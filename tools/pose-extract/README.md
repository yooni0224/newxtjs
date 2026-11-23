# 포즈 뽑기 도구

사람 모형의 포즈 프리셋·손가락 모양(`src/people/poseLibrary.js`)을 실제 동작 데이터에서 뽑는 도구.

1. 동작 모음(CC0)을 내려받아 `source/` 에 넣기 (이 폴더는 저장소에 올리지 않음)
   - Universal Animation Library: https://opengameart.org/content/universal-animation-library
     → `Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb` 를 `source/ual1.glb` 로
   - Universal Animation Library 2: https://opengameart.org/content/universal-animation-library-2
     → `Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb` 를 `source/ual2.glb` 로
2. `npm run dev` 후 http://localhost:5173/tools/pose-extract/ 열기
3. 화면에 나온 글을 `src/people/poseLibrary.js` 에 통째로 붙여 넣기

어떤 동작의 어느 순간을 쓸지, 이름·분류·손 모양은 `spec.js` 에서 고침.
원리는 `extract.js` 맨 위 설명 참고 (같은 마네킹이라 T자 자세 대비 뼈 회전 차이를 그대로 관절 각도로 옮김).
