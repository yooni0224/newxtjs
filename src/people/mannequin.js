// 관절로 움직이는 마네킹 만들기.
// 키에 따라 '몇 등신'인지 바뀜: 성인 7.5등신, 아이는 머리가 상대적으로 큼.
// 발바닥 = 높이 0, 머리 꼭대기 = 키. 앞쪽은 +Z (발끝·코가 향하는 쪽), 사람의 왼쪽 = +X.
//
// 관절 계층 (부모가 돌면 자식이 따라 돎)
//   골반 → 허리 → 가슴 → 목 → 머리
//                  가슴 → 어깨 → 팔꿈치 → 손목   (왼쪽·오른쪽)
//   골반 → 고관절 → 무릎 → 발목                   (왼쪽·오른쪽)
// 관절 하나 = 빈 그룹. 몸 부위(메시)는 그 관절의 자식이라 관절이 돌면 같이 돎.
// 기본 자세(모든 관절 0°) = 차렷 자세. 회전 범위·포즈는 src/people/pose.js
import * as THREE from 'three';

// 좌우가 있는 관절 이름 (자식의 부모를 고를 때 씀)
const JOINTS_WITH_SIDE = new Set(['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']);

/**
 * 관절 목록. limits = 회전 범위(도, 기본 자세 기준). 회전 순서 'XZY'
 *   x: 앞뒤로 굽히기  (팔다리: - 면 앞으로 듦 / 몸통: + 면 앞으로 숙임 / 무릎: + 면 뒤로 굽힘)
 *   z: 옆으로 벌리기 (왼쪽 기준 + 면 바깥으로)
 *   y: 비틀기       (왼쪽 기준 + 면 바깥쪽으로 돎)
 * side 가 있는 관절은 왼쪽(+1) 값을 적고, 오른쪽(-1)은 y·z 를 거울처럼 뒤집어 씀.
 * 범위가 [0, 0] 인 축은 돌릴 수 없음 (무릎·팔꿈치는 앞뒤로만).
 */
export const JOINTS = [
  { id: 'pelvis', name: '골반', parent: null, limits: { x: [-90, 90], y: [-60, 60], z: [-60, 60] } },
  { id: 'waist', name: '허리', parent: 'pelvis', limits: { x: [-30, 50], y: [-40, 40], z: [-30, 30] } },
  { id: 'chest', name: '가슴', parent: 'waist', limits: { x: [-20, 30], y: [-30, 30], z: [-20, 20] } },
  { id: 'neck', name: '목', parent: 'chest', limits: { x: [-40, 45], y: [-60, 60], z: [-35, 35] } },
  { id: 'head', name: '머리', parent: 'neck', limits: { x: [-30, 30], y: [-30, 30], z: [-20, 20] } },
  ...sided('shoulder', '어깨', 'chest', { x: [-180, 60], y: [-90, 60], z: [-30, 180] }),
  ...sided('elbow', '팔꿈치', 'shoulder', { x: [-150, 0], y: [0, 0], z: [0, 0] }),
  ...sided('wrist', '손목', 'elbow', { x: [-40, 40], y: [-80, 80], z: [-70, 60] }),
  ...sided('hip', '고관절', 'pelvis', { x: [-125, 30], y: [-45, 60], z: [-25, 50] }),
  ...sided('knee', '무릎', 'hip', { x: [0, 150], y: [0, 0], z: [0, 0] }),
  ...sided('ankle', '발목', 'knee', { x: [-30, 45], y: [-25, 25], z: [-20, 20] }),
];

function sided(base, name, parent, limits) {
  const parentId = (s) => (JOINTS_WITH_SIDE.has(parent) ? parent + s : parent);
  return [
    { id: base + 'L', name: '왼쪽 ' + name, parent: parentId('L'), side: 1, limits },
    { id: base + 'R', name: '오른쪽 ' + name, parent: parentId('R'), side: -1, limits: mirrorLimits(limits) },
  ];
}
/** 왼쪽 범위 → 오른쪽 범위 (y·z 를 뒤집음) */
function mirrorLimits({ x, y, z }) {
  return { x, y: [-y[1], -y[0]], z: [-z[1], -z[0]] };
}

/** 키(m) → 등신 (머리 몇 개 높이인지) */
function headsTall(height) {
  return THREE.MathUtils.clamp(5 + ((height - 0.9) / 0.7) * 2.5, 5, 7.5);
}

/**
 * @param height    키(m)
 * @param bodyMat   몸 재질
 * @param jointMat  관절 재질
 * @returns {THREE.Group}  userData.joints = { 관절 id: 관절 그룹 }
 */
export function buildMannequin(height, bodyMat, jointMat) {
  const H = height;
  const heads = headsTall(H);
  const u = H / heads; // 머리 하나 길이
  const chin = H - u;
  const B = chin; // 턱 아래 몸 길이
  const at = (f) => chin - f * B; // 턱에서 몸 길이의 f 만큼 아래 높이

  const shoulderY = at(0.07);
  const waistY = at(0.3);
  const hipY = at(0.43);
  const kneeY = at(0.68);
  const ankleY = 0.045 * B;
  const elbowY = at(0.31);
  const wristY = at(0.46);
  const chestY = THREE.MathUtils.lerp(waistY, shoulderY, 0.35);
  const adult = THREE.MathUtils.clamp((heads - 5.5) / 2, 0, 1);
  const shoulderX = u * THREE.MathUtils.lerp(0.75, 0.9, adult);
  const hipX = 0.42 * u;
  const v = (x, y, z = 0) => new THREE.Vector3(x, y, z);

  // ---------- 관절 위치 (기본 자세, 마네킹 기준 좌표) ----------
  const rest = {
    pelvis: v(0, hipY),
    waist: v(0, waistY),
    chest: v(0, chestY),
    neck: v(0, shoulderY - 0.05 * u),
    head: v(0, chin + 0.1 * u),
  };
  for (const [suffix, s] of [['L', 1], ['R', -1]]) {
    rest['shoulder' + suffix] = v(s * shoulderX, shoulderY - 0.15 * u);
    rest['elbow' + suffix] = v(s * (shoulderX + 0.05 * u), elbowY);
    rest['wrist' + suffix] = v(s * (shoulderX + 0.08 * u), wristY);
    rest['hip' + suffix] = v(s * hipX, hipY);
    rest['knee' + suffix] = v(s * hipX, kneeY);
    rest['ankle' + suffix] = v(s * hipX, ankleY);
  }

  const group = new THREE.Group();
  group.name = '마네킹';
  const joints = {};
  for (const def of JOINTS) {
    const joint = new THREE.Group();
    joint.name = def.name;
    joint.rotation.order = 'XZY';
    const parent = def.parent ? joints[def.parent] : group;
    joint.position.copy(rest[def.id]).sub(def.parent ? rest[def.parent] : new THREE.Vector3());
    joint.userData = { kind: 'joint', jointId: def.id, limits: def.limits, restPosition: joint.position.clone() };
    parent.add(joint);
    joints[def.id] = joint;
  }
  group.userData.joints = joints;

  // ---------- 몸 부위: 위치는 마네킹 기준으로 적고, 붙일 관절 기준으로 옮겨서 붙임 ----------
  const put = (jointId, mesh) => {
    mesh.position.sub(rest[jointId]);
    joints[jointId].add(mesh);
  };
  const ellipsoid = (jointId, rx, ry, rz, pos, mat = bodyMat) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    mesh.scale.set(rx, ry, rz);
    mesh.position.copy(pos);
    put(jointId, mesh);
  };
  const ball = (jointId, r) => ellipsoid(jointId, r, r, r, rest[jointId], jointMat);
  // a → b 로 가늘어지는 원기둥 (팔다리 마디)
  const limb = (jointId, a, b, ra, rb) => {
    const dir = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, dir.length(), 16), bodyMat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(v(0, 1, 0), dir.normalize());
    put(jointId, mesh);
  };

  // 머리 (꼭대기 = 키) + 코 (앞쪽 표시)
  ellipsoid('head', 0.4 * u, 0.5 * u, 0.45 * u, v(0, H - 0.5 * u));
  ellipsoid('head', 0.07 * u, 0.09 * u, 0.07 * u, v(0, H - 0.55 * u, 0.44 * u));
  // 목
  limb('neck', v(0, shoulderY - 0.05 * u), v(0, chin + 0.15 * u), 0.2 * u, 0.17 * u);
  // 가슴 · 배 · 골반
  const chestR = shoulderX * 0.8;
  ellipsoid('chest', chestR, (shoulderY - chestY) / 2 + 0.17 * u, chestR * 0.5, v(0, (chestY + shoulderY) / 2 + 0.05 * u));
  ellipsoid('waist', chestR * 0.82, (chestY - waistY) / 2 + 0.14 * u, chestR * 0.46, v(0, (waistY + chestY) / 2));
  const pelvisR = hipX + 0.25 * u;
  const pelvisTop = waistY + 0.1 * u;
  const pelvisBottom = hipY - 0.35 * u;
  ellipsoid('pelvis', pelvisR, (pelvisTop - pelvisBottom) / 2, pelvisR * 0.65, v(0, (pelvisTop + pelvisBottom) / 2));

  for (const [suffix, s] of [['L', 1], ['R', -1]]) {
    const j = (name) => name + suffix;
    // 팔: 어깨 → 팔꿈치 → 손목 → 손
    ball(j('shoulder'), 0.2 * u);
    limb(j('shoulder'), rest[j('shoulder')], rest[j('elbow')], 0.19 * u, 0.15 * u);
    ball(j('elbow'), 0.15 * u);
    limb(j('elbow'), rest[j('elbow')], rest[j('wrist')], 0.15 * u, 0.11 * u);
    const wrist = rest[j('wrist')];
    ellipsoid(j('wrist'), 0.08 * u, 0.38 * u, 0.15 * u, v(wrist.x, wrist.y - 0.36 * u));

    // 다리: 고관절 → 무릎 → 발목 → 발
    ball(j('hip'), 0.27 * u);
    limb(j('hip'), rest[j('hip')], rest[j('knee')], 0.28 * u, 0.2 * u);
    ball(j('knee'), 0.19 * u);
    limb(j('knee'), rest[j('knee')], rest[j('ankle')], 0.19 * u, 0.13 * u);
    const footH = Math.max(ankleY * 1.3, 0.25 * u);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42 * u, footH, 1.1 * u), bodyMat);
    foot.position.set(s * hipX, footH / 2, 0.3 * u);
    put(j('ankle'), foot);
  }

  return group;
}
