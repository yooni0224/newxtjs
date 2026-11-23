// 동작 모음(Quaternius Universal Animation Library, CC0)에서 포즈를 뽑아 src/people/poseLibrary.js 내용을 만듦.
//   개발 서버를 켜고 http://localhost:5173/tools/pose-extract/ 를 열면 결과가 화면에 나옴 → 파일에 붙여 넣기
//   (원본 동작 파일은 source/ 에 — README.md 참고. 이 파일들은 저장소에 넣지 않음)
//
// 원리: 같은 마네킹이라 'T자 자세 → 그 순간' 의 뼈 회전 차이(몸 기준)는 뼈 축 정의와 상관없이 같음.
//   차이 D = (그 순간 뼈 회전) × (T자 자세 뼈 회전)⁻¹
//   이 툴의 관절 회전(몸 기준 누적) J = D (팔은 우리가 기본 자세로 내린 만큼 빼 줌: × 팔내림⁻¹)
//   관절 각도 = (부모 관절 J)⁻¹ × J → XZY 오일러 각, 사람이 꺾을 수 있는 범위로 자름
//   손가락 마디 굽힘 E = T⁻¹ × (D부모⁻¹ × D) × T   (T = 그 마디의 T자 자세 회전, 우리 모델 기준)
//   → 그 회전의 축(마디 기준)을 '굽는 축'으로 저장 (얼마나 굽힐지는 손 모양마다 src/people/hands.js 에서)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadRigs, BONE_OF } from '../../src/people/rig.js';
import { JOINTS } from '../../src/people/mannequin.js';
import { clampJoint } from '../../src/people/pose.js';
import { FINGER_BONES } from '../../src/people/hands.js';
import { POSES, FINGER_SOURCE } from './spec.js';

const SOURCES = {
  ual1: { url: './source/ual1.glb', rename: rigifyToUe }, // Godot 판: Rigify 뼈 이름
  ual2: { url: './source/ual2.glb', rename: (n) => n }, // Unreal-Godot 판: 우리와 같은 이름
};

/** Rigify(DEF-…) 뼈 이름 → 우리 모델(UE 식) 이름. three.js 가 불러올 때 이름의 '.' 을 지움 (DEF-spine.001 → DEF-spine001) */
function rigifyToUe(name) {
  const base = {
    'DEF-hips': 'pelvis', 'DEF-spine001': 'spine_01', 'DEF-spine002': 'spine_02', 'DEF-spine003': 'spine_03',
    'DEF-neck': 'neck_01', 'DEF-head': 'Head',
  };
  if (base[name]) return base[name];
  const m = /^DEF-(.+?)([LR])$/.exec(name);
  if (!m) return null;
  const side = m[2] === 'L' ? 'l' : 'r';
  const part = {
    shoulder: 'clavicle', upper_arm: 'upperarm', forearm: 'lowerarm', hand: 'hand',
    thigh: 'thigh', shin: 'calf', foot: 'foot', toe: 'ball',
  }[m[1]];
  if (part) return `${part}_${side}`;
  const f = /^(?:f_)?(thumb|index|middle|ring|pinky)0([123])$/.exec(m[1]);
  return f ? `${f[1]}_0${f[2]}_${side}` : null;
}

async function loadSource(key) {
  const { url, rename } = SOURCES[key];
  const gltf = await new GLTFLoader().loadAsync(url);
  const bones = {};
  gltf.scene.traverse((o) => {
    if (!o.isBone) return;
    const n = rename(o.name);
    if (n) bones[n] = o;
  });
  const rest = [];
  gltf.scene.traverse((o) => o.isBone && rest.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const missing = Object.values(BONE_OF).filter((n) => !bones[n]);
  if (missing.length) throw new Error(`${key}: 뼈를 못 찾음 ${missing.join(', ')} (있는 뼈: ${Object.keys(bones).join(', ')})`);
  return { scene: gltf.scene, mixer: new THREE.AnimationMixer(gltf.scene), clips: gltf.animations, bones, rest };
}

/** 동작의 한 순간 → 뼈 이름별 회전(몸 기준) */
function sample(src, clipName, at) {
  const clip = src.clips.find((c) => c.name === clipName);
  if (!clip) throw new Error(`동작 '${clipName}' 이 없어요`);
  src.mixer.stopAllAction();
  // 앞 동작이 남긴 값이 섞이지 않게 모든 뼈를 기본 자세로 되돌린 뒤
  for (const [bone, p, q, sc] of src.rest) {
    bone.position.copy(p);
    bone.quaternion.copy(q);
    bone.scale.copy(sc);
  }
  const action = src.mixer.clipAction(clip);
  action.reset().play();
  src.mixer.setTime(Math.min(at, 0.999) * clip.duration);
  src.scene.updateMatrixWorld(true);
  const out = {};
  for (const [name, bone] of Object.entries(src.bones)) out[name] = bone.getWorldQuaternion(new THREE.Quaternion());
  return out;
}

const r1 = (v) => Math.round(v * 10) / 10;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

function extractPose(T, A, tpl) {
  const delta = (name) => A[name].clone().multiply(T[name].clone().invert());
  const J = {};
  for (const def of JOINTS) {
    const bone = BONE_OF[def.id];
    const q = delta(bone);
    const arm = /^(upperarm|lowerarm|hand)_([lr])$/.exec(bone);
    if (arm) q.multiply(tpl.armTurn[arm[2]].clone().invert());
    J[def.id] = q;
  }
  const pose = {};
  const dummy = new THREE.Group();
  dummy.rotation.order = 'XZY';
  for (const def of JOINTS) {
    const r = def.parent ? J[def.parent].clone().invert().multiply(J[def.id]) : J[def.id].clone();
    dummy.quaternion.copy(r);
    dummy.userData.limits = def.limits;
    clampJoint(dummy);
    const deg = [dummy.rotation.x, dummy.rotation.y, dummy.rotation.z].map((a) => r1(THREE.MathUtils.radToDeg(a)));
    if (deg.some((d) => d !== 0)) pose[def.id] = deg;
  }
  return pose;
}

/** 손가락 마디마다 굽는 축 */
function extractFingers(T, A, tpl, side) {
  const delta = (name) => A[name].clone().multiply(T[name].clone().invert());
  const out = {};
  for (const f of FINGER_BONES) {
    const name = `${f}_${side}`;
    const seg = Number(f.slice(-1));
    const parent = seg === 1 ? `hand_${side}` : `${f.slice(0, -1)}${seg - 1}_${side}`;
    if (!A[name] || !A[parent]) continue;
    const local = delta(parent).invert().multiply(delta(name));
    const tw = tpl.tposeWorld[name];
    const e = tw.clone().invert().multiply(local).multiply(tw);
    if (e.w < 0) e.set(-e.x, -e.y, -e.z, -e.w);
    const axis = new THREE.Vector3(e.x, e.y, e.z);
    if (axis.lengthSq() < 1e-8) continue;
    out[f] = axis.normalize().toArray().map(r4);
  }
  return out;
}

async function main() {
  const out = document.getElementById('out');
  out.textContent = '불러오는 중…';
  const tpl = (await loadRigs()).get('male');
  const sources = { ual1: await loadSource('ual1'), ual2: await loadSource('ual2') };
  const tpose = { ual1: sample(sources.ual1, 'A_TPose', 0), ual2: sample(sources.ual2, 'A_TPose', 0) };

  const poses = {};
  for (const p of POSES) {
    const pose = extractPose(tpose[p.src], sample(sources[p.src], p.clip, p.at), tpl);
    pose.hands = p.hands || { L: 'relaxed', R: 'relaxed' };
    poses[p.id] = { name: p.name, category: p.category, pose };
  }
  const fs = FINGER_SOURCE;
  const A = sample(sources[fs.src], fs.clip, fs.at);
  const fingers = { L: extractFingers(tpose[fs.src], A, tpl, 'l'), R: extractFingers(tpose[fs.src], A, tpl, 'r') };

  const text =
    `// tools/pose-extract 로 만든 파일 (손으로 고치지 말고 spec.js 를 고친 뒤 다시 뽑으세요)\n` +
    `// 출처: Quaternius — Universal Animation Library 1 & 2 (CC0)\n` +
    `export const EXTRACTED_POSES = ${JSON.stringify(poses, null, 0).replace(/},"/g, '},\n  "')};\n` +
    `// 손가락 마디가 굽는 축 (마디 기준, 양수로 돌리면 손바닥 쪽으로 굽음)\n` +
    `export const FINGER_AXES = ${JSON.stringify(fingers)};\n`;
  out.textContent = text;
  window.__result = text;
}

main().catch((err) => {
  document.getElementById('out').textContent = `실패: ${err.stack || err}`;
  window.__error = String(err);
});
