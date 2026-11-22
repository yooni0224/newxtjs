// 모델 하나의 상태 저장/되살리기 (부품 위치까지).
//
// 불러올 때 모든 물체에 '원본 파일 안 위치'(userData.srcPath, 자식 순서 경로)를 붙여 둠 (modelStore.tagSourcePaths).
// 저장: 지금 내용 그룹의 구조를 그대로 나무로 적음 — 물체마다 { 원본 위치, 이름, 위치·회전·크기, 숨김, 잠금, 자식들 }
//   → 그룹 편집으로 옮긴 부품, 복제한 부품(같은 원본 위치가 여러 번 나옴), 지운 부품(나무에 없음)이 다 들어감
// 되살리기: 원본 파일을 새로 불러온 뒤(pristine), 나무를 따라 원본 물체를 '자기만'(자식 빼고) 복사해서 다시 조립
//   메시는 모양(geometry)·재질을 원본과 같이 씀 → 복제해도 메모리를 더 쓰지 않음
// 뼈대(스키닝)가 있는 모델은 이렇게 다시 조립할 수 없어서, 원본 구조 그대로 두고 위치·숨김·잠금만 맞춤.
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const DIGITS = 6;
const round = (v) => Math.round(v * 10 ** DIGITS) / 10 ** DIGITS;
const arr = (v) => v.toArray().map(round);

/** 모델 root → 저장할 값 */
export function captureModel(root) {
  const content = root.children.find((c) => c.userData.modelContent);
  return {
    name: root.name,
    source: root.userData.source,
    position: arr(root.position),
    quaternion: arr(root.quaternion),
    scale: arr(root.scale),
    visible: root.visible,
    locked: !!root.userData.locked,
    tree: content ? captureNode(content) : null,
  };
}

function captureNode(o) {
  const node = { s: o.userData.srcPath ?? null, n: o.name, p: arr(o.position), q: arr(o.quaternion), k: arr(o.scale) };
  if (!o.visible) node.v = 0;
  if (o.userData.locked) node.l = 1;
  const kids = o.children.filter((c) => c.userData.srcPath !== undefined);
  if (kids.length) node.c = kids.map(captureNode);
  return node;
}

/**
 * 원본(pristine)과 저장된 나무로 내용 그룹을 다시 만듦.
 * pristine 은 여러 모델(복제한 모델 전체)이 같이 써도 됨 — 건드리지 않음.
 */
export function rebuildContent(pristine, tree) {
  const byPath = new Map();
  let skinned = false;
  pristine.traverse((o) => {
    byPath.set(o.userData.srcPath, o);
    if (o.isSkinnedMesh || o.isBone) skinned = true;
  });
  if (!tree) return SkeletonUtils.clone(pristine);
  if (skinned) return applyOnly(SkeletonUtils.clone(pristine), tree);

  const build = (t) => {
    const src = byPath.get(t.s);
    if (!src) return null; // 원본 파일이 바뀌어서 없는 물체
    const o = src.clone(false); // 자기만 복사 (메시는 모양·재질을 같이 씀)
    setNode(o, t);
    for (const ct of t.c || []) {
      const child = build(ct);
      if (child) o.add(child);
    }
    return o;
  };
  return build(tree) || SkeletonUtils.clone(pristine);
}

/** 뼈대 있는 모델: 구조는 원본 그대로, 같은 위치의 물체에 저장된 값만 적용 */
function applyOnly(content, tree) {
  const byPath = new Map();
  content.traverse((o) => byPath.set(o.userData.srcPath, o));
  const walk = (t) => {
    const o = byPath.get(t.s);
    if (o) setNode(o, t);
    for (const ct of t.c || []) walk(ct);
  };
  walk(tree);
  return content;
}

function setNode(o, t) {
  o.name = t.n ?? o.name;
  o.position.fromArray(t.p);
  o.quaternion.fromArray(t.q);
  o.scale.fromArray(t.k);
  o.visible = t.v !== 0;
  if (t.l) o.userData.locked = true;
  else delete o.userData.locked;
}
