// 그림자: 켜기/끄기, 해 방향(방위·높이), 진하기, 가장자리 부드러움, 품질.
//   해 방위: 0° = 북쪽(-Z), 90° = 동쪽(+X), 180° = 남쪽(+Z), 270° = 서쪽(-X)
//   해 높이: 0° = 지평선, 90° = 머리 위
// 모델·사람 모형 모두 그림자를 드리우고 받음. 바닥(높이 0)에는 '그림자 받이' 판이 있어서
// 모델 밖 맨바닥에도 그림자가 보임 (선 찾기에서는 빠짐: viewer.addColorOnly).
//
// 큰 맵에서도 버벅이지 않게
//   ① 그림자 지도는 뭔가 바뀔 때만 다시 그림 (물체 이동·포즈·해 방향·보는 곳이 많이 바뀜)
//   ② 장면이 작으면 장면 전체, 크면 '지금 보는 곳 주변'(품질별 최대 반지름)만 계산
//   ③ 품질: 그림자 지도 크기 낮음 1024 / 중간 2048 / 높음 4096
import * as THREE from 'three';
import { on, emit } from '../core/events.js';

export const SHADOW_QUALITY = {
  low: { name: '낮음', mapSize: 1024, maxRadius: 45 },
  medium: { name: '중간', mapSize: 2048, maxRadius: 70 },
  high: { name: '높음', mapSize: 4096, maxRadius: 90 },
};
const MIN_RADIUS = 6; // 그림자를 계산하는 범위의 최소 반지름(m)
const MAX_SOFTNESS_TEXELS = 10; // 부드러움 100% 일 때 가장자리 번짐 (그림자 지도 픽셀)
const CATCHER_OPACITY = 0.62; // 맨바닥 그림자 농도 (진하기 100% 일 때)
const AMBIENT_CUT = 0.75; // 진하기 100% 일 때 주변 빛을 얼마나 줄일지

/**
 * @param viewer      core/viewer.js
 * @param env         core/environment.js (sun, hemi)
 * @param getCasters  그림자를 만드는 물체 그룹들 [모델들, 사람들]
 * @param walk        camera/walkMode.js (1인칭이면 앞쪽을 계산)
 * @param editorCam   core/editorCamera.js (편집 시점이면 보는 중심 주변을 계산)
 */
export function createShadows({ viewer, env, getCasters, walk, editorCam }) {
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

  // ---------- 바뀌면 다시 그리기 ----------
  let boundsDirty = true;
  let sceneSphere = null; // 모델·사람 전체를 감싸는 구 (없으면 null)
  let sceneTop = 0;
  let region = null; // 지금 그림자를 계산하는 범위 { center, radius }

  function markDirty() {
    renderer.shadowMap.needsUpdate = true;
  }
  function markSceneChanged() {
    boundsDirty = true;
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
    if (box.isEmpty()) {
      sceneSphere = null;
      sceneTop = 0;
      return;
    }
    sceneSphere = box.getBoundingSphere(new THREE.Sphere());
    sceneTop = box.max.y;
  }

  // ---------- 해 방향 ----------
  /** 해가 있는 쪽 방향 (단위 벡터) */
  function sunDirection(target = new THREE.Vector3()) {
    const az = THREE.MathUtils.degToRad(settings.azimuth);
    const el = THREE.MathUtils.degToRad(Math.max(settings.elevation, 0.5));
    return target.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }

  // ---------- 매 프레임: 계산 범위 맞추기 ----------
  const dir = new THREE.Vector3();
  const focus = new THREE.Vector3();
  viewer.onFrame(() => {
    if (!settings.enabled) return;
    updateBounds();
    const want = desiredRegion();
    // 지금 범위가 원하는 범위를 다 덮고, 너무 크지 않으면 그대로 (자주 다시 그리지 않게)
    const covers = region && region.center.distanceTo(want.center) + want.radius <= region.radius;
    const tooBig = region && region.radius > want.radius * 1.8;
    if (!covers || tooBig) {
      region = { center: want.center.clone(), radius: want.radius * (want.whole ? 1.02 : 1.15) };
      placeSun();
    }
  });

  /** 그림자를 계산할 범위: 장면이 작으면 장면 전체, 크면 보는 곳 주변 */
  function desiredRegion() {
    const q = SHADOW_QUALITY[settings.quality];
    let r;
    if (walk.isActive()) {
      r = q.maxRadius * 0.6;
      const f = camera.getWorldDirection(new THREE.Vector3()).setY(0);
      if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
      focus.copy(camera.position).addScaledVector(f.normalize(), r * 0.6);
      focus.y = walk.getGroundY();
    } else {
      focus.copy(editorCam.controls.target);
      r = THREE.MathUtils.clamp(camera.position.distanceTo(focus) * 1.6, MIN_RADIUS, q.maxRadius);
    }
    if (sceneSphere && sceneSphere.radius <= r) {
      return { center: sceneSphere.center, radius: Math.max(sceneSphere.radius, MIN_RADIUS), whole: true };
    }
    return { center: focus, radius: r, whole: false };
  }

  /** 해(빛)를 범위 위쪽에 두고, 그림자 카메라를 범위에 맞춤 */
  function placeSun() {
    if (!region) return;
    const q = SHADOW_QUALITY[settings.quality];
    const mapSize = Math.min(q.mapSize, renderer.capabilities.maxTextureSize);
    sunDirection(dir);
    const { center, radius } = region;
    // 범위 밖에 있어도 해와 범위 사이에 있는 물체는 그림자를 드리우도록 충분히 멀리
    const sceneReach = sceneSphere ? center.distanceTo(sceneSphere.center) + sceneSphere.radius : radius;
    const distance = Math.max(sceneReach, radius) + 5;
    // 해가 낮으면 그림자가 길게 늘어지므로 그만큼 더 멀리까지
    const longShadow = Math.min(2000, Math.max(sceneTop, 1) / Math.tan(Math.max(dir.y, 0.02)));
    sun.position.copy(center).addScaledVector(dir, distance);
    sun.target.position.copy(center);

    const cam = sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.1;
    cam.far = distance + radius + longShadow;
    cam.updateProjectionMatrix();

    if (sun.shadow.mapSize.x !== mapSize) {
      sun.shadow.mapSize.set(mapSize, mapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    // 그림자 지도 한 칸의 실제 크기에 맞춰 '그림자 여드름'(밝은 면의 얼룩 무늬) 막기.
    // 가장자리를 부드럽게 할수록(주변을 넓게 볼수록) 더 띄워야 함
    const texel = (2 * radius) / mapSize;
    const softTexels = settings.softness * MAX_SOFTNESS_TEXELS;
    sun.shadow.normalBias = texel * (2 + 1.2 * softTexels);
    sun.shadow.bias = -texel / (cam.far - cam.near);
    sun.shadow.radius = softTexels;
    markDirty();
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
    sun.shadow.radius = settings.softness * MAX_SOFTNESS_TEXELS;
    balanceLights();
    if (!settings.enabled) {
      // 그림자를 꺼도 해 방향은 빛에 그대로 반영
      sunDirection(dir);
      const c = sun.target.position;
      sun.position.copy(c).addScaledVector(dir, 20);
    }
    region = null; // 다음 프레임에 범위·해 위치 다시 계산
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
    updateBounds();
    if (!region) {
      const want = desiredRegion();
      region = { center: want.center.clone(), radius: want.radius * 1.05 };
    }
    placeSun();
    return () => {
      sun.castShadow = saved.castShadow;
      sun.shadow.intensity = saved.intensity;
      catcher.visible = saved.catcher;
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
    sunDirection,
  };
}
