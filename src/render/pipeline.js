// 화면(미리보기) 그리는 순서. 효과(AO·일반 렌더 선)가 하나라도 켜져 있으면 매 프레임:
//   ① 효과마다 준비 그림 (면 방향·깊이 등)     ← 그리드·핸들은 숨김
//   ② 보통 그림
//   ③ 효과 덧그리기 (등록한 순서: AO 곱하기 → 선)
//   ④ 그리드·핸들·표시만 맨 위에 (②의 깊이를 써서 모델 뒤 그리드는 가려짐)
// 효과가 다 꺼져 있으면 보통처럼 한 번만 그림.
// 효과 = { isActive(), prepare(), draw() }  (src/render/ao.js, src/render/lineOverlay.js)

export function createRenderPipeline(viewer) {
  const { renderer, scene, camera } = viewer;
  const effects = [];

  function render() {
    const active = effects.filter((e) => e.isActive());
    const helpers = viewer.getHelpers().filter((o) => o.visible);
    setVisible(helpers, false);
    for (const e of active) e.prepare();
    renderer.render(scene, camera);
    for (const e of active) e.draw();
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
    add(effect) {
      effects.push(effect);
    },
    /** 효과를 켜고 끌 때 부름 */
    refresh() {
      viewer.setRenderPipeline(effects.some((e) => e.isActive()) ? render : null);
    },
  };
}

function setVisible(list, value) {
  for (const o of list) o.visible = value;
}
