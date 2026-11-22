// 뼈대가 들어 있는 사람 모델(마네킹, public/people/*.glb)을 관절 포즈로 움직이기.
//
// 포즈의 기준은 그대로 '관절 그룹'(src/people/mannequin.js 의 JOINTS — 기본 자세에서 축이 사람 기준).
// 관절 그룹은 눈에 안 보이고, 모델의 뼈를 매번 그 관절에 맞춰 돌림(sync):
//   뼈의 회전(몸 기준) = 그 뼈를 움직이는 관절까지의 회전 누적 × 기본 자세에서의 뼈 회전
//   (관절에 직접 연결되지 않은 뼈 — 쇄골·가슴 윗부분·손가락·발가락 — 는 가장 가까운 위쪽 관절을 따라감)
// 그래서 포즈 모드·각도 제한·프리셋·복사/붙여넣기·저장은 도형 마네킹 때와 똑같이 동작함.
//
// 모델은 팔을 옆으로 편 T자 자세 → 불러올 때 팔을 내려(ARM_DOWN_DEG 만큼만 벌림) '차렷'을 기본 자세로 삼음.
// 키: 몸 전체 크기로 맞추고, 아이일수록 머리 뼈를 키워 등신을 맞춤 (성인 7.5등신 ~ 아이 6등신).
// 모델 파일은 법선이 빠져 있어서 불러올 때 매끈한 법선을 계산함. 출처·라이선스: public/people/LICENSE.md
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { JOINTS, buildJoints, headsTall } from './mannequin.js';

/** 체형: 파일 이름 (public/people/) */
export const BODY_TYPES = {
  male: { name: '남성', file: 'mannequin_male.glb' },
  female: { name: '여성', file: 'mannequin_female.glb' },
};
export const DEFAULT_BODY = 'male';

const ARM_DOWN_DEG = 6; // 기본 자세에서 팔이 몸 바깥으로 벌어진 각도
const BODY_COLOR = 0xd9c2a3; // 데생 인형 같은 나무색

/** 관절 id → 모델의 뼈 이름 */
const BONE_OF = {
  pelvis: 'pelvis',
  waist: 'spine_01',
  chest: 'spine_02',
  neck: 'neck_01',
  head: 'Head',
};
for (const [suffix, side] of [['L', 'l'], ['R', 'r']]) {
  Object.assign(BONE_OF, {
    [`shoulder${suffix}`]: `upperarm_${side}`,
    [`elbow${suffix}`]: `lowerarm_${side}`,
    [`wrist${suffix}`]: `hand_${side}`,
    [`hip${suffix}`]: `thigh_${side}`,
    [`knee${suffix}`]: `calf_${side}`,
    [`ankle${suffix}`]: `foot_${side}`,
  });
}
const JOINT_OF = Object.fromEntries(Object.entries(BONE_OF).map(([id, bone]) => [bone, id]));

let loading = null;
const material = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.72 });

/** 체형 모델들을 한 번만 불러와 준비 → Map(체형 → 틀) */
export function loadRigs() {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL;
  loading = Promise.all(
    Object.entries(BODY_TYPES).map(async ([type, { file }]) => {
      const gltf = await loader.loadAsync(`${base}people/${file}`);
      return [type, prepareTemplate(gltf.scene)];
    }),
  ).then((list) => new Map(list));
  return loading;
}

/** 불러온 모델 → 틀: 팔 내린 기본 자세, 뼈별 기본 회전, 관절 위치, 높이 */
function prepareTemplate(scene) {
  scene.updateMatrixWorld(true);
  const bones = {};
  let mesh = null;
  scene.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) mesh = o;
  });
  if (!mesh) throw new Error('사람 모델에 뼈대 메시가 없어요.');
  for (const name of Object.values(BONE_OF)) if (!bones[name]) throw new Error(`사람 모델에 '${name}' 뼈가 없어요.`);
  mesh.geometry.computeVertexNormals(); // 파일에 법선이 없음 → 매끈하게
  mesh.geometry.computeBoundingSphere();

  // 팔 내리기 (T자 → 차렷)
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const [side, s] of [['l', 1], ['r', -1]]) {
    const upper = bones[`upperarm_${side}`];
    upper.getWorldPosition(a);
    bones[`lowerarm_${side}`].getWorldPosition(b);
    const dir = b.sub(a).normalize();
    const rad = THREE.MathUtils.degToRad(ARM_DOWN_DEG);
    const target = new THREE.Vector3(s * Math.sin(rad), -Math.cos(rad), 0);
    const turn = new THREE.Quaternion().setFromUnitVectors(dir, target);
    setWorldQuaternion(upper, turn.multiply(upper.getWorldQuaternion(new THREE.Quaternion())));
    scene.updateMatrixWorld(true);
  }

  // 뼈 순서(부모 먼저), 기본 회전, 따라갈 관절
  const rootBone = Object.values(bones).find((o) => !o.parent?.isBone);
  const order = [];
  rootBone.traverse((o) => o.isBone && order.push(o.name));
  const baseWorld = {};
  for (const name of order) baseWorld[name] = bones[name].getWorldQuaternion(new THREE.Quaternion());
  const control = {};
  for (const name of order) {
    for (let o = bones[name]; o?.isBone; o = o.parent) {
      if (JOINT_OF[o.name]) {
        control[name] = JOINT_OF[o.name];
        break;
      }
    }
  }
  const rest = {};
  for (const [id, name] of Object.entries(BONE_OF)) rest[id] = bones[name].getWorldPosition(new THREE.Vector3());

  // 높이·머리 (아이 머리 키우기용)
  const box = new THREE.Box3().setFromObject(scene, true);
  const headPivotY = rest.head.y;
  const top = box.max.y;
  const headLength = (top - headPivotY) * 1.15; // 머리 뼈 기준점(목 위)부터 정수리 + 턱 조금
  return {
    scene,
    order,
    baseWorld,
    control,
    rest,
    rootParentWorld: rootBone.parent.getWorldQuaternion(new THREE.Quaternion()),
    pelvisParentInverse: bones[BONE_OF.pelvis].parent.matrixWorld.clone().invert(),
    bottom: box.min.y,
    top,
    headPivotY,
    nativeHeads: (top - box.min.y) / headLength,
  };
}

/**
 * 사람 한 명의 몸: 뼈대 모델 복제 + 눈에 안 보이는 관절 그룹들.
 * userData = { joints, sync(), jointForHit(hit), body }
 */
export function createRiggedBody(templates, type, height) {
  const t = templates.get(type) || templates.get(DEFAULT_BODY);
  const body = new THREE.Group();
  body.name = '마네킹';
  const rig = SkeletonUtils.clone(t.scene);
  const bones = {};
  let mesh = null;
  rig.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) mesh = o;
    if (o.isMesh) {
      o.material = material;
      o.castShadow = o.receiveShadow = true;
      o.frustumCulled = false; // 포즈에 따라 모양이 바뀌어서 미리 계산한 범위로 잘라내면 안 됨
      o.userData.sharedGeometry = true; // 여러 사람이 같이 쓰는 모양 (지울 때 정리하면 안 됨)
    }
  });
  rig.position.y = -t.bottom;
  body.add(rig);
  const rest = {};
  for (const [id, p] of Object.entries(t.rest)) rest[id] = p.clone().setY(p.y - t.bottom);
  const joints = buildJoints(body, rest);

  // 아이일수록 머리를 크게, 몸 전체는 키에 맞춤
  const headScale = THREE.MathUtils.clamp(t.nativeHeads / headsTall(height), 1, 1.6);
  bones[BONE_OF.head].scale.setScalar(headScale);
  const fullHeight = t.headPivotY - t.bottom + headScale * (t.top - t.headPivotY);
  body.scale.setScalar(height / fullHeight);

  const order = t.order.map((name) => bones[name]);
  const pelvisBone = bones[BONE_OF.pelvis];
  const world = new Map();
  const jointWorld = {};
  const offset = new THREE.Vector3(0, -t.bottom, 0);

  /** 관절 그룹의 지금 회전·골반 위치 → 뼈 */
  function sync() {
    for (const def of JOINTS) {
      const q = joints[def.id].quaternion;
      jointWorld[def.id] = def.parent ? jointWorld[def.parent].clone().multiply(q) : q.clone();
    }
    world.clear();
    for (const bone of order) {
      const id = t.control[bone.name];
      const w = id ? jointWorld[id].clone().multiply(t.baseWorld[bone.name]) : t.baseWorld[bone.name].clone();
      world.set(bone, w);
      const parentWorld = world.get(bone.parent) || t.rootParentWorld;
      bone.quaternion.copy(parentWorld.clone().invert().multiply(w));
    }
    // 골반 위치 (발 바닥에 붙이기로 오르내림): 관절 위치(몸 기준) → 모델 좌표 → 골반 뼈 부모 기준
    pelvisBone.position.copy(joints.pelvis.position).sub(offset).applyMatrix4(t.pelvisParentInverse);
    mesh.boundingBox = null; // 선택 상자·클릭 검사가 새 모양으로 다시 계산하게
    mesh.boundingSphere = null;
  }

  /** 몸을 클릭한 곳 → 그 부분을 움직이는 관절 (가장 많이 영향을 주는 뼈 기준) */
  function jointForHit(hit) {
    if (hit.object !== mesh || !hit.face) return null;
    const index = mesh.geometry.attributes.skinIndex;
    const weight = mesh.geometry.attributes.skinWeight;
    let best = -1;
    let bestWeight = -1;
    for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
      for (let k = 0; k < 4; k++) {
        const w = weight.getComponent(v, k);
        if (w > bestWeight) {
          bestWeight = w;
          best = index.getComponent(v, k);
        }
      }
    }
    const bone = mesh.skeleton.bones[best];
    const id = bone && t.control[bone.name];
    return id ? joints[id] : null;
  }

  body.userData = { joints, sync, jointForHit, body: templates.has(type) ? type : DEFAULT_BODY };
  sync();
  return body;
}

function setWorldQuaternion(object, q) {
  const parent = object.parent.getWorldQuaternion(new THREE.Quaternion());
  object.quaternion.copy(parent.invert().multiply(q));
}
