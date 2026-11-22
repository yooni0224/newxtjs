// 화각(렌즈 mm). 기준은 35mm 필름(풀프레임): 컷 프레임의 긴 변 = 36mm.
// 예) 24mm = 넓게, 35mm = 보통, 50mm = 사람 눈과 비슷하게 좁게.
// 프레임이 꺼져 있으면 3D 화면 전체의 긴 변 기준.
import * as THREE from 'three';
import { on, emit } from '../core/events.js';

const FILM_SIZE = 36; // mm
export const MIN_FOCAL = 8;
export const MAX_FOCAL = 300;

/**
 * @param viewer            core/viewer.js
 * @param getReferenceRect  () => 컷 프레임 {x, y, w, h} (화면 px)
 */
export function createLens(viewer, getReferenceRect, initialFocal = 35) {
  const { camera, canvas } = viewer;
  let focal = initialFocal;

  // 프레임 긴 변이 36mm 필름에 해당하도록 카메라의 세로 화각을 계산
  function apply() {
    const viewH = canvas.clientHeight;
    const r = getReferenceRect();
    const longSide = Math.max(r.w, r.h);
    if (!viewH || !longSide) return;
    const halfTan = ((FILM_SIZE / 2) * viewH) / (focal * longSide);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfTan));
    camera.updateProjectionMatrix();
  }
  viewer.onResize(apply);
  on('frame-changed', apply);
  apply();

  return {
    getFocalLength: () => focal,
    setFocalLength(mm) {
      if (!Number.isFinite(mm)) return;
      focal = Math.min(MAX_FOCAL, Math.max(MIN_FOCAL, mm));
      apply();
      emit('lens-changed', focal);
    },
  };
}
