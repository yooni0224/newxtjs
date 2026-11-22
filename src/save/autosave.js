// 자동 저장: 실수로 창을 닫아도 작업을 되살릴 수 있게 브라우저 저장소(IndexedDB)에 계속 저장.
//   - 무언가 바뀌면 잠깐(SAVE_DELAY) 기다렸다가 저장, 시점만 움직였을 때는 VIEW_CHECK 마다 확인해서 저장
//   - 창을 닫거나 다른 탭으로 갈 때도 저장 시도
//   - 모델 원본 파일은 묶음마다 한 번만 넣고(크니까), 자주 저장하는 건 작은 project.json 내용뿐
// 다시 열었을 때: 지난번 자동 저장을 '복구용' 칸으로 옮겨 두고 '복구 / 버리기' 를 물음
//   (그동안 새 작업은 원래 칸에 자동 저장되므로 복구용은 덮어쓰지 않음)
// 저장소: 'kv' (current = 지금 작업, recovery = 복구용) + 'bundles' (묶음 id → 원본 파일들)

const DB_NAME = 'webtoon-bg-3d';
const SAVE_DELAY = 1000; // ms
const VIEW_CHECK = 20000; // ms

/**
 * @param project   src/save/project.js
 * @param store     src/models/modelStore.js (원본 파일 묶음)
 * @param onStatus  (글) => void  — 자동 저장 상태 표시
 */
export function createAutosave({ project, store, onStatus = () => {} }) {
  let db = null;
  let timer = null;
  let enabled = false;
  let saving = false;
  let again = false;
  let lastView = '';
  const savedBundles = new Set(); // 이미 저장소에 넣은 묶음

  /** 시작: 저장소 열기, 지난 작업을 복구용으로 옮기기. 복구할 게 있으면 그 정보를 돌려줌 */
  async function init() {
    try {
      db = await openDb();
    } catch (err) {
      console.warn('자동 저장을 쓸 수 없어요:', err);
      onStatus('자동 저장을 쓸 수 없어요 (브라우저 저장소가 막혀 있음)');
      return null;
    }
    for (const key of await keys('bundles')) savedBundles.add(key);
    const current = await get('kv', 'current');
    if (current && project.hasContent(current.state)) {
      await put('kv', 'recovery', current);
      await del('kv', 'current');
    }
    enabled = true;
    const recovery = await get('kv', 'recovery');
    return recovery && project.hasContent(recovery.state) ? summary(recovery) : null;
  }

  /** 바뀌었음 → 잠깐 뒤 저장 */
  function schedule() {
    if (!enabled) return;
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY);
  }

  async function save() {
    clearTimeout(timer);
    timer = null;
    if (!enabled || !db) return;
    if (saving) {
      again = true;
      return;
    }
    saving = true;
    try {
      const state = project.collect();
      // 새 원본 파일 묶음만 넣음
      for (const b of store.usedBundles()) {
        if (savedBundles.has(b.id)) continue;
        await put('bundles', b.id, { id: b.id, files: b.files.map((f) => ({ path: f.path, file: f.file })) });
        savedBundles.add(b.id);
      }
      await put('kv', 'current', { state, savedAt: Date.now() });
      lastView = JSON.stringify(state.view);
      await cleanBundles();
      onStatus(`자동 저장됨 ${clock(new Date())}`);
    } catch (err) {
      console.error(err);
      onStatus(`자동 저장 실패 — ${err?.name === 'QuotaExceededError' ? '저장 공간이 부족해요' : err.message}`);
    } finally {
      saving = false;
      if (again) {
        again = false;
        schedule();
      }
    }
  }

  /** 지금 작업·복구용 어디에도 안 쓰는 묶음 지우기 */
  async function cleanBundles() {
    const used = new Set();
    for (const key of ['current', 'recovery']) {
      const v = await get('kv', key);
      for (const b of v?.state.bundles || []) used.add(b.id);
    }
    for (const id of await keys('bundles')) {
      if (!used.has(id)) {
        await del('bundles', id);
        savedBundles.delete(id);
      }
    }
  }

  /** 복구용 작업을 엶 */
  async function recover() {
    const recovery = await get('kv', 'recovery');
    if (!recovery) return [];
    const bundleFiles = new Map();
    for (const b of recovery.state.bundles || []) {
      const stored = await get('bundles', b.id);
      if (stored) bundleFiles.set(b.id, stored.files);
    }
    const problems = await project.apply(recovery.state, bundleFiles);
    await del('kv', 'recovery');
    for (const id of bundleFiles.keys()) savedBundles.add(id); // 이미 저장소에 있음
    await save();
    return problems;
  }

  async function discard() {
    await del('kv', 'recovery');
    await cleanBundles();
  }

  // 시점만 움직였을 때도 가끔 저장 (컷을 안 만들어도 마지막 시점이 남게)
  setInterval(() => {
    if (!enabled) return;
    if (JSON.stringify(project.collect().view) !== lastView) save();
  }, VIEW_CHECK);
  // 창을 닫거나 숨길 때 저장 시도 (끝까지 못 쓸 수도 있지만 그 전 저장이 남아 있음)
  const flush = () => {
    if (enabled && (timer || again)) save();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // ---------- IndexedDB 도우미 ----------
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('bundles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function request(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  const get = (s, key) => request(s, 'readonly', (os) => os.get(key));
  const put = (s, key, value) => request(s, 'readwrite', (os) => os.put(value, key));
  const del = (s, key) => request(s, 'readwrite', (os) => os.delete(key));
  const keys = (s) => request(s, 'readonly', (os) => os.getAllKeys());

  return {
    init,
    schedule,
    save,
    recover,
    discard,
    /** 개발용: 지금 상태 */
    debugState: () => ({ enabled, saving, again, pending: !!timer }),
  };
}

/** 복구 안내에 쓸 요약 */
function summary({ state, savedAt }) {
  return {
    name: state.name,
    savedAt: new Date(savedAt),
    models: state.models?.length || 0,
    people: state.people?.length || 0,
    cuts: state.cuts?.length || 0,
  };
}

export function clock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
