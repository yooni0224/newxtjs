// BLEND(Blender) 파일 변환기 — Vite 개발 서버(npm run dev)·미리보기 서버에 붙는 작은 기능.
// 브라우저는 .blend 를 직접 못 읽으므로(모디파이어·노드 재질은 Blender 만 계산할 수 있음),
// 이 컴퓨터에 설치된 Blender 를 화면 없이 실행해서 GLB 로 바꿔 돌려준다 (server/blend_to_glb.py).
//
//   POST /api/blend/convert?main=<경로>   몸통 = ZIP(.blend + 같이 넣은 텍스처) → GLB
//   GET  /api/blend/status                Blender 를 찾았는지, 버전
//   POST /api/blend/path                  { path } — 못 찾았을 때 사용자가 알려 준 Blender 위치 저장(.blender-path)
//
// - Blender 찾는 순서: 환경 변수 BLENDER_PATH → .blender-path → PATH → 흔한 설치 위치(윈도우·맥·리눅스·스팀)
// - 같은 파일은 다시 변환하지 않음 (node_modules/.cache/webtoon-blend 에 결과 보관, 최근 30개)
// - 변환은 한 번에 하나씩, 10분 넘으면 중단
// - 안전: 이 툴 화면에서 보낸 요청만 받음(다른 사이트가 몰래 못 부르게), .blend 안의 파이썬 자동 실행 끔(-Y)
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(HERE, 'blend_to_glb.py');
const PATH_FILE = path.join(ROOT, '.blender-path');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'webtoon-blend');
const CACHE_KEEP = 30;
const TIMEOUT_MS = 10 * 60 * 1000;

export function blendConverter() {
  const attach = (server) => {
    server.middlewares.use('/api/blend', (req, res) => {
      handle(req, res).catch((err) => {
        if (!(err instanceof ConvertError)) console.error('[blend]', err);
        sendJson(res, err.status || 500, { code: err.code || 'FAILED', error: err.message || String(err) });
      });
    });
  };
  return { name: 'webtoon-blend-converter', configureServer: attach, configurePreviewServer: attach };
}

async function handle(req, res) {
  if (!fromThisApp(req)) return sendJson(res, 403, { code: 'FORBIDDEN', error: '이 툴 화면에서 보낸 요청만 받아요.' });
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.replace(/\/+$/, '');

  if (route === '/status' && req.method === 'GET') {
    const blender = findBlender();
    return sendJson(res, 200, blender ? { found: true, path: blender, version: await blenderVersion(blender) } : { found: false });
  }

  if (route === '/path' && req.method === 'POST') {
    const { path: given } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const exe = normalizeGivenPath(given);
    if (!exe) return sendJson(res, 400, { code: 'BAD_PATH', error: 'Blender 실행 파일(blender / blender.exe / Blender.app)이 아니에요.' });
    if (!isFile(exe)) return sendJson(res, 400, { code: 'BAD_PATH', error: `그 위치에 파일이 없어요: ${exe}` });
    const version = await blenderVersion(exe);
    if (!version) return sendJson(res, 400, { code: 'BAD_PATH', error: '실행해 봤지만 Blender 가 아니거나 실행되지 않아요.' });
    fs.writeFileSync(PATH_FILE, exe + '\n');
    return sendJson(res, 200, { found: true, path: exe, version });
  }

  if (route === '/convert' && req.method === 'POST') {
    const main = url.searchParams.get('main') || '';
    const body = await readBody(req);
    const glb = await queue(() => convert(body, main));
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': glb.length });
    return res.end(glb);
  }

  sendJson(res, 404, { code: 'NOT_FOUND', error: '없는 주소' });
}

/** 다른 웹사이트가 이 주소로 몰래 요청하지 못하게: 우리 화면이 붙이는 머리말 + 같은 출처만 */
function fromThisApp(req) {
  if (req.headers['x-webtoon'] !== '1') return false; // 다른 출처에서 이 머리말을 붙이면 브라우저가 사전 확인 → 우리는 허락 안 함
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ---------- 변환 ----------
let chain = Promise.resolve();
/** 한 번에 하나씩 (Blender 여러 개가 동시에 뜨지 않게) */
function queue(job) {
  const run = chain.then(job, job);
  chain = run.catch(() => {});
  return run;
}

class ConvertError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function convert(body, main) {
  const files = unzipSync(new Uint8Array(body));
  // 보관 열쇠 = 변환 스크립트 + 파일 이름·내용 (ZIP 자체는 만든 시각이 들어가서 매번 달라짐)
  const hash = crypto.createHash('sha1').update(fs.readFileSync(SCRIPT)).update('\0').update(main);
  for (const name of Object.keys(files).sort()) hash.update('\0').update(name).update('\0').update(files[name]);
  const key = hash.digest('hex');
  const cached = path.join(CACHE_DIR, `${key}.glb`);
  if (isFile(cached)) {
    const now = new Date();
    fs.utimesSync(cached, now, now);
    return fs.readFileSync(cached);
  }

  const blender = findBlender();
  if (!blender) throw new ConvertError('NO_BLENDER', 'Blender 를 찾지 못했어요.', 424);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'webtoon-blend-'));
  try {
    const inDir = path.join(work, 'in');
    for (const [name, data] of Object.entries(files)) {
      const target = safeJoin(inDir, name);
      if (!target || name.endsWith('/')) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    const blendFile = safeJoin(inDir, main);
    if (!blendFile || !isFile(blendFile)) throw new ConvertError('FAILED', '보낸 파일 안에 .blend 가 없어요.', 400);
    const out = path.join(work, 'out.glb');
    const args = ['-b', '--factory-startup', '-Y', blendFile, '--python-exit-code', '1', '--python', SCRIPT, '--', out, inDir];
    const { code, log, timedOut } = await run(blender, args, TIMEOUT_MS);
    if (timedOut) throw new ConvertError('FAILED', `Blender 변환이 ${TIMEOUT_MS / 60000}분 넘게 걸려서 멈췄어요.`);
    if (code !== 0 || !isFile(out)) throw new ConvertError('FAILED', explainFailure(log, await blenderVersion(blender)));
    const glb = fs.readFileSync(out);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cached, glb);
    pruneCache();
    return glb;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Blender 출력에서 사람이 알아볼 만한 실패 이유 */
function explainFailure(log, version) {
  const lines = log.split(/\r?\n/);
  const own = lines.find((l) => l.includes('WEBTOON_ERROR:'));
  if (own) return own.split('WEBTOON_ERROR:')[1].trim();
  const hints = [];
  if (/not a blend file|failed to read blend file|newer blender|newer version|file format version/i.test(log)) {
    // 새 버전(예: 5.x)으로 저장한 파일은 옛 Blender 가 '블렌드 파일이 아님' 으로 못 읽음
    hints.push(
      `Blender 가 이 파일을 열지 못했어요. 더 새 버전 Blender 로 저장한 파일일 수 있어요` +
        `${version ? ` (이 컴퓨터의 Blender: ${version})` : ''} → Blender 를 최신 버전으로 업데이트해 주세요.`,
    );
    return hints[0];
  }
  const important = lines.filter((l) => /error|exception|traceback|cannot|failed/i.test(l)).slice(-6);
  return [...hints, 'Blender 변환 실패', ...important].join('\n').slice(0, 1500);
}

function run(exe, args, timeout) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
    let log = '';
    const keep = (chunk) => {
      log += chunk.toString();
      if (log.length > 200000) log = log.slice(-100000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, log: log + '\n' + err.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, log, timedOut });
    });
  });
}

function pruneCache() {
  try {
    const entries = fs
      .readdirSync(CACHE_DIR)
      .filter((n) => n.endsWith('.glb'))
      .map((n) => ({ file: path.join(CACHE_DIR, n), time: fs.statSync(path.join(CACHE_DIR, n)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const e of entries.slice(CACHE_KEEP)) fs.rmSync(e.file, { force: true });
  } catch {
    // 정리는 실패해도 괜찮음
  }
}

// ---------- Blender 찾기 ----------
const versions = new Map();

function blenderVersion(exe) {
  if (versions.has(exe)) return Promise.resolve(versions.get(exe));
  return new Promise((resolve) => {
    execFile(exe, ['-b', '--factory-startup', '--version'], { timeout: 60000, windowsHide: true }, (err, stdout) => {
      const m = /Blender\s+(\d+\.\d+(?:\.\d+)?)/.exec(stdout || '');
      const v = m ? m[1] : null;
      if (v) versions.set(exe, v);
      resolve(v);
    });
  });
}

export function findBlender() {
  for (const p of candidates()) if (p && isFile(p)) return p;
  return null;
}

function candidates() {
  const list = [];
  if (process.env.BLENDER_PATH) list.push(normalizeGivenPath(process.env.BLENDER_PATH, true));
  try {
    list.push(fs.readFileSync(PATH_FILE, 'utf8').trim());
  } catch {
    // 아직 저장한 위치 없음
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) list.push(path.join(dir, 'blender.exe'));
    const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files'];
    for (const r of new Set(roots.filter(Boolean))) {
      for (const d of byVersion(path.join(r, 'Blender Foundation'))) list.push(path.join(d, 'blender.exe'));
      list.push(path.join(r, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'));
    }
    if (process.env.LOCALAPPDATA) {
      for (const d of byVersion(path.join(process.env.LOCALAPPDATA, 'Programs', 'Blender Foundation'))) list.push(path.join(d, 'blender.exe'));
    }
  } else if (process.platform === 'darwin') {
    for (const apps of ['/Applications', path.join(home, 'Applications')]) {
      for (const app of byVersion(apps, /^blender.*\.app$/i)) list.push(path.join(app, 'Contents', 'MacOS', 'Blender'));
    }
    list.push(path.join(home, 'Library/Application Support/Steam/steamapps/common/Blender/Blender.app/Contents/MacOS/Blender'));
    for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) list.push(path.join(dir, 'blender'));
  } else {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) list.push(path.join(dir, 'blender'));
    list.push('/snap/bin/blender', '/usr/local/bin/blender', '/usr/bin/blender', '/opt/blender/blender');
    for (const d of byVersion(home, /^blender/i)) list.push(path.join(d, 'blender'));
    list.push(path.join(home, '.steam/steam/steamapps/common/Blender/blender'));
  }
  return list;
}

/** 폴더 안에서 이름이 맞는 것들을 버전 높은 순으로 (예: 'Blender 4.2' 가 'Blender 3.6' 보다 먼저) */
function byVersion(dir, pattern = /^blender/i) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => pattern.test(n));
  } catch {
    return [];
  }
  const ver = (n) => (n.match(/\d+/g) || []).map(Number);
  names.sort((a, b) => {
    const va = ver(a);
    const vb = ver(b);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const d = (vb[i] ?? -1) - (va[i] ?? -1);
      if (d) return d;
    }
    return 0;
  });
  return names.map((n) => path.join(dir, n));
}

/**
 * 사용자가 알려 준 위치 정리: 따옴표 빼기, 맥 'Blender.app' → 안의 실행 파일, 폴더 → 그 안의 blender(.exe).
 * 실행 파일 이름이 blender 가 아니면 null (아무 프로그램이나 실행하지 않게) — 환경 변수(trusted)는 이름 검사 안 함
 */
function normalizeGivenPath(given, trusted = false) {
  if (typeof given !== 'string') return null;
  let p = given.trim().replace(/^["']|["']$/g, '');
  if (!p) return null;
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  p = path.resolve(p);
  if (/\.app\/?$/i.test(p)) p = path.join(p, 'Contents', 'MacOS', 'Blender');
  else if (isDir(p)) p = path.join(p, process.platform === 'win32' ? 'blender.exe' : 'blender');
  if (!trusted && !/^blender(\.exe)?$/i.test(path.basename(p))) return null;
  return p;
}

// ---------- 도우미 ----------
function safeJoin(base, rel) {
  const target = path.resolve(base, rel.replace(/\\/g, '/'));
  return target === base || target.startsWith(base + path.sep) ? target : null;
}
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
