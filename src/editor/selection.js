// 클릭으로 선택하기 + 선택한 것에 노란 상자 표시 + 그룹 편집(모델 안으로 들어가기).
//
// 그룹 편집 (스케치업 그룹 편집처럼)
//   - 맨 위(context = null)에서는 클릭하면 모델 전체·사람이 선택됨
//   - 더블클릭하면 그 안으로 들어감(context = 그 그룹) → 클릭하면 바로 아래 자식(부품)이 선택됨
//     더 안쪽 그룹도 더블클릭으로 계속 들어감. Esc 로 한 단계 위로 (들어갔던 그룹이 선택됨)
//   - 편집 중인 그룹 바깥을 클릭하면 그게 들어 있는 단계까지 자동으로 올라감
//   - 숨긴 것·잠근 것(src/models/modelStore.js)은 클릭이 통과함 (선택 안 됨)
// 불러온 모델 = root(기준점 그룹) → 내용(불러온 파일 그대로, userData.modelContent) → 파일 안의 그룹·오브젝트.
// 모델 안으로 들어가면 context = 내용 그룹 (root 는 건너뜀).
//
// 다른 기능이 클릭을 먼저 가로챌 수 있음 (addClickHandler, 예: 포즈 모드의 관절 고르기).
// 더블클릭은 onDoubleClick 으로 알림 (예: 사람 → 포즈 모드).
import * as THREE from 'three';
import { emit } from '../core/events.js';

const CLICK_TOLERANCE = 5; // 이 픽셀보다 많이 움직이면 '클릭'이 아니라 '시점 드래그'로 봄

/**
 * @param viewer      core/viewer.js 결과
 * @param gizmo       editor/gizmo.js 결과
 * @param getTargets  클릭으로 고를 수 있는 맨 위 물체 목록(모델 root, 사람)을 돌려주는 함수
 */
export function createSelection(viewer, gizmo, getTargets) {
  const { canvas, scene, onFrame } = viewer;
  let selected = null;
  let context = null; // 그룹 편집 중인 그룹 (그 자식들을 고름). null = 맨 위
  let down = null;
  let enabled = true; // 1인칭 모드 동안에는 false
  const clickHandlers = []; // (x, y) => true 면 그 기능이 클릭을 처리한 것
  const doubleClickHandlers = [];

  const outline = makeBox(0xffc400, 0.85, 999);
  const contextBox = makeBox(0x6f9bff, 0.6, 998); // 편집 중인 그룹 테두리
  onFrame(() => {
    if (selected) outline.update();
    if (context) contextBox.update();
  });

  function makeBox(color, opacity, order) {
    const box = new THREE.BoxHelper(undefined, color);
    box.material.depthTest = false; // 벽 뒤에 있어도 보이게
    box.material.transparent = true;
    box.material.opacity = opacity;
    box.renderOrder = order;
    box.visible = false;
    scene.add(box);
    viewer.addHelper(box);
    return box;
  }

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
    clickAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('dblclick', (e) => {
    if (!enabled || e.button !== 0) return;
    for (const fn of doubleClickHandlers) fn(selected, e);
  });

  /** 클릭한 곳: 지금 단계에서 고를 물체. 바깥이면 그게 들어 있는 단계로 올라감. 빈 곳이면 선택만 해제 */
  function clickAt(x, y) {
    const hit = firstHit(x, y);
    if (!hit) return select(null);
    let ctx = context;
    while (ctx && !isInside(hit, ctx)) ctx = parentContext(ctx);
    setContext(ctx);
    select(itemAt(hit, ctx));
  }

  /** 광선에 처음 닿는 물체 (숨긴 것·잠근 것은 통과) */
  function firstHit(x, y) {
    const raycaster = viewer.rayFromScreen(x, y);
    const targets = getTargets().filter((o) => o.visible);
    for (const hit of raycaster.intersectObjects(targets, true)) {
      if (isShown(hit.object) && !isLocked(hit.object)) return hit.object;
    }
    return null;
  }

  /** ctx 단계에서 object 를 품고 있는 물체 (ctx 의 자식). 맨 위면 모델 root / 사람 */
  function itemAt(object, ctx) {
    if (!ctx) return findSelectableRoot(object);
    for (let o = object; o; o = o.parent) if (o.parent === ctx) return o;
    return null;
  }

  function select(object) {
    if (object && !enabled) return;
    if (object && (isLocked(object) || !isShown(object))) object = null;
    if (object) setContext(contextFor(object));
    if (object === selected) return;
    selected = object;
    gizmo.attach(object);
    if (object) outline.setFromObject(object);
    outline.visible = !!object;
    emit('selection-changed', object);
  }

  function setContext(ctx) {
    if (ctx === context) return;
    context = ctx;
    if (ctx) contextBox.setFromObject(ctx);
    contextBox.visible = !!ctx;
    emit('context-changed', ctx);
  }

  // ---------- 들어가기 / 나오기 ----------
  /** 이 물체 안으로 들어갈 수 있나 (모델, 또는 자식이 있는 그룹·오브젝트) */
  function canEnter(object) {
    if (!object || object.userData.kind === 'human') return false;
    const inner = innerOf(object);
    return !!inner && inner.children.length > 0 && !isLocked(object);
  }

  /** 더블클릭: 그 안으로 들어감 (아무것도 선택 안 된 상태로) */
  function enter(object) {
    if (!enabled || !canEnter(object)) return false;
    select(null);
    setContext(innerOf(object));
    return true;
  }

  /** Esc: 한 단계 위로. 들어갔던 그룹이 선택됨. 처리했으면 true */
  function exitContext() {
    if (!context) return false;
    const item = context.userData.modelContent ? context.parent : context;
    setContext(parentContext(context));
    select(item);
    return true;
  }

  return {
    select,
    getSelected: () => selected,
    getContext: () => context,
    canEnter,
    enter,
    exitContext,
    /** 편집 중인 그룹이 지워지거나 숨겨지거나 잠기면 맨 위로 (모델 목록·상태가 바뀐 뒤 부름) */
    validate() {
      let ctx = context;
      while (ctx && (!isInScene(ctx) || !isShown(ctx) || isLocked(ctx))) ctx = parentContext(ctx);
      if (ctx && !isInScene(ctx)) ctx = null;
      setContext(ctx);
      if (selected && (!isInScene(selected) || !isShown(selected) || isLocked(selected))) select(null);
    },
    addClickHandler: (fn) => clickHandlers.push(fn),
    onDoubleClick: (fn) => doubleClickHandlers.push(fn),
    setEnabled(value) {
      enabled = value;
      if (!value) {
        select(null);
        setContext(null);
      }
    },
  };
}

/** 들어갔을 때 자식을 고를 그룹: 모델 root 는 그 안의 내용 그룹, 나머지는 자기 자신 */
function innerOf(object) {
  if (object.userData.kind === 'model') return object.children.find((c) => c.userData.modelContent) || null;
  return object;
}

/** 한 단계 위의 편집 그룹 (모델 내용 그룹의 위 = 맨 위 null) */
function parentContext(ctx) {
  if (!ctx || ctx.userData.modelContent) return null;
  return ctx.parent?.userData.kind === 'model' ? null : ctx.parent;
}

/** 이 물체를 고를 때의 편집 그룹 (맨 위 물체면 null, 부품이면 부모) */
function contextFor(object) {
  return object.userData.selectable ? null : object.parent;
}

function isInside(object, ctx) {
  for (let o = object.parent; o; o = o.parent) if (o === ctx) return true;
  return false;
}

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** 자기나 위쪽 그룹 중 하나라도 잠겼으면 잠긴 것 */
export function isLocked(object) {
  for (let o = object; o; o = o.parent) if (o.userData.locked) return true;
  return false;
}

function isInScene(object) {
  for (let o = object; o; o = o.parent) if (o.isScene) return true;
  return false;
}

function findSelectableRoot(object) {
  for (let o = object; o; o = o.parent) if (o.userData.selectable) return o;
  return null;
}
