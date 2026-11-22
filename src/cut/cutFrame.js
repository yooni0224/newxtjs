// 컷 프레임: 컷 비율 테두리(바깥은 어둡게), 3분할 격자, 눈높이선(수평선).
// 3D 화면 위에 덧그리는 2D 그림이라 내보낸 이미지에는 들어가지 않음.
// 내보내기는 이 프레임 안쪽만 (src/export/exportImage.js), 화각(mm)도 프레임 기준 (src/camera/lens.js).
import * as THREE from 'three';
import { emit } from '../core/events.js';

// 프레임 둘레 여백(px): 위는 1인칭 정보, 아래는 안내 줄이 들어갈 자리
const MARGIN = { top: 44, bottom: 40, side: 24 };
const MASK_COLOR = 'rgba(20, 22, 26, 0.45)';
const HORIZON_COLOR = 'rgba(255, 80, 80, 0.95)';

export function createCutFrame(viewer) {
  const { camera, canvas } = viewer;
  const overlay = document.getElementById('overlay');
  const ctx = overlay.getContext('2d');
  const state = { enabled: true, ratioW: 3, ratioH: 4, thirds: false, horizon: true };
  let label = '';

  /** 프레임 위치·크기 (3D 화면 안의 px). 프레임이 꺼져 있으면 화면 전체 */
  function getRect() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!state.enabled) return { x: 0, y: 0, w, h };
    const availW = Math.max(w - 2 * MARGIN.side, 10);
    const availH = Math.max(h - MARGIN.top - MARGIN.bottom, 10);
    const aspect = state.ratioW / state.ratioH;
    let fw = availW;
    let fh = fw / aspect;
    if (fh > availH) {
      fh = availH;
      fw = fh * aspect;
    }
    return { x: (w - fw) / 2, y: MARGIN.top + (availH - fh) / 2, w: fw, h: fh };
  }

  /** 설정 바꾸기. 예) set({ ratioW: 16, ratioH: 9 }) */
  function set(changes) {
    Object.assign(state, changes);
    emit('frame-changed', { ...state });
  }

  // ---------- 매 프레임 덧그리기 ----------
  viewer.onLateFrame(draw);

  function draw() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
      overlay.width = Math.round(w * dpr);
      overlay.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const r = getRect();

    if (state.enabled) {
      ctx.fillStyle = MASK_COLOR; // 프레임 바깥 어둡게
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill('evenodd');
      line(r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h, r.x, r.y);
      if (label) {
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        ctx.fillText(label, r.x + r.w, r.y - 7);
      }
    }
    if (state.thirds) {
      for (const t of [1 / 3, 2 / 3]) {
        line(r.x + r.w * t, r.y, r.x + r.w * t, r.y + r.h);
        line(r.x, r.y + r.h * t, r.x + r.w, r.y + r.h * t);
      }
    }
    if (state.horizon) drawHorizon(r, w, h);
  }

  /** 흰 선 + 어두운 테두리 (밝은 배경·어두운 배경 모두에서 보이게) */
  function line(...pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
  }

  /** 눈높이선: 카메라 높이의 수평면이 보이는 곳 (먼 수평 방향 점을 화면에 찍어서 구함) */
  const far = new THREE.Vector3();
  function drawHorizon(r, w, h) {
    camera.updateMatrixWorld();
    const dir = camera.getWorldDirection(far);
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-3) return; // 바로 위/아래를 볼 때는 없음
    far.set(dir.x / len, 0, dir.z / len).multiplyScalar(1e4).add(camera.position).project(camera);
    const y = ((1 - far.y) / 2) * h;

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = HORIZON_COLOR;
    if (y < 0 || y > h) {
      ctx.fillText(y < 0 ? '↑ 눈높이선 (화면 위쪽 밖)' : '↓ 눈높이선 (화면 아래쪽 밖)', r.x + 6, y < 0 ? r.y + 16 : r.y + r.h - 8);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = HORIZON_COLOR;
    ctx.stroke();
    ctx.fillText('눈높이선', r.x + 6, y - 5);
  }

  return {
    getRect,
    getState: () => ({ ...state }),
    set,
    /** 프레임 위에 적을 글 (예: '3:4 · 2000×2667px') */
    setLabel(text) {
      label = text;
    },
  };
}
