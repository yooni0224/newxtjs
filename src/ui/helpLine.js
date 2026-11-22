// 화면 아래 안내 줄: 지금 하는 일에 맞는 조작법만 보여 줌.
// 순서: 찍기 → 1인칭 → 포즈 모드 → 편집
import { on } from '../core/events.js';

export function setupHelpLine({ walk, picker, poseMode }) {
  const names = ['edit', 'pick', 'walk', 'pose'];

  function update() {
    let which = 'edit';
    if (picker.getPurpose()) which = 'pick';
    else if (walk.isActive()) which = 'walk';
    else if (poseMode.isActive()) which = 'pose';
    for (const name of names) document.getElementById(`help-${name}`).hidden = name !== which;
  }

  for (const name of ['surface-pick-changed', 'walk-mode-changed', 'pose-mode-changed']) on(name, update);
  update();
}
