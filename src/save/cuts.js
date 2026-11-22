// 컷 목록: 지금 시점(카메라 위치·높이·방향·화각) + 컷 프레임 비율 + 해 방향을 이름 붙여 저장,
// 목록에서 고르면 그 시점·화각·비율·해 방향으로 돌아감.
//   편집 시점이었으면 편집 시점으로, 1인칭이었으면 1인칭(발 높이·눈높이·고개 각도)으로.
// 컷 = { id, name, view, focal, frame: { enabled, ratioW, ratioH }, sun: { azimuth, elevation } }
//   view = { mode: 'edit', position, target } | { mode: 'walk', x, z, groundY, eyeHeight, yaw, pitch }
import { emit } from '../core/events.js';

export function createCuts({ camera, editorCam, walk, lens, frame, shadows }) {
  let cuts = [];
  let activeId = null; // 마지막으로 고르거나 만든 컷 (목록에 표시)

  /** 지금 시점 (컷·프로젝트 저장에 같이 씀) */
  function captureView() {
    if (walk.isActive()) return { mode: 'walk', ...round(walk.getState()) };
    return {
      mode: 'edit',
      position: camera.position.toArray().map(r6),
      target: editorCam.controls.target.toArray().map(r6),
    };
  }

  /** 시점 되돌리기 */
  function applyView(view) {
    if (!view) return;
    if (view.mode === 'walk') {
      walk.setState(view);
      return;
    }
    if (walk.isActive()) walk.exit(); // 편집 시점으로 나온 뒤 위치를 맞춤
    camera.position.fromArray(view.position);
    editorCam.controls.target.fromArray(view.target);
    editorCam.controls.update();
  }

  function capture(name) {
    const f = frame.getState();
    const s = shadows.getSettings();
    return {
      name,
      view: captureView(),
      focal: lens.getFocalLength(),
      frame: { enabled: f.enabled, ratioW: f.ratioW, ratioH: f.ratioH },
      sun: { azimuth: s.azimuth, elevation: s.elevation },
    };
  }

  function changed() {
    emit('cuts-changed', { cuts: list(), activeId });
  }

  /** 지금 시점을 새 컷으로 */
  function add(name) {
    const cut = { id: newId(), ...capture(name || nextName()) };
    cuts.push(cut);
    activeId = cut.id;
    changed();
    return cut;
  }

  /** 컷 고르기 → 그 시점·화각·비율·해 방향으로 */
  function goTo(id) {
    const cut = cuts.find((c) => c.id === id);
    if (!cut) return;
    frame.set({ ...cut.frame });
    lens.setFocalLength(cut.focal);
    shadows.set({ azimuth: cut.sun.azimuth, elevation: cut.sun.elevation });
    applyView(cut.view);
    activeId = id;
    changed();
  }

  /** 컷을 지금 시점(과 해 방향·화각·비율)으로 바꾸기 */
  function update(id) {
    const cut = cuts.find((c) => c.id === id);
    if (!cut) return;
    Object.assign(cut, capture(cut.name));
    activeId = id;
    changed();
  }

  function rename(id, name) {
    const cut = cuts.find((c) => c.id === id);
    if (!cut || !name.trim()) return;
    cut.name = name.trim();
    changed();
  }

  function remove(id) {
    cuts = cuts.filter((c) => c.id !== id);
    if (activeId === id) activeId = null;
    changed();
  }

  function nextName() {
    let n = cuts.length + 1;
    while (cuts.some((c) => c.name === `컷 ${n}`)) n++;
    return `컷 ${n}`;
  }

  function list() {
    return cuts.map((c) => ({ ...c }));
  }

  return {
    add,
    goTo,
    update,
    rename,
    remove,
    list,
    getActiveId: () => activeId,
    captureView,
    applyView,
    /** 프로젝트 저장/열기 */
    getState: () => JSON.parse(JSON.stringify(cuts)),
    setState(saved = []) {
      cuts = saved.map((c) => ({ ...c, id: c.id || newId() }));
      activeId = null;
      changed();
    },
  };
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}
function r6(v) {
  return Math.round(v * 1e6) / 1e6;
}
function round(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'number' ? r6(v) : v;
  return out;
}
