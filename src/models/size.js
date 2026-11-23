// 모델 크기 재기 / 높이를 숫자로 맞추기. (단위 m)
import * as THREE from 'three';

const box = new THREE.Box3();

/**
 * 물체의 실제 크기(가로 x, 높이 y, 깊이 z).
 * precise=true 면 꼭짓점을 하나하나 봐서 정확하지만 큰 모델에선 조금 느림.
 */
export function measure(object, precise = true) {
  visibleBox(object, precise, box);
  if (box.isEmpty()) return new THREE.Vector3();
  return box.getSize(new THREE.Vector3());
}

const _v = new THREE.Vector3();
const _b = new THREE.Box3();

/**
 * 보이는 부분만의 범위 상자. 숨긴 부품(SKP·Blender 에서 숨긴 보조 물체 등)은 빼고 잼 —
 * 안 그러면 숨긴 큰 물체 때문에 모델이 공중에 뜨거나, 높이·시점 맞추기가 엉뚱해짐.
 * 보이는 게 하나도 없으면 전체로.
 */
export function visibleBox(object, precise = true, target = new THREE.Box3()) {
  object.updateWorldMatrix(true, true);
  target.makeEmpty();
  object.traverseVisible((o) => {
    const geometry = o.geometry;
    if (!geometry) return;
    const position = geometry.getAttribute('position');
    if (precise && position && !o.isInstancedMesh) {
      for (let i = 0; i < position.count; i++) {
        if (o.isMesh) o.getVertexPosition(i, _v);
        else _v.fromBufferAttribute(position, i);
        target.expandByPoint(_v.applyMatrix4(o.matrixWorld));
      }
    } else {
      if (o.boundingBox !== undefined) {
        if (o.boundingBox === null) o.computeBoundingBox();
        _b.copy(o.boundingBox);
      } else {
        if (geometry.boundingBox === null) geometry.computeBoundingBox();
        _b.copy(geometry.boundingBox);
      }
      target.union(_b.applyMatrix4(o.matrixWorld));
    }
  });
  if (target.isEmpty()) target.setFromObject(object, precise);
  return target;
}

/** 비율을 유지한 채 높이가 meters 가 되도록 크기 조절. 성공하면 true */
export function setHeight(object, meters) {
  const current = measure(object).y;
  if (!(current > 0) || !(meters > 0)) return false;
  object.scale.multiplyScalar(meters / current);
  object.updateMatrixWorld(true);
  return true;
}
