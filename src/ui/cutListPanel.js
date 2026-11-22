// '컷 목록' 칸: 지금 시점을 컷으로 저장, 목록 클릭 → 그 시점으로, ⟳ 지금 상태로 바꾸기, ✎ 이름, ✕ 지우기.
// 컷 저장·적용은 src/save/cuts.js
import { on } from '../core/events.js';

export function setupCutListPanel({ cuts }) {
  const list = document.getElementById('cut-list');
  let editingId = null; // 이름 고치는 중인 컷

  document.getElementById('btn-cut-add').addEventListener('click', (e) => {
    e.currentTarget.blur();
    cuts.add();
  });

  function render() {
    const activeId = cuts.getActiveId();
    const frag = document.createDocumentFragment();
    for (const cut of cuts.list()) {
      const li = document.createElement('li');
      li.className = 'cut-item';
      li.classList.toggle('active', cut.id === activeId);
      li.title = '누르면 이 컷의 시점으로';

      const main = document.createElement('div');
      main.className = 'cut-main';
      if (cut.id === editingId) {
        main.append(renameInput(cut));
      } else {
        const name = document.createElement('div');
        name.className = 'cut-name';
        name.textContent = cut.name;
        name.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startRename(cut.id);
        });
        const info = document.createElement('div');
        info.className = 'cut-info';
        info.textContent = describe(cut);
        main.append(name, info);
      }
      li.addEventListener('click', () => {
        if (editingId !== cut.id) cuts.goTo(cut.id);
      });

      li.append(
        main,
        button('⟳', '지금 시점·화각·컷 비율·해 방향으로 바꾸기', () => cuts.update(cut.id)),
        button('✎', '이름 바꾸기', () => startRename(cut.id)),
        button('✕', '이 컷 지우기', () => {
          if (confirm(`'${cut.name}' 컷을 지울까요?`)) cuts.remove(cut.id);
        }),
      );
      frag.append(li);
    }
    list.replaceChildren(frag);
    list.querySelector('input')?.focus();
  }

  function startRename(id) {
    editingId = id;
    render();
  }

  function renameInput(cut) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = cut.name;
    input.maxLength = 40;
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      editingId = null;
      if (commit) cuts.rename(cut.id, input.value);
      render();
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    setTimeout(() => input.select(), 0);
    return input;
  }

  on('cuts-changed', render);
  render();
}

function button(text, title, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', (e) => {
    e.stopPropagation(); // 줄 클릭(시점 이동)으로 넘어가지 않게
    e.currentTarget.blur();
    onClick();
  });
  return b;
}

/** 컷 한 줄 설명: 시점 종류 · 화각 · 비율 · 해 방향 */
function describe(cut) {
  const v = cut.view;
  const where = v.mode === 'walk' ? `1인칭 눈 ${v.eyeHeight.toFixed(2)}m` : '편집 시점';
  const ratio = cut.frame.enabled ? `${cut.frame.ratioW}:${cut.frame.ratioH}` : '화면 전체';
  return `${where} · ${Math.round(cut.focal)}mm · ${ratio} · 해 ${Math.round(cut.sun.azimuth)}°/${Math.round(cut.sun.elevation)}°`;
}
