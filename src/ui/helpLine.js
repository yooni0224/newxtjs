// 화면 아래 안내 줄: 지금 하는 일에 맞는 조작법만 보여 줌.
// 순서: 찍기 → 1인칭 → 포즈 모드 → 그룹 편집 → 편집
// 그룹 편집 중이면 화면 위에 '그룹 편집: 모델 › 그룹' 표시도 함.
import { on } from '../core/events.js';

export function setupHelpLine({ walk, picker, poseMode, selection }) {
  const names = ['edit', 'pick', 'walk', 'pose', 'group'];
  const hud = document.getElementById('context-hud');
  const pathEl = document.getElementById('context-path');

  function update() {
    let which = 'edit';
    if (picker.getPurpose()) which = 'pick';
    else if (walk.isActive()) which = 'walk';
    else if (poseMode.isActive()) which = 'pose';
    else if (selection.getContext()) which = 'group';
    for (const name of names) document.getElementById(`help-${name}`).hidden = name !== which;

    const ctx = selection.getContext();
    hud.hidden = !ctx;
    if (ctx) pathEl.textContent = groupPath(ctx).join(' › ');
  }

  for (const name of ['surface-pick-changed', 'walk-mode-changed', 'pose-mode-changed', 'context-changed']) on(name, update);
  update();
}

/** 모델 이름부터 이 그룹까지 이름들 (불러온 내용 그룹은 건너뜀) */
export function groupPath(object) {
  const names = [];
  for (let o = object; o && !o.isScene; o = o.parent) {
    if (o.userData.modelContent) continue;
    names.unshift(o.name || '(이름 없음)');
    if (o.userData.kind === 'model') break;
  }
  return names;
}
