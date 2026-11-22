// 배치한 사람 모형들 관리: 추가 / 복제 / 삭제 / 키 바꾸기 / 체형 / 포즈 / 보이기.
// 사람 하나 = 빈 그룹(root) 안에 몸(뼈대 있는 마네킹 모델 + 관절 그룹). root 원점 = 발바닥 가운데.
// 다른 모델처럼 선택·이동·회전 가능 (크기 핸들 대신 '키'로 조절).
// 몸: src/people/rig.js (남성·여성 마네킹 모델). 모델 파일을 아직 못 불러왔거나 실패하면
//     도형으로 만든 간단한 마네킹(src/people/mannequin.js)을 쓰고, 불러오면 자동으로 바꿈.
// 포즈(관절 각도)는 src/people/pose.js, 관절 돌리기 화면 조작은 src/people/poseMode.js
import * as THREE from 'three';
import { emit } from '../core/events.js';
import { buildMannequin } from './mannequin.js';
import { getPose, setPose } from './pose.js';
import { loadRigs, createRiggedBody, BODY_TYPES, DEFAULT_BODY } from './rig.js';

export const MIN_HEIGHT = 0.3;
export const MAX_HEIGHT = 3;
export { BODY_TYPES };

export function createPeople(scene) {
  const group = new THREE.Group();
  group.name = '사람들';
  scene.add(group);

  // 간단한 마네킹(모델을 못 불러왔을 때만)용 재질
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7d97c9, roughness: 0.75 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x4f668f, roughness: 0.75 });
  let nextHeight = 1.75; // 새로 놓을 사람의 키
  let nextBody = DEFAULT_BODY; // 새로 놓을 사람의 체형
  let rigs = null; // 불러온 체형 모델들

  // 사람 모델 불러오기 (처음 한 번). 그 전에 놓인 사람은 다 불러온 뒤 모델로 바꿈
  const ready = loadRigs()
    .then((loaded) => {
      rigs = loaded;
      for (const root of group.children) build(root, root.userData.height, getPose(root), root.userData.body);
      if (group.children.length) emit('people-changed');
    })
    .catch((err) => {
      console.error(err);
      emit('people-load-failed', err.message);
    });

  /** 몸 새로 만들기 (키·체형을 바꿀 때). 포즈는 그대로 다시 적용 */
  function build(root, height, pose = {}, body = nextBody) {
    disposeChildren(root);
    const type = BODY_TYPES[body] ? body : DEFAULT_BODY;
    const mannequin = rigs ? createRiggedBody(rigs, type, height) : buildMannequin(height, bodyMat, jointMat);
    mannequin.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    root.add(mannequin);
    root.userData.height = height;
    root.userData.body = type;
    root.name = `사람 ${BODY_TYPES[type].name} ${height.toFixed(2)}m`;
    setPose(root, pose);
  }

  /**
   * 사람 추가. lookYaw = 바라볼 방향 (1인칭 카메라와 같은 기준의 각도)
   */
  function add({ height = nextHeight, body = nextBody, position, lookYaw = 0, pose = {} }) {
    const root = new THREE.Group();
    root.userData = { kind: 'human', selectable: true };
    root.position.copy(position);
    root.rotation.y = lookYaw + Math.PI; // 마네킹 앞쪽(+Z)이 바라볼 방향으로
    build(root, clampHeight(height), pose, body);
    group.add(root);
    setVisible(true);
    emit('people-changed');
    return root;
  }

  function duplicate(root) {
    const copy = add({
      height: root.userData.height,
      body: root.userData.body,
      position: root.position.clone().add(new THREE.Vector3(0.6, 0, 0)),
      pose: getPose(root),
    });
    copy.rotation.copy(root.rotation);
    return copy;
  }

  function remove(root) {
    group.remove(root);
    disposeChildren(root);
    emit('people-changed');
  }

  /** 키 바꾸기 (body 를 주면 체형도 같이) */
  function setHeight(root, height, body = root.userData.body) {
    build(root, clampHeight(height), getPose(root), body);
    emit('people-changed');
  }

  function setBody(root, body) {
    build(root, root.userData.height, getPose(root), body);
    emit('people-changed');
  }

  /** 포즈 바꾸기 (프리셋, 붙여넣기, 초기화) */
  function applyPose(root, pose) {
    setPose(root, pose);
    emit('pose-changed', root);
  }

  function setVisible(visible) {
    if (group.visible === visible) return;
    group.visible = visible;
    emit('people-visibility-changed', visible);
  }

  return {
    group,
    /** 사람 모델을 다 불러왔을 때 (프로젝트 열기 전에 기다림) */
    ready,
    add,
    duplicate,
    remove,
    setHeight,
    setBody,
    applyPose,
    getPose,
    list: () => group.children,
    isVisible: () => group.visible,
    setVisible,
    getNextHeight: () => nextHeight,
    setNextHeight(height) {
      nextHeight = clampHeight(height);
      emit('people-changed');
    },
    getNextBody: () => nextBody,
    setNextBody(body) {
      if (BODY_TYPES[body]) nextBody = body;
      emit('people-changed');
    },
  };
}

function clampHeight(h) {
  return THREE.MathUtils.clamp(h, MIN_HEIGHT, MAX_HEIGHT);
}

/** 몸 지우기 (여러 사람이 같이 쓰는 모델 모양은 남김) */
function disposeChildren(root) {
  for (const child of [...root.children]) {
    child.traverse((o) => {
      if (!o.userData.sharedGeometry) o.geometry?.dispose();
    });
    root.remove(child);
  }
}
