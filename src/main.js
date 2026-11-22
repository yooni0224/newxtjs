// 시작점: 각 기능을 만들고 서로 연결한다.
// 기능별 코드는 각 파일에 있음 → PLAN.md 의 '파일 구조' 참고.
import * as THREE from 'three';

import { on, emit } from './core/events.js';
import { createViewer } from './core/viewer.js';
import { createEnvironment } from './core/environment.js';
import { createEditorCamera } from './core/editorCamera.js';
import { createModelStore } from './models/modelStore.js';
import { loadModelsFromFiles } from './models/loadFiles.js';
import { setupFileInput } from './models/dropZone.js';
import { measure, setHeight } from './models/size.js';
import { createGizmo } from './editor/gizmo.js';
import { createSelection } from './editor/selection.js';
import { setupShortcuts } from './editor/shortcuts.js';
import { createSurfacePicker } from './editor/surfacePicker.js';
import { createPeople } from './people/people.js';
import { createPoseMode } from './people/poseMode.js';
import { createLens } from './camera/lens.js';
import { createCutFrame } from './cut/cutFrame.js';
import { createLineOverlay } from './render/lineOverlay.js';
import { createWalkMode } from './camera/walkMode.js';
import { setupToolbar } from './ui/toolbar.js';
import { setupInspector } from './ui/inspector.js';
import { setupCameraPanel } from './ui/cameraPanel.js';
import { setupPeoplePanel } from './ui/peoplePanel.js';
import { setupCutPanel } from './ui/cutPanel.js';
import { setupHelpLine } from './ui/helpLine.js';
import { setupLayerPanel } from './ui/layerPanel.js';
import { toast } from './ui/toast.js';

// ---------- 화면 만들기 ----------
const viewport = document.getElementById('viewport');
const viewer = createViewer(viewport);
const env = createEnvironment(viewer);
const editorCam = createEditorCamera(viewer);
const store = createModelStore(viewer.scene);
const people = createPeople(viewer.scene);
const gizmo = createGizmo(viewer, editorCam.controls); // selection 보다 먼저 만들어야 함
const selection = createSelection(viewer, gizmo, () => [...store.list(), ...people.list()]);
const poseMode = createPoseMode({ viewer, gizmo, selection, people }); // 사람 관절 돌리기
const frame = createCutFrame(viewer); // 컷 프레임 (화각·내보내기 기준)
const lens = createLens(viewer, frame.getRect, 35); // 처음 화각 35mm
const lineOverlay = createLineOverlay(viewer); // 일반 렌더 선 (화면 미리보기 + 설정)
const walk = createWalkMode({ viewer, editorCam, selection, getSurfaces: () => store.list() });
// 바닥·모델 윗면 찍기 (시작 위치 찍기, 사람 배치). 사람 모형은 밟을 수 없음
const picker = createSurfacePicker({ viewer, getSurfaces: () => store.list() });

// ---------- 편집 동작 ----------
const actions = {
  setMode: (mode) => gizmo.setMode(mode),

  /** 복제: 사람 / 모델 전체 / 그룹 편집 중이면 부품 */
  duplicate() {
    const sel = selection.getSelected();
    if (!sel) return;
    if (sel.userData.kind === 'human') selection.select(people.duplicate(sel));
    else selection.select(store.duplicate(sel));
  },

  remove() {
    const sel = selection.getSelected();
    if (!sel || poseMode.getJoint()) return; // 관절을 고른 동안에는 사람을 지우지 않음
    selection.select(null);
    if (sel.userData.kind === 'human') people.remove(sel);
    else store.remove(sel);
  },

  /** 높이 입력: 모델은 비율 유지 크기 조절, 사람은 키 바꾸기 */
  setHeight(object, meters) {
    if (object.userData.kind !== 'human') return setHeight(object, meters);
    people.setHeight(object, meters);
    return true;
  },

  focus() {
    const sel = selection.getSelected();
    if (sel) editorCam.focusOn(sel);
    else if (store.list().length) editorCam.focusOn(store.list());
  },

  /** Esc: 관절 해제 → 포즈 모드 끝 → 그룹 한 단계 위로 → 선택 해제 순서로 한 단계씩 */
  escape() {
    if (poseMode.escape()) return;
    if (selection.exitContext()) return;
    selection.select(null);
  },
};

// 더블클릭: 사람 → 포즈 모드, 모델·그룹 → 그 안으로 들어가기
selection.onDoubleClick((sel) => {
  if (sel?.userData.kind === 'human') poseMode.enter(sel);
  else if (sel) selection.enter(sel);
});
// 모델·부품이 지워지거나 숨겨지거나 잠기면 선택·그룹 편집 정리
on('models-changed', () => selection.validate());
on('model-flags-changed', () => selection.validate());

setupShortcuts(actions);
setupInspector(actions);
setupCameraPanel({ walk, lens, picker, camera: viewer.camera });
setupPeoplePanel({ people, picker, selection, camera: viewer.camera, poseMode });
setupToolbar({ gizmo, env, people });
setupCutPanel({ viewer, frame, people, lineOverlay });
setupHelpLine({ walk, picker, poseMode, selection });
setupLayerPanel({ store, selection });
setupFileInput(viewport, importFiles);

// 사람 모형을 숨기면 선택도 해제
on('people-visibility-changed', (visible) => {
  if (!visible && selection.getSelected()?.userData.kind === 'human') selection.select(null);
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

/** 파일을 놓은 바닥 위치. 하늘이나 너무 먼 곳이면 화면 중심(1인칭이면 3m 앞) 바닥 */
function placementPoint(dropPoint) {
  const walking = walk.isActive();
  const fallback = walking ? walk.pointAhead(3) : editorCam.controls.target.clone().setY(0);
  if (!dropPoint) return fallback;
  const hit = viewer.groundPointAt(dropPoint.x, dropPoint.y);
  const maxDist = walking ? 50 : viewer.camera.position.distanceTo(editorCam.controls.target) * 4;
  return hit && hit.distanceTo(viewer.camera.position) < maxDist ? hit : fallback;
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
if (import.meta.env.DEV) window.app = { viewer, store, selection, people, poseMode, gizmo, editorCam, lens, walk, picker, frame, lineOverlay, events: { on, emit } };
