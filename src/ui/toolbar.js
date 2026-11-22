// 패널의 버튼·체크박스 연결: 핸들 모드, 스냅, 사람 모형 보이기, 그리드.
import { on } from '../core/events.js';

export function setupToolbar({ gizmo, env, people }) {
  const modeButtons = [...document.querySelectorAll('#gizmo-modes button')];
  const scaleButton = modeButtons.find((b) => b.dataset.mode === 'scale');
  const chkSnap = document.getElementById('chk-snap');
  const chkHuman = document.getElementById('chk-human');
  const chkGrid = document.getElementById('chk-grid');

  for (const btn of modeButtons) {
    btn.addEventListener('click', () => gizmo.setMode(btn.dataset.mode));
  }
  on('gizmo-mode-changed', (mode) => {
    for (const btn of modeButtons) btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  // 사람 모형을 골랐을 땐 크기 버튼 끄기
  on('selection-changed', (obj) => {
    scaleButton.disabled = obj?.userData.kind === 'human';
  });

  chkSnap.addEventListener('change', () => gizmo.setSnap(chkSnap.checked));

  chkHuman.addEventListener('change', () => people.setVisible(chkHuman.checked));
  on('people-visibility-changed', (visible) => {
    chkHuman.checked = visible;
  });

  chkGrid.addEventListener('change', () => env.setGridVisible(chkGrid.checked));
}
