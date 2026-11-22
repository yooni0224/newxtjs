// 장면에 배치된 모델 목록 관리: 추가 / 복제 / 삭제 / 숨기기 / 잠그기.
//
// 모델 하나 = 빈 그룹(root) 안에 불러온 모델(내용)을 넣은 것.
// root 의 기준점은 '모델 바닥 한가운데' 라서, 바닥(높이 0)에 놓고 크기를 바꿔도 바닥에 붙어 있다.
// 내용(userData.modelContent) 안은 불러온 파일의 그룹·오브젝트 구조 그대로.
// 그 안의 부품도 복제·삭제할 수 있음 (그룹 편집: src/editor/selection.js).
// 숨기기 = visible 끄기 (화면·내보내기·그림자·밟기 모두 빠짐)
// 잠그기 = userData.locked (클릭 선택만 안 됨. 1인칭 지형 따라가기에서는 그대로 밟힘)
// 원본 파일은 '묶음'(한 번에 불러온 파일들)으로 기억 → 프로젝트 파일 하나에 같이 담음 (src/save/project.js)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { emit } from '../core/events.js';
import { measure } from './size.js';
import { prepareFastRaycast } from '../core/fastRaycast.js';

export function createModelStore(scene) {
  const group = new THREE.Group();
  group.name = '모델들';
  scene.add(group);

  // 원본 파일 묶음 (프로젝트 저장에 그대로 담음). 한 번에 불러온 파일들 = 묶음 하나.
  // id → { id, files: [{ file, path }] }
  const bundles = new Map();

  /** 불러온 파일들을 묶음으로 기억하고 id 를 돌려줌 (프로젝트에서 열 때는 원래 id 를 그대로 씀) */
  function addBundle(files, id = newId()) {
    if (!bundles.has(id)) bundles.set(id, { id, files });
    return id;
  }

  /**
   * 불러온 3D 객체를 장면에 추가하고 root 를 돌려준다.
   * @param source  { bundleId, modelPath } — 어느 묶음의 어느 파일인지 (프로젝트 저장용)
   */
  function add(object, { name, source = null }) {
    tagSourcePaths(object);
    const root = new THREE.Group();
    root.name = name;
    root.userData = { kind: 'model', selectable: true, source };
    object.userData.modelContent = true; // 불러온 내용 (그룹 편집할 때 root 대신 들어가는 곳)
    root.add(object);
    prepare(object);

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
   * 프로젝트에서 되살리기: 내용(content)은 이미 저장된 구조대로 만들어진 것. 기준점 맞추기 안 함.
   * @param state  { name, source, position, quaternion, scale, visible, locked }
   */
  function restore(content, state) {
    const root = new THREE.Group();
    root.name = state.name;
    root.userData = { kind: 'model', selectable: true, source: state.source };
    if (state.locked) root.userData.locked = true;
    root.visible = state.visible !== false;
    root.position.fromArray(state.position);
    root.quaternion.fromArray(state.quaternion);
    root.scale.fromArray(state.scale);
    content.userData.modelContent = true;
    root.add(content);
    prepare(content);
    group.add(root);
    return root;
  }

  /** 빠른 광선 검사 준비 + 그림자 드리우고 받기 (src/render/shadows.js) */
  function prepare(object) {
    prepareFastRaycast(object);
    object.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
  }

  /** 모두 지우기 (새 프로젝트, 프로젝트 열기) */
  function clear() {
    for (const root of [...group.children]) {
      root.removeFromParent();
      disposeUnused(root, group);
    }
    bundles.clear();
    emit('models-changed');
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
    addBundle,
    restore,
    clear,
    duplicate,
    remove,
    setHidden,
    setLocked,
    list: () => group.children,
    getBundle: (id) => bundles.get(id),
    /** 지금 장면의 모델들이 쓰는 묶음만 */
    usedBundles() {
      const ids = new Set(group.children.map((r) => r.userData.source?.bundleId).filter(Boolean));
      return [...ids].map((id) => bundles.get(id)).filter(Boolean);
    },
  };
}

/**
 * 불러온 내용의 모든 물체에 '원본 파일 안 위치'(자식 순서 경로) 표시: 내용 = '', 첫째 자식 = '0', 그 첫째 = '0/0'.
 * 복제해도 userData 가 같이 복사되므로 '어느 원본 물체의 복제인지' 알 수 있음 → 프로젝트 저장(src/save/modelState.js)
 */
export function tagSourcePaths(object, path = '') {
  object.userData.srcPath = path;
  object.children.forEach((child, i) => tagSourcePaths(child, path === '' ? String(i) : `${path}/${i}`));
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
