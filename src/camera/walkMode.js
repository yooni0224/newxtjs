// 1인칭(인물 시점) 모드.
//   드래그: 고개 돌리기 · W A S D (또는 방향키): 이동 · Shift: 빠르게
//   Q / E: 눈높이 낮추기 / 높이기 · Esc: 나가기
// 들어가기: enter() = 편집 카메라 자리(x, z)에서 보던 방향 그대로(수평)
//          enterAt() = 찍은 표면 위에서 (src/ui/cameraPanel.js '시작 위치 찍기')
// 카메라 높이 = 발 높이(서 있는 표면) + 눈높이. Q/E 는 발밑 기준 눈높이를 바꿈.
// 지형 따라가기 켜짐: 계단·경사로를 오르내리고(0.4m 까지), 더 높은 건 벽처럼 막힘 (src/camera/terrain.js)
// 지형 따라가기 꺼짐: 발 높이 고정, 벽 통과 (촬영용 카메라처럼)
// 나오면 편집 카메라는 들어가기 전 자리로 돌아감.
import * as THREE from 'three';
import { emit } from '../core/events.js';
import { isTyping } from '../core/keyboard.js';
import { createTerrain } from './terrain.js';

const WALK_SPEED = 2; // 걷는 속도 m/초
const RUN_MULTIPLIER = 3; // Shift 누르면 몇 배
const LIFT_SPEED = 0.5; // Q/E 높이 바꾸는 속도 m/초
const LOOK_SENSITIVITY = 0.004; // 드래그 1픽셀당 회전량 (화각이 좁을수록 자동으로 느려짐)
const HEIGHT_SMOOTHING = 10; // 발 높이가 바뀔 때 따라가는 빠르기 (클수록 빨리)
export const MIN_EYE = 0.05;
export const MAX_EYE = 1000;

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
]);

/** 바라보는 방향(벡터) → 좌우 고개 각도(라디안). 수평 성분만 씀 */
export function yawFromDirection(dir) {
  return Math.atan2(-dir.x, -dir.z);
}

/** 카메라가 보고 있는 좌우 방향 */
export function cameraYaw(camera) {
  return yawFromDirection(camera.getWorldDirection(new THREE.Vector3()));
}

/**
 * @param viewer       core/viewer.js
 * @param editorCam    core/editorCamera.js (1인칭 동안 꺼 둠)
 * @param selection    editor/selection.js (1인칭 동안 꺼 둠)
 * @param getSurfaces  밟을 수 있는 물체 목록 (모델들, 사람 모형 제외)
 */
export function createWalkMode({ viewer, editorCam, selection, getSurfaces }) {
  const { camera, canvas, onFrame } = viewer;
  const terrain = createTerrain(getSurfaces);
  let active = false;
  let followTerrain = true; // 지형 따라가기
  let eyeHeight = 1.6;
  let groundY = 0; // 서 있는 표면 높이(발 높이)
  let shownGroundY = 0; // 화면에 쓰는 발 높이 (groundY 를 부드럽게 따라감)
  let yaw = 0; // 좌우 고개 (라디안)
  let pitch = 0; // 위아래 고개 (라디안, 0 = 수평)
  let editorPose = null; // 들어가기 전 편집 카메라 자리
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  function applyView() {
    camera.position.y = shownGroundY + eyeHeight;
    camera.quaternion.setFromEuler(euler.set(pitch, yaw, 0));
  }

  function forward() {
    return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  // ---------- 들어가기 / 나가기 ----------
  /** 편집 카메라가 있는 자리(x, z) 바닥에 서서, 보던 방향을 수평으로 이어받음 */
  function enter() {
    const { x, z } = camera.position;
    const ground = followTerrain ? terrain.groundAt(x, z, 0) : 0;
    enterAt({ x, z, groundY: ground, yaw: cameraYaw(camera) });
  }

  /** 정해진 자리에서 시작. groundY = 서 있을 표면 높이, yaw = 바라볼 방향 */
  function enterAt({ x, z, groundY: ground = 0, yaw: startYaw }) {
    if (active) return;
    editorPose = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      target: editorCam.controls.target.clone(),
    };
    selection.setEnabled(false);
    editorCam.setActive(false);
    camera.position.set(x, 0, z);
    groundY = ground;
    shownGroundY = ground;
    yaw = startYaw;
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
    // 편집 카메라를 들어가기 전 자리로 되돌림
    camera.position.copy(editorPose.position);
    camera.quaternion.copy(editorPose.quaternion);
    editorCam.setActive(true, editorPose.target);
    selection.setEnabled(true);
    emit('walk-mode-changed', false);
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
    if (!active) return;
    smoothHeight(dt);
    if (keys.size === 0) return;

    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_MULTIPLIER : 1;
    const axis = (plus, minus) =>
      (plus.some((k) => keys.has(k)) ? 1 : 0) - (minus.some((k) => keys.has(k)) ? 1 : 0);

    const ahead = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    const side = axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    if (ahead || side) {
      const f = forward();
      const right = new THREE.Vector3(-f.z, 0, f.x);
      let move = f.multiplyScalar(ahead).add(right.multiplyScalar(side)).normalize();
      move.multiplyScalar(WALK_SPEED * fast * dt);
      if (followTerrain) {
        move = terrain.limitMove(camera.position, groundY, eyeHeight, move); // 벽에 막힘
        camera.position.add(move);
        groundY = terrain.groundAt(camera.position.x, camera.position.z, groundY); // 계단·경사·낙하
      } else {
        camera.position.add(move);
      }
      emit('walk-view-changed');
    }

    const lift = axis(['KeyE'], ['KeyQ']);
    if (lift) setEyeHeight(eyeHeight + lift * LIFT_SPEED * fast * dt);
  });

  /** 발 높이가 바뀌면 카메라 높이를 부드럽게 따라가게 */
  function smoothHeight(dt) {
    if (shownGroundY === groundY) return;
    const t = 1 - Math.exp(-HEIGHT_SMOOTHING * dt);
    shownGroundY += (groundY - shownGroundY) * t;
    if (Math.abs(groundY - shownGroundY) < 0.001) shownGroundY = groundY;
    applyView();
  }

  // ---------- 지형 따라가기 켜기/끄기 ----------
  function setFollowTerrain(value) {
    followTerrain = value;
    if (value && active) groundY = terrain.groundAt(camera.position.x, camera.position.z, groundY);
    emit('terrain-follow-changed', value);
  }

  // ---------- 눈높이 ----------
  function setEyeHeight(meters) {
    if (!Number.isFinite(meters)) return;
    eyeHeight = THREE.MathUtils.clamp(meters, MIN_EYE, MAX_EYE);
    if (active) applyView();
    emit('eye-height-changed', eyeHeight);
  }

  return {
    enter,
    enterAt,
    exit,
    isActive: () => active,
    getEyeHeight: () => eyeHeight,
    getGroundY: () => groundY,
    getFollowTerrain: () => followTerrain,
    setFollowTerrain,
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
