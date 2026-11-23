// 어떤 동작의 어느 순간을 포즈 프리셋으로 뽑을지.
//   clip: 동작 이름, at: 동작 길이 중 어디(0 = 처음, 0.5 = 가운데, 1 = 끝), src: 'ual1' | 'ual2'
//   hands: 이 포즈의 손 모양 (src/people/hands.js 의 HAND_SHAPES 이름)
// 분류(category)는 '사람' 칸에서 묶어 보여 주는 이름.
export const POSES = [
  // 서기
  { id: 'stand', name: '서기', category: '서기', src: 'ual1', clip: 'Idle_Loop', at: 0 },
  { id: 'talk', name: '대화', category: '서기', src: 'ual1', clip: 'Idle_Talking_Loop', at: 0.35 },
  { id: 'armsCrossed', name: '팔짱', category: '서기', src: 'ual2', clip: 'Idle_FoldArms_Loop', at: 0 },
  { id: 'phone', name: '전화', category: '서기', src: 'ual2', clip: 'Idle_TalkingPhone_Loop', at: 0.3 },
  { id: 'lean', name: '난간에 기대기', category: '서기', src: 'ual2', clip: 'Idle_Rail_Loop', at: 0 },
  { id: 'holdLantern', name: '등 들기', category: '서기', src: 'ual2', clip: 'Idle_Lantern_Loop', at: 0, hands: { L: 'relaxed', R: 'grip' } },
  { id: 'nod', name: '끄덕이기', category: '서기', src: 'ual2', clip: 'Yes', at: 0.45 },
  { id: 'shakeHead', name: '고개 젓기', category: '서기', src: 'ual2', clip: 'Idle_No_Loop', at: 0.3 },
  // 이동
  { id: 'walk', name: '걷기', category: '이동', src: 'ual1', clip: 'Walk_Loop', at: 0 },
  { id: 'walkFormal', name: '정장 걸음', category: '이동', src: 'ual1', clip: 'Walk_Formal_Loop', at: 0 },
  { id: 'jog', name: '조깅', category: '이동', src: 'ual1', clip: 'Jog_Fwd_Loop', at: 0.25, hands: { L: 'fist', R: 'fist' } },
  { id: 'run', name: '달리기', category: '이동', src: 'ual1', clip: 'Sprint_Loop', at: 0.25, hands: { L: 'fist', R: 'fist' } },
  { id: 'carry', name: '들고 걷기', category: '이동', src: 'ual2', clip: 'Walk_Carry_Loop', at: 0.25, hands: { L: 'grip', R: 'grip' } },
  { id: 'sneak', name: '살금살금', category: '이동', src: 'ual1', clip: 'Crouch_Fwd_Loop', at: 0.25 },
  { id: 'jump', name: '점프', category: '이동', src: 'ual1', clip: 'Jump_Loop', at: 0.5 },
  { id: 'push', name: '밀기', category: '이동', src: 'ual1', clip: 'Push_Loop', at: 0.25, hands: { L: 'open', R: 'open' } },
  // 앉기·눕기
  { id: 'sitChair', name: '의자에 앉기', category: '앉기·눕기', src: 'ual1', clip: 'Sitting_Idle_Loop', at: 0 },
  { id: 'sitTalk', name: '앉아서 대화', category: '앉기·눕기', src: 'ual1', clip: 'Sitting_Talking_Loop', at: 0.35 },
  { id: 'drive', name: '운전', category: '앉기·눕기', src: 'ual1', clip: 'Driving_Loop', at: 0, hands: { L: 'grip', R: 'grip' } },
  { id: 'crouch', name: '쪼그려 앉기', category: '앉기·눕기', src: 'ual1', clip: 'Crouch_Idle_Loop', at: 0 },
  { id: 'kneel', name: '무릎 꿇기', category: '앉기·눕기', src: 'ual1', clip: 'Fixing_Kneeling', at: 0.3 },
  { id: 'lieDown', name: '눕기', category: '앉기·눕기', src: 'ual2', clip: 'LayToIdle', at: 0 },
  { id: 'fallen', name: '쓰러짐', category: '앉기·눕기', src: 'ual1', clip: 'Death01', at: 1 },
  // 동작
  { id: 'reach', name: '손 뻗기', category: '동작', src: 'ual1', clip: 'Interact', at: 0.45, hands: { L: 'relaxed', R: 'open' } },
  { id: 'pickUp', name: '줍기', category: '동작', src: 'ual1', clip: 'PickUp_Table', at: 0.45 },
  { id: 'drink', name: '마시기', category: '동작', src: 'ual2', clip: 'Consume', at: 0.5, hands: { L: 'relaxed', R: 'grip' } },
  { id: 'water', name: '물 주기', category: '동작', src: 'ual2', clip: 'Farm_Watering', at: 0.5, hands: { L: 'relaxed', R: 'grip' } },
  { id: 'throw', name: '던지기', category: '동작', src: 'ual2', clip: 'OverhandThrow', at: 0.35, hands: { L: 'open', R: 'grip' } },
  { id: 'punch', name: '펀치', category: '동작', src: 'ual1', clip: 'Punch_Jab', at: 0.3, hands: { L: 'fist', R: 'fist' } },
  { id: 'sword', name: '칼 들기', category: '동작', src: 'ual1', clip: 'Sword_Idle', at: 0, hands: { L: 'relaxed', R: 'grip' } },
  { id: 'aim', name: '총 겨누기', category: '동작', src: 'ual1', clip: 'Pistol_Aim_Neutral', at: 0, hands: { L: 'grip', R: 'grip' } },
  { id: 'dance', name: '춤', category: '동작', src: 'ual1', clip: 'Dance_Loop', at: 0.2 },
];

// 손가락 마디가 굽는 축을 뽑을 동작 (이 동작 모음은 모든 동작에서 손 모양이 같아서, 굽는 '축'만 쓰고
// 얼마나 굽힐지는 src/people/hands.js 의 손 모양마다 따로 정함)
export const FINGER_SOURCE = { src: 'ual1', clip: 'Idle_Loop', at: 0 };
