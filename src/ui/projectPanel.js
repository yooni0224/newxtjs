// '파일' 칸의 프로젝트 부분: 이름, 저장(Ctrl+S) / 열기 / 새로, 자동 저장 상태, 복구 안내.
// 저장 내용은 src/save/project.js, 자동 저장은 src/save/autosave.js
//   - 저장: 프로젝트 파일(.webtoon3d) 하나에 모델 원본 파일까지.
//     크롬·엣지: 처음엔 '다른 이름으로 저장' 창 → 다음부터 Ctrl+S 는 같은 파일에 덮어씀 (Ctrl+Shift+S: 다른 이름으로)
//     그 밖의 브라우저: 내려받기
//   - 열기: 버튼(크롬·엣지는 연 파일에 그대로 덮어쓸 수 있음), 또는 .webtoon3d 파일을 화면에 끌어다 놓기 (main.js 의 importFiles)
//   - 저장하지 않은 변경이 있으면 창을 닫을 때 브라우저가 한 번 물어봄
import { on } from '../core/events.js';
import { isTyping } from '../core/keyboard.js';
import { createAutosave, clock } from '../save/autosave.js';
import { PROJECT_EXT } from '../save/project.js';
import { toast } from './toast.js';

// 이 신호가 오면 '바뀜' → 자동 저장 예약 + 닫을 때 확인
const CHANGE_EVENTS = [
  'models-changed', 'object-transformed', 'model-flags-changed', 'people-changed', 'pose-changed',
  'people-visibility-changed', 'cuts-changed', 'shadows-changed', 'ao-changed', 'render-lines-changed',
  'export-settings-changed', 'frame-changed', 'lens-changed', 'eye-height-changed', 'terrain-follow-changed',
  'grid-visibility-changed', 'project-changed',
];

export function setupProjectPanel({ project, store }) {
  const $ = (id) => document.getElementById(id);
  const nameInput = $('project-name');
  const fileInput = $('project-input');
  const status = $('autosave-status');
  let dirty = false; // 마지막으로 저장/열기 한 뒤 바뀐 게 있는지
  let busy = false; // 열기·저장 도중 (그동안 생기는 신호는 '바뀜'으로 안 침)
  let fileHandle = null; // 이 프로젝트를 저장한(연) 파일 — 크롬·엣지에서 다음 저장 때 덮어씀
  const pickerTypes = [{ description: '웹툰 배경 3D 프로젝트', accept: { 'application/zip': [PROJECT_EXT] } }];

  const autosave = createAutosave({ project, store, onStatus: (text) => (status.textContent = text) });

  // ---------- 이름 ----------
  nameInput.value = project.getName();
  nameInput.addEventListener('change', () => project.setName(nameInput.value));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur();
  });
  on('project-changed', ({ name }) => {
    if (document.activeElement !== nameInput) nameInput.value = name;
  });

  // ---------- 저장 ----------
  async function save({ saveAs = false } = {}) {
    if (busy) return;
    busy = true;
    let loading = null;
    try {
      // 저장할 파일 고르기는 누른 직후에 해야 함 (브라우저 규칙) → 파일 만들기 전에
      let handle = saveAs ? null : fileHandle;
      if (!handle && window.showSaveFilePicker) {
        try {
          handle = await window.showSaveFilePicker({ suggestedName: `${project.getName()}${PROJECT_EXT}`, types: pickerTypes });
        } catch (err) {
          if (err.name === 'AbortError') return; // 취소
          handle = null; // 창을 못 띄우면 내려받기로
        }
      }
      loading = toast('프로젝트 저장 중…', 'info', 120000);
      await nextFrame();
      const file = await project.toFile();
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
        fileHandle = handle;
        toast(`저장함: ${handle.name} (${sizeText(file.size)})`);
      } else {
        download(file);
        toast(`내려받음: ${file.name} (${sizeText(file.size)})`);
      }
      dirty = false;
    } catch (err) {
      console.error(err);
      toast(`저장 실패 — ${err.message}`, 'error', 9000);
    } finally {
      loading?.remove();
      busy = false;
    }
  }
  $('btn-project-save').addEventListener('click', (e) => {
    e.currentTarget.blur();
    save({ saveAs: e.shiftKey });
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && !e.altKey) {
      e.preventDefault(); // 브라우저의 '페이지 저장' 막기
      if (!isTyping(e.target) || e.target === nameInput) save({ saveAs: e.shiftKey });
    }
  });

  // ---------- 열기 ----------
  /** 프로젝트 파일 열기 (버튼·끌어다 놓기) */
  async function open(file, handle = null) {
    if (busy) return;
    if (dirty && !confirm('저장하지 않은 변경이 있어요. 프로젝트를 열면 지금 작업은 사라집니다. 계속할까요?')) return;
    busy = true;
    const loading = toast('프로젝트 여는 중…', 'info', 120000);
    await nextFrame();
    try {
      const { state, bundleFiles } = await project.readFile(file);
      const problems = await project.apply(state, bundleFiles);
      for (const p of problems) toast(p, 'warn', 9000);
      dirty = false;
      fileHandle = handle; // 크롬·엣지에서 연 파일이면 다음 저장 때 그 파일에 덮어씀
      toast(`열었어요: ${state.name}`);
    } catch (err) {
      console.error(err);
      toast(`열기 실패 — ${err.message}`, 'error', 9000);
    } finally {
      loading.remove();
      busy = false;
      autosave.schedule();
    }
  }
  $('btn-project-open').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    if (!window.showOpenFilePicker) return fileInput.click();
    try {
      const [handle] = await window.showOpenFilePicker({ types: pickerTypes });
      open(await handle.getFile(), handle);
    } catch (err) {
      if (err.name !== 'AbortError') fileInput.click(); // 창을 못 띄우면 예전 방식으로
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) open(file);
  });

  // ---------- 새 프로젝트 ----------
  $('btn-project-new').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (dirty && !confirm('저장하지 않은 변경이 있어요. 새로 시작하면 지금 작업은 사라집니다. 계속할까요?')) return;
    busy = true;
    project.clearScene();
    project.setName('새 프로젝트');
    busy = false;
    dirty = false;
    fileHandle = null;
    autosave.schedule();
  });

  // ---------- 바뀜 → 자동 저장 ----------
  for (const name of CHANGE_EVENTS) {
    on(name, () => {
      if (busy) return;
      dirty = true;
      autosave.schedule();
    });
  }
  // 저장하지 않은 변경이 있으면 창 닫기 전에 확인 (자동 저장도 해 둠)
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------- 복구 안내 ----------
  const banner = $('recovery-banner');
  autosave.init().then((info) => {
    if (!info) return;
    const parts = [info.models && `모델 ${info.models}`, info.people && `사람 ${info.people}`, info.cuts && `컷 ${info.cuts}`].filter(Boolean);
    $('recovery-text').textContent =
      `자동 저장된 작업이 있어요: '${info.name}' (${dateText(info.savedAt)}, ${parts.join(' · ')})`;
    banner.hidden = false;
  });
  $('btn-recover').addEventListener('click', async () => {
    if (dirty && !confirm('지금 작업은 사라지고 자동 저장된 작업으로 바뀝니다. 계속할까요?')) return;
    banner.hidden = true;
    busy = true;
    const loading = toast('복구하는 중…', 'info', 120000);
    try {
      const problems = await autosave.recover();
      for (const p of problems) toast(p, 'warn', 9000);
      toast('복구했어요. 프로젝트 파일로도 저장해 두세요.');
      dirty = true; // 아직 파일로 저장 안 한 상태
    } catch (err) {
      console.error(err);
      toast(`복구 실패 — ${err.message}`, 'error', 9000);
    } finally {
      loading.remove();
      busy = false;
    }
  });
  $('btn-recover-discard').addEventListener('click', () => {
    if (!confirm('자동 저장된 작업을 버릴까요? 되돌릴 수 없어요.')) return;
    banner.hidden = true;
    autosave.discard();
  });

  return { open, autosave };
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function sizeText(bytes) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1e3))}KB`;
}

function dateText(d) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${clock(d).slice(0, 5)}`;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
