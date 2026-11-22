// 컷 프레임 안쪽을 PNG 로 내보내기.
//   일반 렌더: 화면에 보이는 그대로 (그리드·핸들·표시는 빼고) + 켜 두었으면 외곽선·모서리선
//   선화: 흰 면 + 검은 선, 배경 투명
// 선 찾기는 src/render/edgeLines.js
import * as THREE from 'three';
import { renderEdgeImage } from '../render/edgeLines.js';

export const MAX_EXPORT_WIDTH = 8000;

/** 프레임 비율과 가로 픽셀로 결과 크기 계산 */
export function exportSize(rect, width) {
  const w = Math.round(THREE.MathUtils.clamp(width, 16, MAX_EXPORT_WIDTH));
  return { w, h: Math.max(1, Math.round((w * rect.h) / rect.w)) };
}

/**
 * 일반 렌더 선 두께(화면 px) → 결과 이미지 px.
 * 화면의 프레임 가로(rect.w)가 결과 가로(outW)로 커지는 만큼 선도 같이 굵게 → 화면에서 본 비율 그대로.
 */
export function renderLineWidth(screenWidth, rect, outW) {
  return (screenWidth * outW) / rect.w;
}

/**
 * @param viewer       core/viewer.js
 * @param rect         컷 프레임 (3D 화면 안의 px)
 * @param width        결과 가로 픽셀
 * @param mode         'normal' | 'line'
 * @param lineArt      선화 설정 { width: 결과 px, crease: 도 }
 * @param renderLines  일반 렌더 선 설정 { enabled, width: 화면 px, crease: 도 } (src/render/lineOverlay.js)
 * @param hide         함께 숨길 것들 (예: 사람 모형 그룹)
 * @returns {HTMLCanvasElement}
 */
export function renderCut({ viewer, rect, width, mode, lineArt, renderLines, hide = [] }) {
  const { renderer, camera, canvas } = viewer;
  const { w: outW, h: outH } = exportSize(rect, width);

  // 그리드·핸들·표시 등 숨기기
  const hidden = [...viewer.getHelpers(), ...hide].filter((o) => o.visible);
  setVisible(hidden, false);
  const savedPixelRatio = renderer.getPixelRatio();
  const savedClear = renderer.getClearColor(new THREE.Color());
  const savedAlpha = renderer.getClearAlpha();

  // 화면 전체 중 프레임 부분만 찍도록 카메라 시야를 잘라냄
  camera.setViewOffset(canvas.clientWidth, canvas.clientHeight, rect.x, rect.y, rect.w, rect.h);
  try {
    if (mode === 'line') {
      return renderEdges(viewer, outW, outH, { lineWidth: lineArt.width, creaseAngle: lineArt.crease, fill: true });
    }
    const image = renderNormal(viewer, outW, outH);
    if (renderLines?.enabled) {
      const lines = renderEdges(viewer, outW, outH, {
        lineWidth: renderLineWidth(renderLines.width, rect, outW),
        creaseAngle: renderLines.crease,
        fill: false,
      });
      image.getContext('2d').drawImage(lines, 0, 0);
    }
    return image;
  } finally {
    camera.clearViewOffset();
    renderer.setRenderTarget(null);
    renderer.setClearColor(savedClear, savedAlpha);
    renderer.setPixelRatio(savedPixelRatio);
    viewer.resize(); // 화면 크기 되돌리기
    setVisible(hidden, true);
  }
}

/** 선 그림 (바닥 그림자 받이처럼 색 그림에만 나오는 것은 빼고) */
function renderEdges(viewer, outW, outH, options) {
  const colorOnly = viewer.getColorOnly().filter((o) => o.visible);
  setVisible(colorOnly, false);
  try {
    return renderEdgeImage(viewer, outW, outH, options);
  } finally {
    setVisible(colorOnly, true);
  }
}

/** 일반 렌더: 화면용 캔버스를 잠깐 결과 크기로 바꿔 그린 뒤 복사 */
function renderNormal({ renderer, scene, camera }, outW, outH) {
  renderer.setPixelRatio(1);
  renderer.setSize(outW, outH, false);
  const gl = renderer.getContext();
  if (gl.drawingBufferWidth < outW || gl.drawingBufferHeight < outH) {
    throw new Error(`이 크기(${outW}×${outH})는 브라우저가 그릴 수 없어요. 가로 픽셀을 줄여 주세요.`);
  }
  renderer.render(scene, camera);
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0); // 그린 직후에 복사해야 함
  return out;
}

function setVisible(list, value) {
  for (const o of list) o.visible = value;
}

/** 캔버스를 PNG 파일로 내려받기 */
export function downloadPng(canvas, fileName) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('PNG 만들기 실패'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      resolve(blob);
    }, 'image/png');
  });
}
