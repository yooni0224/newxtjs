// SketchUp(.skp) 파일 읽기 — 화면이 멈추지 않게 따로 도는 작업자(Web Worker)에서.
// 읽기는 openskp (MIT, https://github.com/iamahsanmehmood/openskp) 가 함: SketchUp 2013 ~ 최신 파일,
// 그룹·컴포넌트 구조, 태그(레이어), 재질·텍스처. 결과는 src/models/skpLoader.js 가 3D 객체로 만듦.
import { buildInstancedScene } from 'openskp';

self.onmessage = (event) => {
  const { id, buffer } = event.data;
  try {
    // respectEdgeVisibility: SketchUp 에서 '숨김' 처리한 면은 빼기 (SketchUp 화면과 같게)
    const scene = buildInstancedScene(buffer, { respectEdgeVisibility: true });
    const transfer = new Set();
    for (const res of scene.meshResources) {
      for (const p of res.primitives) {
        for (const arr of [p.positions, p.normals, p.uvs, p.indices]) transfer.add(arr.buffer);
      }
    }
    // 텍스처 그림은 원본 파일 버퍼의 일부일 수 있어서 따로 복사해서 보냄
    const textures = scene.textures.map((t) => {
      const data = t.data.slice();
      transfer.add(data.buffer);
      return { data, mimeType: t.mimeType };
    });
    self.postMessage(
      {
        id,
        result: {
          hierarchy: scene.sceneHierarchy,
          meshResources: scene.meshResources,
          materials: scene.gltfMaterials,
          textures,
          layerHidden: scene.layerHidden || {},
          layerColors: scene.layerColors || {},
        },
      },
      [...transfer],
    );
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
