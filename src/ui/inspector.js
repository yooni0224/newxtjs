// '선택한 모델' 칸: 이름, 높이 표시/입력, 가로·깊이, 복제·삭제·보기 버튼.
import { on, emit } from '../core/events.js';
import { measure } from '../models/size.js';
import { bindNumberField, showNumber } from './numberField.js';

/** setHeight(물체, m): 모델은 비율 유지 크기 조절, 사람은 키 바꾸기 (main.js 에서 연결) */
export function setupInspector({ duplicate, remove, focus, setHeight }) {
  const $ = (id) => document.getElementById(id);
  const emptyText = $('insp-empty');
  const body = $('insp-body');
  const nameEl = $('insp-name');
  const heightInput = $('insp-height');
  const sizeEl = $('insp-size');
  const btnDuplicate = $('btn-duplicate');

  let current = null;

  function refresh(precise = true) {
    emptyText.hidden = !!current;
    body.hidden = !current;
    if (!current) return;

    const isHuman = current.userData.kind === 'human';
    const size = measure(current, precise);
    nameEl.textContent = current.name;
    showNumber(heightInput, fmt(isHuman ? current.userData.height : size.y)); // 사람은 앉아 있어도 '키'
    $('insp-height-label').textContent = isHuman ? '키' : '높이';
    $('insp-height-hint').textContent = isHuman
      ? '숫자를 넣고 Enter → 키 바꾸기 (몸 비율도 맞춰 바뀜)'
      : '숫자를 넣고 Enter → 비율 유지하며 크기 맞춤';
    sizeEl.textContent = `가로 ${fmt(size.x)} m · 깊이 ${fmt(size.z)} m`;
  }

  on('selection-changed', (obj) => {
    current = obj;
    refresh();
  });
  // 핸들로 움직이는 동안엔 빠른 계산, 손을 떼면 정확한 계산
  on('object-transformed', ({ object, final }) => {
    if (object === current) refresh(final);
  });
  on('people-changed', () => {
    if (current?.userData.kind === 'human') refresh();
  });
  on('pose-changed', (person) => {
    if (person === current) refresh(false);
  });

  bindNumberField(heightInput, (meters) => {
    if (current && meters && setHeight(current, meters)) {
      emit('object-transformed', { object: current, final: true });
    } else {
      refresh();
    }
  });

  btnDuplicate.addEventListener('click', duplicate);
  $('btn-delete').addEventListener('click', remove);
  $('btn-focus').addEventListener('click', focus);
}

/** 숫자 보기 좋게: 작은 값은 소수 셋째 자리까지 */
function fmt(n) {
  return n < 0.1 ? n.toFixed(3) : n.toFixed(2);
}
