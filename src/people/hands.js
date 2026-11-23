// 손 모양: 손가락 다섯 개(엄지·검지·중지·약지·소지)마다 '펴기 / 편하게 / 쥐기 / 주먹' 중 하나를 골라 조합.
// 마디가 굽는 축은 실제 동작 데이터에서 뽑은 것 (FINGER_AXES, src/people/poseLibrary.js — tools/pose-extract),
// 얼마나 굽힐지(마디 1·2·3, 도)는 아래 CURL 에서 정함.
// 손 모양 이름은 포즈에 같이 저장됨: pose.hands = { L: 'fist', R: 'relaxed' }
import * as THREE from 'three';
import { FINGER_AXES } from './poseLibrary.js';

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
/** 손가락 뼈 이름 (좌우 붙이기 전): thumb_01 … pinky_03 */
export const FINGER_BONES = FINGERS.flatMap((f) => [1, 2, 3].map((i) => `${f}_0${i}`));
export const DEFAULT_HAND = 'relaxed';

/** 손가락 상태별 마디 굽힘(도) [뿌리, 가운데, 끝] — 바깥쪽 손가락일수록 조금 더 굽음 */
const CURL = {
  open: { thumb: [0, 0, 0], index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], pinky: [0, 0, 0] },
  relaxed: { thumb: [4, 10, 12], index: [12, 18, 10], middle: [16, 22, 12], ring: [20, 26, 14], pinky: [24, 30, 16] },
  grip: { thumb: [10, 22, 30], index: [48, 58, 34], middle: [52, 60, 36], ring: [55, 62, 38], pinky: [58, 64, 40] },
  fist: { thumb: [16, 34, 48], index: [82, 100, 62], middle: [86, 102, 62], ring: [88, 104, 62], pinky: [90, 104, 62] },
  pinch: { thumb: [14, 28, 34], index: [38, 62, 42] }, // OK 모양의 엄지·검지 (끝이 맞닿게)
};

const all = (state) => Object.fromEntries(FINGERS.map((f) => [f, state]));

/** 손 모양 목록 (버튼 순서대로) */
export const HAND_SHAPES = {
  relaxed: { name: '편하게', fingers: all('relaxed') },
  open: { name: '펴기', fingers: all('open') },
  grip: { name: '쥐기', fingers: all('grip') },
  fist: { name: '주먹', fingers: all('fist') },
  point: { name: '가리키기', fingers: { ...all('fist'), index: 'open' } },
  peace: { name: '브이', fingers: { ...all('fist'), index: 'open', middle: 'open' } },
  thumbsUp: { name: '엄지 척', fingers: { ...all('fist'), thumb: 'open' } },
  ok: { name: 'OK', fingers: { thumb: 'pinch', index: 'pinch', middle: 'relaxed', ring: 'relaxed', pinky: 'relaxed' } },
};

const cache = new Map();

/**
 * 손 모양 → { 뼈 이름(예: index_02_l): 굽힘 회전 }. 굽는 축 데이터가 없으면 빈 객체(손가락을 편 기본 자세)
 * @param side  'L' | 'R'
 */
export function fingerRotations(side, shapeName) {
  const key = `${side}|${shapeName}`;
  if (cache.has(key)) return cache.get(key);
  const shape = HAND_SHAPES[shapeName] || HAND_SHAPES[DEFAULT_HAND];
  const axes = FINGER_AXES?.[side] || {};
  const suffix = side === 'L' ? '_l' : '_r';
  const out = {};
  for (const finger of FINGERS) {
    const angles = CURL[shape.fingers[finger]]?.[finger] || CURL.relaxed[finger];
    for (let i = 1; i <= 3; i++) {
      const axis = axes[`${finger}_0${i}`];
      if (!axis || !angles[i - 1]) continue;
      out[`${finger}_0${i}${suffix}`] = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3().fromArray(axis),
        THREE.MathUtils.degToRad(angles[i - 1]),
      );
    }
  }
  cache.set(key, out);
  return out;
}
