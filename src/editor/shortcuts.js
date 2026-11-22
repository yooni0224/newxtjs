// 키보드 단축키. 글자 입력칸에 쓰는 중에는 동작하지 않음.
// e.code(키 위치)를 써서 한글 입력 상태에서도 동작함.

/**
 * @param actions { setMode(mode), duplicate(), remove(), focus(), deselect() }
 */
export function setupShortcuts(actions) {
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
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
        actions.deselect();
        break;
    }
  });
}

function isTyping(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'file'].includes(el.type);
}
