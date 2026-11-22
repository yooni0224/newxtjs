// '컷 프레임' 칸 + '내보내기' 칸.
// 비율 버튼 값은 index.html 의 data-ratio="가로:세로" 에서 바꿀 수 있음.
import { on, emit } from '../core/events.js';
import { renderCut, downloadPng, exportSize, MAX_EXPORT_WIDTH } from '../export/exportImage.js';
import { bindNumberField, showNumber } from './numberField.js';
import { toast } from './toast.js';

export function setupCutPanel({ viewer, frame, people, lineOverlay, shadows, ao }) {
  const $ = (id) => document.getElementById(id);

  // ---------- 컷 프레임 ----------
  const chkFrame = $('chk-frame');
  const ratioButtons = [...document.querySelectorAll('[data-ratio]')];
  const ratioW = $('ratio-w');
  const ratioH = $('ratio-h');

  chkFrame.addEventListener('change', () => frame.set({ enabled: chkFrame.checked }));
  for (const btn of ratioButtons) {
    btn.addEventListener('click', () => {
      const [w, h] = btn.dataset.ratio.split(':').map(Number);
      frame.set({ ratioW: w, ratioH: h, enabled: true });
    });
  }
  bindNumberField(ratioW, (v) => (v ? frame.set({ ratioW: v, enabled: true }) : refresh()));
  bindNumberField(ratioH, (v) => (v ? frame.set({ ratioH: v, enabled: true }) : refresh()));
  $('chk-thirds').addEventListener('change', (e) => frame.set({ thirds: e.target.checked }));
  $('chk-horizon').addEventListener('change', (e) => frame.set({ horizon: e.target.checked }));

  // ---------- 내보내기 설정 ----------
  const widthInput = $('export-width');
  const modeButtons = [...document.querySelectorAll('[data-export-mode]')];
  const lineWidth = $('line-width');
  const crease = $('crease-angle');
  let mode = 'normal';

  // 일반 렌더 선 (설정은 lineOverlay 가 가지고 있고, 바꾸면 화면 미리보기에 바로 반영)
  const chkRenderLines = $('chk-render-lines');
  const renderLineWidth = $('render-line-width');
  const renderCrease = $('render-crease-angle');
  const applyRenderLines = () =>
    lineOverlay.set({
      enabled: chkRenderLines.checked,
      width: parseFloat(renderLineWidth.value),
      crease: parseFloat(renderCrease.value),
    });
  chkRenderLines.addEventListener('change', applyRenderLines);
  renderLineWidth.addEventListener('input', applyRenderLines);
  renderCrease.addEventListener('input', applyRenderLines);
  on('render-lines-changed', refresh);

  const chkPeople = $('chk-export-people');
  /** 내보내기 설정이 바뀜 → 화면 갱신 + 알림 (자동 저장) */
  const changed = () => {
    refresh();
    emit('export-settings-changed');
  };
  widthInput.max = String(MAX_EXPORT_WIDTH);
  bindNumberField(widthInput, changed);
  for (const btn of modeButtons) {
    btn.addEventListener('click', () => {
      mode = btn.dataset.exportMode;
      changed();
    });
  }
  lineWidth.addEventListener('input', changed);
  crease.addEventListener('input', changed);
  chkPeople.addEventListener('change', changed);

  const exportWidth = () => parseFloat(widthInput.value) || 2000;

  function refresh() {
    const s = frame.getState();
    chkFrame.checked = s.enabled;
    showNumber(ratioW, String(s.ratioW));
    showNumber(ratioH, String(s.ratioH));
    for (const btn of ratioButtons) {
      const [w, h] = btn.dataset.ratio.split(':').map(Number);
      btn.classList.toggle('active', s.enabled && Math.abs(w / h - s.ratioW / s.ratioH) < 1e-6);
    }
    const { w, h } = exportSize(frame.getRect(), exportWidth());
    showNumber(widthInput, String(w));
    $('export-size').textContent = `결과: ${w} × ${h} px${s.enabled ? '' : ' (프레임 꺼짐 → 화면 전체)'}`;
    frame.setLabel(s.enabled ? `${s.ratioW}:${s.ratioH} · ${w}×${h}px` : '');

    for (const btn of modeButtons) btn.classList.toggle('active', btn.dataset.exportMode === mode);
    $('line-options').hidden = mode !== 'line';
    $('shadow-export-hint').hidden = mode !== 'shadow';
    $('line-width-value').textContent = `${lineWidth.value}px`;
    $('crease-angle-value').textContent = `${crease.value}°`;

    const rl = lineOverlay.getSettings();
    $('render-line-options').hidden = mode !== 'normal';
    chkRenderLines.checked = rl.enabled;
    renderLineWidth.value = String(rl.width);
    renderCrease.value = String(rl.crease);
    $('render-line-sliders').hidden = !rl.enabled;
    // 내보낼 때 실제 두께 (화면 px × 결과 가로 / 프레임 가로)
    const outLine = (rl.width * w) / frame.getRect().w;
    $('render-line-width-value').textContent = `${rl.width}px`;
    $('render-line-width-value').title = `내보내면 약 ${outLine.toFixed(1)}px`;
    $('render-crease-angle-value').textContent = `${rl.crease}°`;
    lineOverlay.setPreview(mode === 'normal'); // 미리보기는 '일반 렌더' 일 때만
  }
  on('frame-changed', refresh);
  viewer.onResize(refresh);
  refresh();

  // ---------- 내보내기 ----------
  $('btn-export').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    const loading = toast('내보내는 중…', 'info', 60000);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // 알림이 먼저 보이게
    try {
      const rect = frame.getRect();
      const image = renderCut({
        viewer,
        rect,
        width: exportWidth(),
        mode,
        lineArt: { width: parseFloat(lineWidth.value), crease: parseFloat(crease.value) },
        renderLines: lineOverlay.getSettings(),
        shadows,
        ao,
        hide: chkPeople.checked ? [] : [people.group],
      });
      const s = frame.getState();
      const ratio = s.enabled ? `${s.ratioW}x${s.ratioH}` : 'full';
      // 파일 이름은 영문으로 (브라우저에 따라 한글 이름이 무시되는 경우가 있어서)
      const kind = { normal: 'render', line: 'lineart', shadow: 'shadow' }[mode];
      await downloadPng(image, `cut_${ratio}_${kind}_${timestamp()}.png`);
      toast(`내보냄: ${image.width} × ${image.height} px`);
    } catch (err) {
      console.error(err);
      toast(`내보내기 실패 — ${err.message}`, 'error', 8000);
    } finally {
      loading.remove();
    }
  });

  return {
    /** 내보내기 설정 (프로젝트 저장용) */
    getExportSettings: () => ({
      mode,
      width: exportWidth(),
      lineArt: { width: parseFloat(lineWidth.value), crease: parseFloat(crease.value) },
      includePeople: chkPeople.checked,
    }),
    setExportSettings(v = {}) {
      if (v.mode) mode = v.mode;
      if (v.width) widthInput.value = String(v.width);
      if (v.lineArt) {
        lineWidth.value = String(v.lineArt.width);
        crease.value = String(v.lineArt.crease);
      }
      if (v.includePeople !== undefined) chkPeople.checked = v.includePeople;
      refresh();
    },
  };
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
