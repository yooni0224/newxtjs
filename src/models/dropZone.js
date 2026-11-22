// 파일을 끌어다 놓기(드래그 앤 드롭) + '모델 불러오기' 버튼.
// 받은 파일들을 { file, path } 목록으로 만들어 onFiles(목록, 놓은 화면 위치) 로 넘긴다.

/**
 * @param {HTMLElement} target  파일을 놓을 영역
 * @param {(entries: {file: File, path: string}[], point: {x:number,y:number}|null) => void} onFiles
 */
export function setupFileInput(target, onFiles) {
  const overlay = document.getElementById('drop-overlay');
  const input = document.getElementById('file-input');
  let dragDepth = 0;

  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

  target.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('show');
  });
  target.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  target.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.classList.remove('show');
  });
  target.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('show');
    const entries = await readDropped(e.dataTransfer);
    if (entries.length) onFiles(entries, { x: e.clientX, y: e.clientY });
  });

  // 패널 등 다른 곳에 떨어뜨려도 브라우저가 파일을 열어 버리지 않게
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  document.getElementById('btn-open').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const entries = [...input.files].map((file) => ({ file, path: file.name }));
    input.value = ''; // 같은 파일을 다시 고를 수 있게
    if (entries.length) onFiles(entries, null);
  });
}

/** 놓은 항목 읽기. 폴더를 놓으면 안의 파일까지 모두 읽는다 */
async function readDropped(dataTransfer) {
  // webkitGetAsEntry 는 drop 이벤트 안에서 바로 불러야 함 (await 전에)
  const items = [...(dataTransfer.items || [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.());

  if (!items.length || items.some((x) => !x)) {
    return [...dataTransfer.files].map((file) => ({ file, path: file.name }));
  }

  const out = [];
  for (const entry of items) await walk(entry, '', out);
  return out;
}

async function walk(entry, parent, out) {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, path });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries 는 한 번에 일부만 주므로 빈 목록이 올 때까지 반복
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, path, out);
    }
  }
}
