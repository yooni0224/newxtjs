// 화면 아래쪽에 잠깐 뜨는 알림 메시지.
// type: 'info' | 'warn' | 'error'

export function toast(message, type = 'info', ms = 3500) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}
