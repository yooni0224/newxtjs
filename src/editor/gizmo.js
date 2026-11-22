// 선택한 모델에 붙는 이동 / 회전 / 크기 핸들 (TransformControls).
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { emit } from '../core/events.js';

const SNAP_MOVE = 0.1; // m
const SNAP_ROTATE = THREE.MathUtils.degToRad(15);
const SNAP_SCALE = 0.1;

export function createGizmo(viewer, orbitControls) {
  const { scene, camera, canvas } = viewer;
  const tc = new TransformControls(camera, canvas);
  tc.setSize(0.9);
  scene.add(tc.getHelper());
  viewer.addHelper(tc.getHelper());

  let mode = 'translate'; // 사용자가 고른 모드

  // 핸들을 잡고 있는 동안에는 시점이 같이 돌지 않게
  tc.addEventListener('dragging-changed', (e) => {
    orbitControls.enabled = !e.value;
    if (!e.value && tc.object) emit('object-transformed', { object: tc.object, final: true });
  });
  tc.addEventListener('objectChange', () => {
    emit('object-transformed', { object: tc.object, final: false });
  });

  /**
   * 사람 모형은 크기 조절 불가, 회전은 세로축만.
   * 관절(포즈 모드)은 회전만, 관절 자기 방향 기준 축, 돌릴 수 있는 축만 보임 (무릎·팔꿈치는 앞뒤로만)
   */
  function applyRules() {
    const userData = tc.object?.userData || {};
    if (userData.kind === 'joint') {
      tc.setMode('rotate');
      tc.setSpace('local');
      tc.setSize(0.6);
      const { x, y, z } = userData.limits;
      tc.showX = x[1] > x[0];
      tc.showY = y[1] > y[0];
      tc.showZ = z[1] > z[0];
      return;
    }
    tc.setSpace('world');
    tc.setSize(0.9);
    const isHuman = userData.kind === 'human';
    tc.setMode(isHuman && mode === 'scale' ? 'translate' : mode);
    const limitRotation = isHuman && tc.mode === 'rotate';
    tc.showX = !limitRotation;
    tc.showY = true;
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
    getObject: () => tc.object ?? null,
    setSnap(on) {
      tc.setTranslationSnap(on ? SNAP_MOVE : null);
      tc.setRotationSnap(on ? SNAP_ROTATE : null);
      tc.setScaleSnap(on ? SNAP_SCALE : null);
    },
    isDragging: () => tc.dragging,
  };
}
