// 바닥 그리드와 기본 조명, 배경색.
import * as THREE from 'three';
import { emit } from './events.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const GRID_SIZE = 200; // 그리드 전체 크기(m)

export function createEnvironment(viewer) {
  const { scene, renderer } = viewer;
  scene.background = new THREE.Color(0xdfe3e8);

  // 금속/반사 재질이 까맣게 보이지 않도록 은은한 실내 반사광
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  // 하늘/땅 색이 다른 전체 조명 + 해처럼 한쪽에서 비추는 빛
  // 해 방향·그림자는 src/render/shadows.js 가 정함
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9096a0, 1.4);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(6, 12, 8);
  scene.add(hemi, sun, sun.target);

  // 바닥 그리드: 1m 간격(연한 선) + 10m 간격(진한 선)
  const grid = new THREE.Group();
  grid.name = '바닥 그리드';
  const minor = makeGrid(GRID_SIZE, 1, 0xb9bfc8);
  const major = makeGrid(GRID_SIZE, 10, 0x8c939e);
  major.position.y = 0.002; // 두 그리드가 겹쳐 깜빡이지 않게 살짝 띄움
  grid.add(minor, major);
  scene.add(grid);
  viewer.addHelper(grid);

  return {
    grid,
    sun,
    hemi,
    setGridVisible(visible) {
      grid.visible = visible;
      emit('grid-visibility-changed', visible);
    },
  };
}

/**
 * 바닥 격자 만들기. size: 전체 크기(m), step: 칸 간격(m)
 * 긴 선 하나 대신 1m 짜리 짧은 선을 이어 붙임
 * (일부 그래픽 환경에서 카메라 뒤로 지나가는 긴 선이 통째로 사라지는 문제 방지)
 */
function makeGrid(size, step, color) {
  const half = size / 2;
  const points = [];
  for (let i = -half; i <= half; i += step) {
    for (let t = -half; t < half; t += 1) {
      points.push(i, 0, t, i, 0, t + 1); // 앞뒤 방향 선
      points.push(t, 0, i, t + 1, 0, i); // 좌우 방향 선
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
}
