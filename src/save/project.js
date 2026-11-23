// 프로젝트 저장/불러오기.
// 프로젝트 파일(.webtoon3d) = ZIP 하나:
//   project.json              모델 배치·부품·사람(포즈)·컷 목록·설정·지금 시점
//   bundles/<묶음 id>/<경로>   불러왔던 원본 모델 파일들 (.glb/.gltf/.bin/.obj/.mtl/.skp/.blend/텍스처)
// → 이 파일 하나만 옮기면 다른 컴퓨터에서도 그대로 열림.
// 자동 저장(src/save/autosave.js)도 같은 collect()/apply() 를 씀 (파일은 브라우저 저장소에 따로).
import * as THREE from 'three';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { emit } from '../core/events.js';
import { loadModelAt } from '../models/loadFiles.js';
import { tagSourcePaths } from '../models/modelStore.js';
import { prepareFastRaycast } from '../core/fastRaycast.js';
import { captureModel, rebuildContent } from './modelState.js';

export const PROJECT_EXT = '.webtoon3d';
const FORMAT = 'webtoon-bg-3d-project';
const VERSION = 1;
const TEXT_FILES = /\.(gltf|obj|mtl|json|txt)$/i; // 압축이 잘 되는 것만 압축 (나머지는 그대로 담아서 빠르게)

/**
 * @param app  main.js 의 기능들 { env, store, people, cuts, shadows, ao, lineOverlay, exportPanel, frame, lens, walk, selection, poseMode }
 */
export function createProject(app) {
  const { env, store, people, cuts, shadows, ao, lineOverlay, exportPanel, frame, lens, walk, selection, poseMode } = app;
  let name = '새 프로젝트';

  // ---------- 지금 상태 → 저장할 값 ----------
  function collect() {
    return {
      format: FORMAT,
      version: VERSION,
      name,
      savedAt: new Date().toISOString(),
      bundles: store.usedBundles().map((b) => ({ id: b.id, files: b.files.map((f) => f.path) })),
      models: store.list().map(captureModel),
      people: people.list().map((p) => ({
        body: p.userData.body,
        height: p.userData.height,
        position: p.position.toArray(),
        quaternion: p.quaternion.toArray(),
        pose: people.getPose(p),
      })),
      cuts: cuts.getState(),
      view: cuts.captureView(),
      settings: {
        shadows: shadows.getSettings(),
        ao: ao.getSettings(),
        renderLines: lineOverlay.getSettings(),
        export: exportPanel.getExportSettings(),
        frame: frame.getState(),
        focal: lens.getFocalLength(),
        eyeHeight: walk.getEyeHeight(),
        followTerrain: walk.getFollowTerrain(),
        peopleVisible: people.isVisible(),
        gridVisible: env.grid.visible,
        nextPersonHeight: people.getNextHeight(),
        nextPersonBody: people.getNextBody(),
      },
    };
  }

  /** 장면 비우기 (모델·사람·컷). 설정은 그대로 */
  function clearScene() {
    if (walk.isActive()) walk.exit();
    poseMode.exit();
    selection.select(null);
    store.clear();
    for (const p of [...people.list()]) people.remove(p);
    cuts.setState([]);
    selection.validate();
  }

  /**
   * 저장된 값 → 장면. 원본 파일은 bundleFiles(묶음 id → [{ file, path }]) 에서 가져옴.
   * @returns {Promise<string[]>} 문제가 있었던 것들 (모델 하나가 안 열려도 나머지는 엶)
   */
  async function apply(state, bundleFiles) {
    if (state.format !== FORMAT) throw new Error('이 툴의 프로젝트 파일이 아니에요.');
    const problems = [];
    clearScene();
    name = state.name || name;

    for (const b of state.bundles || []) {
      const files = bundleFiles.get(b.id);
      if (files) store.addBundle(files, b.id);
    }

    // 모델: 같은 파일은 한 번만 불러와서(원본) 복제한 모델들이 같이 씀
    const pristine = new Map();
    for (const m of state.models || []) {
      try {
        const bundle = m.source && store.getBundle(m.source.bundleId);
        if (!bundle) throw new Error('원본 파일이 프로젝트에 없어요.');
        const key = `${m.source.bundleId}|${m.source.modelPath}`;
        if (!pristine.has(key)) pristine.set(key, loadPristine(bundle.files, m.source.modelPath));
        const content = rebuildContent(await pristine.get(key), m.tree);
        store.restore(content, m);
      } catch (err) {
        console.error(err);
        problems.push(`${m.name}: ${err.message}`);
      }
    }

    // 사람 (체형·키·위치·방향·포즈). 사람 모델을 다 불러온 뒤에 (그래야 발 바닥 맞추기가 모델 기준)
    await people.ready;
    for (const p of state.people || []) {
      const person = people.add({ body: p.body, height: p.height, position: new THREE.Vector3().fromArray(p.position), pose: p.pose });
      person.quaternion.fromArray(p.quaternion);
    }

    // 설정
    const s = state.settings || {};
    if (s.shadows) shadows.set(s.shadows);
    if (s.ao) ao.set(s.ao);
    if (s.renderLines) lineOverlay.set(s.renderLines);
    if (s.frame) frame.set(s.frame);
    if (s.export) exportPanel.setExportSettings(s.export);
    if (s.focal) lens.setFocalLength(s.focal);
    if (s.eyeHeight) walk.setEyeHeight(s.eyeHeight);
    if (s.followTerrain !== undefined) walk.setFollowTerrain(s.followTerrain);
    if (s.nextPersonHeight) people.setNextHeight(s.nextPersonHeight);
    if (s.nextPersonBody) people.setNextBody(s.nextPersonBody);
    if (s.gridVisible !== undefined) env.setGridVisible(s.gridVisible);
    if (s.peopleVisible !== undefined) people.setVisible(s.peopleVisible);

    cuts.setState(state.cuts || []);
    cuts.applyView(state.view);
    emit('models-changed'); // 레이어 패널·그림자 범위 등 새로 고침
    emit('project-changed', { name });
    return problems;
  }

  async function loadPristine(files, path) {
    const object = await loadModelAt(files, path);
    tagSourcePaths(object);
    prepareFastRaycast(object);
    return object;
  }

  // ---------- 파일 하나(.webtoon3d)로 ----------
  async function toFile() {
    const state = collect();
    const entries = { 'project.json': [strToU8(JSON.stringify(state)), { level: 6 }] };
    for (const b of store.usedBundles()) {
      for (const f of b.files) {
        const data = new Uint8Array(await f.file.arrayBuffer());
        entries[`bundles/${b.id}/${f.path}`] = [data, { level: TEXT_FILES.test(f.path) ? 6 : 0 }];
      }
    }
    const zipped = zipSync(entries);
    return new File([zipped], `${safeFileName(name)}${PROJECT_EXT}`, { type: 'application/zip' });
  }

  /** 프로젝트 파일 읽기 → { state, bundleFiles } */
  async function readFile(file) {
    let entries;
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch {
      throw new Error('프로젝트 파일이 손상됐거나 형식이 달라요.');
    }
    if (!entries['project.json']) throw new Error('프로젝트 파일 안에 project.json 이 없어요.');
    const state = JSON.parse(strFromU8(entries['project.json']));
    const bundleFiles = new Map();
    for (const b of state.bundles || []) {
      bundleFiles.set(
        b.id,
        b.files
          .filter((path) => entries[`bundles/${b.id}/${path}`])
          .map((path) => ({ path, file: new File([entries[`bundles/${b.id}/${path}`]], path.split('/').pop()) })),
      );
    }
    return { state, bundleFiles };
  }

  return {
    collect,
    apply,
    toFile,
    readFile,
    clearScene,
    getName: () => name,
    setName(value) {
      name = value.trim() || '새 프로젝트';
      emit('project-changed', { name });
    },
    /** 저장할 내용이 있는지 (모델·사람·컷) */
    hasContent: (state = collect()) => !!(state.models?.length || state.people?.length || state.cuts?.length),
  };
}

/** 파일 이름에 못 쓰는 글자 빼기 */
function safeFileName(text) {
  return text.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project';
}
