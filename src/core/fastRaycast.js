// 빠른 광선 검사 (three-mesh-bvh 라이브러리).
// 큰 배경 모델에서도 클릭 선택·찍기·1인칭 지형 따라가기가 느려지지 않게 해 줌.
// 이 파일을 import 하기만 하면 three.js 의 광선 검사가 빠른 방식으로 바뀜.
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** 모델 안의 메시마다 검사용 구조를 미리 만들어 둠 (불러올 때 한 번) */
export function prepareFastRaycast(object) {
  object.traverse((o) => {
    const g = o.geometry;
    if (!o.isMesh || o.isSkinnedMesh || !g?.attributes.position || g.boundsTree) return;
    try {
      g.computeBoundsTree();
    } catch (err) {
      console.warn('빠른 검사 준비 실패(보통 검사로 대신함):', err);
    }
  });
}
