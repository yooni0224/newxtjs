// 편집 모드 키보드 단축키. 글자 입력칸에 쓰는 중이거나 1인칭 모드일 때는 동작하지 않음.
// e.code(키 위치)를 써서 한글 입력 상태에서도 동작함.
// (1인칭 모드 키는 src/camera/walkMode.js 에 있음)
import { on } from '../core/events.js';
import { isTyping } from '../core/keyboard.js';

/**
 * @param actions { setMode(mode), duplicate(), remove(), focus(), escape() }
 */
export function setupShortcuts(actions) {
  let walking = false;
  on('walk-mode-changed', (value) => {
    walking = value;
  });

  window.addEventListener('keydown', (e) => {
    if (walking || isTyping(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey; // 맥은 Cmd

    if (ctrl && e.code === 'KeyD') {
      e.preventDefault(); // 브라우저 '즐겨찾기 추가' 막기
      actions.duplicate();
      return;
    }
    if (ctrl || e.altKey) return;

    switch (e.code) {
      case 'KeyW':
        actions.setMode('translate');
        break;
      case 'KeyE':
        actions.setMode('rotate');
        break;
      case 'KeyR':
        actions.setMode('scale');
        break;
      case 'KeyF':
        actions.focus();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        actions.remove();
        break;
      case 'Escape':
        actions.escape(); // 한 단계씩 빠져나옴 (관절 → 포즈 모드 → 선택)
        break;
    }
  });
}
