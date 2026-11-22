// 일반 렌더 선(외곽선·모서리선): 설정 + 화면 미리보기.
//   설정: 켜기/끄기, 선 두께(화면 px), 모서리 각도(도)
//   선 두께는 '화면에서 보이는 굵기' 기준. 내보낼 때는 결과 해상도에 맞춰 비례해서 굵어짐
//   (src/export/exportImage.js 의 renderLineWidth 참고) → 화면에서 본 것과 같은 비율로 나옴.
// 미리보기 순서 (매 프레임):
//   ① 면 방향 + 깊이 그림 (그리드·핸들 등 빼고)  ② 화면에 보통 그림 (그리드·핸들 빼고)
//   ③ 선 덧그림  ④ 그리드·핸들만 맨 위에 (②의 깊이를 써서 모델 뒤 그리드는 가려짐)
import * as THREE from 'three';
import { emit } from '../core/events.js';
import { createEdgeRenderer, makeNormalTarget, disposeNormalTarget } from './edgeLines.js';

const MAX_PREVIEW_PIXELS = 8e6; // 미리보기용 면 방향 그림 최대 크기 (넘으면 1배로)

export function createLineOverlay(viewer) {
  const { renderer, scene, camera } = viewer;
  const settings = { enabled: false, width: 1.5, crease: 30 };
  let previewOn = true; // 내보내기 모드가 '일반 렌더' 일 때만 미리보기 (cutPanel 이 정함)
  let edges = null;
  let target = null;

  function refreshPipeline() {
    const on = settings.enabled && previewOn;
    viewer.setRenderPipeline(on ? renderWithLines : null);
    if (!on && target) {
      disposeNormalTarget(target);
      target = null;
    }
  }

  function renderWithLines() {
    edges ||= createEdgeRenderer();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // 화면이 작으면(픽셀 비율 1) 2배로 그려서 선을 부드럽게
    const ss = renderer.getPixelRatio() < 1.5 && size.x * size.y * 4 <= MAX_PREVIEW_PIXELS ? 2 : 1;
    const tw = size.x * ss;
    const th = size.y * ss;
    if (!target) target = makeNormalTarget(tw, th);
    else if (target.width !== tw || target.height !== th) target.setSize(tw, th);

    const helpers = viewer.getHelpers().filter((o) => o.visible);
    const lineHidden = viewer.getColorOnly().filter((o) => o.visible);
    setVisible(helpers, false);

    // ① 면 방향 + 깊이
    setVisible(lineHidden, false);
    edges.renderNormals(renderer, scene, camera, target);
    setVisible(lineHidden, true);

    // ② 보통 그림
    renderer.render(scene, camera);

    // ③ 선 덧그림 (두께: 화면 px → 그림판 픽셀)
    edges.drawEdges(renderer, camera, {
      normalTarget: target,
      radius: Math.max(0.75, (settings.width * renderer.getPixelRatio() * ss) / 2),
      creaseAngle: settings.crease,
      outW: size.x,
      outH: size.y,
      fill: false,
      blend: true,
    });

    // ④ 그리드·핸들만 위에
    setVisible(helpers, true);
    if (helpers.length) renderHelpersOnly();
  }

  /** 장면에서 그리드·핸들·표시만 보이게 하고 덧그림 (조명은 그대로 둬야 재질을 다시 준비하지 않음) */
  function renderHelpersOnly() {
    const helperSet = new Set(viewer.getHelpers());
    const others = scene.children.filter((o) => o.visible && !o.isLight && !helperSet.has(o));
    setVisible(others, false);
    const savedBackground = scene.background;
    const savedAutoClear = renderer.autoClear;
    scene.background = null;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = savedAutoClear;
    scene.background = savedBackground;
    setVisible(others, true);
  }

  return {
    getSettings: () => ({ ...settings }),
    /** 설정 바꾸기. 예) set({ enabled: true, width: 2 }) */
    set(changes) {
      Object.assign(settings, changes);
      refreshPipeline();
      emit('render-lines-changed', { ...settings });
    },
    /** 화면 미리보기를 할지 (내보내기 모드가 '일반 렌더' 일 때만) */
    setPreview(value) {
      previewOn = value;
      refreshPipeline();
    },
  };
}

function setVisible(list, value) {
  for (const o of list) o.visible = value;
}
