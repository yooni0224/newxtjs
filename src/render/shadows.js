// 그림자: 켜기/끄기, 해 방향(방위·높이), 진하기, 가장자리 부드러움, 품질.
//   해 방위: 0° = 북쪽(-Z), 90° = 동쪽(+X), 180° = 남쪽(+Z), 270° = 서쪽(-X)
//   해 높이: 0° = 지평선, 90° = 머리 위
// 모델·사람 모형 모두 그림자를 드리우고 받음. 바닥(높이 0)에는 '그림자 받이' 판이 있어서
// 모델 밖 맨바닥에도 그림자가 보임 (선 찾기에서는 빠짐: viewer.addColorOnly).
//
// 계단처럼 깨지지 않게
//   - 그림자 지도를 '지금 화면에 보이는 영역 ∩ 장면' 에 딱 맞춤 (품질별 최대 거리까지)
//   - 내보낼 때는 화면을 가까운 곳 → 먼 곳으로 여러 조각(깊이 구간)으로 나눠, 조각마다 그림자 지도를
//     그 조각에만 맞춰 다시 그림 → 가까운 곳도 먼 곳도 촘촘함 (renderView)
// 줄무늬·얼룩(그림자 여드름) 없이, 물체에서 떠 보이지 않게
//   - 그림자 지도를 그릴 때 '면의 기울기만큼' 깊이를 밀어냄(polygonOffset) → 기울어진 면만 많이 밀리고
//     평평한 면은 거의 안 밀려서 맞닿은 곳의 그림자가 떨어지지 않음. 법선 방향 띄움은 아주 조금만.
//   - 가장자리 부드러움은 실제 거리(m) 기준 → 화면·내보내기·조각마다 같은 번짐
// 큰 맵에서도 버벅이지 않게
//   - 그림자 지도는 뭔가 바뀔 때만 다시 그림 (물체 이동·포즈·해 방향·보이는 영역이 벗어남)
//   - 품질: 지도 크기 낮음 2048 / 중간 4096 / 높음 8192, 그림자를 그리는 최대 거리
import * as THREE from 'three';
import { on, emit } from '../core/events.js';

export const SHADOW_QUALITY = {
  low: { name: '낮음', mapSize: 2048, maxDistance: 80 },
  medium: { name: '중간', mapSize: 4096, maxDistance: 160 },
  high: { name: '높음', mapSize: 8192, maxDistance: 320 },
};
const EXPORT_MAP_SIZE = 4096; // 내보낼 때 조각마다 쓰는 지도 크기
const EXPORT_MAX_SLICES = 16; // 내보낼 때 최대 조각 수
const MAX_SOFT_METERS = 0.3; // 부드러움 100% 일 때 가장자리 번짐 반지름(m)
const MAX_SOFT_TEXELS = 16; // 번짐이 이 칸 수를 넘지 않게 (넘으면 점박이 무늬가 생김)
const PCF_SAMPLES = 12; // 가장자리를 부드럽게 할 때 주변을 보는 횟수 (three.js 기본 5)
const REFIT_INTERVAL = 120; // 시점을 움직이는 동안 그림자 범위를 다시 맞추는 최소 간격(ms)
const CATCHER_OPACITY = 0.62; // 맨바닥 그림자 농도 (진하기 100% 일 때)
const AMBIENT_CUT = 0.75; // 진하기 100% 일 때 주변 빛을 얼마나 줄일지
const UP = new THREE.Vector3(0, 1, 0);

improvePcfSamples();

/**
 * @param viewer      core/viewer.js
 * @param env         core/environment.js (sun, hemi)
 * @param getCasters  그림자를 만드는 물체 그룹들 [모델들, 사람들]
 */
export function createShadows({ viewer, env, getCasters }) {
  const { renderer, scene, camera } = viewer;
  const { sun } = env;
  const settings = { enabled: false, azimuth: 145, elevation: 50, darkness: 0.7, softness: 0.3, quality: 'medium' };

  renderer.shadowMap.enabled = true; // 실제로 그릴지는 sun.castShadow 로 정함
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false; // 필요할 때만 다시 그림 (markDirty)

  // ---------- 바닥 그림자 받이 ----------
  const catcherMaterial = new THREE.ShadowMaterial({ opacity: CATCHER_OPACITY, depthWrite: false });
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), catcherMaterial);
  catcher.name = '바닥 그림자 받이';
  catcher.position.y = -0.003; // 모델 바닥(높이 0)과 겹쳐 깜빡이지 않게 살짝 아래
  catcher.receiveShadow = true;
  catcher.renderOrder = -1;
  catcher.visible = false;
  scene.add(catcher);
  viewer.addColorOnly(catcher);

  // ---------- 그림자 지도 그릴 때 기울기만큼 깊이 밀어내기 ----------
  // three.js 가 그림자 지도용 재질로 그릴 때(장면 없이 해 카메라로) 끼어들어 polygonOffset 을 켬
  const offset = { factor: 2, units: 2 };
  const renderBufferDirect = renderer.renderBufferDirect.bind(renderer);
  renderer.renderBufferDirect = (cam, scn, geometry, material, object, group) => {
    if (scn === null && cam === sun.shadow.camera && material.isMeshDepthMaterial) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = offset.factor;
      material.polygonOffsetUnits = offset.units;
    }
    return renderBufferDirect(cam, scn, geometry, material, object, group);
  };

  // ---------- 바뀌면 다시 그리기 ----------
  let boundsDirty = true;
  let sceneBox = null; // 모델·사람 전체 상자 (세상 좌표, 없으면 null)
  let fitted = null; // 지금 그림자 지도 범위 (해 기준 좌표의 상자)
  let lastFit = 0;

  function markDirty() {
    renderer.shadowMap.needsUpdate = true;
  }
  function markSceneChanged() {
    boundsDirty = true;
    fitted = null; // 장면이 바뀌면 범위도 다시
    markDirty();
  }
  for (const name of [
    'object-transformed', 'models-changed', 'model-flags-changed', 'people-changed',
    'pose-changed', 'people-visibility-changed',
  ]) on(name, markSceneChanged);

  function updateBounds() {
    if (!boundsDirty) return;
    boundsDirty = false;
    const box = new THREE.Box3();
    for (const g of getCasters()) if (g.visible) box.expandByObject(g);
    sceneBox = box.isEmpty() ? null : box;
  }

  // ---------- 해 방향 + 해 기준 좌표 (x·y = 그림자 지도 평면, z = 해 쪽으로) ----------
  const L = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };

  /** 해가 있는 쪽 방향 (단위 벡터) */
  function sunDirection(target = new THREE.Vector3()) {
    const az = THREE.MathUtils.degToRad(settings.azimuth);
    const el = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(settings.elevation, 0.5, 89.9));
    return target.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }
  function updateLightBasis() {
    sunDirection(L.z);
    // three.js 의 그림자 카메라(lookAt, 위쪽 = +Y)와 같은 축이 되도록
    L.x.crossVectors(UP, L.z).normalize();
    L.y.crossVectors(L.z, L.x);
  }

  /** 점들을 해 기준 좌표로 바꿔 감싸는 상자 */
  function lightBox(points) {
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const p of points) {
      const x = p.dot(L.x);
      const y = p.dot(L.y);
      const z = p.dot(L.z);
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
      b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
    }
    return b;
  }
  function boxCorners(box) {
    const out = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
    return out;
  }
  const scratchCam = new THREE.PerspectiveCamera();
  /** 카메라 시야 중 near ~ far 구간의 꼭짓점 8개 (내보내기의 프레임 잘라내기도 반영) */
  function frustumCorners(cam, near, far) {
    scratchCam.copy(cam);
    scratchCam.near = near;
    scratchCam.far = far;
    scratchCam.updateProjectionMatrix();
    const out = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(new THREE.Vector3(x, y, z).unproject(scratchCam));
    return out;
  }
  /** 카메라에서 장면의 가장 먼 곳까지 거리 */
  function farthestScene(cam) {
    let d = 0;
    for (const c of boxCorners(sceneBox)) d = Math.max(d, c.distanceTo(cam.position));
    return d;
  }

  /**
   * 시야 near ~ far 구간에 보이는 것들이 받는 그림자를 담을 범위 (해 기준 좌표).
   * 가로·세로 = 시야 ∩ 장면, 해 쪽 = 장면 끝까지(시야 밖 물체도 그림자를 드리움), 반대쪽 = 시야 끝까지
   */
  function fitBox(cam, near, far) {
    if (!sceneBox) return null;
    const f = lightBox(frustumCorners(cam, near, far));
    const s = lightBox(boxCorners(sceneBox));
    const box = {
      minX: Math.max(f.minX, s.minX), maxX: Math.min(f.maxX, s.maxX),
      minY: Math.max(f.minY, s.minY), maxY: Math.min(f.maxY, s.maxY),
      minZ: f.minZ, maxZ: s.maxZ + 1,
    };
    if (box.maxX <= box.minX || box.maxY <= box.minY) return null; // 보이는 곳에 그림자 받을 게 없음
    return box;
  }

  /** 해와 그림자 카메라를 범위(box)에 맞추고, 지도 크기에 따라 번짐·밀어내기 값 정함 */
  function applyBox(box, mapSize) {
    const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.02 + 0.05; // 가장자리 여유
    const minX = box.minX - pad;
    const maxX = box.maxX + pad;
    const minY = box.minY - pad;
    const maxY = box.maxY + pad;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const top = box.maxZ;
    sun.position.set(0, 0, 0).addScaledVector(L.x, cx).addScaledVector(L.y, cy).addScaledVector(L.z, top);
    sun.target.position.copy(sun.position).sub(L.z);

    const cam = sun.shadow.camera;
    cam.left = -(maxX - minX) / 2;
    cam.right = (maxX - minX) / 2;
    cam.bottom = -(maxY - minY) / 2;
    cam.top = (maxY - minY) / 2;
    cam.near = 0;
    cam.far = top - box.minZ + 1;
    cam.updateProjectionMatrix();

    // 가장자리를 번지게 할 거면 그만큼 지도를 덜 촘촘하게 (번짐이 MAX_SOFT_TEXELS 칸 안에 들어오게, 메모리도 아낌)
    const extent = Math.max(maxX - minX, maxY - minY);
    const softMeters = settings.softness * MAX_SOFT_METERS;
    let size = Math.min(mapSize, renderer.capabilities.maxTextureSize);
    if (softMeters > 0) {
      const enough = (extent * MAX_SOFT_TEXELS) / softMeters;
      size = Math.min(size, Math.max(512, 2 ** Math.floor(Math.log2(enough))));
    }
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    const texel = extent / size;
    const radius = Math.min(softMeters / texel, MAX_SOFT_TEXELS);
    sun.shadow.radius = radius;
    offset.factor = 1.5 + radius; // 주변을 넓게 볼수록 기울어진 면을 더 밀어냄
    offset.units = 2;
    sun.shadow.normalBias = texel * 0.5;
    sun.shadow.bias = 0;
    markDirty();
  }

  // ---------- 매 프레임: 화면에 보이는 영역에 맞추기 ----------
  viewer.onFrame(() => {
    if (!settings.enabled) return;
    updateBounds();
    if (!sceneBox) return;
    const q = SHADOW_QUALITY[settings.quality];
    const far = Math.min(q.maxDistance, farthestScene(camera), camera.far);
    const want = fitBox(camera, camera.near, Math.max(far, camera.near + 0.1));
    if (!want) return;
    // 지금 범위가 원하는 범위를 다 덮고, 너무 크지 않으면 그대로 (자주 다시 그리지 않게)
    if (fitted && contains(fitted, want) && area(fitted) < area(want) * 2.2) return;
    const now = performance.now();
    if (fitted && now - lastFit < REFIT_INTERVAL) return; // 움직이는 중엔 너무 자주 하지 않음
    lastFit = now;
    fitted = grow(want, 0.08);
    applyBox(fitted, q.mapSize);
  });

  /**
   * 내보내기용 그리기: 그림자가 켜져 있으면 시야를 깊이 조각으로 나눠 먼 곳부터 그리고,
   * 조각마다 그림자 지도를 그 조각에만 맞춰 최고 품질로 다시 그림. 결과는 지금 그리는 곳(캔버스)에.
   * @param outW 결과 가로 픽셀 (조각을 얼마나 잘게 나눌지 정함)
   */
  function renderView(outW) {
    updateBounds();
    if (!sun.castShadow || !sceneBox) {
      renderer.render(scene, camera);
      return;
    }
    updateLightBasis();
    const slices = depthSlices(outW);
    const saved = { near: camera.near, far: camera.far, background: scene.background, autoClear: renderer.autoClear };
    try {
      slices.forEach(([near, far], i) => {
        const box = fitBox(camera, near, far);
        if (box) applyBox(box, EXPORT_MAP_SIZE);
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
        if (i === 0) {
          renderer.autoClear = true;
        } else {
          // 가까운 조각은 앞 그림 위에 겹쳐 그림 (깊이만 지우고, 배경은 처음 한 번만)
          renderer.autoClear = false;
          scene.background = null;
          renderer.clearDepth();
        }
        renderer.render(scene, camera);
      });
    } finally {
      camera.near = saved.near;
      camera.far = saved.far;
      camera.updateProjectionMatrix();
      scene.background = saved.background;
      renderer.autoClear = saved.autoClear;
      fitted = null; // 화면용 범위로 다시 맞춤
      markDirty();
    }
  }

  /**
   * 깊이 조각: 먼 곳 → 가까운 곳 순서 [[near, far], ...].
   * 조각의 (먼 끝 / 가까운 끝) 비율을 작게 할수록 촘촘함. 결과 가로가 클수록 잘게 나눔
   */
  function depthSlices(outW) {
    const viewDir = camera.getWorldDirection(new THREE.Vector3());
    let dMin = Infinity;
    let dMax = 0;
    for (const c of boxCorners(sceneBox)) {
      const d = c.clone().sub(camera.position).dot(viewDir);
      dMin = Math.min(dMin, d);
      dMax = Math.max(dMax, d);
    }
    const near = camera.near;
    const far = camera.far;
    const start = THREE.MathUtils.clamp(dMin, Math.max(near * 2, 0.5), far);
    const end = THREE.MathUtils.clamp(dMax, start * 1.01, far);
    const ratio = Math.max(1.4, (EXPORT_MAP_SIZE * 1.6) / Math.max(outW, 1));
    const count = THREE.MathUtils.clamp(Math.ceil(Math.log(end / start) / Math.log(ratio)), 1, EXPORT_MAX_SLICES);
    const step = Math.pow(end / start, 1 / count);
    const cuts = [near];
    for (let i = 1; i < count; i++) cuts.push(start * Math.pow(step, i));
    cuts.push(far);
    const slices = [];
    for (let i = cuts.length - 2; i >= 0; i--) slices.push([cuts[i], cuts[i + 1]]);
    return slices;
  }

  // 그림자를 켜면 진하기에 따라 '주변 빛'(하늘빛·반사광)을 줄이고 햇빛을 늘림 →
  // 해를 받는 면의 밝기는 거의 그대로, 그림자 속(주변 빛만 받음)은 그만큼 어두워짐
  const base = { hemi: env.hemi.intensity, sun: sun.intensity, envMap: scene.environmentIntensity };
  function balanceLights() {
    const k = settings.enabled ? 1 - AMBIENT_CUT * settings.darkness : 1;
    env.hemi.intensity = base.hemi * k;
    scene.environmentIntensity = base.envMap * k;
    // 해 높이 50° 에서 위를 향한 면의 밝기(하늘빛 + 햇빛)가 그대로 되도록
    const up = Math.sin(THREE.MathUtils.degToRad(50));
    sun.intensity = base.sun + (base.hemi * (1 - k)) / up;
  }

  function apply() {
    sun.castShadow = settings.enabled;
    catcher.visible = settings.enabled;
    // 진하기: 0~33% 는 햇빛을 가리는 정도, 그 위로는 주변 빛을 줄여서 더 어둡게 (balanceLights)
    sun.shadow.intensity = Math.min(1, settings.darkness * 3);
    catcherMaterial.opacity = sun.shadow.intensity > 0 ? (CATCHER_OPACITY * settings.darkness) / sun.shadow.intensity : 0;
    balanceLights();
    updateLightBasis();
    // 그림자를 꺼도 해 방향은 빛에 그대로 반영
    sun.target.position.set(0, 0, 0);
    sun.position.copy(L.z).multiplyScalar(20);
    fitted = null; // 다음 프레임에 범위 다시 맞춤
    markDirty();
  }

  /**
   * '그림자만' 내보내기용: 그림자를 꺼 두었어도 잠깐 켜서 계산. 되돌리는 함수를 돌려줌
   */
  function prepareShadowPass() {
    const saved = { castShadow: sun.castShadow, intensity: sun.shadow.intensity, catcher: catcher.visible };
    sun.castShadow = true;
    sun.shadow.intensity = 1;
    catcher.visible = true;
    markDirty();
    return () => {
      sun.castShadow = saved.castShadow;
      sun.shadow.intensity = saved.intensity;
      catcher.visible = saved.catcher;
      fitted = null;
      markDirty();
    };
  }

  apply();

  return {
    catcher,
    getSettings: () => ({ ...settings }),
    /** 설정 바꾸기. 예) set({ enabled: true, azimuth: 200 }) */
    set(changes) {
      Object.assign(settings, changes);
      apply();
      emit('shadows-changed', { ...settings });
    },
    markDirty,
    prepareShadowPass,
    renderView,
    sunDirection,
  };
}

function contains(a, b) {
  return a.minX <= b.minX && a.maxX >= b.maxX && a.minY <= b.minY && a.maxY >= b.maxY && a.minZ <= b.minZ && a.maxZ >= b.maxZ;
}
function area(b) {
  return (b.maxX - b.minX) * (b.maxY - b.minY);
}
function grow(b, f) {
  const gx = (b.maxX - b.minX) * f;
  const gy = (b.maxY - b.minY) * f;
  const gz = (b.maxZ - b.minZ) * f;
  return { minX: b.minX - gx, maxX: b.maxX + gx, minY: b.minY - gy, maxY: b.maxY + gy, minZ: b.minZ - gz, maxZ: b.maxZ };
}

/**
 * three.js 의 부드러운 그림자(PCF)는 주변을 5번만 봐서 넓게 번지게 하면 점박이가 생김 → 12번 보게 고침.
 * (셰이더 조각 글자를 바꾸는 것이라 three.js 버전이 바뀌어 모양이 다르면 그냥 기본값으로 둠)
 */
function improvePcfSamples() {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const first = chunk.indexOf('vogelDiskSample( 0, 5, phi )');
  if (first === -1) return console.warn('그림자 셰이더 모양이 달라서 기본 부드러움을 씁니다.');
  const start = chunk.lastIndexOf('shadow = (', first);
  const endMark = ') * 0.2;';
  const end = chunk.indexOf(endMark, first);
  if (start === -1 || end === -1) return console.warn('그림자 셰이더 모양이 달라서 기본 부드러움을 씁니다.');
  const loop = `shadow = 0.0;
				for ( int i = 0; i < ${PCF_SAMPLES}; i ++ ) {
					shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${PCF_SAMPLES}, phi ) * radius, shadowCoord.z ) );
				}
				shadow /= ${PCF_SAMPLES}.0;`;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + loop + chunk.slice(end + endMark.length);
}
