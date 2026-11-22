// 1인칭 '지형 따라가기'용: 발밑 표면 찾기, 벽에 막히기.
//   - 한 번에 STEP_UP(0.4m)까지는 올라섬 (계단·경사로·단차)
//   - 그보다 높은 것은 벽처럼 막힘 (벽을 따라 미끄러지듯 움직임)
//   - 발밑에 아무것도 없으면 아래 표면으로 떨어짐 (바닥 그리드 높이 0 이 마지막 바닥)
import * as THREE from 'three';

export const STEP_UP = 0.4; // 한 번에 오를 수 있는 높이 (m)
const BODY_RADIUS = 0.2; // 벽에 이만큼 가까워지면 멈춤 (m)
const DOWN = new THREE.Vector3(0, -1, 0);

/** @param getSurfaces 밟을 수 있는 물체 목록 (모델들. 사람 모형은 넣지 않음) */
export function createTerrain(getSurfaces) {
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true; // 메시마다 가장 가까운 것 하나만 (빠름)
  const normalMatrix = new THREE.Matrix3();

  function firstHit(origin, dir, far) {
    ray.set(origin, dir);
    ray.far = far;
    const targets = getSurfaces().filter((o) => o.visible);
    return ray.intersectObjects(targets, true).find((h) => h.face && isShown(h.object)) || null;
  }

  /** (x, z) 에 fromY 높이로 서 있다가 갈 수 있는 발밑 표면 높이 */
  function groundAt(x, z, fromY) {
    const top = fromY + STEP_UP;
    const hit = firstHit(new THREE.Vector3(x, top + 0.001, z), DOWN, Infinity);
    let ground = hit ? hit.point.y : -Infinity;
    if (fromY >= -0.01) ground = Math.max(ground, 0); // 바닥 그리드도 바닥 (지하에 있을 때는 제외)
    return ground === -Infinity ? fromY : ground;
  }

  /** 이 방향으로 움직이면 몸(발목 위 ~ 눈)이 부딪히는 가장 가까운 면. 없으면 null */
  function obstacle(pos, footY, eyeHeight, move) {
    const len = move.length();
    const dir = move.clone().divideScalar(len);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(BODY_RADIUS * 0.8);
    const low = footY + STEP_UP + 0.02;
    const heights = [low];
    if (eyeHeight > STEP_UP + 0.15) heights.push(footY + (STEP_UP + eyeHeight) / 2, footY + eyeHeight);

    let nearest = null;
    for (const h of heights) {
      for (const s of [0, 1, -1]) {
        const origin = new THREE.Vector3(pos.x + side.x * s, h, pos.z + side.z * s);
        const hit = firstHit(origin, dir, len + BODY_RADIUS);
        if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
      }
    }
    if (!nearest) return null;

    // 벽 방향(수평 법선). 거의 수평인 면이면 그냥 정면으로 막힌 것으로 봄
    const n = nearest.face.normal.clone().applyMatrix3(normalMatrix.getNormalMatrix(nearest.object.matrixWorld));
    n.y = 0;
    if (n.lengthSq() < 1e-4) n.copy(dir).negate();
    n.normalize();
    if (n.dot(dir) > 0) n.negate();
    return { normal: n };
  }

  /** 움직이려는 수평 이동량을 벽에 막히지 않게 고쳐서 돌려줌 (벽을 따라 미끄러짐) */
  function limitMove(pos, footY, eyeHeight, move) {
    if (move.lengthSq() < 1e-12) return move;
    const block = obstacle(pos, footY, eyeHeight, move);
    if (!block) return move;
    const slide = move.clone().addScaledVector(block.normal, -move.dot(block.normal));
    if (slide.lengthSq() < 1e-10 || obstacle(pos, footY, eyeHeight, slide)) return new THREE.Vector3();
    return slide;
  }

  return { groundAt, limitMove };
}

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
