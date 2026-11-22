// 장면에 배치된 모델 목록 관리: 추가 / 복제 / 삭제.
//
// 모델 하나 = 빈 그룹(root) 안에 불러온 모델을 넣은 것.
// root 의 기준점은 '모델 바닥 한가운데' 라서, 바닥(높이 0)에 놓고 크기를 바꿔도 바닥에 붙어 있다.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { emit } from '../core/events.js';
import { measure } from './size.js';
import { prepareFastRaycast } from '../core/fastRaycast.js';

export function createModelStore(scene) {
  const group = new THREE.Group();
  group.name = '모델들';
  scene.add(group);

  // 원본 파일 기억 (4단계 프로젝트 저장 때 사용). id → { name, entries }
  const sources = new Map();
  let nextSourceId = 1;

  /** 불러온 3D 객체를 장면에 추가하고 root 를 돌려준다 */
  function add(object, { name, entries = [] }) {
    const sourceId = String(nextSourceId++);
    sources.set(sourceId, { name, entries });

    const root = new THREE.Group();
    root.name = name;
    root.userData = { kind: 'model', selectable: true, sourceId };
    root.add(object);
    prepareFastRaycast(object);

    // 기준점을 바닥 한가운데로: 모델을 옮겨서 바닥 중앙이 root 원점에 오게 함
    const box = new THREE.Box3().setFromObject(object, true);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      object.position.x -= center.x;
      object.position.z -= center.z;
      object.position.y -= box.min.y;
    }

    group.add(root);
    emit('models-changed');
    return root;
  }

  /** 복제: 원본 바로 옆(가로 폭만큼 오른쪽)에 만든다 */
  function duplicate(root) {
    const copy = SkeletonUtils.clone(root);
    const width = measure(root, false).x || 1;
    copy.position.x += width;
    group.add(copy);
    emit('models-changed');
    return copy;
  }

  /** 삭제: 다른 복제본이 안 쓰는 메모리만 정리 */
  function remove(root) {
    group.remove(root);
    disposeUnused(root, group);
    emit('models-changed');
  }

  return {
    group,
    add,
    duplicate,
    remove,
    list: () => group.children,
    getSource: (root) => sources.get(root.userData.sourceId),
  };
}

function collectResources(object) {
  const set = new Set();
  object.traverse((o) => {
    if (o.geometry) set.add(o.geometry);
    for (const m of [].concat(o.material || [])) {
      set.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) set.add(value);
    }
  });
  return set;
}

function disposeUnused(removed, remaining) {
  const stillUsed = collectResources(remaining);
  for (const res of collectResources(removed)) {
    if (!stillUsed.has(res)) res.dispose();
  }
}
