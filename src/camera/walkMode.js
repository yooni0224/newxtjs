// 1인칭(인물 시점) 모드.
//   드래그: 고개 돌리기 · W A S D (또는 방향키): 이동 · Shift: 빠르게
//   Q / E: 눈높이 낮추기 / 높이기 · Esc: 나가기
// 눈높이는 바닥(높이 0)에서 잰 값으로 고정. 벽 통과 가능(촬영용 카메라처럼).
import * as THREE from 'three';
import { emit } from '../core/events.js';
import { isTyping } from '../core/keyboard.js';

const WALK_SPEED = 2; // 걷는 속도 m/초
const RUN_MULTIPLIER = 3; // Shift 누르면 몇 배
const LIFT_SPEED = 0.5; // Q/E 높이 바꾸는 속도 m/초
const LOOK_SENSITIVITY = 0.004; // 드래그 1픽셀당 회전량 (화각이 좁을수록 자동으로 느려짐)
export const MIN_EYE = 0.05;
export const MAX_EYE = 1000;

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
]);

/**
 * @param viewer      core/viewer.js
 * @param editorCam   core/editorCamera.js (1인칭 동안 꺼 둠)
 * @param selection   editor/selection.js (1인칭 동안 꺼 둠)
 * @param getTargets  모델 목록 (나갈 때 '보고 있던 물체'를 찾는 데 씀)
 */
export function createWalkMode({ viewer, editorCam, selection, getTargets }) {
  const { camera, canvas, onFrame } = viewer;
  let active = false;
  let eyeHeight = 1.6;
  let yaw = 0; // 좌우 고개 (라디안)
  let pitch = 0; // 위아래 고개 (라디안, 0 = 수평)
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  function applyView() {
    camera.position.y = eyeHeight;
    camera.quaternion.setFromEuler(euler.set(pitch, yaw, 0));
  }

  function forward() {
    return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  // ---------- 들어가기 / 나가기 ----------
  function enter() {
    if (active) return;
    selection.setEnabled(false);
    editorCam.setActive(false);
    // 지금 보던 자리 바닥에 서서, 보던 방향을 수평으로 바라봄
    const dir = camera.getWorldDirection(new THREE.Vector3());
    yaw = Math.atan2(-dir.x, -dir.z);
    pitch = 0;
    active = true;
    applyView();
    canvas.style.cursor = 'grab';
    emit('walk-mode-changed', true);
  }

  function exit() {
    if (!active) return;
    active = false;
    keys.clear();
    canvas.style.cursor = '';
    // 편집 시점은 지금 보고 있던 물체를 중심으로 이어서 돌 수 있게
    editorCam.setActive(true, lookTarget());
    selection.setEnabled(true);
    emit('walk-mode-changed', false);
  }

  /** 정면으로 보이는 물체 위치 (없으면 5m 앞) */
  function lookTarget() {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const ray = new THREE.Raycaster(camera.position, dir, 0.3, 100);
    const hit = ray.intersectObjects(getTargets().filter((o) => o.visible), true)[0];
    return camera.position.clone().addScaledVector(dir, hit ? hit.distance : 5);
  }

  // ---------- 마우스 드래그: 고개 돌리기 ----------
  let dragId = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    dragId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== dragId) return;
    const k = (LOOK_SENSITIVITY * camera.fov) / 50;
    yaw -= e.movementX * k;
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * k, -1.55, 1.55);
    applyView();
    emit('walk-view-changed');
  });
  const endDrag = (e) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    if (active) canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- 키보드 ----------
  window.addEventListener('keydown', (e) => {
    if (!active || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') {
      exit();
    } else if (MOVE_KEYS.has(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear()); // 다른 창으로 가면 키 떼기

  // ---------- 매 프레임: 이동 ----------
  let last = performance.now();
  onFrame(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!active || keys.size === 0) return;

    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_MULTIPLIER : 1;
    const axis = (plus, minus) =>
      (plus.some((k) => keys.has(k)) ? 1 : 0) - (minus.some((k) => keys.has(k)) ? 1 : 0);

    const ahead = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    const side = axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    if (ahead || side) {
      const f = forward();
      const right = new THREE.Vector3(-f.z, 0, f.x);
      const move = f.multiplyScalar(ahead).add(right.multiplyScalar(side)).normalize();
      camera.position.addScaledVector(move, WALK_SPEED * fast * dt);
      emit('walk-view-changed');
    }

    const lift = axis(['KeyE'], ['KeyQ']);
    if (lift) setEyeHeight(eyeHeight + lift * LIFT_SPEED * fast * dt);
  });

  // ---------- 눈높이 ----------
  function setEyeHeight(meters) {
    if (!Number.isFinite(meters)) return;
    eyeHeight = THREE.MathUtils.clamp(meters, MIN_EYE, MAX_EYE);
    if (active) applyView();
    emit('eye-height-changed', eyeHeight);
  }

  return {
    enter,
    exit,
    isActive: () => active,
    getEyeHeight: () => eyeHeight,
    setEyeHeight,
    /** 고개를 수평으로 (세로선이 똑바로 서는 구도) */
    level() {
      pitch = 0;
      if (active) applyView();
      emit('walk-view-changed');
    },
    getPitchDegrees: () => THREE.MathUtils.radToDeg(pitch),
    /** 바라보는 방향으로 dist(m) 앞의 바닥 위치 */
    pointAhead(dist) {
      return camera.position.clone().addScaledVector(forward(), dist).setY(0);
    },
  };
}
