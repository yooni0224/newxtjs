// 기능(파일)끼리 주고받는 신호를 모아 둔 곳.
// 사용법: on('이름', 함수) 로 듣고, emit('이름', 값) 으로 알린다.
//
// 지금 쓰는 신호 목록
//   'selection-changed'        선택된 물체가 바뀜        값: 물체 또는 null
//   'object-transformed'       선택한 물체가 움직임/회전/크기 변경  값: { object, final }
//                              (final=true 이면 드래그가 끝난 시점)
//   'models-changed'           모델이 추가되거나 삭제됨  값: 없음
//   'gizmo-mode-changed'       핸들 모드가 바뀜          값: 'translate' | 'rotate' | 'scale'
//   'human-visibility-changed' 사람 모형 켜짐/꺼짐        값: true | false

const bus = new EventTarget();

export function on(name, fn) {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(name, handler);
  return () => bus.removeEventListener(name, handler);
}

export function emit(name, value) {
  bus.dispatchEvent(new CustomEvent(name, { detail: value }));
}
