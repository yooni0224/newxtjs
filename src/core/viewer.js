// 3D 화면의 바탕: 렌더러, 장면(scene), 카메라, 매 프레임 그리기, 창 크기 맞추기.
import * as THREE from 'three';

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();

  // 단위: 1 = 1m. near/far 는 보이는 거리 범위(0.05m ~ 2km)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
  camera.position.set(6, 4, 8);

  const canvas = renderer.domElement;
  const frameCallbacks = [];
  const lateFrameCallbacks = []; // 카메라 움직임이 다 끝난 뒤에 할 일 (화면 덧그림 등)
  const resizeCallbacks = [];
  const helpers = []; // 화면에만 보이고 내보낼 때는 숨길 것들 (그리드, 핸들, 표시 등)
  const colorOnly = []; // 색 그림에만 나오고 선 찾기(선화·일반 렌더 선)에서는 뺄 것들 (바닥 그림자 받이 등)
  let pipeline = null; // 매 프레임 그리는 방법을 바꾸고 싶을 때 (예: 일반 렌더 선 미리보기)

  // 3D 화면을 누르면 입력칸 커서를 빼서 단축키가 바로 먹게
  canvas.addEventListener('pointerdown', () => document.activeElement?.blur?.());

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const fn of resizeCallbacks) fn();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    for (const fn of frameCallbacks) fn();
    for (const fn of lateFrameCallbacks) fn();
    if (pipeline) pipeline();
    else renderer.render(scene, camera);
  });

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** 화면 좌표(clientX, clientY) → 카메라에서 나가는 광선 */
  function rayFromScreen(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }

  /** 화면 좌표가 가리키는 바닥(높이 0) 위치. 하늘을 가리키면 null */
  function groundPointAt(clientX, clientY) {
    const hit = new THREE.Vector3();
    return rayFromScreen(clientX, clientY).ray.intersectPlane(groundPlane, hit) ? hit : null;
  }

  return {
    renderer,
    scene,
    camera,
    canvas,
    onFrame: (fn) => frameCallbacks.push(fn),
    onLateFrame: (fn) => lateFrameCallbacks.push(fn),
    onResize: (fn) => resizeCallbacks.push(fn),
    resize,
    addHelper: (obj) => helpers.push(obj),
    getHelpers: () => helpers,
    addColorOnly: (obj) => colorOnly.push(obj),
    getColorOnly: () => colorOnly,
    /** 매 프레임 그리는 함수 바꾸기 (null 이면 보통대로) */
    setRenderPipeline(fn) {
      pipeline = fn;
    },
    rayFromScreen,
    groundPointAt,
  };
}
