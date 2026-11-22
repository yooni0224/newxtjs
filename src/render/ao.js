// 앰비언트 오클루전(AO): 구석·물체끼리 맞닿은 곳을 자연스럽게 어둡게.
//   화면에 보이는 깊이·면 방향만 보고 계산 (화면 공간 AO).
//   ① 장면을 '면 방향 + 깊이'로 그림 (바닥 그림자 받이 판도 넣어서 맨바닥과 맞닿은 곳도 어둡게)
//   ② 점마다 면 바깥쪽 반구 안의 16곳이 다른 물체에 가려졌는지 봄 (반지름 AO_RADIUS m)
//   ③ 4×4 로 흐리게 (깊이가 크게 다른 곳은 섞지 않음 → 물체 테두리에 번짐 없음)
//   ④ 그림 위에 곱하기 (세기 = 얼마나 어둡게)
// 화면 미리보기: src/render/pipeline.js 효과로 등록. 내보내기: renderImage() 가 흑백 그림을 줌.
import * as THREE from 'three';
import { emit } from '../core/events.js';

const AO_RADIUS = 0.6; // 구석을 어둡게 하는 범위 (m)
const AO_FADE = [40, 90]; // 이 거리(m)부터 멀어질수록 AO 를 약하게 → 먼 바닥이 지평선 근처에서 얼룩지지 않게
const AO_SAMPLES = 16;
const MAX_EXPORT_PIXELS = 16e6; // 내보낼 때 AO 계산 최대 크기 (넘으면 줄여서 계산 후 늘림 — AO 는 부드러워서 티 안 남)

export function createAO(viewer, { ground, pipeline }) {
  const { renderer, scene, camera, canvas } = viewer;
  const settings = { enabled: false, strength: 0.6, inShadowExport: true };

  const normalMaterial = new THREE.MeshNormalMaterial({ flatShading: true, side: THREE.DoubleSide });
  const aoMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tNormal: { value: null },
      tDepth: { value: null },
      projection: { value: new THREE.Matrix4() },
      invProjection: { value: new THREE.Matrix4() },
      radius: { value: AO_RADIUS },
      fade: { value: new THREE.Vector2(...AO_FADE) },
      kernel: { value: makeKernel(AO_SAMPLES) },
    },
    vertexShader: VERTEX,
    fragmentShader: AO_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tAO: { value: null },
      tDepth: { value: null },
      texel: { value: new THREE.Vector2() },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      strength: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: BLUR_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  // 화면 그림에 곱하기: 결과 = 지금 색 × AO
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: { tAO: { value: null } },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D tAO;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(tAO, vUv).rgb, 1.0); }`,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), aoMaterial);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let targets = null; // { normal, ao, blur }

  function ensureTargets(w, h) {
    if (targets && targets.normal.width === w && targets.normal.height === h) return;
    disposeTargets();
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    targets = {
      normal: new THREE.WebGLRenderTarget(w, h, { ...nearest, depthTexture: new THREE.DepthTexture(w, h) }),
      ao: new THREE.WebGLRenderTarget(w, h, nearest),
      blur: new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }),
    };
  }
  function disposeTargets() {
    if (!targets) return;
    targets.normal.depthTexture.dispose();
    for (const t of Object.values(targets)) t.dispose();
    targets = null;
  }

  function drawQuad(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  /** 지금 카메라로 AO 를 계산해 targets.blur 에 담음 (값: 1 = 그대로, 작을수록 어둡게, 세기 반영) */
  function compute(w, h) {
    ensureTargets(w, h);
    const savedTarget = renderer.getRenderTarget();
    const savedClear = renderer.getClearColor(new THREE.Color());
    const savedAlpha = renderer.getClearAlpha();
    const savedBackground = scene.background;
    const savedOverride = scene.overrideMaterial;
    const groundWasVisible = ground.visible;

    // ① 면 방향 + 깊이 (바닥 받이 판도 넣음)
    ground.visible = true;
    scene.overrideMaterial = normalMaterial;
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(targets.normal);
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = savedOverride;
    scene.background = savedBackground;
    ground.visible = groundWasVisible;

    // ② AO
    const u = aoMaterial.uniforms;
    u.tNormal.value = targets.normal.texture;
    u.tDepth.value = targets.normal.depthTexture;
    u.projection.value.copy(camera.projectionMatrix);
    u.invProjection.value.copy(camera.projectionMatrixInverse);
    drawQuad(aoMaterial, targets.ao);

    // ③ 흐리게 + 세기
    const b = blurMaterial.uniforms;
    b.tAO.value = targets.ao.texture;
    b.tDepth.value = targets.normal.depthTexture;
    b.texel.value.set(1 / w, 1 / h);
    b.cameraNear.value = camera.near;
    b.cameraFar.value = camera.far;
    b.strength.value = settings.strength;
    drawQuad(blurMaterial, targets.blur);

    renderer.setRenderTarget(savedTarget);
    renderer.setClearColor(savedClear, savedAlpha);
  }

  // ---------- 화면 미리보기 효과 (src/render/pipeline.js) ----------
  const effect = {
    isActive: () => settings.enabled,
    prepare() {
      // 화면 크기(CSS px) 로 계산 → 고해상도 화면에서는 절반 크기라 빠름, 곱할 때 부드럽게 늘림
      compute(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
    },
    draw() {
      compositeMaterial.uniforms.tAO.value = targets.blur.texture;
      const savedAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      quad.material = compositeMaterial;
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
      renderer.autoClear = savedAutoClear;
    },
  };

  /**
   * 내보내기용: 지금 카메라(프레임 부분으로 잘린 상태)로 AO 흑백 그림을 만들어 2D 캔버스로 돌려줌.
   * 결과 크기가 아주 크면 줄여서 계산함 (곱할 때 drawImage 로 늘리면 됨)
   */
  function renderImage(outW, outH) {
    const scale = Math.min(1, Math.sqrt(MAX_EXPORT_PIXELS / (outW * outH)));
    const w = Math.max(1, Math.round(outW * scale));
    const h = Math.max(1, Math.round(outH * scale));
    compute(w, h);
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(targets.blur, 0, 0, w, h, pixels);
    disposeTargets(); // 큰 그림판은 바로 정리 (화면용은 다음 프레임에 다시 만듦)
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    const image = ctx.createImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) image.data.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    ctx.putImageData(image, 0, 0);
    return out;
  }

  pipeline.add(effect);

  return {
    renderImage,
    getSettings: () => ({ ...settings }),
    /** 설정 바꾸기. 예) set({ enabled: true, strength: 0.8 }) */
    set(changes) {
      Object.assign(settings, changes);
      if (!settings.enabled) disposeTargets();
      pipeline.refresh();
      emit('ao-changed', { ...settings });
    },
  };
}

/** 반구 안의 점들: 가운데 가까이에 더 많이 (가까운 구석을 더 잘 잡음) */
function makeKernel(n) {
  const out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 0.9 + 0.1).normalize();
    const t = i / n;
    v.multiplyScalar(THREE.MathUtils.lerp(0.15, 1, t * t) * (0.5 + rnd() * 0.5));
    out.push(v);
  }
  return out;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const AO_FRAGMENT = /* glsl */ `
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform mat4 projection;
uniform mat4 invProjection;
uniform float radius;
uniform vec2 fade;
uniform vec3 kernel[${AO_SAMPLES}];
varying vec2 vUv;

vec3 viewPosAt(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = invProjection * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}

// 4×4 칸마다 다른 회전 (흐리기 4×4 로 정확히 섞여 사라짐)
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[idx]) + 0.5) / 16.0;
}

void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 1.0) { gl_FragColor = vec4(1.0); return; } // 하늘
  vec3 P = viewPosAt(vUv);
  float distFade = smoothstep(fade.x, fade.y, -P.z);
  if (distFade >= 1.0) { gl_FragColor = vec4(1.0); return; }
  vec3 N = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
  float bias = 0.03 * radius + 0.002 * -P.z; // 멀수록 깊이 정밀도가 떨어지므로 여유를 더
  float a = bayer4(gl_FragCoord.xy) * 6.2831853;
  vec3 r = vec3(cos(a), sin(a), 0.0);
  vec3 T = r - N * dot(r, N);
  if (dot(T, T) < 1e-4) T = vec3(0.0, 1.0, 0.0) - N * N.y;
  T = normalize(T);
  mat3 TBN = mat3(T, cross(N, T), N);
  float occ = 0.0;
  for (int i = 0; i < ${AO_SAMPLES}; i++) {
    vec3 S = P + TBN * kernel[i] * radius;
    vec4 o = projection * vec4(S, 1.0);
    vec2 suv = o.xy / o.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sceneZ = viewPosAt(suv).z;
    float range = smoothstep(0.0, 1.0, radius / max(abs(P.z - sceneZ), 1e-4)); // 멀리 앞에 있는 물체는 무시
    occ += (sceneZ >= S.z + bias ? 1.0 : 0.0) * range;
  }
  float ao = 1.0 - occ / float(${AO_SAMPLES});
  gl_FragColor = vec4(vec3(mix(ao, 1.0, distFade)), 1.0);
}`;

const BLUR_FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform float strength;
varying vec2 vUv;

float viewZ(vec2 uv) {
  return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
}

void main() {
  float zc = viewZ(vUv);
  float sum = 0.0;
  float wsum = 0.0;
  for (int x = -2; x < 2; x++) {
    for (int y = -2; y < 2; y++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * texel;
      float w = 1.0 / (1e-3 + abs(viewZ(uv) - zc) / (0.02 * abs(zc) + 0.02)); // 깊이가 비슷한 곳만 섞음
      w = min(w, 1.0);
      sum += texture2D(tAO, uv).r * w;
      wsum += w;
    }
  }
  float ao = wsum > 0.0 ? sum / wsum : 1.0;
  gl_FragColor = vec4(vec3(mix(1.0, ao, strength)), 1.0);
}`;
