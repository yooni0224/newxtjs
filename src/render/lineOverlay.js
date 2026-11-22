// 일반 렌더 선(외곽선·모서리선): 설정 + 화면 미리보기.
//   설정: 켜기/끄기, 선 두께(화면 px), 모서리 각도(도)
//   선 두께는 '화면에서 보이는 굵기' 기준. 내보낼 때는 결과 해상도에 맞춰 비례해서 굵어짐
//   (src/export/exportImage.js 의 renderLineWidth 참고) → 화면에서 본 것과 같은 비율로 나옴.
// 미리보기는 src/render/pipeline.js 의 효과로: 준비 = 면 방향 + 깊이 그림, 덧그리기 = 선
import * as THREE from 'three';
import { emit } from '../core/events.js';
import { createEdgeRenderer, makeNormalTarget, disposeNormalTarget } from './edgeLines.js';

const MAX_PREVIEW_PIXELS = 8e6; // 미리보기용 면 방향 그림 최대 크기 (넘으면 1배로)

export function createLineOverlay(viewer, pipeline) {
  const { renderer, scene, camera } = viewer;
  const settings = { enabled: false, width: 1.5, crease: 30 };
  let previewOn = true; // 내보내기 모드가 '일반 렌더' 일 때만 미리보기 (cutPanel 이 정함)
  let edges = null;
  let target = null;
  let size = new THREE.Vector2();
  let ss = 1;

  const effect = {
    isActive: () => settings.enabled && previewOn,
    /** 면 방향 + 깊이 (바닥 그림자 받이처럼 색 그림에만 나오는 것은 빼고) */
    prepare() {
      edges ||= createEdgeRenderer();
      size = renderer.getDrawingBufferSize(size);
      // 화면이 작으면(픽셀 비율 1) 2배로 그려서 선을 부드럽게
      ss = renderer.getPixelRatio() < 1.5 && size.x * size.y * 4 <= MAX_PREVIEW_PIXELS ? 2 : 1;
      const tw = size.x * ss;
      const th = size.y * ss;
      if (!target) target = makeNormalTarget(tw, th);
      else if (target.width !== tw || target.height !== th) target.setSize(tw, th);
      const lineHidden = viewer.getColorOnly().filter((o) => o.visible);
      setVisible(lineHidden, false);
      edges.renderNormals(renderer, scene, camera, target);
      setVisible(lineHidden, true);
    },
    /** 선 덧그리기 (두께: 화면 px → 그림판 픽셀) */
    draw() {
      edges.drawEdges(renderer, camera, {
        normalTarget: target,
        radius: Math.max(0.75, (settings.width * renderer.getPixelRatio() * ss) / 2),
        creaseAngle: settings.crease,
        outW: size.x,
        outH: size.y,
        fill: false,
        blend: true,
      });
    },
  };
  pipeline.add(effect);

  function refresh() {
    if (!effect.isActive() && target) {
      disposeNormalTarget(target);
      target = null;
    }
    pipeline.refresh();
  }

  return {
    getSettings: () => ({ ...settings }),
    /** 설정 바꾸기. 예) set({ enabled: true, width: 2 }) */
    set(changes) {
      Object.assign(settings, changes);
      refresh();
      emit('render-lines-changed', { ...settings });
    },
    /** 화면 미리보기를 할지 (내보내기 모드가 '일반 렌더' 일 때만) */
    setPreview(value) {
      previewOn = value;
      refresh();
    },
  };
}

function setVisible(list, value) {
  for (const o of list) o.visible = value;
}
