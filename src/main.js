// 시작점: 각 기능을 만들고 서로 연결한다.
// 기능별 코드는 각 파일에 있음 → PLAN.md 의 '파일 구조' 참고.
import * as THREE from 'three';

import { on } from './core/events.js';
import { createViewer } from './core/viewer.js';
import { createEnvironment } from './core/environment.js';
import { createEditorCamera } from './core/editorCamera.js';
import { createModelStore } from './models/modelStore.js';
import { loadModelsFromFiles } from './models/loadFiles.js';
import { setupFileInput } from './models/dropZone.js';
import { measure } from './models/size.js';
import { createGizmo } from './editor/gizmo.js';
import { createSelection } from './editor/selection.js';
import { setupShortcuts } from './editor/shortcuts.js';
import { createHumanRef } from './helpers/humanRef.js';
import { setupToolbar } from './ui/toolbar.js';
import { setupInspector } from './ui/inspector.js';
import { toast } from './ui/toast.js';

// ---------- 화면 만들기 ----------
const viewport = document.getElementById('viewport');
const viewer = createViewer(viewport);
const env = createEnvironment(viewer);
const editorCam = createEditorCamera(viewer);
const store = createModelStore(viewer.scene);
const human = createHumanRef(viewer.scene);
const gizmo = createGizmo(viewer, editorCam.controls); // selection 보다 먼저 만들어야 함
const selection = createSelection(viewer, gizmo, () => [...store.list(), human.root]);

// ---------- 편집 동작 ----------
const actions = {
  setMode: (mode) => gizmo.setMode(mode),

  duplicate() {
    const sel = selection.getSelected();
    if (sel?.userData.kind !== 'model') return;
    selection.select(store.duplicate(sel));
  },

  remove() {
    const sel = selection.getSelected();
    if (!sel) return;
    selection.select(null);
    if (sel.userData.kind === 'human') human.setVisible(false);
    else store.remove(sel);
  },

  focus() {
    const sel = selection.getSelected();
    if (sel) editorCam.focusOn(sel);
    else if (store.list().length) editorCam.focusOn(store.list());
  },

  deselect: () => selection.select(null),
};

setupShortcuts(actions);
setupInspector(actions);
setupToolbar({ gizmo, env, human, getHumanSpot: () => editorCam.controls.target });
setupFileInput(viewport, importFiles);

// 사람 모형을 끄면 선택도 해제
on('human-visibility-changed', (visible) => {
  if (!visible && selection.getSelected() === human.root) selection.select(null);
});

// 모델이 하나도 없을 때만 안내 문구 표시
const emptyHint = document.getElementById('empty-hint');
on('models-changed', () => {
  emptyHint.hidden = store.list().length > 0;
});

// ---------- 파일 불러오기 ----------
const GAP = 0.5; // 여러 개를 한 번에 불러올 때 사이 간격(m)

async function importFiles(entries, dropPoint) {
  const loading = toast('불러오는 중…', 'info', 120000);
  await nextFrame(); // 알림이 먼저 그려지도록

  let result;
  try {
    result = await loadModelsFromFiles(entries);
  } finally {
    loading.remove();
  }
  const { models, errors, warnings } = result;
  for (const msg of errors) toast(msg, 'error', 9000);
  for (const msg of warnings) toast(msg, 'warn', 7000);
  if (!models.length) return;

  const wasEmpty = store.list().length === 0;
  const anchor = placementPoint(dropPoint);
  const right = new THREE.Vector3().setFromMatrixColumn(viewer.camera.matrixWorld, 0).setY(0);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();

  // 놓은 위치에서 화면 오른쪽 방향으로 나란히 배치
  const roots = [];
  let edge = 0;
  models.forEach((m, i) => {
    const root = store.add(m.object, { name: m.name, entries });
    const size = measure(root);
    const offset = i === 0 ? 0 : edge + GAP + size.x / 2;
    root.position.copy(anchor).addScaledVector(right, offset);
    root.position.y = 0;
    edge = offset + size.x / 2;
    warnIfOddSize(m.name, size.y);
    roots.push(root);
  });

  selection.select(roots[roots.length - 1]);
  if (wasEmpty) editorCam.focusOn(roots);
  toast(`${models.length}개 불러옴`);
}

/** 파일을 놓은 바닥 위치. 하늘이나 너무 먼 곳이면 화면 중심 바닥 */
function placementPoint(dropPoint) {
  const target = editorCam.controls.target.clone().setY(0);
  if (!dropPoint) return target;
  const hit = viewer.groundPointAt(dropPoint.x, dropPoint.y);
  const maxDist = viewer.camera.position.distanceTo(editorCam.controls.target) * 4;
  return hit && hit.distanceTo(viewer.camera.position) < maxDist ? hit : target;
}

function warnIfOddSize(name, height) {
  if (height > 100) {
    toast(`${name}: 높이가 ${Math.round(height)}m 예요. 단위가 cm/mm 라면 '높이' 칸에 실제 높이를 넣어 주세요.`, 'warn', 9000);
  } else if (height > 0 && height < 0.05) {
    toast(`${name}: 높이가 ${height.toFixed(3)}m 로 아주 작아요. '높이' 칸에 실제 높이를 넣어 주세요.`, 'warn', 9000);
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

// 개발 중 브라우저 콘솔에서 확인용 (예: app.store.list())
if (import.meta.env.DEV) window.app = { viewer, store, selection, human, gizmo, editorCam };
