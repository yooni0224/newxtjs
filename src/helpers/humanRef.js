// 크기 비교용 사람 모형 (키 1.7m). 클릭해서 옮기거나 돌릴 수 있음(크기 조절은 안 됨).
import * as THREE from 'three';
import { emit } from '../core/events.js';

export const HUMAN_HEIGHT = 1.7;

export function createHumanRef(scene) {
  const root = new THREE.Group();
  root.name = `사람 모형 (${HUMAN_HEIGHT}m)`;
  root.userData = { kind: 'human', selectable: true };

  const mat = new THREE.MeshStandardMaterial({ color: 0x4f7fd9, roughness: 0.7 });
  const part = (geometry, x, y, z = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };

  // 머리 꼭대기가 정확히 1.70m (머리 반지름 0.1 × 세로 1.2배 = 0.12 → 중심 1.58)
  part(new THREE.SphereGeometry(0.1, 24, 16), 0, 1.58).scale.set(1, 1.2, 1.05);
  part(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), 0, 1.44); // 목
  part(new THREE.CapsuleGeometry(0.17, 0.38, 6, 16), 0, 1.09).scale.set(1, 1, 0.6); // 몸통
  for (const side of [-1, 1]) {
    part(new THREE.CapsuleGeometry(0.065, 0.8, 6, 12), side * 0.09, 0.465); // 다리 (바닥 0 ~ 0.93)
    part(new THREE.CapsuleGeometry(0.045, 0.6, 6, 12), side * 0.215, 1.055).rotation.z = side * 0.08; // 팔
    part(new THREE.BoxGeometry(0.09, 0.06, 0.22), side * 0.09, 0.03, 0.05); // 발 (앞쪽 방향 표시)
  }

  root.visible = false;
  scene.add(root);
  let placed = false;

  return {
    root,
    isVisible: () => root.visible,
    /** 켜기/끄기. 처음 켤 때는 at 위치(바닥)에 세움 */
    setVisible(visible, at) {
      if (visible && !placed && at) {
        root.position.set(at.x, 0, at.z);
        placed = true;
      }
      root.visible = visible;
      emit('human-visibility-changed', visible);
    },
  };
}
