// 장면에 배치된 모델 목록 관리: 추가 / 복제 / 삭제 / 숨기기 / 잠그기.
//
// 모델 하나 = 빈 그룹(root) 안에 불러온 모델(내용)을 넣은 것.
// root 의 기준점은 '모델 바닥 한가운데' 라서, 바닥(높이 0)에 놓고 크기를 바꿔도 바닥에 붙어 있다.
// 내용(userData.modelContent) 안은 불러온 파일의 그룹·오브젝트 구조 그대로.
// 그 안의 부품도 복제·삭제할 수 있음 (그룹 편집: src/editor/selection.js).
// 숨기기 = visible 끄기 (화면·내보내기·그림자·밟기 모두 빠짐)
// 잠그기 = userData.locked (클릭 선택만 안 됨. 1인칭 지형 따라가기에서는 그대로 밟힘)
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
    object.userData.modelContent = true; // 불러온 내용 (그룹 편집할 때 root 대신 들어가는 곳)
    root.add(object);
    prepareFastRaycast(object);
    object.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true; // 그림자 드리우고 받기 (src/render/shadows.js)
    });

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

  /**
   * 복제: 원본 바로 옆(가로 폭만큼 오른쪽, 세상 기준)에 만든다.
   * 모델 전체든 안의 부품이든 같은 부모 안에 넣음.
   */
  function duplicate(object) {
    const parent = object.parent;
    const copy = SkeletonUtils.clone(object);
    const width = measure(object, false).x || 1;
    // 세상 기준 오른쪽으로 width 만큼 → 부모 기준 위치로 바꿔서 넣음
    const world = object.getWorldPosition(new THREE.Vector3());
    world.x += width;
    copy.position.copy(parent.worldToLocal(world));
    parent.add(copy);
    emit('models-changed');
    return copy;
  }

  /** 삭제 (모델 전체 또는 부품): 다른 복제본이 안 쓰는 메모리만 정리 */
  function remove(object) {
    object.removeFromParent();
    disposeUnused(object, group);
    emit('models-changed');
  }

  /** 숨기기/보이기 */
  function setHidden(object, hidden) {
    object.visible = !hidden;
    emit('model-flags-changed', object);
  }

  /** 잠그기/풀기 */
  function setLocked(object, locked) {
    if (locked) object.userData.locked = true;
    else delete object.userData.locked;
    emit('model-flags-changed', object);
  }

  return {
    group,
    add,
    duplicate,
    remove,
    setHidden,
    setLocked,
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
