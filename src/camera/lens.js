// 화각(렌즈 mm). 카메라 기준은 35mm 필름(풀프레임): 화면의 긴 변 = 36mm.
// 예) 24mm = 넓게, 35mm = 보통, 50mm = 사람 눈과 비슷하게 좁게.
// (3단계에서 컷 프레임이 생기면 '화면' 대신 '프레임'의 긴 변 기준으로 바꿀 예정)
import { emit } from '../core/events.js';

const FILM_SIZE = 36; // mm
export const MIN_FOCAL = 8;
export const MAX_FOCAL = 300;

export function createLens(viewer, initialFocal = 35) {
  const { camera } = viewer;
  camera.filmGauge = FILM_SIZE;
  let focal = initialFocal;

  // three.js 가 mm → 화각(도)으로 바꿔 줌. 창 크기가 바뀌면 다시 계산.
  const apply = () => camera.setFocalLength(focal);
  viewer.onResize(apply);
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
