// '그림자만' 내보내기: 흰 바탕에 그림자만 회색으로 (그림 프로그램에서 곱하기 레이어로 쓰기).
//   - 해가 가려진 곳(드리운 그림자) + 해 반대쪽을 향한 면(물체의 어두운 쪽)이 회색
//   - 회색 농도 = 그림자 진하기 (진하기 70% → 밝기 30% 회색)
//   - 텍스처 무늬·색은 빠지고, 잎사귀처럼 투명하게 뚫린 부분은 그대로 뚫림
//   - 유리처럼 비치는 재질은 빼고 그 뒤의 그림자가 보이게 함
// 모든 물체의 재질을 잠깐 '그림자 전용 재질'로 바꿔서 그린 뒤 되돌림.
import * as THREE from 'three';

/**
 * 지금 카메라(이미 프레임 부분으로 잘린 상태)로 그림자만 그린 캔버스를 돌려줌.
 * @param renderNormal  (outW, outH) => 캔버스  — 보통 그리기 (exportImage.js)
 * @param shadows       src/render/shadows.js
 */
export function renderShadowOnly({ scene }, outW, outH, { shadows, darkness, renderNormal }) {
  const restoreShadows = shadows.prepareShadowPass();
  const darknessUniform = { value: darkness };
  const cache = new Map(); // 원래 재질 → 그림자 전용 재질
  const swapped = []; // [물체, 원래 재질]
  const hidden = [];

  scene.traverseVisible((o) => {
    if (!o.isMesh) {
      if (o.isLine || o.isPoints || o.isSprite) hidden.push(o); // 선·점은 빼기
      return;
    }
    const original = o.material;
    const list = [].concat(original);
    if (list.every(isSeeThrough)) {
      hidden.push(o);
      return;
    }
    const replaced = list.map((m) => {
      if (!cache.has(m)) cache.set(m, makeShadowMaterial(m, darknessUniform));
      return cache.get(m);
    });
    swapped.push([o, original]);
    o.material = Array.isArray(original) ? replaced : replaced[0];
  });
  for (const o of hidden) o.visible = false;

  const savedBackground = scene.background;
  const savedEnvironment = scene.environment;
  scene.background = new THREE.Color(0xffffff);
  scene.environment = null;
  try {
    return renderNormal(outW, outH);
  } finally {
    scene.background = savedBackground;
    scene.environment = savedEnvironment;
    for (const [o, m] of swapped) o.material = m;
    for (const o of hidden) o.visible = true;
    for (const m of cache.values()) m.dispose();
    restoreShadows();
  }
}

/** 유리처럼 비치는 재질 (그림자만 그릴 때는 빼고 그 뒤가 보이게) */
function isSeeThrough(m) {
  if (m.transmission > 0) return true;
  return m.transparent && m.opacity < 0.95 && !m.map && !m.alphaMap;
}

/**
 * 그림자 전용 재질: 램버트 재질에서 빛 계산 대신 '해가 닿는 정도'만 흑백으로 내보냄.
 * 잎사귀 같은 뚫린 텍스처는 그 모양을 지키도록 map·alphaTest 를 가져감.
 */
function makeShadowMaterial(m, darknessUniform) {
  const cutout = m.alphaTest > 0 || !!m.alphaMap || (m.transparent && !!m.map);
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: m.side,
    map: cutout ? m.map || null : null,
    alphaMap: cutout ? m.alphaMap || null : null,
    alphaTest: cutout ? Math.max(m.alphaTest || 0, 0.5) : 0,
  });
  material.toneMapped = false;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.shadowDarkness = darknessUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float shadowDarkness;')
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        float sunLit = getShadowMask();
        #if NUM_DIR_LIGHTS > 0
          // 해 반대쪽을 향한 면도 그림자 (경계는 살짝 부드럽게)
          sunLit *= smoothstep( 0.0, 0.12, dot( normal, directionalLights[ 0 ].direction ) );
        #endif
        gl_FragColor = vec4( vec3( 1.0 - shadowDarkness * ( 1.0 - sunLit ) ), 1.0 );`,
      )
      .replace('#include <tonemapping_fragment>', '')
      .replace('#include <colorspace_fragment>', '')
      .replace('#include <fog_fragment>', '');
  };
  material.customProgramCacheKey = () => 'shadow-only';
  return material;
}
