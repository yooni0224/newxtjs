// 클릭으로 모델 선택하기 + 선택한 모델에 노란 상자 표시.
// 다른 기능이 클릭을 먼저 가로챌 수 있음 (addClickHandler, 예: 포즈 모드의 관절 고르기).
// 더블클릭은 onDoubleClick 으로 알림 (예: 사람 → 포즈 모드).
import * as THREE from 'three';
import { emit } from '../core/events.js';

const CLICK_TOLERANCE = 5; // 이 픽셀보다 많이 움직이면 '클릭'이 아니라 '시점 드래그'로 봄

/**
 * @param viewer      core/viewer.js 결과
 * @param gizmo       editor/gizmo.js 결과
 * @param getTargets  클릭으로 고를 수 있는 물체 목록을 돌려주는 함수
 */
export function createSelection(viewer, gizmo, getTargets) {
  const { canvas, scene, onFrame } = viewer;
  let selected = null;
  let down = null;
  let enabled = true; // 1인칭 모드 동안에는 false
  const clickHandlers = []; // (x, y) => true 면 그 기능이 클릭을 처리한 것
  const doubleClickHandlers = [];

  const outline = new THREE.BoxHelper(undefined, 0xffc400);
  outline.material.depthTest = false; // 벽 뒤에 있어도 보이게
  outline.material.transparent = true;
  outline.material.opacity = 0.85;
  outline.renderOrder = 999;
  outline.visible = false;
  scene.add(outline);
  viewer.addHelper(outline);
  onFrame(() => {
    if (selected) outline.update();
  });

  // gizmo 가 먼저 만들어져 있어야 아래 isDragging() 이 제대로 동작함
  canvas.addEventListener('pointerdown', (e) => {
    down = e.button === 0 && !gizmo.isDragging() ? { x: e.clientX, y: e.clientY } : null;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!enabled || !down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > CLICK_TOLERANCE) return;
    for (const fn of clickHandlers) if (fn(e.clientX, e.clientY)) return;
    select(pick(e.clientX, e.clientY));
  });
  canvas.addEventListener('dblclick', (e) => {
    if (!enabled || e.button !== 0) return;
    for (const fn of doubleClickHandlers) fn(selected, e);
  });

  function pick(x, y) {
    const raycaster = viewer.rayFromScreen(x, y);
    const targets = getTargets().filter((o) => o.visible);
    for (const hit of raycaster.intersectObjects(targets, true)) {
      if (!isShown(hit.object)) continue;
      return findSelectableRoot(hit.object);
    }
    return null;
  }

  function select(object) {
    if (object && !enabled) return;
    if (object === selected) return;
    selected = object;
    gizmo.attach(object);
    if (object) outline.setFromObject(object);
    outline.visible = !!object;
    emit('selection-changed', object);
  }

  return {
    select,
    getSelected: () => selected,
    addClickHandler: (fn) => clickHandlers.push(fn),
    onDoubleClick: (fn) => doubleClickHandlers.push(fn),
    setEnabled(value) {
      enabled = value;
      if (!value) select(null);
    },
  };
}

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function findSelectableRoot(object) {
  for (let o = object; o; o = o.parent) if (o.userData.selectable) return o;
  return null;
}
