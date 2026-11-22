// 선화 그리기: 흰 면 + 검은 외곽선·모서리선, 배경 투명.
//  1) 장면을 '면 방향(법선) + 깊이' 그림으로 그림 (가능하면 2배 크기 → 선이 부드러움)
//  2) 픽셀마다 양옆(선 두께의 절반 거리)을 비교해서 선을 찾음
//     - 물체 ↔ 배경 경계, 앞뒤로 떨어진 물체 경계(깊이가 끊김)   → 외곽선
//     - 면 방향이 '모서리 각도'보다 많이 꺾임                    → 모서리선
// 텍스처·색은 무시하고 모양만 봄.
import * as THREE from 'three';

const DEPTH_SENSITIVITY = 0.01; // 깊이 끊김 기준 (작을수록 외곽선이 많아짐)
const MAX_RENDER_PIXELS = 36e6; // 2배 크기로 그릴 수 있는 최대 픽셀 수 (그래픽 메모리 보호)

/**
 * 지금 카메라(이미 프레임 부분으로 잘린 상태)로 선화를 그려 2D 캔버스로 돌려줌.
 * @param lineWidth    선 두께 (결과 이미지 px)
 * @param creaseAngle  이 각도(도)보다 많이 꺾인 모서리에 선
 */
export function renderLineArt({ renderer, scene, camera }, outW, outH, lineWidth, creaseAngle) {
  const maxTex = renderer.capabilities.maxTextureSize;
  if (outW > maxTex || outH > maxTex) throw new Error(`그래픽 카드 한계(${maxTex}px)보다 커요. 가로 픽셀을 줄여 주세요.`);
  const ss = outW * 2 <= maxTex && outH * 2 <= maxTex && outW * outH * 4 <= MAX_RENDER_PIXELS ? 2 : 1;
  const rw = outW * ss;
  const rh = outH * ss;

  // 1) 면 방향 + 깊이
  const normalTarget = new THREE.WebGLRenderTarget(rw, rh, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(rw, rh),
  });
  const normalMaterial = new THREE.MeshNormalMaterial({ flatShading: true, side: THREE.DoubleSide });
  const savedBackground = scene.background;
  scene.overrideMaterial = normalMaterial;
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(normalTarget);
  renderer.clear();
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  scene.background = savedBackground;

  // 2) 선 찾기 → 결과 크기로
  const edgeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tNormal: { value: normalTarget.texture },
      tDepth: { value: normalTarget.depthTexture },
      texel: { value: new THREE.Vector2(1 / rw, 1 / rh) },
      outTexel: { value: new THREE.Vector2(1 / outW, 1 / outH) },
      radius: { value: Math.max(1, (lineWidth * ss) / 2) },
      cosCrease: { value: Math.cos(THREE.MathUtils.degToRad(creaseAngle)) },
      depthSensitivity: { value: DEPTH_SENSITIVITY },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), edgeMaterial);
  quadScene.add(quad);
  const resultTarget = new THREE.WebGLRenderTarget(outW, outH);
  renderer.setRenderTarget(resultTarget);
  renderer.render(quadScene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));

  const pixels = new Uint8Array(outW * outH * 4);
  renderer.readRenderTargetPixels(resultTarget, 0, 0, outW, outH, pixels);
  renderer.setRenderTarget(null);

  for (const x of [normalTarget.depthTexture, normalTarget, resultTarget, normalMaterial, edgeMaterial, quad.geometry]) x.dispose();

  // GPU 그림은 위아래가 뒤집혀 있으므로 바로 세워서 2D 캔버스에 담음
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  const image = ctx.createImageData(outW, outH);
  const row = outW * 4;
  for (let y = 0; y < outH; y++) image.data.set(pixels.subarray((outH - 1 - y) * row, (outH - y) * row), y * row);
  ctx.putImageData(image, 0, 0);
  return out;
}

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = /* glsl */ `
#include <packing>
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform vec2 outTexel;
uniform float radius;
uniform float cosCrease;
uniform float depthSensitivity;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;

// 1/거리 (평면 위에서는 화면을 따라 일정하게 변해서 '끊김'을 찾기 좋음)
float invDepth(vec2 uv) {
  return -1.0 / perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
}

// uv 를 사이에 두고 d 방향 양쪽을 비교 → 선이면 1
float pairLine(vec2 uv, vec2 d, float covered, float cz) {
  vec2 o = d * radius * texel;
  vec4 a = texture2D(tNormal, uv + o);
  vec4 b = texture2D(tNormal, uv - o);
  float ca = step(0.5, a.a);
  float cb = step(0.5, b.a);
  if (ca != covered || cb != covered) return 1.0;          // 물체 ↔ 배경
  if (covered < 0.5) return 0.0;
  float za = invDepth(uv + o);
  float zb = invDepth(uv - o);
  if (abs(za + zb - 2.0 * cz) > depthSensitivity * cz) return 1.0; // 앞뒤 물체 경계
  vec3 na = normalize(a.xyz * 2.0 - 1.0);
  vec3 nb = normalize(b.xyz * 2.0 - 1.0);
  if (dot(na, nb) < cosCrease) return 1.0;                 // 꺾인 모서리
  return 0.0;
}

// 한 점의 색 (미리 곱한 알파: 검은 선 / 흰 면 / 투명)
vec4 shade(vec2 uv) {
  float covered = step(0.5, texture2D(tNormal, uv).a);
  float cz = invDepth(uv);
  float l = pairLine(uv, vec2(1.0, 0.0), covered, cz);
  l = max(l, pairLine(uv, vec2(0.0, 1.0), covered, cz));
  l = max(l, pairLine(uv, vec2(0.7071, 0.7071), covered, cz));
  l = max(l, pairLine(uv, vec2(0.7071, -0.7071), covered, cz));
  if (l > 0.5) return vec4(0.0, 0.0, 0.0, 1.0);
  return covered > 0.5 ? vec4(1.0) : vec4(0.0);
}

void main() {
  // 결과 픽셀 하나를 4군데에서 보고 평균 (계단 현상 줄이기)
  vec4 sum = shade(vUv + vec2(-0.25, -0.25) * outTexel)
           + shade(vUv + vec2( 0.25, -0.25) * outTexel)
           + shade(vUv + vec2(-0.25,  0.25) * outTexel)
           + shade(vUv + vec2( 0.25,  0.25) * outTexel);
  sum *= 0.25;
  gl_FragColor = sum.a > 0.0 ? vec4(sum.rgb / sum.a, sum.a) : vec4(0.0);
}`;
