// 배치한 사람 모형들 관리: 추가 / 복제 / 삭제 / 키 바꾸기 / 보이기.
// 사람 하나 = 빈 그룹(root) 안에 마네킹. root 원점 = 발바닥 가운데.
// 다른 모델처럼 선택·이동·회전 가능 (크기 핸들 대신 '키'로 조절).
import * as THREE from 'three';
import { emit } from '../core/events.js';
import { buildMannequin } from './mannequin.js';

export const MIN_HEIGHT = 0.3;
export const MAX_HEIGHT = 3;

export function createPeople(scene) {
  const group = new THREE.Group();
  group.name = '사람들';
  scene.add(group);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7d97c9, roughness: 0.75 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x4f668f, roughness: 0.75 });
  let nextHeight = 1.75; // 새로 놓을 사람의 키

  function build(root, height) {
    disposeChildren(root);
    root.add(buildMannequin(height, bodyMat, jointMat));
    root.userData.height = height;
    root.name = `사람 ${height.toFixed(2)}m`;
  }

  /**
   * 사람 추가. lookYaw = 바라볼 방향 (1인칭 카메라와 같은 기준의 각도)
   */
  function add({ height = nextHeight, position, lookYaw = 0 }) {
    const root = new THREE.Group();
    root.userData = { kind: 'human', selectable: true };
    root.position.copy(position);
    root.rotation.y = lookYaw + Math.PI; // 마네킹 앞쪽(+Z)이 바라볼 방향으로
    build(root, clampHeight(height));
    group.add(root);
    setVisible(true);
    emit('people-changed');
    return root;
  }

  function duplicate(root) {
    const copy = add({ height: root.userData.height, position: root.position.clone().add(new THREE.Vector3(0.6, 0, 0)) });
    copy.rotation.copy(root.rotation);
    return copy;
  }

  function remove(root) {
    group.remove(root);
    disposeChildren(root);
    emit('people-changed');
  }

  function setHeight(root, height) {
    build(root, clampHeight(height));
    emit('people-changed');
  }

  function setVisible(visible) {
    if (group.visible === visible) return;
    group.visible = visible;
    emit('people-visibility-changed', visible);
  }

  return {
    group,
    add,
    duplicate,
    remove,
    setHeight,
    list: () => group.children,
    isVisible: () => group.visible,
    setVisible,
    getNextHeight: () => nextHeight,
    setNextHeight(height) {
      nextHeight = clampHeight(height);
      emit('people-changed');
    },
  };
}

function clampHeight(h) {
  return THREE.MathUtils.clamp(h, MIN_HEIGHT, MAX_HEIGHT);
}

function disposeChildren(root) {
  for (const child of [...root.children]) {
    child.traverse((o) => o.geometry?.dispose());
    root.remove(child);
  }
}
