// 키보드 공통 도우미.

/** 글자 입력칸에 쓰는 중인지 (그때는 단축키가 동작하면 안 됨) */
export function isTyping(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'file'].includes(el.type);
}
