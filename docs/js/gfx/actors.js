// 인물·차량 뷰 (graphics-dev). 상태(Agent/Vehicle)는 gameplay(ai.js)가 소유하고 여기서는 읽기만 한다.
// 인물: 뼈대 13개 SkinnedMesh. 외형별 지오메트리 1개(버텍스 컬러 병합, 부위마다 뼈 하나에 강체 스키닝)를 공유하고
//   인물마다 Skeleton만 따로 둔다 → 드로우콜은 인물당 1개 그대로. 서 있는 자세는 BODY 히트박스
//   (머리 중심 1.62 r 0.13 / 몸통 0.9~1.5 hw 0.24 / 다리 0~0.9 hw 0.2)에 맞춘다.
// 움직임: 절차 애니메이션(대기 호흡·체중 이동·두리번, 걷기·달리기 보행 주기, 경계 웅크림)과
//   간이 물리 사망(탄 방향으로 넘어지는 진자 + 무릎·골반 꺾임 + 팔·머리 스프링 지연, 바닥에서 튕긴 뒤 정지).
// 프레임 루프에서 할당하지 않는다(뼈 회전과 스칼라 상태만 갱신). 'hit'는 생성자에서 1회 구독(탄 방향 기록).
import * as THREE from '../../vendor/three.module.min.js';
import { BODY } from '../config.js';
import { bus } from '../bus.js';
import { prep, mergeGeometries, carGeo, shared } from './mesh.js';

const TAU = Math.PI * 2;
const SKIN = [0xe9b996, 0xc98e66, 0x8d5b3d];
// top: 상의, sleeve: 팔(-1 = 맨팔), pants: 하의(-1 = 맨다리), shoes, hair, skin(인덱스). 외형별 장식은 personGeo()에서
const LOOK = {
  suit_black: { top: 0x1c1e24, sleeve: 0x1c1e24, pants: 0x23262c, shoes: 0x0e0e0e, hair: 0x1a1410, skin: 0 },
  red_cap: { top: 0x7a4a2b, sleeve: 0x7a4a2b, pants: 0x34405a, shoes: 0x3e2a1c, hair: 0x2b1d14, skin: 1 },
  vip: { top: 0xf4f2ea, sleeve: 0xf4f2ea, pants: 0xeeece4, shoes: 0x5d4037, hair: 0x9a9a9a, skin: 0 },
  guard: { top: 0x1f2c4a, sleeve: 0x1f2c4a, pants: 0x1f2c4a, shoes: 0x111111, hair: 0x15181f, skin: 2 },
  worker: { top: 0x4f5b66, sleeve: 0x4f5b66, pants: 0x3d5a80, shoes: 0x4e342e, hair: 0x2b1d14, skin: 1 },
  civ_a: { top: 0x2f80d9, sleeve: 0x2f80d9, pants: 0x3b5f99, shoes: 0xf2f2f2, hair: 0x4a2e1c, skin: 0 },
  civ_b: { top: 0xf06aa0, sleeve: -1, pants: -1, shoes: 0xf5f5f5, hair: 0x6b3e1f, skin: 1 },
  civ_c: { top: 0x3fa34d, sleeve: 0x3fa34d, pants: 0x37474f, shoes: 0x212121, hair: 0x1a1410, skin: 2 },
  civ_d: { top: 0xfdd835, sleeve: -1, pants: 0x8a8f98, shoes: 0x795548, hair: 0x3e2723, skin: 0 },
};

// ---- 뼈대: 인물 정면 +Z 기준으로 R = −X 쪽, L = +X 쪽. RIG = [부모, 관절 위치(메시 좌표, 바인드 자세)] ----
const J = { root: 0, hips: 1, spine: 2, chest: 3, head: 4, uaR: 5, faR: 6, uaL: 7, faL: 8, thR: 9, shR: 10, thL: 11, shL: 12 };
const SH = 0.19, HIP = 0.92;
const RIG = [
  [-1, 0, 0, 0], [0, 0, HIP, 0], [1, 0, 1.04, 0], [2, 0, 1.28, 0], [3, 0, 1.5, 0],
  [3, -SH, 1.45, 0], [5, -SH, 1.165, 0], [3, SH, 1.45, 0], [7, SH, 1.165, 0],
  [1, -0.1, 0.9, 0], [9, -0.1, 0.47, 0], [1, 0.1, 0.9, 0], [11, 0.1, 0.47, 0],
];

// ---- 사망 물리 ----
const STEP = 1 / 120, G15 = 1.5 * 9.8;  // 바닥 축으로 넘어지는 막대: ω' = (1.5g / L)·sin θ
const GROUND = Math.PI / 2 - 0.03;      // 누운 각도
// 명중 부위별 초기 조건: om 넘어지는 초기 각속도, cv/ct 무릎 꺾임 속도·목표(1 = 주저앉음), hv 머리 튕김, at 누운 뒤 팔 각도
const DIE = {
  head: { om: 0.45, cv: 5, ct: 1, hv: 8, at: -0.5 },    // 그 자리에서 힘이 풀려 무너짐, 머리가 뒤로 젖혀짐
  body: { om: 2.1, cv: 1.5, ct: 0.5, hv: -2.5, at: -0.6 }, // 탄에 밀려 뒤로 넘어짐
  legs: { om: 0.7, cv: 3.5, ct: 0.95, hv: 0, at: 0.35 },  // 다리가 꺾이며 쏜 쪽으로 고꾸라짐
};

const _ax = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _c = new THREE.Color();
const shade = (c, k) => _c.setHex(c).multiplyScalar(k).getHex();
const POSE0 = { walk: 0, run: 0, al: 0, lean: 0, bob: 0, stride: 0 }; // a.pose가 없을 때(서 있는 자세)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (k, dt) => 1 - Math.exp(-k * dt);

/** 외형별 인체 지오메트리(바인드 자세) + skinIndex/skinWeight(부위마다 뼈 하나, 가중치 1) */
function personGeo(key) {
  const L = LOOK[key] || LOOK.civ_a, skin = SKIN[L.skin], parts = [], bone = [];
  const add = (g, b) => { parts.push(g); bone.push(g.attributes.position.count, b); };
  const box = (w, h, d, c, x, y, z, b, rx = 0, top = c) => add(prep(new THREE.BoxGeometry(w, h, d), c, x, y, z, 0, top, rx), b);
  const cyl = (r0, r1, h, c, x, y, z, b, seg = 6) => add(prep(new THREE.CylinderGeometry(r0, r1, h, seg), c, x, y, z), b);
  const ball = (r, c, x, y, z, b, sx = 1, sy = 1, sz = 1, ws = 8, hs = 6, th = Math.PI) => {
    const g = new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, th);
    g.scale(sx, sy, sz);
    add(prep(g, c, x, y, z), b);
  };
  const HY = BODY.head.y, sleeve = L.sleeve < 0 ? skin : L.sleeve, pants = L.pants < 0 ? skin : L.pants;
  const dress = key === 'civ_b', glasses = key === 'suit_black' || key === 'guard';

  // 다리: 허벅지(0.92→0.46) · 무릎 · 정강이(0.47→0.07) · 신발
  for (const s of [-1, 1]) {
    const x = 0.1 * s, th = s < 0 ? J.thR : J.thL, sh = s < 0 ? J.shR : J.shL;
    cyl(0.088, 0.066, 0.46, pants, x, 0.69, 0, th);
    ball(0.063, pants, x, 0.47, 0.004, sh, 1, 1, 1, 6, 4);
    cyl(0.062, 0.05, 0.4, pants, x, 0.27, 0, sh);
    box(0.11, 0.075, 0.25, L.shoes, x, 0.0375, 0.035, sh, 0, shade(L.shoes, 1.3));
  }
  // 골반·벨트·배·가슴·목
  box(0.33, 0.16, 0.21, dress ? L.top : pants, 0, 0.9, 0, J.hips);
  if (!dress) box(0.335, 0.04, 0.215, key === 'vip' ? 0x5d4037 : 0x1a1a1a, 0, 0.975, 0, J.hips);
  box(0.31, 0.26, 0.19, L.top, 0, 1.11, 0, J.spine);
  box(0.36, 0.28, 0.22, L.top, 0, 1.36, 0, J.chest);
  cyl(0.048, 0.054, 0.1, skin, 0, 1.53, 0, J.head);
  // 팔: 어깨 · 위팔(1.455→1.165) · 아래팔(1.165→0.915) · 손
  for (const s of [-1, 1]) {
    const x = SH * s, ua = s < 0 ? J.uaR : J.uaL, fa = s < 0 ? J.faR : J.faL;
    ball(0.062, L.top, x, 1.45, 0, ua); // 어깨는 상의 색(원피스 어깨끈·반팔 포함)
    cyl(0.05, 0.044, 0.29, sleeve, x, 1.31, 0, ua);
    if (key === 'civ_d') cyl(0.058, 0.055, 0.13, L.top, x, 1.39, 0, ua); // 반팔
    cyl(0.044, 0.036, 0.25, sleeve, x, 1.04, 0, fa);
    box(0.055, 0.1, 0.04, skin, x, 0.865, 0.005, fa);
  }
  // 머리: 갸름한 구(머리 중심 1.62) + 얼굴(눈·눈썹·코·입·귀). 정면 = +Z
  ball(0.112, skin, 0, HY, 0, J.head, 0.95, 1.08, 1, 10, 8);
  for (const s of [-1, 1]) {
    if (!glasses) {
      box(0.032, 0.018, 0.012, 0xf4f4f4, 0.038 * s, 1.635, 0.103, J.head);
      box(0.016, 0.016, 0.01, 0x2a1a10, 0.04 * s, 1.635, 0.107, J.head);
    } else box(0.055, 0.03, 0.014, 0x050505, 0.038 * s, 1.636, 0.106, J.head); // 선글라스 알
    box(0.042, 0.012, 0.014, shade(L.hair, 0.9), 0.04 * s, 1.664, 0.097, J.head);
    box(0.022, 0.05, 0.035, skin, 0.104 * s, 1.615, -0.005, J.head);
  }
  if (glasses) box(0.03, 0.01, 0.01, 0x050505, 0, 1.642, 0.112, J.head);
  box(0.026, 0.045, 0.035, shade(skin, 0.88), 0, 1.607, 0.118, J.head);
  box(0.046, 0.01, 0.012, 0x8a3b32, 0, 1.566, 0.1, J.head);
  // 머리카락(앞이마는 얼굴이 앞으로 나오도록 뒤·위로 치우친 구) / 모자
  const hair = () => ball(0.118, L.hair, 0, HY + 0.025, -0.022, J.head, 0.97, 1, 1, 10, 7);
  const cap = (c) => {
    ball(0.123, c, 0, 1.652, -0.006, J.head, 0.98, 1, 1.02, 10, 5, Math.PI / 2);
    box(0.2, 0.02, 0.12, shade(c, 0.85), 0, 1.664, 0.15, J.head, 0.15);
    box(0.19, 0.07, 0.05, L.hair, 0, 1.6, -0.085, J.head);
  };
  // 외형별 옷·소품
  switch (key) {
    case 'suit_black':
      hair();
      box(0.1, 0.24, 0.012, 0xf2f2f2, 0, 1.37, 0.111, J.chest);                 // 셔츠
      box(0.042, 0.27, 0.016, 0x101010, 0, 1.35, 0.118, J.chest);                // 넥타이
      for (const s of [-1, 1]) box(0.05, 0.2, 0.012, 0x30333b, 0.072 * s, 1.385, 0.113, J.chest); // 옷깃
      break;
    case 'red_cap':
      cap(0xe0201b);
      box(0.12, 0.26, 0.012, 0xd9cbb0, 0, 1.36, 0.111, J.chest);                // 안쪽 셔츠
      box(0.33, 0.05, 0.2, shade(L.top, 0.8), 0, 1.0, 0, J.spine);               // 재킷 밑단
      break;
    case 'vip':
      hair();
      box(0.1, 0.24, 0.012, 0xdfe6ee, 0, 1.37, 0.111, J.chest);
      box(0.056, 0.27, 0.016, 0xffc21a, 0, 1.35, 0.119, J.chest);                // 금색 넥타이
      for (const s of [-1, 1]) box(0.05, 0.2, 0.012, 0xdcd9cf, 0.072 * s, 1.385, 0.113, J.chest);
      box(0.06, 0.04, 0.014, 0xd32f2f, 0.1, 1.425, 0.116, J.chest);              // 행커치프
      break;
    case 'guard':
      cap(0x15181f);
      box(0.38, 0.27, 0.25, 0x2e3528, 0, 1.355, 0, J.chest);                     // 조끼
      box(0.34, 0.2, 0.235, 0x2e3528, 0, 1.13, 0, J.spine);
      for (const s of [-1, 1]) box(0.08, 0.07, 0.03, 0x1a1d16, 0.085 * s, 1.12, 0.128, J.spine); // 파우치
      break;
    case 'worker':
      ball(0.14, 0xffd400, 0, 1.655, 0, J.head, 1, 0.92, 1.05, 10, 5, Math.PI / 2); // 안전모
      cyl(0.172, 0.172, 0.016, 0xffd400, 0, 1.66, 0.012, J.head, 12);
      box(0.375, 0.27, 0.235, 0xff7a1a, 0, 1.355, 0, J.chest);                   // 주황 조끼 + 반사띠
      box(0.33, 0.2, 0.21, 0xff7a1a, 0, 1.13, 0, J.spine);
      box(0.38, 0.035, 0.24, 0xe8e8e8, 0, 1.3, 0, J.chest);
      box(0.335, 0.035, 0.215, 0xe8e8e8, 0, 1.09, 0, J.spine);
      break;
    case 'civ_b':
      hair();
      box(0.2, 0.3, 0.07, L.hair, 0, 1.5, -0.1, J.head);                         // 긴 머리
      cyl(0.19, 0.27, 0.44, L.top, 0, 0.71, 0, J.hips, 8);                       // 치마
      break;
    case 'civ_c':
      hair();
      box(0.24, 0.16, 0.1, L.top, 0, 1.47, -0.14, J.chest);                      // 후드
      box(0.2, 0.1, 0.012, 0x2e7d32, 0, 1.06, 0.1, J.spine);                     // 앞주머니
      for (const s of [-1, 1]) box(0.01, 0.12, 0.01, 0xf0f0f0, 0.035 * s, 1.42, 0.115, J.chest); // 끈
      break;
    default: hair();
  }

  const n = bone.reduce((a, v, i) => (i % 2 ? a : a + v), 0);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0, o = 0; i < bone.length; i += 2) {
    for (let k = 0; k < bone[i]; k++, o++) { si[o * 4] = bone[i + 1]; sw[o * 4] = 1; }
  }
  const g = mergeGeometries(parts);
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

/** 손전등 빛줄기(오른쪽 아래팔 뼈 좌표): 손에서 아래팔 방향(−Y)으로, 꼭짓점 알파 0.13 → 끝 0 */
function coneGeo() {
  const g = new THREE.ConeGeometry(1.3, 7, 12, 1, true).toNonIndexed();
  g.translate(0, -3.5, 0);
  const p = g.attributes.position, col = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) { const a = 0.13 * (1 + p.getY(i) / 7); col.set([1, 0.95, 0.78, Math.max(0, a)], i * 4); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.translate(0, -0.3, 0.02);
  return g;
}

/** 인물 메시에 뼈대를 만들어 바인드한다(메시는 원점·무회전 상태여야 함). 뼈 배열을 돌려준다 */
function rig(m) {
  const bones = RIG.map(() => new THREE.Bone());
  RIG.forEach(([p, x, y, z], i) => {
    if (p < 0) { bones[i].position.set(x, y, z); m.add(bones[i]); return; }
    const q = RIG[p];
    bones[i].position.set(x - q[1], y - q[2], z - q[3]);
    bones[p].add(bones[i]);
  });
  m.updateMatrixWorld(true);
  m.bind(new THREE.Skeleton(bones));
  return bones;
}

/** 인물·차량의 시각적 표현. 상태(Agent/Vehicle)는 gameplay(ai.js)가 소유하고 여기서는 읽기만 한다. */
export class ActorViews {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.views = new Map();
    this.geos = {};                       // 외형별 지오메트리(지연 생성 후 재사용)
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.carMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.coneMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.cone = null; this.cam = null;
    // 명중 순간 탄 방향(쏜 사람 → 명중점, 수평)과 부위를 기록해 두었다가 사망 연출에 쓴다
    bus.on('hit', (h) => {
      const v = this.views.get(h.agentId);
      if (!v || v.car) return;
      const c = this.cam || (this.cam = this.scene.getObjectByProperty('isCamera', true) || null);
      const dx = h.pos[0] - (c ? c.position.x : 0), dz = h.pos[2] - (c ? c.position.z : 20), l = Math.hypot(dx, dz) || 1;
      v.hx = dx / l; v.hz = dz / l; v.hp = h.part;
    });
  }

  build(agents, vehicles) {
    this.clear();
    const night = shared.theme === 'night';
    for (const a of agents) {
      const key = LOOK[a.look] ? a.look : 'civ_a';
      const g = this.geos[key] || (this.geos[key] = personGeo(key));
      const m = new THREE.SkinnedMesh(g, this.mat);
      const b = rig(m);
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2); // 누운 자세까지 덮는 고정 구(매 프레임 재계산 안 함)
      let cone = null;
      if (night && a.role === 'guard') {
        cone = new THREE.Mesh(this.cone || (this.cone = coneGeo()), this.coneMat);
        cone.renderOrder = 3; cone.frustumCulled = false; b[J.faR].add(cone);
      }
      this.group.add(m);
      this.views.set(a.id, {
        m, b, cone, car: false,
        t: Math.random() * 20, hy: 0, lookY: 0, lookT: Math.random() * 3,
        clasp: a.role === 'guard' || a.look === 'suit_black' ? 1 : 0, // 대기 중 손을 앞으로 모으는 인물
        hx: 0, hz: 0, hp: '', dead: false, settled: false,
        th: 0, om: 0, c: 0, cv: 0, ct: 0, aa: 0, av: 0, at: 0, ha: 0, hv: 0, ft: 0, fdx: 0, fdz: -1, kl: 1, kr: 1,
      });
    }
    for (const v of vehicles) {
      const m = new THREE.Mesh(carGeo(v.color ?? 0x333333), this.carMat);
      this.group.add(m);
      this.views.set(v.id, { m, cone: null, car: true });
    }
  }

  sync(agents, vehicles, dt) {
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i], v = this.views.get(a.id);
      if (!v) continue;
      const m = v.m, vis = a.anim !== 'hidden' && a.state !== 'boarded' && a.state !== 'escaped';
      m.visible = vis;
      if (!vis) continue;
      m.position.set(a.x, a.y || 0, a.z);
      m.rotation.y = a.heading;
      if (a.state === 'dead' || a.anim === 'dead') {
        if (!v.dead) this._die(v, a);
        if (v.cone) v.cone.visible = false;
        this._fall(v, dt);
      } else this._live(v, a, dt);
    }
    for (let i = 0; i < vehicles.length; i++) {
      const c = vehicles[i], v = this.views.get(c.id);
      if (!v) continue;
      v.m.visible = c.state !== 'gone';
      v.m.position.set(c.x, c.y || 0, c.z);
      v.m.rotation.y = c.heading;
    }
  }

  // ---------- 살아 있는 동안: 절차 애니메이션 ----------
  _live(v, a, dt) {
    const B = v.b, P = a.pose || POSE0; // 숙임·반동·보폭은 ai가 계산한 값(판정 히트박스와 같은 값)을 쓴다
    v.t += dt;
    const walk = P.walk, run = P.run, idle = 1 - walk, al = P.al * idle;
    const ph = (a.gait || 0) * TAU, s = Math.sin(ph), c = Math.cos(ph), t = v.t;
    const br = Math.sin(t * 1.7), ws = Math.sin(t * 0.37); // 호흡, 체중 이동
    if ((v.lookT -= dt) <= 0) { v.lookT = 1.5 + Math.random() * 4; v.lookY = (Math.random() * 2 - 1) * 0.75; } // 고개만 두리번
    v.hy += (v.lookY * idle * (1 - al) - v.hy) * ease(3, dt);
    // 골반: 걸음 두 번에 한 번 위아래, 좌우 비틀림, 대기 중 체중 이동 / 상체: 앞으로 숙임 + 골반과 반대로 비틀림
    const lean = P.lean, hz = 0.035 * ws * idle + 0.025 * c * walk;
    B[J.hips].position.set(0.018 * ws * idle, HIP + P.bob, 0);
    B[J.hips].rotation.set(0, 0.14 * s * walk, hz);
    B[J.spine].rotation.set(lean + 0.012 * br * idle, 0, -hz * 0.6);
    B[J.chest].rotation.set(0.012 * br * idle, -0.22 * s * walk, -hz * 0.4);
    B[J.head].rotation.set(-lean * 0.7 + 0.05 * Math.sin(t * 0.43) * idle, v.hy + 0.1 * s * walk, 0);
    // 다리: 허벅지 앞뒤 스윙(앞 = −), 무릎은 다리가 앞으로 나가는 구간에서 굽힘, 대기 중엔 힘 뺀 쪽 무릎이 살짝 굽음
    const tA = P.stride, kA = (0.8 + 0.6 * run) * walk, kb = 0.05 * walk + 0.25 * run + 0.55 * al;
    B[J.thL].rotation.set(-tA * s - 0.28 * al, 0, 0.03 - hz);
    B[J.thR].rotation.set(tA * s - 0.28 * al, 0, -0.03 - hz);
    B[J.shL].rotation.set(kA * Math.max(0, c) + kb + 0.1 * Math.max(0, ws) * idle, 0, 0);
    B[J.shR].rotation.set(kA * Math.max(0, -c) + kb + 0.1 * Math.max(0, -ws) * idle, 0, 0);
    // 팔: 다리와 반대로 스윙, 달리면 팔꿈치 약 90°, 경비·정장은 대기 중 손을 앞으로 모음, 경계하면 팔을 들고 웅크림
    const aA = (0.3 + 0.5 * run) * walk, cl = v.clasp * idle * (1 - al), mic = 0.03 * Math.sin(t * 0.8) * idle;
    arm(B[J.uaL], B[J.faL], 1, aA * s + mic, cl, al, run, walk);
    if (v.cone) { // 야간 경비: 오른손 손전등을 앞으로 비춤
      B[J.uaR].rotation.set(-0.5 + 0.06 * s * walk, 0, -0.05);
      B[J.faR].rotation.set(-0.75, 0, 0);
      v.cone.visible = true;
    } else arm(B[J.uaR], B[J.faR], -1, -aA * s - mic, cl, al, run, walk);
  }

  // ---------- 사망: 간이 물리 ----------
  _die(v, a) {
    v.dead = true; v.settled = false;
    const P = DIE[v.hp] || DIE.body;
    // 탄 진행 방향(월드) → 인물 로컬(heading 역회전). 기록이 없으면 뒤로. 다리 명중은 쏜 쪽으로 고꾸라짐. ±20° 흩뜨림
    const c = Math.cos(a.heading), s = Math.sin(a.heading), sg = v.hp === 'legs' ? -1 : 1;
    let lx = v.hp ? (v.hx * c - v.hz * s) * sg : 0, lz = v.hp ? (v.hx * s + v.hz * c) * sg : -1;
    const j = (Math.random() - 0.5) * 0.7, cj = Math.cos(j), sj = Math.sin(j);
    v.fdx = lx * cj + lz * sj; v.fdz = -lx * sj + lz * cj;
    const l = Math.hypot(v.fdx, v.fdz) || 1; v.fdx /= l; v.fdz /= l;
    v.th = 0.03; v.om = P.om * (0.85 + Math.random() * 0.3); v.c = 0; v.cv = P.cv; v.ct = P.ct;
    v.aa = 0; v.av = 0; v.at = P.at; v.ha = 0; v.hv = P.hv; v.ft = 0;
    const kk = Math.random() < 0.5; v.kl = kk ? 1.1 : 0.55 + Math.random() * 0.3; v.kr = kk ? 0.55 + Math.random() * 0.3 : 1.1;
    v.b[J.hips].rotation.set(0, 0, 0); v.b[J.chest].rotation.set(0, 0, 0);
  }

  _fall(v, dt) {
    if (v.settled || dt <= 0) return;
    v.ft += dt;
    const n = Math.min(10, Math.ceil(dt / STEP)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const om0 = v.om, L = 1.7 - 0.85 * clamp(v.c, 0, 1);
      v.om += ((G15 / L) * Math.sin(v.th) - 0.4 * v.om) * h;    // 넘어지는 진자(무릎이 꺾일수록 짧아져 빨리 쓰러짐)
      v.th += v.om * h;
      if (v.th >= GROUND) { v.th = GROUND; v.om = v.om > 0.9 ? -v.om * 0.3 : 0; } // 바닥: 작게 튕긴 뒤 정지
      else if (v.th < 0) { v.th = 0; v.om = 0.3; }
      const dw = v.om - om0, lie = v.th / GROUND; // 몸통 각속도 변화 → 팔·머리가 관성으로 늦게 따라옴
      v.cv += (60 * (v.ct * (1 - 0.7 * lie * lie) - v.c) - 11 * v.cv) * h; v.c += v.cv * h; // 바닥에 닿을수록 다리가 풀려 펴짐
      v.av += (-35 * (v.aa - v.at) - 6 * v.av) * h - dw * 0.9; v.aa += v.av * h;
      v.hv += (-45 * v.ha - 5 * v.hv) * h - dw * 0.6; v.ha += v.hv * h;
    }
    if (v.ft > 1.2 && v.th >= GROUND && v.om === 0 && Math.abs(v.cv) + Math.abs(v.av) + Math.abs(v.hv) < 0.05) v.settled = true;
    // 자세: 발을 축으로 넘어짐(축 = 위 × 넘어지는 방향), 골반이 내려앉고 무릎이 앞으로 꺾임, 상체는 웅크림
    const B = v.b, c = clamp(v.c, 0, 1.1);
    _ax.set(v.fdz, 0, -v.fdx);
    B[J.root].quaternion.setFromAxisAngle(_ax, v.th);
    B[J.root].position.y = 0.11 * Math.sin(v.th);
    B[J.hips].position.set(0, HIP - 0.36 * c, 0);
    B[J.spine].quaternion.setFromAxisAngle(_ax, -0.22 * c);
    B[J.head].quaternion.setFromAxisAngle(_ax, clamp(v.ha, -1.1, 1.1));
    const kl = c * v.kl, kr = c * v.kr; // 좌우 무릎을 다르게 꺾어 대칭 자세를 피함
    B[J.thL].rotation.set(-1.15 * kl, 0, 0.1 + 0.1 * c); B[J.thR].rotation.set(-1.15 * kr, 0, -0.1 - 0.1 * c);
    B[J.shL].rotation.set(2 * kl, 0, 0); B[J.shR].rotation.set(2 * kr, 0, 0);
    for (let k = 0; k < 2; k++) {
      const sd = k ? 1 : -1, ua = B[k ? J.uaL : J.uaR];
      _q1.setFromAxisAngle(_ax, v.aa + sd * 0.12);
      _q2.setFromAxisAngle(_z, sd * (0.2 + 0.4 * c));
      ua.quaternion.multiplyQuaternions(_q1, _q2);
      B[k ? J.faL : J.faR].rotation.set(-0.3 - 0.35 * c, 0, 0);
    }
  }

  /** 야간투시: 인물 재질에 밝은 발광(열상 느낌). 차량·배경은 renderer의 녹색 조명만 받는다 */
  setNightVision(on) {
    this.mat.emissive.setHex(on ? 0x8cffa0 : 0x000000);
    this.mat.emissiveIntensity = on ? 0.75 : 1;
  }

  clear() {
    for (const v of this.views.values()) {
      this.group.remove(v.m);
      if (v.car) v.m.geometry.dispose();
      else v.m.skeleton.dispose(); // 뼈 텍스처 해제(인물 지오메트리는 외형별 캐시라 유지)
    }
    this.views.clear();
  }
}

/** 팔 한쪽 자세. side: L = +1, R = −1. cl = 손 모으기, al = 경계 웅크림 */
function arm(ua, fa, side, swing, cl, al, run, walk) {
  ua.rotation.set(swing * (1 - cl) - 0.26 * cl - 0.35 * al, 0, side * (0.07 + 0.04 * run - 0.25 * cl + 0.1 * al));
  fa.rotation.set(-(0.12 + 0.15 * walk + 1.2 * run) * (1 - cl) - 1.0 * cl - 0.7 * al, 0, -side * 0.55 * cl);
}
