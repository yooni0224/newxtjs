// 모델 크기 재기 / 높이를 숫자로 맞추기. (단위 m)
import * as THREE from 'three';

const box = new THREE.Box3();

/**
 * 물체의 실제 크기(가로 x, 높이 y, 깊이 z).
 * precise=true 면 꼭짓점을 하나하나 봐서 정확하지만 큰 모델에선 조금 느림.
 */
export function measure(object, precise = true) {
  object.updateWorldMatrix(true, true);
  box.setFromObject(object, precise);
  if (box.isEmpty()) return new THREE.Vector3();
  return box.getSize(new THREE.Vector3());
}

/** 비율을 유지한 채 높이가 meters 가 되도록 크기 조절. 성공하면 true */
export function setHeight(object, meters) {
  const current = measure(object).y;
  if (!(current > 0) || !(meters > 0)) return false;
  object.scale.multiplyScalar(meters / current);
  object.updateMatrixWorld(true);
  return true;
}
