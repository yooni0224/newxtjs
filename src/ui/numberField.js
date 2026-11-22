// 숫자 입력칸 공통 동작: Enter = 적용, Esc = 취소.

/**
 * @param input     <input type="number">
 * @param onCommit  (숫자 또는 null) => void   null 이면 잘못된 값 → 원래 값으로 되돌리면 됨
 */
export function bindNumberField(input, onCommit) {
  let before = '';
  input.addEventListener('focus', () => {
    before = input.value;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur(); // blur 되면서 'change' 가 일어남
    if (e.key === 'Escape') {
      input.value = before; // 쓰던 것 취소
      input.blur();
    }
  });
  input.addEventListener('change', () => {
    const value = parseFloat(input.value);
    onCommit(Number.isFinite(value) && value > 0 ? value : null);
  });
}

/** 입력 중이 아닐 때만 칸의 값을 바꿈 (쓰고 있는 글자를 덮어쓰지 않게) */
export function showNumber(input, text) {
  if (document.activeElement !== input) input.value = text;
}
