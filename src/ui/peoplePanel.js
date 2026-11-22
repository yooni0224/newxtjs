// '사람' 칸: 사람 배치 버튼, 체형(남성·여성)·키 버튼/입력, 포즈(포즈 모드·프리셋·초기화·복사/붙여넣기).
// 사람이 선택돼 있으면 체형·키 버튼은 그 사람에게, 아니면 '새로 놓을 사람'에게 적용.
// 포즈 버튼은 선택한 사람에게만.
import { on } from '../core/events.js';
import { cameraYaw } from '../camera/walkMode.js';
import { POSE_PRESETS, getPose, jointName } from '../people/pose.js';
import { bindNumberField, showNumber } from './numberField.js';
import { toast } from './toast.js';

export function setupPeoplePanel({ people, picker, selection, camera, poseMode }) {
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

  // ---------- 체형 · 키 ----------
  const bodyButtons = [...document.querySelectorAll('[data-body]')];
  /** 선택한 사람(없으면 새로 놓을 사람)의 키·체형 바꾸기. body 는 없으면 그대로 */
  function applyHeight(meters, body) {
    const person = selectedPerson();
    if (person) people.setHeight(person, meters, body);
    if (body) people.setNextBody(body);
    people.setNextHeight(meters);
  }
  function applyBody(body) {
    const person = selectedPerson();
    if (person) people.setBody(person, body);
    people.setNextBody(body);
  }
  for (const btn of heightButtons) {
    btn.addEventListener('click', () => applyHeight(parseFloat(btn.dataset.personHeight), btn.dataset.personBody));
  }
  for (const btn of bodyButtons) btn.addEventListener('click', () => applyBody(btn.dataset.body));
  bindNumberField(heightInput, (meters) => {
    if (meters) applyHeight(meters);
    else refresh();
  });

  function refresh() {
    const person = selectedPerson();
    const height = person ? person.userData.height : people.getNextHeight();
    const body = person ? person.userData.body : people.getNextBody();
    targetLabel.textContent = person ? '(선택한 사람)' : '(새로 놓을 사람)';
    showNumber(heightInput, height.toFixed(2));
    for (const btn of heightButtons) {
      const sameBody = !btn.dataset.personBody || btn.dataset.personBody === body;
      btn.classList.toggle('active', sameBody && Math.abs(parseFloat(btn.dataset.personHeight) - height) < 0.005);
    }
    for (const btn of bodyButtons) btn.classList.toggle('active', btn.dataset.body === body);
  }
  on('selection-changed', refresh);
  on('people-changed', refresh);
  refresh();

  // ---------- 포즈 ----------
  const btnPoseMode = $('btn-pose-mode');
  const poseHint = $('pose-hint');
  const presetButtons = [...document.querySelectorAll('[data-pose]')];
  const btnReset = $('btn-pose-reset');
  const btnCopy = $('btn-pose-copy');
  const btnPaste = $('btn-pose-paste');
  let clipboard = null; // 복사한 포즈

  btnPoseMode.addEventListener('click', () => {
    btnPoseMode.blur();
    if (poseMode.isActive()) poseMode.exit();
    else poseMode.enter(selectedPerson());
  });
  for (const btn of presetButtons) {
    btn.addEventListener('click', () => {
      const person = selectedPerson();
      if (person) people.applyPose(person, POSE_PRESETS[btn.dataset.pose].pose);
    });
  }
  btnReset.addEventListener('click', () => {
    const person = selectedPerson();
    if (person) people.applyPose(person, {});
  });
  btnCopy.addEventListener('click', () => {
    const person = selectedPerson();
    if (!person) return;
    clipboard = getPose(person);
    toast('포즈를 복사했어요. 다른 사람을 고르고 붙여넣기 하세요.');
    refreshPose();
  });
  btnPaste.addEventListener('click', () => {
    const person = selectedPerson();
    if (person && clipboard) people.applyPose(person, clipboard);
  });

  function refreshPose() {
    const person = selectedPerson();
    const joint = poseMode.getJoint();
    btnPoseMode.disabled = !person;
    btnPoseMode.classList.toggle('active', poseMode.isActive());
    btnPoseMode.textContent = poseMode.isActive() ? '포즈 모드 끝내기 (Esc)' : '포즈 모드 (관절 돌리기)';
    for (const btn of [...presetButtons, btnReset, btnCopy]) btn.disabled = !person;
    btnPaste.disabled = !person || !clipboard;
    $('pose-target').textContent = person ? '(선택한 사람)' : '';
    if (!person) poseHint.textContent = '사람을 고른 뒤 누르거나, 사람을 더블클릭하세요.';
    else if (!poseMode.isActive()) poseHint.textContent = '프리셋은 바로 적용됩니다. 관절을 직접 돌리려면 포즈 모드로.';
    else if (joint) poseHint.textContent = `관절: ${jointName(joint.userData.jointId)} — 핸들로 돌리기 (Esc: 관절 해제)`;
    else poseHint.textContent = '관절 점이나 몸 부위를 클릭해서 고르세요. (고르기 전엔 사람 전체 이동)';
  }
  on('selection-changed', refreshPose);
  on('pose-mode-changed', refreshPose);
  on('pose-joint-changed', refreshPose);
  refreshPose();
}
