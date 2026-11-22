// '시작 위치 찍기': 바닥이나 모델 윗면을 클릭 → 그 표면 위에 서서 1인칭 시작.
// 클릭한 채 드래그하면 드래그한 방향을 바라봄 (그냥 클릭이면 지금 보던 방향).
// Esc 또는 버튼을 다시 누르면 취소.
import * as THREE from 'three';
import { on, emit } from '../core/events.js';
import { isTyping } from '../core/keyboard.js';
import { yawFromDirection } from './walkMode.js';
import { toast } from '../ui/toast.js';

const DRAG_THRESHOLD = 8; // 이 픽셀보다 많이 움직여야 '드래그'로 봄
const MIN_UP = 0.5; // 윗면으로 인정하는 기울기 (법선의 위쪽 성분, 0.5 ≈ 60° 경사까지)
const MARK_COLOR = 0xff7a1a;

/**
 * @param viewer       core/viewer.js
 * @param walk         camera/walkMode.js
 * @param getSurfaces  밟고 설 수 있는 물체 목록(모델들)
 */
export function createStartPicker({ viewer, walk, getSurfaces }) {
  const { scene, camera, canvas } = viewer;
  const viewport = canvas.parentElement;
  const marker = createMarker();
  scene.add(marker.root);

  let picking = false;
  let press = null; // 누르고 있는 동안: { pointerId, x, y, point, yaw }

  function start() {
    if (picking || walk.isActive()) return;
    picking = true;
    canvas.style.cursor = 'crosshair';
    emit('start-pick-changed', true);
  }

  function cancel() {
    if (!picking) return;
    picking = false;
    press = null;
    marker.hide();
    canvas.style.cursor = '';
    emit('start-pick-changed', false);
  }

  // 캡처 단계에서 먼저 받아, 편집 시점 회전·모델 선택으로 넘어가지 않게 막음 (왼쪽 버튼만)
  const capture = { capture: true };

  viewport.addEventListener('pointerdown', (e) => {
    if (!picking || e.button !== 0 || e.target !== canvas) return;
    e.stopPropagation();
    const point = findSurface(e.clientX, e.clientY);
    if (!point) {
      toast('바닥이나 모델 윗면을 클릭해 주세요.', 'warn');
      return;
    }
    const dir = camera.getWorldDirection(new THREE.Vector3());
    press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, point, yaw: yawFromDirection(dir) };
    canvas.setPointerCapture(e.pointerId);
    marker.show(point, press.yaw, walk.getEyeHeight());
  }, capture);

  viewport.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    e.stopPropagation();
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD) {
      const yaw = yawToward(press.point, e.clientX, e.clientY);
      if (yaw !== null) press.yaw = yaw;
    }
    marker.show(press.point, press.yaw, walk.getEyeHeight());
  }, capture);

  viewport.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    e.stopPropagation();
    const { point, yaw } = press;
    cancel();
    walk.enterAt({ x: point.x, z: point.z, groundY: point.y, yaw });
  }, capture);

  viewport.addEventListener('pointercancel', () => {
    press = null;
    marker.hide();
  }, capture);

  window.addEventListener('keydown', (e) => {
    if (picking && e.code === 'Escape' && !isTyping(e.target)) cancel();
  });
  on('walk-mode-changed', (walking) => {
    if (walking) cancel();
  });

  /** 화면 좌표가 가리키는 '설 수 있는 곳'. 모델 윗면 → 없으면 바닥. 벽·아랫면이면 null */
  function findSurface(x, y) {
    const raycaster = viewer.rayFromScreen(x, y);
    const targets = getSurfaces().filter((o) => o.visible);
    for (const hit of raycaster.intersectObjects(targets, true)) {
      if (!hit.face || !isShown(hit.object)) continue;
      // 처음 닿은 면이 윗면인지 확인 (양면 재질이라 법선이 반대일 수 있어 카메라 쪽으로 맞춤)
      const normal = hit.face.normal
        .clone()
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
        .normalize();
      if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
      return normal.y >= MIN_UP ? hit.point.clone() : null;
    }
    return viewer.groundPointAt(x, y);
  }

  /** 서 있을 점에서 마우스가 가리키는 곳 방향(수평)의 고개 각도 */
  function yawToward(point, x, y) {
    const ray = viewer.rayFromScreen(x, y).ray;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
    // 발 높이의 수평면과 만나는 곳, 하늘을 가리키면 아주 먼 곳
    const aim = ray.intersectPlane(plane, new THREE.Vector3()) || ray.at(1000, new THREE.Vector3());
    const d = aim.sub(point).setY(0);
    return d.lengthSq() > 1e-4 ? yawFromDirection(d) : null;
  }

  return {
    start,
    cancel,
    isPicking: () => picking,
  };
}

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** 찍은 자리 표시: 발밑 고리 + 눈높이 막대 + 바라볼 방향 화살표 */
function createMarker() {
  const root = new THREE.Group();
  root.visible = false;

  const mat = new THREE.MeshBasicMaterial({ color: MARK_COLOR, depthTest: false, transparent: true, side: THREE.DoubleSide });
  const lineMat = new THREE.LineBasicMaterial({ color: MARK_COLOR, depthTest: false, transparent: true });

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 32).rotateX(-Math.PI / 2), mat);
  const stick = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]),
    lineMat,
  );
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), mat);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1, MARK_COLOR, 0.25, 0.15);
  arrow.line.material.depthTest = false;
  arrow.cone.material.depthTest = false;

  root.add(ring, stick, eye, arrow);
  root.traverse((o) => {
    o.renderOrder = 1000; // 모델에 가려지지 않게
  });

  return {
    root,
    show(point, yaw, eyeHeight) {
      root.position.copy(point);
      stick.scale.y = eyeHeight;
      eye.position.y = eyeHeight;
      arrow.position.y = eyeHeight;
      arrow.setDirection(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)));
      root.visible = true;
    },
    hide() {
      root.visible = false;
    },
  };
}
