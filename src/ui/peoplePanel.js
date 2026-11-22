// '사람' 칸: 사람 배치 버튼, 키 버튼/입력.
// 사람이 선택돼 있으면 키 버튼은 그 사람에게, 아니면 '새로 놓을 사람'에게 적용.
import { on } from '../core/events.js';
import { cameraYaw } from '../camera/walkMode.js';
import { bindNumberField, showNumber } from './numberField.js';

export function setupPeoplePanel({ people, picker, selection, camera }) {
  const $ = (id) => document.getElementById(id);
  const btnPlace = $('btn-place-person');
  const heightInput = $('person-height');
  const targetLabel = $('person-height-target');
  const heightButtons = [...document.querySelectorAll('[data-person-height]')];

  const selectedPerson = () => {
    const sel = selection.getSelected();
    return sel?.userData.kind === 'human' ? sel : null;
  };

  // ---------- 사람 배치 ----------
  btnPlace.addEventListener('click', () => {
    btnPlace.blur();
    if (picker.getPurpose() === 'person') {
      picker.cancel();
      return;
    }
    picker.start({
      purpose: 'person',
      markerHeight: () => people.getNextHeight(),
      defaultYaw: () => cameraYaw(camera) + Math.PI, // 그냥 클릭하면 카메라 쪽을 바라봄
      onPick: ({ point, yaw }) => {
        const person = people.add({ position: point, lookYaw: yaw });
        selection.select(person); // 1인칭 모드에선 선택되지 않음
      },
    });
  });
  on('surface-pick-changed', (purpose) => {
    const placing = purpose === 'person';
    btnPlace.textContent = placing ? '배치할 곳 찍는 중… (Esc 취소)' : '사람 배치';
    btnPlace.classList.toggle('active', placing);
  });

  // ---------- 키 ----------
  function applyHeight(meters) {
    const person = selectedPerson();
    if (person) people.setHeight(person, meters);
    people.setNextHeight(meters);
  }
  for (const btn of heightButtons) {
    btn.addEventListener('click', () => applyHeight(parseFloat(btn.dataset.personHeight)));
  }
  bindNumberField(heightInput, (meters) => {
    if (meters) applyHeight(meters);
    else refresh();
  });

  function refresh() {
    const person = selectedPerson();
    const height = person ? person.userData.height : people.getNextHeight();
    targetLabel.textContent = person ? '(선택한 사람)' : '(새로 놓을 사람)';
    showNumber(heightInput, height.toFixed(2));
    for (const btn of heightButtons) {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.personHeight) - height) < 0.005);
    }
  }
  on('selection-changed', refresh);
  on('people-changed', refresh);
  refresh();
}
