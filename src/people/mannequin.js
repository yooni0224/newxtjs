// 단순한 마네킹(머리·몸통·팔다리 구분) 만들기.
// 키에 따라 '몇 등신'인지 바뀜: 성인 7.5등신, 아이는 머리가 상대적으로 큼.
// 발바닥 = 높이 0, 머리 꼭대기 = 키. 앞쪽은 +Z (발끝·코가 향하는 쪽).
import * as THREE from 'three';

/** 키(m) → 등신 (머리 몇 개 높이인지) */
function headsTall(height) {
  return THREE.MathUtils.clamp(5 + ((height - 0.9) / 0.7) * 2.5, 5, 7.5);
}

/**
 * @param height    키(m)
 * @param bodyMat   몸 재질
 * @param jointMat  관절 재질
 * @returns {THREE.Group}
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
  const adult = THREE.MathUtils.clamp((heads - 5.5) / 2, 0, 1);
  const shoulderX = u * THREE.MathUtils.lerp(0.75, 0.9, adult);
  const hipX = 0.42 * u;

  const group = new THREE.Group();
  const v = (x, y, z = 0) => new THREE.Vector3(x, y, z);

  const ellipsoid = (rx, ry, rz, pos, mat = bodyMat) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    mesh.scale.set(rx, ry, rz);
    mesh.position.copy(pos);
    group.add(mesh);
  };
  const joint = (r, pos) => ellipsoid(r, r, r, pos, jointMat);
  // a → b 로 가늘어지는 원기둥 (팔다리 마디)
  const limb = (a, b, ra, rb) => {
    const dir = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, dir.length(), 16), bodyMat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(v(0, 1, 0), dir.normalize());
    group.add(mesh);
  };

  // 머리 (꼭대기 = 키) + 코 (앞쪽 표시)
  ellipsoid(0.4 * u, 0.5 * u, 0.45 * u, v(0, H - 0.5 * u));
  ellipsoid(0.07 * u, 0.09 * u, 0.07 * u, v(0, H - 0.55 * u, 0.44 * u));
  // 목
  limb(v(0, shoulderY - 0.05 * u), v(0, chin + 0.15 * u), 0.2 * u, 0.17 * u);
  // 가슴 · 골반
  const chestR = shoulderX * 0.8;
  ellipsoid(chestR, (shoulderY - waistY) / 2 + 0.18 * u, chestR * 0.5, v(0, (shoulderY + waistY) / 2 + 0.03 * u));
  const pelvisR = hipX + 0.25 * u;
  const pelvisTop = waistY + 0.1 * u;
  const pelvisBottom = hipY - 0.35 * u;
  ellipsoid(pelvisR, (pelvisTop - pelvisBottom) / 2, pelvisR * 0.65, v(0, (pelvisTop + pelvisBottom) / 2));

  for (const s of [-1, 1]) {
    // 팔: 어깨 → 팔꿈치 → 손목 → 손
    const shoulder = v(s * shoulderX, shoulderY - 0.15 * u);
    const elbow = v(s * (shoulderX + 0.05 * u), elbowY);
    const wrist = v(s * (shoulderX + 0.08 * u), wristY);
    joint(0.2 * u, shoulder);
    limb(shoulder, elbow, 0.19 * u, 0.15 * u);
    joint(0.15 * u, elbow);
    limb(elbow, wrist, 0.15 * u, 0.11 * u);
    ellipsoid(0.08 * u, 0.38 * u, 0.15 * u, v(wrist.x, wrist.y - 0.36 * u));

    // 다리: 엉덩이 → 무릎 → 발목 → 발
    const hip = v(s * hipX, hipY);
    const knee = v(s * hipX, kneeY);
    const ankle = v(s * hipX, ankleY);
    joint(0.27 * u, hip);
    limb(hip, knee, 0.28 * u, 0.2 * u);
    joint(0.19 * u, knee);
    limb(knee, ankle, 0.19 * u, 0.13 * u);
    const footH = Math.max(ankleY * 1.3, 0.25 * u);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42 * u, footH, 1.1 * u), bodyMat);
    foot.position.set(s * hipX, footH / 2, 0.3 * u);
    group.add(foot);
  }

  return group;
}
