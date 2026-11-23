// 파일 → 3D 객체로 바꾸기 (GLB / GLTF / OBJ / SKP / BLEND, ZIP 안에 든 것도).
// SKP(SketchUp) 는 src/models/skpLoader.js 에서 (재질·텍스처가 파일 안에 다 들어 있음).
// BLEND(Blender) 는 이 컴퓨터의 Blender 로 GLB 로 바꿔서 읽음: src/models/blendLoader.js
// GLTF 의 .bin·텍스처, OBJ 의 .mtl·텍스처는 함께 넣은 파일들 중에서 이름으로 찾아 연결한다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { loadSkp } from './skpLoader.js';
import { convertBlend, tidyBlendScene } from './blendLoader.js';

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'skp', 'blend'];

// 압축(Draco)된 GLB 를 풀기 위한 해제기. 파일은 public/draco 폴더에 있음.
const base = import.meta.env.BASE_URL;
const draco = new DRACOLoader().setDecoderPath({
  js: base + 'draco/draco_wasm_wrapper.js',
  wasm: base + 'draco/draco_decoder.wasm',
});

/**
 * 파일 목록에서 모델 파일을 찾아 불러온다.
 * @param {{file: File, path: string}[]} entries  path 는 폴더 안 경로 (예: 'house/scene.gltf')
 * @returns {Promise<{ models: {name, object, entry}[], files, errors: string[], warnings: string[] }>}
 *   files = ZIP 을 푼 뒤의 파일 목록 (프로젝트 저장에 원본으로 담음)
 */
export async function loadModelsFromFiles(entries) {
  const all = await expandZips(entries);
  const modelEntries = all.filter((e) => MODEL_EXTENSIONS.includes(extOf(e.path)));

  const models = [];
  const errors = [];
  const warnings = [];

  if (modelEntries.length === 0) {
    errors.push('불러올 모델 파일(GLB/GLTF/OBJ/SKP/BLEND)이 없어요.');
    return { models, files: all, errors, warnings };
  }

  for (const entry of modelEntries) {
    const name = entry.file.name;
    const resolver = createResolver(entry, all);
    const missingText = () => {
      const list = [...resolver.missing];
      return `${list.slice(0, 3).join(', ')}${list.length > 3 ? ' …' : ''}`;
    };
    try {
      const { object, noMtl, notes } = await loadOne(entry, resolver);
      cleanUp(object);
      models.push({ name, object, entry });
      for (const note of notes) warnings.push(`${name}: ${note}`);
      if (resolver.missing.size) {
        warnings.push(`${name}: 함께 필요한 파일 ${resolver.missing.size}개를 못 찾았어요 (${missingText()})`);
      }
      if (noMtl) warnings.push(`${name}: 재질 파일(.mtl)이 없어 기본 색으로 표시해요.`);
    } catch (err) {
      console.error(err);
      errors.push(
        resolver.missing.size
          ? `${name}: 함께 필요한 파일이 없어요 — ${missingText()}\n(모델과 같이 선택하거나, 폴더/ZIP 째로 넣어 주세요)`
          : `${name}: 불러오기 실패 — ${err?.message || err}`,
      );
    }
  }
  return { models, files: all, errors, warnings };
}

/**
 * 파일 묶음(files) 안의 모델 파일 하나(path)만 다시 불러오기 — 프로젝트 열기에서 씀.
 * @returns {Promise<THREE.Object3D>}
 */
export async function loadModelAt(files, path) {
  const entry = files.find((e) => e.path === path);
  if (!entry) throw new Error(`프로젝트 안에 ${path} 파일이 없어요.`);
  const { object } = await loadOne(entry, createResolver(entry, files));
  cleanUp(object);
  return object;
}

async function loadOne(entry, resolver) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(resolver.resolve);

  const type = extOf(entry.path);
  let object;
  let noMtl = false;
  let notes = [];

  if (type === 'glb' || type === 'gltf' || type === 'blend') {
    const loader = new GLTFLoader(manager);
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    let data;
    if (type === 'blend') ({ data, notes } = await convertBlend(entry, resolver.files));
    else data = type === 'glb' ? await entry.file.arrayBuffer() : await entry.file.text();
    const gltf = await loader.parseAsync(data, '');
    object = gltf.scene || gltf.scenes[0];
    if (type === 'blend') tidyBlendScene(object, gltf.parser);
  } else if (type === 'obj') {
    const text = await entry.file.text();
    const loader = new OBJLoader(manager);

    // OBJ 안의 "mtllib 이름.mtl" 을 보고 재질 파일을 찾음
    const mtlNames = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);
    const mtlEntry = mtlNames.map(resolver.find).find(Boolean);
    if (mtlEntry) {
      const materials = new MTLLoader(manager).parse(await mtlEntry.file.text(), '');
      materials.preload();
      loader.setMaterials(materials);
    } else if (mtlNames.length) {
      resolver.missing.add(mtlNames[0]);
    } else {
      noMtl = true;
    }
    object = loader.parse(text);
  } else if (type === 'skp') {
    object = await loadSkp(await entry.file.arrayBuffer());
  }

  return { object, noMtl, notes };
}

/** 불러온 모델 정리: 파일에 딸려 온 조명·카메라 제거, 면 양쪽 다 보이게 */
function cleanUp(object) {
  const remove = [];
  object.traverse((o) => {
    if (o.isLight || o.isCamera) remove.push(o);
    if (o.material) {
      // 방 안에서 벽이 뚫려 보이지 않게 (SKP 는 앞뒷면을 이미 맞춰 놓아서 그대로: src/models/skpLoader.js)
      for (const m of [].concat(o.material)) if (!m.userData.fixedSide) m.side = THREE.DoubleSide;
    }
  });
  for (const o of remove) o.removeFromParent();
}

/** ZIP 파일이 있으면 풀어서 안의 파일들을 목록에 넣는다 */
async function expandZips(entries) {
  const out = [];
  for (const e of entries) {
    if (extOf(e.path) !== 'zip') {
      out.push(e);
      continue;
    }
    const files = unzipSync(new Uint8Array(await e.file.arrayBuffer()));
    const folder = e.path.replace(/\.zip$/i, '');
    for (const [path, data] of Object.entries(files)) {
      if (path.endsWith('/') || path.startsWith('__MACOSX/')) continue;
      out.push({ file: new File([data], baseName(path)), path: `${folder}/${path}` });
    }
  }
  return out;
}

/**
 * 모델 파일이 참조하는 다른 파일(예: 'textures/wood.jpg')을
 * 함께 넣은 파일 중에서 찾아 브라우저용 주소(blob URL)로 바꿔 준다.
 */
function createResolver(modelEntry, all) {
  const dir = dirName(modelEntry.path);
  const byPath = new Map();
  const byName = new Map();
  for (const e of all) {
    byPath.set(normPath(e.path).toLowerCase(), e);
    const name = baseName(e.path).toLowerCase();
    if (!byName.has(name)) byName.set(name, e);
  }
  const urls = new Map();
  const missing = new Set();

  function find(ref) {
    const p = decode(ref).replace(/\\/g, '/');
    return (
      byPath.get(normPath(dir + '/' + p).toLowerCase()) ||
      byPath.get(normPath(p).toLowerCase()) ||
      byName.get(baseName(p).toLowerCase()) ||
      null
    );
  }

  function resolve(url) {
    if (/^(data|blob):/i.test(url)) return url;
    if (/^https?:/i.test(url)) return url;
    const entry = find(url);
    if (!entry) {
      missing.add(baseName(decode(url)));
      return 'missing-file:' + url; // 확실히 실패하게 (엉뚱한 파일을 읽지 않도록)
    }
    if (!urls.has(entry)) urls.set(entry, URL.createObjectURL(entry.file));
    return urls.get(entry);
  }

  return { find, resolve, missing, files: all };
}

// ---------- 경로 도우미 ----------
function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
export function extOf(path) {
  const m = /\.([^./\\]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}
function baseName(path) {
  return path.split(/[/\\]/).pop();
}
function dirName(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}
function normPath(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}
