// 편집용 시점: 마우스로 돌리기/이동/확대 (OrbitControls) + 선택한 물체로 시점 맞추기.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createEditorCamera({ camera, canvas, onFrame }) {
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true; // 부드럽게 멈춤
  controls.dampingFactor = 0.2;
  controls.zoomToCursor = true; // 마우스가 가리키는 곳으로 확대
  controls.minDistance = 0.1;
  controls.maxDistance = 1500;
  controls.update();
  onFrame(() => controls.update());

  /** 물체(또는 물체 여러 개)가 화면에 꽉 차도록 시점 이동 */
  function focusOn(objects) {
    const box = new THREE.Box3();
    for (const obj of [].concat(objects)) box.expandByObject(obj);
    if (box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.3);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const distance = (radius / Math.sin(fov / 2)) * 1.6;

    const direction = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    controls.update();
  }

  return { controls, focusOn };
}
