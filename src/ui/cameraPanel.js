// '인물 시점' 칸: 1인칭 모드 버튼, 시작 위치 찍기, 눈높이, 화각(mm) + 화면 왼쪽 위 정보 표시.
// 눈높이/화각 버튼 값은 index.html 의 data-eye / data-focal 에서 바꿀 수 있음.
import { on } from '../core/events.js';
import { cameraYaw } from '../camera/walkMode.js';
import { bindNumberField, showNumber } from './numberField.js';

export function setupCameraPanel({ walk, lens, picker, camera }) {
  const $ = (id) => document.getElementById(id);
  const btnWalk = $('btn-walk');
  const btnPick = $('btn-pick-start');
  const eyeInput = $('eye-height');
  const focalInput = $('focal-length');
  const eyeButtons = [...document.querySelectorAll('[data-eye]')];
  const focalButtons = [...document.querySelectorAll('[data-focal]')];
  const hud = $('walk-hud');
  const hudInfo = $('hud-info');

  // ---------- 1인칭 모드 ----------
  btnWalk.addEventListener('click', () => {
    if (walk.isActive()) walk.exit();
    else walk.enter();
    btnWalk.blur(); // Space/Enter 로 다시 눌리지 않게
  });
  on('walk-mode-changed', (walking) => {
    btnWalk.textContent = walking ? '1인칭 모드 끝내기 (Esc)' : '1인칭 모드 시작';
    btnWalk.classList.toggle('active', walking);
    btnPick.disabled = walking;
    document.body.classList.toggle('walking', walking);
    hud.hidden = !walking;
    showHelp(walking ? 'walk' : 'edit');
    updateHud();
  });

  // ---------- 시작 위치 찍기 (찍기 도구: src/editor/surfacePicker.js) ----------
  btnPick.addEventListener('click', () => {
    btnPick.blur();
    if (picker.getPurpose() === 'walk') {
      picker.cancel();
      return;
    }
    picker.start({
      purpose: 'walk',
      markerHeight: () => walk.getEyeHeight(),
      defaultYaw: () => cameraYaw(camera), // 그냥 클릭하면 지금 보던 방향
      onPick: ({ point, yaw }) => walk.enterAt({ x: point.x, z: point.z, groundY: point.y, yaw }),
    });
  });
  on('surface-pick-changed', (purpose) => {
    const picking = purpose === 'walk';
    btnPick.textContent = picking ? '위치 찍는 중… (Esc 취소)' : '시작 위치 찍기';
    btnPick.classList.toggle('active', picking);
    showHelp(purpose ? 'pick' : walk.isActive() ? 'walk' : 'edit');
  });

  /** 화면 아래 안내 줄: 'edit' | 'pick' | 'walk' */
  function showHelp(which) {
    for (const name of ['edit', 'pick', 'walk']) $(`help-${name}`).hidden = name !== which;
  }

  // ---------- 눈높이 ----------
  for (const btn of eyeButtons) {
    btn.addEventListener('click', () => walk.setEyeHeight(parseFloat(btn.dataset.eye)));
  }
  bindNumberField(eyeInput, (meters) => {
    if (meters) walk.setEyeHeight(meters);
    else showEye(walk.getEyeHeight());
  });
  $('btn-level').addEventListener('click', () => walk.level());

  function showEye(meters) {
    showNumber(eyeInput, meters.toFixed(2));
    for (const btn of eyeButtons) {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.eye) - meters) < 0.005);
    }
    updateHud();
  }
  on('eye-height-changed', showEye);

  // ---------- 화각 ----------
  for (const btn of focalButtons) {
    btn.addEventListener('click', () => lens.setFocalLength(parseFloat(btn.dataset.focal)));
  }
  bindNumberField(focalInput, (mm) => {
    if (mm) lens.setFocalLength(mm);
    else showFocal(lens.getFocalLength());
  });

  function showFocal(mm) {
    showNumber(focalInput, String(Math.round(mm * 10) / 10));
    for (const btn of focalButtons) {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.focal) - mm) < 0.05);
    }
    updateHud();
  }
  on('lens-changed', showFocal);

  // ---------- 화면 왼쪽 위 정보 ----------
  function updateHud() {
    if (!walk.isActive()) return;
    const pitch = Math.round(walk.getPitchDegrees());
    const pitchText = pitch === 0 ? '수평' : `${pitch > 0 ? '+' : ''}${pitch}°`;
    const ground = walk.getGroundY();
    const groundText = Math.abs(ground) >= 0.005 ? ` (발 높이 ${ground.toFixed(2)}m)` : '';
    hudInfo.textContent =
      `눈높이 ${walk.getEyeHeight().toFixed(2)}m${groundText} · ${Math.round(lens.getFocalLength())}mm · 고개 ${pitchText}`;
  }
  on('walk-view-changed', updateHud);

  // 처음 값 표시
  showEye(walk.getEyeHeight());
  showFocal(lens.getFocalLength());
}
