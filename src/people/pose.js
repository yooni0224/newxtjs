// 포즈: 관절 각도 읽기/쓰기, 회전 범위 지키기, 발 바닥에 붙이기, 포즈 프리셋.
// 관절 그룹을 돌린 뒤에는 syncBody 로 몸(뼈대 모델의 뼈)에 반영 — groundBody 가 해 줌.
// 포즈 = { 관절 id: [x, y, z] (도) }. 없는 관절은 0 (차렷 자세).
// 관절 목록·회전 범위는 src/people/mannequin.js 의 JOINTS.
import * as THREE from 'three';
import { JOINTS } from './mannequin.js';

const { degToRad, radToDeg } = THREE.MathUtils;

/** 왼쪽 값 [x, y, z] → 오른쪽 값 (y·z 거울) */
const mirror = ([x, y, z]) => [x, -y, -z];
/** 왼쪽·오른쪽을 같이 적기. both('elbow', [-20, 0, 0]) → { elbowL, elbowR } */
const both = (base, left) => ({ [base + 'L']: left, [base + 'R']: mirror(left) });

/**
 * 포즈 프리셋. 값은 [앞뒤 x, 비틀기 y, 옆 z] (도)
 *   팔다리 x: - 앞으로 듦 / 무릎 x: + 굽힘 / 팔꿈치 x: - 굽힘 / 몸통 x: + 앞으로 숙임
 *   왼쪽 z: + 바깥으로 벌림 (오른쪽은 반대 부호)
 * 높이는 자동으로 맞춤 (가장 낮은 곳이 바닥에 닿게)
 */
export const POSE_PRESETS = {
  stand: {
    name: '서기',
    pose: { ...both('shoulder', [3, 0, 4]), ...both('elbow', [-10, 0, 0]) },
  },
  walk: {
    name: '걷기',
    pose: {
      waist: [3, 4, 0],
      chest: [0, -6, 0],
      hipL: [-24, 0, 0], kneeL: [6, 0, 0], ankleL: [-8, 0, 0],
      hipR: [16, 0, 0], kneeR: [22, 0, 0], ankleR: [18, 0, 0],
      shoulderL: [20, 0, 4], elbowL: [-12, 0, 0],
      shoulderR: [-22, 0, -4], elbowR: [-28, 0, 0],
    },
  },
  run: {
    name: '달리기',
    pose: {
      waist: [14, 6, 0],
      chest: [4, -8, 0],
      neck: [-10, 0, 0],
      hipL: [-60, 0, 0], kneeL: [85, 0, 0], ankleL: [10, 0, 0],
      hipR: [25, 0, 0], kneeR: [40, 0, 0], ankleR: [35, 0, 0],
      shoulderL: [45, 0, 8], elbowL: [-95, 0, 0],
      shoulderR: [-55, 0, -8], elbowR: [-100, 0, 0],
    },
  },
  sitChair: {
    name: '의자에 앉기',
    pose: {
      ...both('hip', [-90, 0, 6]),
      ...both('knee', [90, 0, 0]),
      ...both('shoulder', [-18, 0, 6]),
      ...both('elbow', [-62, 0, 0]),
    },
  },
  sitFloor: {
    name: '바닥에 앉기',
    pose: {
      waist: [8, 0, 0],
      neck: [-8, 0, 0],
      ...both('hip', [-70, 60, 46]),
      kneeL: [138, 0, 0],
      kneeR: [146, 0, 0],
      ...both('ankle', [20, 0, 0]),
      ...both('shoulder', [-22, 0, 8]),
      ...both('elbow', [-55, 0, 0]),
    },
  },
  armsCrossed: {
    name: '팔짱',
    pose: {
      shoulderL: [-28, -78, 14], elbowL: [-118, 0, 0],
      shoulderR: [-32, 78, -14], elbowR: [-112, 0, 0],
      ...both('wrist', [0, 0, 0]),
    },
  },
};

/** 마네킹 그룹 (사람 root 의 자식) */
export function bodyOf(person) {
  return person.children.find((c) => c.userData.joints) || null;
}

/** 지금 포즈 읽기 (0 인 관절은 뺌) */
export function getPose(person) {
  const body = bodyOf(person);
  const pose = {};
  if (!body) return pose;
  for (const [id, joint] of Object.entries(body.userData.joints)) {
    const r = joint.rotation;
    const deg = [r.x, r.y, r.z].map((a) => Math.round(radToDeg(a) * 100) / 100);
    if (deg.some((d) => d !== 0)) pose[id] = deg;
  }
  return pose;
}

/** 포즈 적용 (없는 관절은 0) → 범위 지키기 → 발 바닥에 붙이기 */
export function setPose(person, pose = {}) {
  const body = bodyOf(person);
  if (!body) return;
  for (const [id, joint] of Object.entries(body.userData.joints)) {
    const [x, y, z] = pose[id] || [0, 0, 0];
    joint.rotation.set(degToRad(x), degToRad(y), degToRad(z), 'XZY');
    clampJoint(joint);
  }
  groundBody(body);
}

/**
 * 관절이 사람이 꺾을 수 있는 범위를 넘지 않게.
 * 같은 방향을 나타내는 각도가 두 가지라서(x+180, 180-z, y+180) 범위에 더 가까운 쪽을 골라 자름.
 */
export function clampJoint(joint) {
  const { limits } = joint.userData;
  if (!limits) return;
  const e = new THREE.Euler().setFromQuaternion(joint.quaternion, 'XZY');
  const a = [e.x, e.y, e.z].map(radToDeg);
  const b = [a[0] + 180, a[1] + 180, 180 - a[2]].map(wrap);
  const ranges = [limits.x, limits.y, limits.z];
  const best = violation(a, ranges) <= violation(b, ranges) ? a : b;
  const clamped = best.map((value, i) => clampWrapped(value, ranges[i]));
  joint.rotation.set(...clamped.map(degToRad), 'XZY');
}

function wrap(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
/** 범위 밖으로 벗어난 정도 (±360° 같은 각도까지 봐서 가장 가까운 값) */
function outside(value, [min, max]) {
  return Math.min(...[value, value - 360, value + 360].map((v) => Math.max(min - v, 0, v - max)));
}
function violation(angles, ranges) {
  return angles.reduce((sum, v, i) => sum + outside(v, ranges[i]), 0);
}
function clampWrapped(value, [min, max]) {
  const candidates = [value, value - 360, value + 360];
  const inside = candidates.find((v) => v >= min && v <= max);
  if (inside !== undefined) return inside;
  // 범위 밖: 가장 가까운 끝으로
  let best = min;
  let bestDist = Infinity;
  for (const v of candidates) {
    for (const edge of [min, max]) {
      const d = Math.abs(v - edge);
      if (d < bestDist) {
        bestDist = d;
        best = edge;
      }
    }
  }
  return best;
}

/**
 * 발 바닥에 붙이기: 몸에서 가장 낮은 곳이 높이 0(사람 root 의 바닥)에 닿도록 골반 높이를 맞춤.
 * 의자에 앉으면 엉덩이가 무릎 높이로, 바닥에 앉으면 엉덩이가 바닥으로 내려감.
 */
export function groundBody(body) {
  const pelvis = body.userData.joints.pelvis;
  pelvis.position.copy(pelvis.userData.restPosition);
  syncBody(body);
  const toBody = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  let minY = Infinity;
  body.traverse((o) => {
    const pos = o.isMesh && o.geometry.attributes.position;
    if (!pos) return;
    m.multiplyMatrices(toBody, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      // 뼈대 모델은 포즈대로 휜 위치 (getVertexPosition)
      if (o.isSkinnedMesh) o.getVertexPosition(i, p);
      else p.fromBufferAttribute(pos, i);
      const y = p.applyMatrix4(m).y;
      if (y < minY) minY = y;
    }
  });
  if (Number.isFinite(minY)) pelvis.position.y -= minY;
  syncBody(body);
}

/** 관절 그룹의 지금 회전을 몸에 반영 (뼈대 모델이면 뼈를 돌림) + 위치 계산 갱신 */
export function syncBody(body) {
  body.userData.sync?.();
  body.updateMatrixWorld(true);
}

/** 관절 id → 화면에 보여 줄 이름 */
export function jointName(id) {
  return JOINTS.find((j) => j.id === id)?.name ?? id;
}
