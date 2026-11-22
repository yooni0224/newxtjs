// '그림자' 칸: 켜기/끄기, 해 방위·높이, 진하기, 부드러움, 품질 + 구석 어둡게(AO).
// 값 바꾸면 화면에 바로 반영 (src/render/shadows.js, src/render/ao.js)
import { on } from '../core/events.js';
import { SHADOW_QUALITY } from '../render/shadows.js';

export function setupShadowPanel({ shadows, ao }) {
  const $ = (id) => document.getElementById(id);
  const chk = $('chk-shadows');
  const azimuth = $('sun-azimuth');
  const elevation = $('sun-elevation');
  const darkness = $('shadow-darkness');
  const softness = $('shadow-softness');
  const qualityButtons = [...document.querySelectorAll('[data-shadow-quality]')];

  chk.addEventListener('change', () => shadows.set({ enabled: chk.checked }));
  azimuth.addEventListener('input', () => shadows.set({ azimuth: parseFloat(azimuth.value) }));
  elevation.addEventListener('input', () => shadows.set({ elevation: parseFloat(elevation.value) }));
  darkness.addEventListener('input', () => shadows.set({ darkness: parseFloat(darkness.value) / 100 }));
  softness.addEventListener('input', () => shadows.set({ softness: parseFloat(softness.value) / 100 }));
  for (const btn of qualityButtons) {
    btn.addEventListener('click', () => shadows.set({ quality: btn.dataset.shadowQuality }));
  }

  // ---------- AO ----------
  const chkAo = $('chk-ao');
  const aoStrength = $('ao-strength');
  const chkAoExport = $('chk-ao-shadow-export');
  chkAo.addEventListener('change', () => ao.set({ enabled: chkAo.checked }));
  aoStrength.addEventListener('input', () => ao.set({ strength: parseFloat(aoStrength.value) / 100 }));
  chkAoExport.addEventListener('change', () => ao.set({ inShadowExport: chkAoExport.checked }));
  function refreshAo() {
    const a = ao.getSettings();
    chkAo.checked = a.enabled;
    aoStrength.value = String(Math.round(a.strength * 100));
    chkAoExport.checked = a.inShadowExport;
    $('ao-strength-value').textContent = `${Math.round(a.strength * 100)}%`;
  }
  on('ao-changed', refreshAo);
  refreshAo();

  function refresh() {
    const s = shadows.getSettings();
    chk.checked = s.enabled;
    azimuth.value = String(s.azimuth);
    elevation.value = String(s.elevation);
    darkness.value = String(Math.round(s.darkness * 100));
    softness.value = String(Math.round(s.softness * 100));
    $('sun-azimuth-value').textContent = `${Math.round(s.azimuth)}° ${compass(s.azimuth)}`;
    $('sun-elevation-value').textContent = `${Math.round(s.elevation)}°`;
    $('shadow-darkness-value').textContent = `${Math.round(s.darkness * 100)}%`;
    $('shadow-softness-value').textContent = `${Math.round(s.softness * 100)}%`;
    for (const btn of qualityButtons) btn.classList.toggle('active', btn.dataset.shadowQuality === s.quality);
    const q = SHADOW_QUALITY[s.quality];
    $('shadow-quality-hint').textContent =
      `화면: 그림자 지도 ${q.mapSize}px, 보이는 곳 ${q.maxDistance}m 까지. 큰 맵에서 버벅이면 '낮음'. ` +
      `내보낼 때는 이 설정과 상관없이 최고 품질.`;
  }
  on('shadows-changed', refresh);
  refresh();
}

/** 방위 각도 → 동서남북 글자 */
function compass(deg) {
  const names = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
