// 왼쪽 '레이어' 패널: 불러온 모델의 그룹·오브젝트 구조를 나무(트리)로 보여 줌.
//   이름 클릭: 선택 (부품이면 그 그룹 안으로 들어간 상태가 됨) · 이름 더블클릭: 그 안으로 들어가기
//   ▸ 펼치기/접기 · 눈: 숨기기/보이기 · 자물쇠: 잠그기/풀기
// 숨긴 것은 화면·내보내기·그림자에서 빠지고, 잠근 것은 선택만 안 됨(1인칭에서는 밟힘).
// 상태 바꾸기는 src/models/modelStore.js, 선택·그룹 편집은 src/editor/selection.js
import { on } from '../core/events.js';
import { isLocked } from '../editor/selection.js';
import { toast } from './toast.js';

const MAX_ROWS_PER_GROUP = 300; // 한 그룹에서 한 번에 보여 줄 자식 수 (아주 큰 모델 대비)

const ICONS = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
};

export function setupLayerPanel({ store, selection }) {
  const panel = document.getElementById('layers');
  const tree = document.getElementById('layer-tree');
  const expanded = new WeakSet(); // 펼친 그룹
  const showAll = new WeakSet(); // 자식이 아주 많아도 다 보여 줄 그룹
  let rowOf = new Map(); // 물체 → 줄 (선택한 줄로 스크롤할 때)

  document.getElementById('btn-layers-toggle').addEventListener('click', (e) => {
    e.currentTarget.blur();
    panel.classList.toggle('collapsed'); // 3D 화면 크기는 viewer 가 알아서 맞춤
  });

  /** 트리에 보여 줄 자식들. 모델 root 는 불러온 내용 그룹을 건너뛰고 그 안의 것들 */
  function childrenOf(node) {
    const inner = node.userData.kind === 'model' ? node.children.find((c) => c.userData.modelContent) : node;
    return inner ? inner.children.filter((c) => !c.isBone) : [];
  }

  function render() {
    rowOf = new Map();
    const frag = document.createDocumentFragment();
    const roots = store.list();
    if (!roots.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = '불러온 모델이 여기에 나옵니다.';
      frag.append(empty);
    }
    for (const root of roots) addRows(frag, root, 0, false, false);
    tree.replaceChildren(frag);
  }

  function addRows(parentEl, node, depth, parentHidden, parentLocked) {
    const kids = childrenOf(node);
    const hidden = !node.visible;
    const locked = !!node.userData.locked;
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.classList.toggle('selected', node === selection.getSelected());
    row.classList.toggle('context', isContext(node));
    row.classList.toggle('dim', hidden || parentHidden);
    row.classList.toggle('locked', locked || parentLocked);
    row.style.paddingLeft = `${4 + depth * 14}px`;

    const toggle = document.createElement('button');
    toggle.className = 'layer-toggle';
    toggle.textContent = kids.length ? (expanded.has(node) ? '▾' : '▸') : '';
    toggle.disabled = !kids.length;
    toggle.addEventListener('click', () => {
      if (expanded.has(node)) expanded.delete(node);
      else expanded.add(node);
      render();
    });

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = displayName(node);
    name.title = kids.length ? `${name.textContent} (${kids.length}개) — 더블클릭: 안으로 들어가기` : name.textContent;
    name.addEventListener('click', () => pick(node));
    name.addEventListener('dblclick', () => {
      if (!selection.enter(node)) return;
      expanded.add(node);
      render();
    });

    const eye = iconButton(hidden ? ICONS.eyeOff : ICONS.eye, hidden ? '보이기' : '숨기기', hidden);
    eye.addEventListener('click', () => store.setHidden(node, !hidden));
    const lock = iconButton(locked ? ICONS.lock : ICONS.unlock, locked ? '잠금 풀기' : '잠그기 (선택 안 됨, 1인칭에선 밟힘)', locked);
    lock.addEventListener('click', () => store.setLocked(node, !locked));

    row.append(toggle, name, eye, lock);
    parentEl.append(row);
    rowOf.set(node, row);

    if (!expanded.has(node)) return;
    const list = showAll.has(node) ? kids : kids.slice(0, MAX_ROWS_PER_GROUP);
    for (const kid of list) addRows(parentEl, kid, depth + 1, hidden || parentHidden, locked || parentLocked);
    if (list.length < kids.length) {
      const more = document.createElement('button');
      more.className = 'layer-more';
      more.style.marginLeft = `${18 + (depth + 1) * 14}px`;
      more.textContent = `… ${kids.length - list.length}개 더 보기`;
      more.addEventListener('click', () => {
        showAll.add(node);
        render();
      });
      parentEl.append(more);
    }
  }

  function isContext(node) {
    const ctx = selection.getContext();
    if (!ctx) return false;
    return ctx === node || (!!ctx.userData.modelContent && ctx.parent === node);
  }

  /** 줄 클릭: 그 물체 선택 (잠겼거나 숨겨져 있으면 알려 줌) */
  function pick(node) {
    if (isLocked(node)) return toast('잠겨 있어요. 자물쇠를 풀면 선택할 수 있어요.', 'warn');
    if (!isShownInTree(node)) return toast('숨겨져 있어요. 눈을 켜면 선택할 수 있어요.', 'warn');
    selection.select(node);
  }

  /** 선택한 것이 보이도록 위쪽 그룹을 펼치고 그 줄로 스크롤 */
  function reveal(object) {
    if (!object) return;
    for (let o = object.parent; o && o !== store.group; o = o.parent) {
      if (o.userData.modelContent) continue;
      expanded.add(o);
    }
  }

  on('models-changed', render);
  on('model-flags-changed', render);
  // 그룹 안으로 들어가면 그 그룹을 펼쳐서 고를 수 있는 자식들이 보이게
  on('context-changed', (ctx) => {
    if (ctx) {
      const node = ctx.userData.modelContent ? ctx.parent : ctx;
      reveal(node);
      expanded.add(node);
    }
    render();
  });
  on('selection-changed', (obj) => {
    reveal(obj);
    render();
    rowOf.get(obj)?.scrollIntoView({ block: 'nearest' });
  });
  render();
}

function iconButton(svg, title, on) {
  const btn = document.createElement('button');
  btn.className = 'layer-icon';
  btn.classList.toggle('on', on);
  btn.innerHTML = svg;
  btn.title = title;
  return btn;
}

function displayName(node) {
  if (node.name) return node.name;
  if (node.isMesh) return '(이름 없는 메시)';
  return '(이름 없는 그룹)';
}

function isShownInTree(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
