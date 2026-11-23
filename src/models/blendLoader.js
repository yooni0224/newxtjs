// BLEND(Blender) 파일 → GLB. 브라우저는 .blend 를 직접 못 읽어서, 이 툴을 켠 개발 서버(npm run dev)가
// 이 컴퓨터의 Blender 로 바꿔 준다 (server/blendConvert.js, server/blend_to_glb.py).
// - .blend 와 같이 넣은 텍스처(폴더째 넣었을 때)도 함께 보냄 → Blender 가 빠진 텍스처를 그 안에서 찾음
// - Blender 를 못 찾으면 위치를 한 번 물어보고 서버에 저장 (.blender-path)
// - 받은 GLB 는 loadFiles.js 가 GLB 처럼 읽고, 여기 tidyBlendScene 으로 정리:
//   원래 이름 되살리기, Blender 에서 숨긴 것 숨기기, 컬렉션을 앞으로, 재질별 조각을 물체 하나로 합치기
import * as THREE from 'three';
import { zipSync } from 'three/addons/libs/fflate.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toast } from '../ui/toast.js';

const API = `${import.meta.env.BASE_URL}api/blend/`;
/** .blend 와 같이 보낼 파일 (텍스처, 연결된 다른 .blend) */
const RELATED = /\.(blend|png|jpe?g|tga|tiff?|bmp|exr|hdr|webp|dds)$/i;

let askedPath = false; // 위치를 물어봤는데 취소했으면 이번 창에서는 다시 안 물어봄

/**
 * @param entry  { file, path } — .blend 파일
 * @param files  같이 불러온 파일 전체 (텍스처를 고르기 위해)
 * @returns {Promise<ArrayBuffer>} GLB
 */
export async function convertBlend(entry, files) {
  const pack = {};
  for (const e of files) {
    if (e === entry || RELATED.test(e.path)) pack[e.path] = new Uint8Array(await e.file.arrayBuffer());
  }
  const body = zipSync(pack, { level: 0 });

  const note = toast(`${entry.file.name}: Blender 로 바꾸는 중… (처음엔 몇 초~몇십 초)`, 'info', 600000);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await request(`convert?main=${encodeURIComponent(entry.path)}`, { method: 'POST', body });
      if (res.ok) return await res.arrayBuffer();
      const info = await res.json().catch(() => ({}));
      if (info.code === 'NO_BLENDER' && attempt === 0 && (await askBlenderPath())) continue;
      if (info.code === 'NO_BLENDER') {
        throw new Error(
          'BLEND 파일을 열려면 이 컴퓨터에 Blender 가 있어야 해요. blender.org 에서 무료로 설치한 뒤 다시 열어 주세요.',
        );
      }
      throw new Error(info.error || `변환 실패 (${res.status})`);
    }
    throw new Error('Blender 를 찾지 못했어요.');
  } finally {
    note.remove();
  }
}

async function request(path, init = {}) {
  let res;
  try {
    res = await fetch(API + path, { ...init, headers: { 'X-Webtoon': '1', ...(init.headers || {}) } });
  } catch {
    res = null;
  }
  // 서버 기능이 없는 곳(완성본을 웹에 올린 경우 등): 주소가 없거나 HTML 이 옴
  if (!res || res.status === 404 || (res.headers.get('content-type') || '').includes('text/html')) {
    throw new Error('BLEND 파일은 이 툴을 내 컴퓨터에서 켰을 때(start 파일 / npm run dev)만 열 수 있어요.');
  }
  return res;
}

/** Blender 위치를 물어서 서버에 저장. 저장됐으면 true */
async function askBlenderPath() {
  if (askedPath) return false;
  let message =
    'Blender 를 찾지 못했어요.\n' +
    '설치돼 있으면 Blender 프로그램 위치를 붙여 넣어 주세요.\n' +
    '  윈도우 예: C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe\n' +
    '  맥 예: /Applications/Blender.app\n' +
    '설치돼 있지 않으면 취소 → blender.org 에서 무료로 설치한 뒤 다시 여세요.';
  for (;;) {
    const given = window.prompt(message, '');
    if (!given) {
      askedPath = true;
      return false;
    }
    const res = await request('path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: given }),
    });
    const info = await res.json().catch(() => ({}));
    if (res.ok) {
      toast(`Blender ${info.version} 을(를) 찾았어요. 다음부터는 바로 열려요.`);
      return true;
    }
    message = `${info.error || '그 위치로는 Blender 를 실행하지 못했어요.'}\n다시 입력하거나 취소하세요.`;
  }
}

/**
 * Blender 에서 바꾼 GLB 를 읽은 뒤 정리
 * @param scene   GLTFLoader 결과 장면
 * @param parser  GLTFLoader 의 parser (어떤 메시가 '재질별 조각'인지 알아내기 위해)
 */
export function tidyBlendScene(scene, parser) {
  // 1) 재질별 조각(같은 물체의 메시들)을 물체 하나로: Blender 물체 하나 = 메시 하나 (레이어 패널이 아웃라이너처럼)
  //    GLTFLoader 는 재질이 여럿인 메시를 '그룹(meshes 번호) + 조각 메시들(meshes·primitives 번호)' 로 만듦
  const groups = [];
  scene.traverse((o) => {
    const a = parser.associations.get(o);
    if (!o.isMesh && a && a.meshes !== undefined && a.primitives === undefined) groups.push(o);
  });
  const mergedByMesh = new Map(); // 같은 메시를 여러 곳에 놓았으면(컬렉션 인스턴스) 합친 모양도 같이 씀
  for (const group of groups) mergePrimitives(group, parser, mergedByMesh);

  scene.traverse((o) => {
    const data = o.userData;
    // 2) 이름: GLTFLoader 는 띄어쓰기를 '_' 로 바꿈 → 원래 이름으로. 컬렉션은 Blender 가 붙인 '.001' 없는 이름으로
    if (data.webtoon_name) o.name = data.webtoon_name;
    else if (data.name) o.name = data.name;
    // 3) Blender 에서 숨긴 것
    if (data.webtoon_hidden) o.visible = false;
    if (data.webtoon_name) data.blendCollection = true;
    delete data.webtoon_name;
    delete data.webtoon_hidden;
  });

  // 4) 컬렉션을 물체보다 앞에 (Blender 아웃라이너 순서)
  scene.traverse((o) => {
    if (o.children.length < 2) return;
    const cols = o.children.filter((c) => c.userData.blendCollection);
    if (!cols.length) return;
    const rest = o.children.filter((c) => !c.userData.blendCollection);
    o.children.splice(0, o.children.length, ...cols, ...rest);
  });
}

/** 노드 그룹 안의 '재질별 조각' 메시들 → 메시 하나(재질 배열). 조각이 아닌 자식(다른 물체)은 그대로 */
function mergePrimitives(group, parser, mergedByMesh) {
  const meshIndex = parser.associations.get(group).meshes;
  const parts = group.children.filter((c) => {
    const a = c.isMesh ? parser.associations.get(c) : null;
    return a && a.primitives !== undefined && a.meshes === meshIndex;
  });
  if (parts.length < 2 || parts.some((p) => p.children.length || p.isSkinnedMesh)) return;
  let merged = mergedByMesh.get(meshIndex);
  if (!merged) {
    const geos = parts.map((p) => p.geometry);
    const names = Object.keys(geos[0].attributes).sort().join();
    if (geos.some((g) => Object.keys(g.attributes).sort().join() !== names || !g.index)) return; // 모양 정보가 서로 다르면 그대로 둠
    merged = mergeGeometries(geos, true);
    if (!merged) return;
    mergedByMesh.set(meshIndex, merged);
  }
  const mesh = new THREE.Mesh(merged, parts.map((p) => p.material));
  mesh.name = group.name;
  mesh.userData = { ...group.userData };
  mesh.position.copy(group.position);
  mesh.quaternion.copy(group.quaternion);
  mesh.scale.copy(group.scale);
  mesh.visible = group.visible;
  const others = group.children.filter((c) => !parts.includes(c));
  for (const c of others) mesh.add(c);
  const parent = group.parent;
  parent.children.splice(parent.children.indexOf(group), 1, mesh);
  mesh.parent = parent;
  group.parent = null;
}
