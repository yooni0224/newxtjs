// 선택한 모델에 붙는 이동 / 회전 / 크기 핸들 (TransformControls).
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { emit } from '../core/events.js';

const SNAP_MOVE = 0.1; // m
const SNAP_ROTATE = THREE.MathUtils.degToRad(15);
const SNAP_SCALE = 0.1;

export function createGizmo({ scene, camera, canvas }, orbitControls) {
  const tc = new TransformControls(camera, canvas);
  tc.setSize(0.9);
  scene.add(tc.getHelper());

  let mode = 'translate'; // 사용자가 고른 모드

  // 핸들을 잡고 있는 동안에는 시점이 같이 돌지 않게
  tc.addEventListener('dragging-changed', (e) => {
    orbitControls.enabled = !e.value;
    if (!e.value && tc.object) emit('object-transformed', { object: tc.object, final: true });
  });
  tc.addEventListener('objectChange', () => {
    emit('object-transformed', { object: tc.object, final: false });
  });

  /** 사람 모형은 크기 조절 불가, 회전은 세로축만 */
  function applyRules() {
    const isHuman = tc.object?.userData.kind === 'human';
    tc.setMode(isHuman && mode === 'scale' ? 'translate' : mode);
    const limitRotation = isHuman && tc.mode === 'rotate';
    tc.showX = !limitRotation;
    tc.showZ = !limitRotation;
  }

  return {
    attach(object) {
      if (object) tc.attach(object);
      else tc.detach();
      applyRules();
    },
    setMode(newMode) {
      mode = newMode;
      applyRules();
      emit('gizmo-mode-changed', mode);
    },
    getMode: () => mode,
    setSnap(on) {
      tc.setTranslationSnap(on ? SNAP_MOVE : null);
      tc.setRotationSnap(on ? SNAP_ROTATE : null);
      tc.setScaleSnap(on ? SNAP_SCALE : null);
    },
    isDragging: () => tc.dragging,
  };
}
