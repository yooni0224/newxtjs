// 포즈 모드: 선택한 사람의 관절을 돌려서 자세 만들기.
//   들어가기: '포즈 모드' 버튼 또는 사람 더블클릭
//   관절마다 작은 점이 보임 → 점(또는 몸 부위)을 클릭하면 그 관절에 회전 핸들
//   하위 관절은 따라 움직이고(관절 계층), 사람이 꺾을 수 있는 범위를 넘지 않음 (src/people/pose.js)
//   관절을 안 고른 동안에는 기존처럼 사람 전체 이동/회전 핸들
//   Esc: 관절 해제 → 한 번 더 누르면 포즈 모드 끝
import * as THREE from 'three';
import { on, emit } from '../core/events.js';
import { JOINTS } from './mannequin.js';
import { bodyOf, clampJoint, groundBody } from './pose.js';

const DOT_RADIUS_PX = 5; // 관절 점 크기 (화면 px)
const DOT_PICK_PX = 12; // 이 거리 안을 클릭하면 그 점을 고른 것으로 봄
const DOT_COLOR = 0x29b6ff;
const DOT_SELECTED_COLOR = 0xff7a1a;

export function createPoseMode({ viewer, gizmo, selection, people }) {
  const { scene, camera, canvas } = viewer;
  let person = null; // 포즈 모드 중인 사람
  let joint = null; // 고른 관절

  // ---------- 관절 점 (화면 표시용, 내보내기에는 안 나옴) ----------
  const dots = new THREE.Group();
  dots.name = '관절 점';
  dots.visible = false;
  scene.add(dots);
  viewer.addHelper(dots);
  const dotGeometry = new THREE.SphereGeometry(1, 12, 8);
  const dotMaterial = new THREE.MeshBasicMaterial({ color: DOT_COLOR, depthTest: false, transparent: true });
  const selectedMaterial = new THREE.MeshBasicMaterial({ color: DOT_SELECTED_COLOR, depthTest: false, transparent: true });
  const dotOf = {};
  for (const def of JOINTS) {
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.renderOrder = 1001; // 몸에 가려지지 않게
    dots.add(dot);
    dotOf[def.id] = dot;
  }

  const joints = () => bodyOf(person)?.userData.joints || {};
  const p = new THREE.Vector3();

  viewer.onFrame(() => {
    if (!person) return;
    // 화면에서 늘 같은 크기로 보이게: 카메라와의 거리로 크기 조절
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(canvas.clientHeight, 1);
    for (const [id, j] of Object.entries(joints())) {
      j.getWorldPosition(p);
      const dot = dotOf[id];
      dot.position.copy(p);
      dot.scale.setScalar(p.distanceTo(camera.position) * perPx * DOT_RADIUS_PX);
      dot.material = j === joint ? selectedMaterial : dotMaterial;
    }
  });

  // ---------- 들어가기 / 나가기 ----------
  function enter(target) {
    if (target?.userData.kind !== 'human' || target === person) return;
    exit();
    if (selection.getSelected() !== target) selection.select(target);
    if (selection.getSelected() !== target) return; // 선택이 안 되는 상태 (1인칭 등)
    person = target;
    dots.visible = true;
    emit('pose-mode-changed', person);
  }

  function exit() {
    if (!person) return;
    const was = person;
    person = null;
    joint = null;
    dots.visible = false;
    if (selection.getSelected() === was) gizmo.attach(was); // 핸들을 사람 전체로 되돌림
    emit('pose-joint-changed', null);
    emit('pose-mode-changed', null);
  }

  function selectJoint(j) {
    joint = j || null;
    gizmo.attach(joint || person);
    emit('pose-joint-changed', joint);
  }

  // ---------- 클릭: 관절 점 → 몸 부위 순서로 찾음 ----------
  selection.addClickHandler((x, y) => {
    if (!person) return false;
    const id = nearestDot(x, y);
    if (id) {
      selectJoint(joints()[id]);
      return true;
    }
    const hit = viewer.rayFromScreen(x, y).intersectObject(person, true)[0];
    const part = hit && findJoint(hit.object);
    if (part) {
      selectJoint(part);
      return true;
    }
    return false; // 다른 물체·빈 곳 → 보통 선택 (선택이 바뀌면 포즈 모드 끝)
  });

  function nearestDot(x, y) {
    const rect = canvas.getBoundingClientRect();
    let best = null;
    let bestDist = DOT_PICK_PX;
    for (const [id, j] of Object.entries(joints())) {
      j.getWorldPosition(p).project(camera);
      if (p.z > 1) continue; // 카메라 뒤
      const sx = rect.left + ((p.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - p.y) / 2) * rect.height;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  // ---------- 관절을 돌리면: 범위 지키기 + 발 바닥에 붙이기 ----------
  on('object-transformed', ({ object }) => {
    if (!person || object !== joint) return;
    clampJoint(joint);
    groundBody(bodyOf(person));
    emit('pose-changed', person);
  });

  // 다른 걸 고르면 끝. 키를 바꿔 마네킹이 새로 만들어지면 같은 관절을 다시 고름
  on('selection-changed', (obj) => {
    if (person && obj !== person) exit();
  });
  on('people-changed', () => {
    if (!person) return;
    if (!people.list().includes(person)) return exit();
    if (joint) selectJoint(joints()[joint.userData.jointId]);
  });

  return {
    enter,
    exit,
    isActive: () => !!person,
    getPerson: () => person,
    getJoint: () => joint,
    /** Esc: 관절 해제 → 포즈 모드 끝. 처리했으면 true */
    escape() {
      if (joint) selectJoint(null);
      else if (person) exit();
      else return false;
      return true;
    },
  };
}

function findJoint(object) {
  for (let o = object; o; o = o.parent) if (o.userData.kind === 'joint') return o;
  return null;
}
