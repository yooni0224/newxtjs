// SketchUp(.skp) 파일 → 3D 객체.
// 파일 읽기는 작업자(src/models/skpWorker.js, openskp)가 하고, 여기서는 그 결과로 three.js 객체를 만든다.
//
// - 구조: SketchUp 의 그룹·컴포넌트 = 그룹(이름 그대로). 그룹 안의 낱개 면은 '면 (낱개)' 메시 하나로.
//         → 레이어 칸 트리, 더블클릭으로 들어가기(그룹 편집)가 SketchUp 처럼 동작
// - 같은 컴포넌트를 여러 번 놓았으면 모양(geometry)은 하나를 같이 씀 (메모리 절약)
// - SketchUp 에서 숨긴 물체, 숨긴 태그(레이어)의 물체 = 숨김 상태로 불러옴 (레이어 칸 눈 버튼으로 다시 보이기)
// - 단위: SketchUp(인치, Z 위) → 미터, Y 위 (openskp 가 바꿔 줌)
// - 칠하지 않은 면: openskp 는 태그 색을 쓰는데, SketchUp 기본 화면처럼 밝은 회색으로 바꿈
import * as THREE from 'three';

/** 칠하지 않은 면 색 (SketchUp 기본 재질 대신) */
const DEFAULT_FACE_COLOR = 0xe2e0db;
const LOOSE_FACES_NAME = '면 (낱개)';

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./skpWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, result, error } = event.data;
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(result);
  };
  worker.onerror = (event) => {
    // 작업자 자체가 망가짐 (스크립트를 못 불러옴 등) → 기다리던 것 모두 실패, 다음에 새로 만듦
    const err = new Error(event.message || 'SKP 읽기 작업자를 시작하지 못했어요.');
    for (const job of pending.values()) job.reject(err);
    pending.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

function parseInWorker(buffer) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, buffer }, [buffer]);
  });
}

/**
 * .skp 파일 내용 → THREE.Group (이름 = 'SketchUp 모델', 호출하는 쪽에서 바꿔도 됨)
 * @param {ArrayBuffer} buffer
 */
export async function loadSkp(buffer) {
  const data = await parseInWorker(buffer);
  const materials = await buildMaterials(data);
  const geometries = new Map();
  for (const res of data.meshResources) {
    const built = buildGeometry(res, materials);
    if (built) geometries.set(res.id, built);
  }

  const layerHidden = data.layerHidden;
  const makeNode = (node, isRoot) => {
    const geo = node.meshResourceId ? geometries.get(node.meshResourceId) : null;
    const children = (node.children || []).map((c) => makeNode(c, false)).filter(Boolean);
    if (!geo && !children.length) return null; // 빈 그룹 (치수선만 있던 것 등)

    let obj;
    if (geo && !children.length && !isRoot) {
      obj = new THREE.Mesh(geo.geometry, geo.material);
    } else {
      obj = new THREE.Group();
      if (geo) {
        const loose = new THREE.Mesh(geo.geometry, geo.material);
        loose.name = LOOSE_FACES_NAME;
        obj.add(loose);
      }
      for (const c of children) obj.add(c);
    }
    if (!isRoot) {
      // 이름 없는 그룹은 openskp 가 'Component_12' 처럼 지어 줌 → '그룹' 으로
      obj.name = node.nameIsGenerated || !node.name ? '그룹' : node.name;
      new THREE.Matrix4().fromArray(node.matrix).decompose(obj.position, obj.quaternion, obj.scale);
      const tag = node.ownLayer;
      if (tag) obj.userData.skpTag = tag;
      if (node.hidden || (tag && layerHidden[tag])) obj.visible = false;
    }
    return obj;
  };

  const root = makeNode(data.hierarchy, true);
  if (!root) throw new Error('보이는 면이 하나도 없어요. (빈 파일이거나, 이 SKP 를 제대로 읽지 못했어요 — SketchUp 에서 OBJ 로 내보내서 불러와 보세요)');
  root.name = 'SketchUp 모델';
  return root;
}

/** openskp 재질(glTF 형식) → three.js 재질 */
async function buildMaterials({ materials, textures, layerColors }) {
  // 태그 색 = 칠하지 않은 면 (텍스처 없는 같은 색 재질은 기본 면 색으로)
  const tagColors = new Set(Object.values(layerColors).map((c) => c.join(',')));
  const maps = await Promise.all(textures.map(loadTexture));
  return materials.map((m, i) => {
    const pbr = m.pbrMetallicRoughness || {};
    const [r, g, b, a] = pbr.baseColorFactor || [1, 1, 1, 1];
    const texIndex = pbr.baseColorTexture?.index;
    const map = texIndex != null ? maps[texIndex] : null;
    const rgb = [r, g, b].map((v) => Math.round(v * 255));
    const unpainted = !map && tagColors.has(rgb.join(','));
    // 면 양쪽 색이 같으면 양면 재질 하나, 다르면 앞면용·뒷면용(뒤집은 복사본)이 따로 옴 → 각자 한쪽만 그려야
    // 같은 자리의 두 면이 서로 깜빡이지 않음 (loadFiles.js 의 '모두 양면으로' 에서 빠지게 fixedSide 표시)
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    mat.userData.fixedSide = true;
    mat.name = unpainted ? '기본 면' : `SketchUp 재질 ${i + 1}`;
    if (map) {
      mat.map = map; // 텍스처는 색을 곱하지 않음 (SketchUp 재질 색 = 텍스처 평균 색이라 곱하면 어두워짐)
    } else if (unpainted) {
      mat.color.setHex(DEFAULT_FACE_COLOR);
    } else {
      mat.color.setRGB(r, g, b, THREE.SRGBColorSpace); // SketchUp 색은 sRGB 값
    }
    if (a < 1) {
      mat.transparent = true;
      mat.opacity = a;
      mat.depthWrite = false;
    }
    return mat;
  });
}

async function loadTexture({ data, mimeType }) {
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // SketchUp 텍스처는 바둑판처럼 반복
    tex.anisotropy = 4;
    return tex;
  } catch {
    return null; // 그림을 못 읽으면 단색으로
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 메시 자원(재질별로 나뉜 조각들) → 모양 하나 + 재질 목록 */
function buildGeometry(res, materials) {
  const prims = res.primitives.filter((p) => p.indices.length > 0);
  if (!prims.length) return null;
  if (prims.length === 1) {
    const p = prims[0];
    return { geometry: makeGeometry([p]), material: materials[p.materialIndex] };
  }
  const geometry = makeGeometry(prims);
  return { geometry, material: prims.map((p) => materials[p.materialIndex]) };
}

function makeGeometry(prims) {
  let vertCount = 0;
  let indexCount = 0;
  for (const p of prims) {
    vertCount += p.positions.length / 3;
    indexCount += p.indices.length;
  }
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = vertCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const geometry = new THREE.BufferGeometry();
  let v = 0;
  let k = 0;
  prims.forEach((p, i) => {
    positions.set(p.positions, v * 3);
    normals.set(p.normals, v * 3);
    uvs.set(p.uvs, v * 2);
    for (let j = 0; j < p.indices.length; j++) indices[k + j] = p.indices[j] + v;
    if (prims.length > 1) geometry.addGroup(k, p.indices.length, i);
    v += p.positions.length / 3;
    k += p.indices.length;
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
