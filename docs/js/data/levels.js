// 레벨/밸런스 데이터 (game-designer 소유). 스키마: design/CONTRACT.md §4 · 설계 근거와 구현 메모: design/GDD.md
// 좌표: 플레이어는 +Z 쪽 옥상에서 −Z를 본다. heading 0 = +Z = 플레이어 쪽을 봄, PI = 등을 보임, H = +X(화면 오른쪽)를 봄, -H = 왼쪽.
// 경로(GDD §9): pos에서 출발해 path[0], path[1] … 순서로 이동하고 경유지마다 wait초 대기(walk·toVehicle의 마지막 점은 대기 없음).
//   patrol은 pos = path[0]이고 끝에 닿으면 역순으로 왕복한다. escort의 offset은 대상 로컬 [x, z]를 heading으로 회전한 값(GDD §9).
// extras 치수(로컬 X×높이×Z, rot = rotation.y): container 12.2×2.6×2.44, stall 3×1.1×1.6, awning 4×(2.6~2.75)×3, wall 8×2.2×0.4,
//   car 1.9×1.45×4.6, crate 1.2³, lamp 0.3×6, tree 반경2×6. 충돌체 없음: awning·lamp·tree. rot은 0 또는 H만 사용(AABB 일치).
const PI = Math.PI, H = Math.PI / 2;

export const BALANCE = {
  hipFov: 50, muzzle: 850, boltTime: 1.0, reloadTime: 2.2, magSize: 5,
  swayAmp: 0.0035, swayFreq: [0.23, 0.31], breathMax: 3.0, breathRecover: 2.5, breathMul: 0.12,
  exhaleMul: 2.0, exhaleTime: 1.2, recoilKick: 0.03, recoilReturn: 6, hipSpread: 0.02, aimSens: 1.0,
  leadTol: 0.06, // 이동 표적 허용 오차(초): 판정을 진행 방향 앞뒤로 '속도 × leadTol'만큼 늘림(4.5m/s 도주 → ±0.27m). GDD §3.4
  score: { kill: 1000, head: 500, perMeter: 1, guard: 200, civilian: -1500, timePerSec: 10, accuracy: 1000 },
};

// 난이도(설정·브리핑에서 선택, 기본 normal). 값은 모두 위 BALANCE·레벨 값에 곱하는 배수다(GDD §11).
//   sway = swayAmp(흔들림), breath = breathMax(숨 참기 최대 시간), react = 경계 → 도주 반응 시간,
//   time = timeLimit(제한 시간), score = 클리어 최종 점수, lead = leadTol(이동 표적 허용 오차). 별 기준(stars)은 난이도와 무관하게 같다.
// normal은 v1.0 대비 흔들림만 20% 줄였고 나머지는 같다 → GDD §4 별 기준 계산이 그대로 유효하다.
export const DIFFICULTY = {
  easy: { label: '쉬움', sway: 0.55, breath: 1.5, react: 1.6, time: 1.25, score: 0.8, lead: 1.4 },
  normal: { label: '보통', sway: 0.8, breath: 1, react: 1, time: 1, score: 1, lead: 1 },
  hard: { label: '어려움', sway: 1, breath: 0.8, react: 0.65, time: 0.85, score: 1.2, lead: 0.35 },
};

// ─────────────────────────────── 1. 도심 (튜토리얼) ───────────────────────────────
const L1 = {
  id: 1, theme: 'downtown', name: '첫 임무', subtitle: '도심 · 고정 표적',
  briefing: '도심 사거리에 조직원 두 명이 나와 있습니다. 둘 다 검은 정장 차림이고 한자리에 서 있습니다. 민간인을 쏘면 감점이니 표적만 노리세요.',
  targetDesc: '검은 정장의 남자 2명',
  hints: [
    '화면을 드래그해 조준하세요',
    'SCOPE 버튼으로 스코프를 여세요',
    'ZOOM을 눌러 14배로 확대하세요',
    'BREATH를 누르고 있으면 흔들림이 줄어요',
    '숨을 참은 채 머리를 겨누고 FIRE!',
    '쏜 뒤 약 1초는 볼트를 당기느라 쏠 수 없어요',
  ],
  env: {
    sky: [0x4a90e2, 0xbfe3ff], fog: { color: 0xbfe3ff, near: 180, far: 620 },
    sun: { color: 0xffffff, intensity: 1.6, dir: [0.4, 1, 0.3] },
    hemi: { sky: 0xdfefff, ground: 0x556655, intensity: 1.1 },
  },
  nightVision: false,
  player: { pos: [0, 25, 20], yaw: 0, pitch: -0.2, yawLimit: [-0.72, 0.72], pitchLimit: [-0.42, 0.12] },
  weapon: { scopeFovs: [8, 3.5], zoomLabels: ['6x', '14x'], reserve: 10 },
  ballistics: { gravity: 0, wind: { speed: 0, dir: 0 }, windFactor: 0.9 },
  timeLimit: 180,
  objective: { ids: ['t1', 't2'] },
  rules: { civilianFail: false, alertRadius: 6, witnessRadius: 20 },
  stars: [0, 3500, 5200],
  exits: [[-75, -100], [80, -95]],
  world: {
    seed: 1101, density: 0.7,
    extras: [
      { type: 'car', x: -8, z: -70, rot: 0, color: 0xe53935 }, { type: 'car', x: 22, z: -104, rot: 0, color: 0x1e88e5 },
      { type: 'tree', x: -30, z: -64, rot: 0, color: 0x43a047 }, { type: 'tree', x: 42, z: -88, rot: 0, color: 0x43a047 },
      { type: 'lamp', x: -12, z: -62, rot: 0, color: 0x37474f }, { type: 'lamp', x: 26, z: -62, rot: 0, color: 0x37474f },
    ],
  },
  actors: [
    { id: 't1', role: 'target', look: 'suit_black', pos: [-18, -75], heading: 0, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 't2', role: 'target', look: 'suit_black', pos: [32, -118], heading: -H, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c1', role: 'civilian', look: 'civ_a', pos: [-6, -84], heading: -H, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c2', role: 'civilian', look: 'civ_b', pos: [12, -95], heading: PI, behavior: 'patrol', path: [[12, -95], [12, -125]], speed: 1.1, wait: 3 },
    { id: 'c3', role: 'civilian', look: 'civ_d', pos: [-45, -120], heading: PI, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
  ],
  vehicles: [],
};

// ─────────────────────────────── 2. 노을 항구 (순찰 표적) ───────────────────────────────
const L2 = {
  id: 2, theme: 'harbor', name: '노을 부두', subtitle: '항구 · 순찰 표적',
  briefing: '해 질 녘 컨테이너 야적장에서 밀수 조직원 두 명이 순찰 중입니다. 컨테이너 뒤로 숨는 구간을 피해 멈춰 설 때를 노리세요. 주황 조끼에 노란 안전모를 쓴 사람은 작업자입니다.',
  targetDesc: '검은 정장의 남자 2명',
  hints: [],
  env: {
    sky: [0x3d4a8a, 0xff9e5e], fog: { color: 0xf2a875, near: 210, far: 660 },
    sun: { color: 0xffb36b, intensity: 1.35, dir: [-0.85, 0.35, 0.3] },
    hemi: { sky: 0xffc8a0, ground: 0x4a3a50, intensity: 1.0 },
  },
  nightVision: false,
  player: { pos: [0, 22, 20], yaw: 0, pitch: -0.1, yawLimit: [-0.65, 0.65], pitchLimit: [-0.35, 0.12] },
  weapon: { scopeFovs: [8, 3.5], zoomLabels: ['6x', '14x'], reserve: 10 },
  ballistics: { gravity: 0, wind: { speed: 0, dir: 0 }, windFactor: 0.9 },
  timeLimit: 150,
  objective: { ids: ['t1', 't2'] },
  rules: { civilianFail: false, alertRadius: 10, witnessRadius: 25 },
  stars: [0, 3350, 5000],
  exits: [[-110, -172], [115, -168]],
  world: {
    seed: 2203, density: 0.5,
    extras: [
      { type: 'container', x: -8, z: -143.5, rot: 0, color: 0xd84315 }, { type: 'container', x: 15, z: -143.5, rot: 0, color: 0x1e88e5 },
      { type: 'container', x: 27, z: -205.5, rot: 0, color: 0x43a047 }, { type: 'container', x: 52, z: -196, rot: H, color: 0xfdd835 },
      { type: 'container', x: -66, z: -185, rot: H, color: 0x8e24aa }, { type: 'container', x: -20, z: -232, rot: 0, color: 0x00897b },
      { type: 'container', x: 96, z: -146, rot: H, color: 0xd84315 }, { type: 'crate', x: -32, z: -147, rot: 0, color: 0x8d6e63 },
      { type: 'crate', x: 62, z: -175, rot: 0, color: 0x8d6e63 }, { type: 'lamp', x: -48, z: -140, rot: 0, color: 0x37474f },
    ],
  },
  actors: [
    { id: 't1', role: 'target', look: 'suit_black', pos: [-40, -150], heading: H, behavior: 'patrol', path: [[-40, -150], [25, -150]], speed: 1.3, wait: 3 },
    { id: 't2', role: 'target', look: 'suit_black', pos: [45, -180], heading: PI, behavior: 'patrol', path: [[45, -180], [45, -212], [8, -212]], speed: 1.2, wait: 3 },
    { id: 'c1', role: 'civilian', look: 'worker', pos: [-55, -160], heading: H, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c2', role: 'civilian', look: 'worker', pos: [-55, -190], heading: PI, behavior: 'patrol', path: [[-55, -190], [-55, -215]], speed: 1.0, wait: 4 },
    { id: 'c3', role: 'civilian', look: 'worker', pos: [22, -185], heading: 0, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c4', role: 'civilian', look: 'worker', pos: [88, -162], heading: PI, behavior: 'patrol', path: [[88, -162], [72, -186]], speed: 1.1, wait: 3 },
  ],
  vehicles: [],
};

// ─────────────────────────────── 3. 시장 (인상착의 식별) ───────────────────────────────
const L3 = {
  id: 3, theme: 'market', name: '빨간 모자', subtitle: '시장 · 인상착의 식별',
  briefing: '붐비는 시장 인파 속에 표적 두 명이 섞여 있습니다. 빨간 모자에 갈색 재킷이 표적입니다. 이번 작전부터는 민간인을 한 명이라도 쏘면 즉시 실패합니다.',
  targetDesc: '빨간 모자 + 갈색 재킷 2명',
  hints: [],
  env: {
    sky: [0x5aa0e6, 0xfff1d6], fog: { color: 0xf6e7cc, near: 180, far: 580 },
    sun: { color: 0xfff4e0, intensity: 1.5, dir: [-0.35, 1, 0.5] },
    hemi: { sky: 0xfff1dd, ground: 0x7a6650, intensity: 1.05 },
  },
  nightVision: false,
  player: { pos: [0, 18, 20], yaw: 0, pitch: -0.11, yawLimit: [-0.62, 0.62], pitchLimit: [-0.35, 0.12] },
  weapon: { scopeFovs: [8, 3.5], zoomLabels: ['6x', '14x'], reserve: 10 },
  ballistics: { gravity: 0, wind: { speed: 0, dir: 0 }, windFactor: 0.9 },
  timeLimit: 150,
  objective: { ids: ['t1', 't2'] },
  rules: { civilianFail: true, alertRadius: 12, witnessRadius: 25 },
  stars: [0, 3350, 4900],
  exits: [[-80, -125], [85, -130]],
  world: {
    seed: 3307, density: 0.6,
    extras: [ // 앞줄(z −122)과 뒷줄(z −160) 노점 + 차양. 통로는 z −141
      { type: 'stall', x: -32, z: -122, rot: 0, color: 0xe53935 }, { type: 'awning', x: -32, z: -122, rot: 0, color: 0xff7043 },
      { type: 'stall', x: -22, z: -122, rot: 0, color: 0xfdd835 }, { type: 'awning', x: -22, z: -122, rot: 0, color: 0x26a69a },
      { type: 'stall', x: -12, z: -122, rot: 0, color: 0x1e88e5 }, { type: 'awning', x: -12, z: -122, rot: 0, color: 0xffca28 },
      { type: 'stall', x: 12, z: -122, rot: 0, color: 0x8e24aa }, { type: 'awning', x: 12, z: -122, rot: 0, color: 0x66bb6a },
      { type: 'stall', x: 22, z: -122, rot: 0, color: 0xfb8c00 }, { type: 'awning', x: 22, z: -122, rot: 0, color: 0x42a5f5 },
      { type: 'stall', x: 32, z: -122, rot: 0, color: 0x43a047 }, { type: 'awning', x: 32, z: -122, rot: 0, color: 0xec407a },
      { type: 'stall', x: -28, z: -160, rot: 0, color: 0x00897b }, { type: 'awning', x: -28, z: -160, rot: 0, color: 0xffa726 },
      { type: 'stall', x: -18, z: -160, rot: 0, color: 0xd81b60 }, { type: 'awning', x: -18, z: -160, rot: 0, color: 0x29b6f6 },
      { type: 'stall', x: -8, z: -160, rot: 0, color: 0x6d4c41 }, { type: 'awning', x: -8, z: -160, rot: 0, color: 0xd4e157 },
      { type: 'stall', x: 8, z: -160, rot: 0, color: 0x3949ab }, { type: 'awning', x: 8, z: -160, rot: 0, color: 0xef5350 },
      { type: 'stall', x: 18, z: -160, rot: 0, color: 0xc0ca33 }, { type: 'awning', x: 18, z: -160, rot: 0, color: 0xab47bc },
      { type: 'stall', x: 28, z: -160, rot: 0, color: 0xf4511e }, { type: 'awning', x: 28, z: -160, rot: 0, color: 0x26c6da },
      { type: 'crate', x: -40, z: -128, rot: 0, color: 0x8d6e63 }, { type: 'crate', x: 40, z: -152, rot: 0, color: 0x8d6e63 },
    ],
  },
  actors: [
    { id: 't1', role: 'target', look: 'red_cap', pos: [-24, -141], heading: H, behavior: 'patrol', path: [[-24, -141], [14, -141]], speed: 1.1, wait: 4 },
    { id: 't2', role: 'target', look: 'red_cap', pos: [34, -171], heading: H, behavior: 'patrol', path: [[34, -171], [45, -171]], speed: 0.9, wait: 5 },
    { id: 'c1', role: 'civilian', look: 'civ_a', pos: [30, -138], heading: -H, behavior: 'patrol', path: [[30, -138], [-40, -138]], speed: 1.2, wait: 2 },
    { id: 'c2', role: 'civilian', look: 'civ_b', pos: [-4, -127], heading: PI, behavior: 'patrol', path: [[-4, -127], [-4, -156]], speed: 1.0, wait: 3 },
    { id: 'c3', role: 'civilian', look: 'civ_c', pos: [-12, -124.5], heading: 0, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c4', role: 'civilian', look: 'civ_d', pos: [-45, -118], heading: PI, behavior: 'patrol', path: [[-45, -118], [-45, -165]], speed: 1.2, wait: 2 },
    { id: 'c5', role: 'civilian', look: 'civ_a', pos: [24, -165], heading: H, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c6', role: 'civilian', look: 'civ_c', pos: [15, -105], heading: PI, behavior: 'walk', path: [[4, -131]], speed: 1.0, wait: 0 },
    { id: 'c7', role: 'civilian', look: 'civ_b', pos: [52, -128], heading: PI, behavior: 'patrol', path: [[52, -128], [52, -160]], speed: 1.0, wait: 3 },
    { id: 'c8', role: 'civilian', look: 'civ_d', pos: [-8, -162.5], heading: 0, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
  ],
  vehicles: [],
};

// ─────────────────────────────── 4. 야간 창고 (낙차·바람·야간투시) ───────────────────────────────
const L4 = {
  id: 4, theme: 'night', name: '야간 창고', subtitle: '야간 · 낙차와 바람',
  briefing: '밤의 창고 단지에서 검은 정장의 거래책 두 명을 제거하세요. 어두우면 NV로 야간투시를 켜세요. 이제 탄이 떨어지고 바람(오른쪽, 초속 3m)에 밀립니다. 경비는 선택 표적이고, 안전모를 쓴 작업자는 민간인입니다.',
  targetDesc: '검은 정장의 남자 2명',
  hints: [],
  env: {
    sky: [0x05070f, 0x1b2440], fog: { color: 0x111a2e, near: 190, far: 540 },
    sun: { color: 0x9db4ff, intensity: 0.45, dir: [-0.3, 1, 0.4] },
    hemi: { sky: 0x6f80b0, ground: 0x1c1c26, intensity: 0.85 },
  },
  nightVision: true,
  player: { pos: [0, 20, 20], yaw: 0, pitch: -0.095, yawLimit: [-0.6, 0.6], pitchLimit: [-0.35, 0.12] },
  weapon: { scopeFovs: [8, 3.5], zoomLabels: ['6x', '14x'], reserve: 15 },
  ballistics: { gravity: 4.9, wind: { speed: 3, dir: 0 }, windFactor: 0.9 },
  timeLimit: 150,
  objective: { ids: ['t1', 't2'] },
  rules: { civilianFail: true, alertRadius: 14, witnessRadius: 30 },
  stars: [0, 3350, 5000],
  exits: [[-108, -195], [110, -180]],
  world: {
    seed: 4409, density: 0.55,
    extras: [
      { type: 'crate', x: -38, z: -182, rot: 0, color: 0x6d4c41 }, { type: 'crate', x: -26, z: -182, rot: 0, color: 0x6d4c41 },
      { type: 'crate', x: -36.6, z: -183.3, rot: 0, color: 0x5d4037 }, { type: 'lamp', x: -27, z: -171, rot: 0, color: 0xffe082 },
      { type: 'lamp', x: 30, z: -199, rot: 0, color: 0xffe082 }, { type: 'lamp', x: 12, z: -157, rot: 0, color: 0xffe082 },
      { type: 'wall', x: 30, z: -208, rot: 0, color: 0x546e7a }, { type: 'container', x: -55, z: -195, rot: H, color: 0x455a64 },
      { type: 'container', x: 86, z: -206, rot: 0, color: 0x5d4037 }, { type: 'container', x: 0, z: -232, rot: 0, color: 0x37474f },
    ],
  },
  actors: [
    { id: 't1', role: 'target', look: 'suit_black', pos: [-32, -176], heading: H, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 't2', role: 'target', look: 'suit_black', pos: [22, -206], heading: PI, behavior: 'patrol', path: [[22, -206], [40, -222]], speed: 1.1, wait: 4 },
    { id: 'g1', role: 'guard', look: 'guard', pos: [-62, -152], heading: H, behavior: 'patrol', path: [[-62, -152], [-10, -152]], speed: 1.2, wait: 3 },
    { id: 'g2', role: 'guard', look: 'guard', pos: [64, -186], heading: PI, behavior: 'patrol', path: [[64, -186], [64, -214]], speed: 1.1, wait: 3 },
    { id: 'g3', role: 'guard', look: 'guard', pos: [6, -160], heading: 0, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c1', role: 'civilian', look: 'worker', pos: [-78, -205], heading: H, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
  ],
  vehicles: [],
};

// ─────────────────────────────── 5. 호텔 앞 VIP (이동 표적 저지) ───────────────────────────────
const L5 = {
  id: 5, theme: 'vip', name: 'VIP 저지', subtitle: '호텔 · 시간 제한 저격',
  briefing: '흰 정장에 금색 넥타이를 맨 VIP가 경호원 두 명과 호텔을 나와 검은 세단으로 걸어갑니다. 차에 타면 놓칩니다. 거리 300m 이상, 바람은 왼쪽으로 초속 4m입니다. 25배 줌을 쓰세요.',
  targetDesc: '흰 정장 + 금색 넥타이의 VIP',
  hints: [],
  env: {
    sky: [0x3f7fd0, 0xffe2b8], fog: { color: 0xf3dcc0, near: 280, far: 760 },
    sun: { color: 0xfff0d0, intensity: 1.5, dir: [0.5, 0.9, 0.5] },
    hemi: { sky: 0xfff0dc, ground: 0x5a5560, intensity: 1.05 },
  },
  nightVision: false,
  player: { pos: [0, 30, 20], yaw: 0.06, pitch: -0.09, yawLimit: [-0.52, 0.52], pitchLimit: [-0.3, 0.1] },
  weapon: { scopeFovs: [8, 3.5, 2], zoomLabels: ['6x', '14x', '25x'], reserve: 10 },
  ballistics: { gravity: 4.9, wind: { speed: 4, dir: PI }, windFactor: 0.9 },
  timeLimit: 120,
  objective: { ids: ['vip'], escapeVehicle: 'car1' },
  rules: { civilianFail: true, alertRadius: 12, witnessRadius: 25 },
  stars: [0, 2450, 3550],
  exits: [[-150, -292], [138, -285]],
  world: {
    seed: 5501, density: 0.45,
    extras: [ // 호텔 정면 z ≈ −312, 정문 x ≈ −40. 나무 2그루가 VIP 이동 중 짧은 사각을 만든다
      { type: 'tree', x: -25, z: -276, rot: 0, color: 0x2e7d32 }, { type: 'tree', x: 2, z: -276, rot: 0, color: 0x2e7d32 },
      { type: 'car', x: -20, z: -288, rot: H, color: 0xeceff1 }, { type: 'car', x: -64, z: -288, rot: H, color: 0xb71c1c },
      { type: 'lamp', x: -55, z: -284, rot: 0, color: 0xcfd8dc }, { type: 'lamp', x: 35, z: -286, rot: 0, color: 0xcfd8dc },
    ],
  },
  actors: [
    { id: 'vip', role: 'vip', look: 'vip', pos: [-40, -308], heading: 0, behavior: 'toVehicle', path: [[-40, -299], [-12, -296], [16, -296]], speed: 1.2, wait: 2.5, vehicle: 'car1' },
    { id: 'g1', role: 'guard', look: 'guard', pos: [-41.1, -307.5], heading: 0, behavior: 'escort', path: [], speed: 1.2, wait: 0, follow: 'vip', offset: [-1.1, 0.5] },
    { id: 'g2', role: 'guard', look: 'guard', pos: [-38.9, -308.6], heading: 0, behavior: 'escort', path: [], speed: 1.2, wait: 0, follow: 'vip', offset: [1.1, -0.6] },
    { id: 'g3', role: 'guard', look: 'guard', pos: [-48, -309], heading: 0, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c1', role: 'civilian', look: 'civ_b', pos: [-62, -300], heading: H, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c2', role: 'civilian', look: 'civ_d', pos: [-50, -268], heading: H, behavior: 'patrol', path: [[-50, -268], [30, -268]], speed: 1.1, wait: 2 },
    { id: 'c3', role: 'civilian', look: 'civ_a', pos: [-33, -309], heading: 0, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
    { id: 'c4', role: 'civilian', look: 'civ_c', pos: [48, -282], heading: -H, behavior: 'idle', path: [], speed: 1.3, wait: 2 },
  ],
  vehicles: [
    { id: 'car1', kind: 'sedan', pos: [17, -292.8], heading: H, color: 0x1b1b1f, path: [[60, -292.8], [140, -292.8], [220, -292.8]] },
  ],
};

export const LEVELS = [L1, L2, L3, L4, L5];
