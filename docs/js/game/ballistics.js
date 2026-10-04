// 탄 비행(탄속·중력·바람)을 1/120초 고정 스텝으로 적분하고, 스텝 선분과 도형의 해석적 교차로 명중을 낸다.
// 도형: 인물(heading 반영 로컬 좌표 + 자세 반영: 척추 관절 기준 상체 숙임·골반 상하·보폭, a.pose는 ai가 계산하고 actors.js도 같은 값으로 그림),
//   차량 박스(heading 반영), world.colliders AABB, 지면 y=0.
// 이동 중인 인물: 스텝 시각에 맞춰 위치를 보간(프레임 끝 위치 − 속도 × 남은 시간)하고,
//   판정을 진행 방향 앞뒤로 '속도 × 허용 시간(leadTol × 난이도)'만큼 늘린다. 아깝게 빗나가면 'nearMiss'(HUD 리드 안내).
// 프레임 루프에서 할당 없음(이벤트 payload 제외). THREE.Raycaster 미사용.
import { bus } from '../bus.js';
import { BALANCE } from '../data/levels.js';
import { BODY, VEHICLE } from '../config.js';

const STEP = 1 / 120;
const MAX_T = 2.0;      // 탄 수명(초)
const RANGE = 1000;     // rangeAt 광선 길이(m)
const HALF_STEP2 = 0.5 * STEP * STEP;
const AG_CY = 0.95, AG_R = 1.35;   // 인물 대략 판정 구(발 위 0.95m, 반지름 1.35m + 허용 오차) — 숙임·보폭 포함
const HD = BODY.head, TO = BODY.torso, LG = BODY.legs;
const SPINE = 1.04, NECK = 1.5;    // 상체가 숙는 축(척추 관절)과 머리 관절 높이 = actors.js 뼈대
const NM_R = 1.6, NM_MOVE = 1.0;   // 아깝게 빗나감: 1m/s 넘게 움직이는 비민간인의 가슴 1.6m 안을 지남

/** segmentCast 결과(재사용). t = 선분 매개변수 0..1 */
const HIT = { t: 0, agent: null, part: '', surface: '' };
let LAG = 0, TOL = 0; // 현재 스텝 끝 → 프레임 끝까지 남은 시간(s), 이동 표적 허용 시간(s)

export class Ballistics {
  constructor() {
    /** 탄 풀(8). Fx가 active인 것을 읽어 궤적을 그린다. (px,py,pz)=직전 위치, (ox,oy,oz)=발사 위치, nm* = 가장 가깝게 지난 이동 표적 */
    this.bullets = Array.from({ length: 8 }, () => ({
      active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, px: 0, py: 0, pz: 0, ox: 0, oy: 0, oz: 0,
      nmD: 0, nmA: null, nmF: 0, nmL: 0, nmR: 0,
    }));
    this.assist = { noDrop: false, noWind: false };
    this.level = null; this.world = null; this.acc = 0; this.tol = 0;
    this.agents = []; this.vehicles = [];
    this._ax = 0; this._ay = 0; this._az = 0;
    bus.on('shot', (s) => this._spawn(s));
  }

  reset(level, world) {
    this.level = level; this.world = world; this.acc = 0;
    this.tol = (BALANCE.leadTol || 0) * (level.difficulty ? level.difficulty.lead ?? 1 : 1);
    this.agents = []; this.vehicles = [];
    for (const b of this.bullets) { b.active = false; b.nmA = null; }
  }

  _spawn(s) {
    if (!this.level) return;
    let b = null;
    for (let i = 0; i < this.bullets.length; i++) { // 빈 슬롯, 없으면 가장 오래된 탄 재사용
      const c = this.bullets[i];
      if (!c.active) { b = c; break; }
      if (!b || c.t > b.t) b = c;
    }
    const m = BALANCE.muzzle;
    b.active = true; b.t = 0;
    b.x = b.px = b.ox = s.origin[0]; b.y = b.py = b.oy = s.origin[1]; b.z = b.pz = b.oz = s.origin[2];
    b.vx = s.dir[0] * m; b.vy = s.dir[1] * m; b.vz = s.dir[2] * m;
    b.nmD = NM_R * NM_R; b.nmA = null; b.nmF = b.nmL = b.nmR = 0;
  }

  update(dt, agents, vehicles) {
    this.agents = agents; this.vehicles = vehicles;
    if (!this.level) return;
    // 가속도: 중력 + 바람((cos dir, 0, sin dir) × speed × windFactor)
    const bl = this.level.ballistics, w = this.assist.noWind ? 0 : bl.wind.speed * bl.windFactor;
    this._ax = Math.cos(bl.wind.dir) * w; this._az = Math.sin(bl.wind.dir) * w;
    this._ay = this.assist.noDrop ? 0 : -bl.gravity;
    TOL = this.tol;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      LAG = this.acc; // 이 스텝이 끝나는 시각은 프레임 끝보다 acc초 앞 → 인물 위치를 그만큼 되돌려 판정
      for (let i = 0; i < this.bullets.length; i++) if (this.bullets[i].active) this._step(this.bullets[i]);
    }
    LAG = 0;
  }

  _step(b) {
    const ax = this._ax, ay = this._ay, az = this._az;
    b.px = b.x; b.py = b.y; b.pz = b.z;
    // 등가속 정확해(x += v·h + ½a·h²) → 낙차 = ½·g·t² 그대로
    b.x += b.vx * STEP + ax * HALF_STEP2; b.y += b.vy * STEP + ay * HALF_STEP2; b.z += b.vz * STEP + az * HALF_STEP2;
    b.vx += ax * STEP; b.vy += ay * STEP; b.vz += az * STEP;
    b.t += STEP;
    this._track(b);
    if (segmentCast(b.px, b.py, b.pz, b.x, b.y, b.z, this.agents, this.vehicles, this.world.colliders)) {
      b.active = false;
      const t = HIT.t;
      b.x = b.px + (b.x - b.px) * t; b.y = b.py + (b.y - b.py) * t; b.z = b.pz + (b.z - b.pz) * t;
      const pos = [b.x, b.y, b.z];
      if (HIT.agent) {
        const a = HIT.agent, dist = Math.hypot(b.x - b.ox, b.y - b.oy, b.z - b.oz);
        b.nmA = null;
        bus.emit('hit', { agentId: a.id, role: a.role, part: HIT.part, pos, dist });
      } else {
        bus.emit('impact', { pos, surface: HIT.surface === 'ground' ? this.world.surfaceAt(b.x, b.z) : HIT.surface });
        this._nearMiss(b);
      }
    } else if (b.t >= MAX_T) { b.active = false; this._nearMiss(b); }
  }

  /** 이동 중인 비민간인 가슴(1.2m)에 가장 가깝게 지난 지점을 기록: 진행 방향 성분(+ 앞 / − 뒤), 필요 리드 */
  _track(b) {
    const A = this.agents, dx = b.x - b.px, dy = b.y - b.py, dz = b.z - b.pz, dd = dx * dx + dy * dy + dz * dz;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      if (a.role === 'civilian' || a.state === 'dead' || a.state === 'boarded' || a.state === 'escaped') continue;
      const vx = a.vx || 0, vz = a.vz || 0, sp = Math.hypot(vx, vz);
      if (sp < NM_MOVE) continue;
      const cx = a.x - vx * LAG, cy = a.y + 1.2, cz = a.z - vz * LAG, wx = cx - b.px, wy = cy - b.py, wz = cz - b.pz;
      let u = dd > 0 ? (wx * dx + wy * dy + wz * dz) / dd : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const ex = b.px + dx * u - cx, ey = b.py + dy * u - cy, ez = b.pz + dz * u - cz, d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < b.nmD) {
        b.nmD = d2; b.nmA = a; b.nmF = (ex * vx + ez * vz) / sp;
        b.nmL = sp * (b.t - STEP + STEP * u); b.nmR = Math.hypot(cx - b.ox, cy - b.oy, cz - b.oz);
      }
    }
  }

  _nearMiss(b) {
    const a = b.nmA;
    b.nmA = null;
    if (!a || a.state === 'dead') return;
    bus.emit('nearMiss', { agentId: a.id, ahead: b.nmF > 0, off: Math.abs(b.nmF), lead: b.nmL, dist: b.nmR });
  }

  /** 화면 중앙 광선이 처음 닿는 곳까지 거리(m). 없으면 -1 */
  rangeAt(view, agents) {
    if (!this.world) return -1;
    const cp = Math.cos(view.pitch);
    const dx = -Math.sin(view.yaw) * cp * RANGE, dy = Math.sin(view.pitch) * RANGE, dz = -Math.cos(view.yaw) * cp * RANGE;
    LAG = 0; TOL = 0; // 거리계는 보이는 그대로
    const hit = segmentCast(view.x, view.y, view.z, view.x + dx, view.y + dy, view.z + dz, agents, this.vehicles, this.world.colliders);
    return hit ? HIT.t * RANGE : -1;
  }

  /** {noDrop, noWind} */
  setAssist(o) { Object.assign(this.assist, o); }
}

/** 자세를 반영한 인물 부위의 월드 좌표(part: 'head' 머리 중심 | 'chest' 가슴 중심). 디버그·QA가 '보이는 곳'을 겨눌 때 쓴다 */
export function partPos(a, part, out = [0, 0, 0]) {
  const P = a.pose, lean = P ? P.lean : 0, bob = P ? P.bob : 0;
  let Y = (TO.y0 + TO.y1) / 2 - SPINE, Z = 0;
  if (part === 'head') { const hl = 0.7 * lean; Y = NECK - SPINE + (HD.y - NECK) * Math.cos(hl); Z = -(HD.y - NECK) * Math.sin(hl); }
  const cl = Math.cos(lean), sl = Math.sin(lean), lz = Y * sl + Z * cl;
  out[0] = a.x + lz * Math.sin(a.heading); out[1] = a.y + SPINE + bob + Y * cl - Z * sl; out[2] = a.z + lz * Math.cos(a.heading);
  return out;
}

// ---- 선분 판정: (x0..x1) 선분과 모든 도형의 가장 가까운 교차를 HIT에 기록. 맞으면 true ----
function segmentCast(x0, y0, z0, x1, y1, z1, agents, vehicles, colliders) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, dd = dx * dx + dy * dy + dz * dz;
  let best = 1.000001, t;
  HIT.agent = null; HIT.part = ''; HIT.surface = '';
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.state === 'dead' || a.state === 'boarded' || a.state === 'escaped') continue;
    const vx = a.vx || 0, vz = a.vz || 0, ax = a.x - vx * LAG, az = a.z - vz * LAG, ext = Math.hypot(vx, vz) * TOL, R = AG_R + ext;
    if (!near(x0, y0, z0, dx, dy, dz, dd, ax, a.y + AG_CY, az, R * R)) continue;
    // 인물 로컬 좌표(발 기준, heading 역회전): lx = x·cos h − z·sin h, lz = x·sin h + z·cos h. 로컬 +Z = 정면 = 진행 방향
    const c = Math.cos(a.heading), s = Math.sin(a.heading), rx = x0 - ax, rz = z0 - az, ly = y0 - a.y;
    const lx = rx * c - rz * s, lz = rx * s + rz * c, ldx = dx * c - dz * s, ldz = dx * s + dz * c;
    const P = a.pose, lean = P ? P.lean : 0, bob = P ? P.bob : 0, wk = P ? P.walk : 0, rn = P ? P.run : 0, st = P ? P.stride : 0;
    // 하체: 다리 상자를 보폭만큼, 이동 허용 오차만큼 앞뒤로 넓힘(골반 높이는 bob만큼 오르내림)
    const lhd = LG.hd + 0.3 * Math.sin(st) + ext;
    t = rayBox(lx, ly, lz, ldx, dy, ldz, -LG.hw, LG.y0, -lhd, LG.hw, LG.y1 + bob, lhd);
    if (t >= 0 && t < best) { best = t; HIT.agent = a; HIT.part = 'legs'; }
    // 상체: 척추 관절(1.04 + bob)을 축으로 lean만큼 앞으로 기운 좌표계로 광선을 옮긴다
    const cl = Math.cos(lean), sl = Math.sin(lean), oy = ly - SPINE - bob;
    const uy = oy * cl + lz * sl, uz = -oy * sl + lz * cl, udy = dy * cl + ldz * sl, udz = -dy * sl + ldz * cl;
    const thd = TO.hd + 0.04 * wk + 0.05 * rn + ext; // 팔 스윙 일부 + 허용 오차
    t = rayBox(lx, uy, uz, ldx, udy, udz, -TO.hw, TO.y0 - SPINE, -thd, TO.hw, TO.y1 - SPINE, thd);
    if (t >= 0 && t < best) { best = t; HIT.agent = a; HIT.part = 'body'; }
    // 머리: 숙임의 70%만큼 젖힌 머리 중심, 진행 방향(z)으로 늘린 캡슐
    const hl = 0.7 * lean, hy = NECK - SPINE + (HD.y - NECK) * Math.cos(hl), hz = -(HD.y - NECK) * Math.sin(hl);
    t = rayCapsuleZ(lx, uy - hy, uz - hz, ldx, udy, udz, ext, HD.r);
    if (t >= 0 && t < best) { best = t; HIT.agent = a; HIT.part = 'head'; }
  }
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (v.state === 'gone') continue;
    const S = VEHICLE[v.kind] || VEHICLE.sedan, hw = S.w / 2, hl = S.l / 2;
    if (!near(x0, y0, z0, dx, dy, dz, dd, v.x, v.y + S.h / 2, v.z, hw * hw + hl * hl + S.h * S.h / 4)) continue;
    const c = Math.cos(v.heading), s = Math.sin(v.heading), rx = x0 - v.x, rz = z0 - v.z;
    t = rayBox(rx * c - rz * s, y0 - v.y, rx * s + rz * c, dx * c - dz * s, dy, dx * s + dz * c, -hw, 0, -hl, hw, S.h, hl);
    if (t >= 0 && t < best) { best = t; HIT.agent = null; HIT.part = ''; HIT.surface = 'vehicle'; }
  }
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i], lo = b.min, hi = b.max;
    t = rayBox(x0, y0, z0, dx, dy, dz, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
    if (t >= 0 && t < best) { best = t; HIT.agent = null; HIT.part = ''; HIT.surface = b.surface; }
  }
  if (y1 < 0 && y0 >= 0) {
    t = y0 / (y0 - y1);
    if (t < best) { best = t; HIT.agent = null; HIT.part = ''; HIT.surface = 'ground'; }
  }
  if (best > 1) return false;
  HIT.t = best;
  return true;
}

/** 선분이 점 (cx,cy,cz) 반경 √r2 안을 지나는가(대략 판정) */
function near(x0, y0, z0, dx, dy, dz, dd, cx, cy, cz, r2) {
  const wx = cx - x0, wy = cy - y0, wz = cz - z0;
  let t = dd > 0 ? (wx * dx + wy * dy + wz * dz) / dd : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = wx - dx * t, ey = wy - dy * t, ez = wz - dz * t;
  return ex * ex + ey * ey + ez * ez <= r2;
}

/** 원점 기준 구와 광선 o + t·d 의 첫 교차 t(≥0), 없으면 -1. 구 안에서 시작하면 -1 */
function raySphere(ox, oy, oz, dx, dy, dz, r) {
  const a = dx * dx + dy * dy + dz * dz, b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - r * r;
  if (c <= 0 || b > 0) return -1;
  const disc = b * b - a * c;
  return disc < 0 ? -1 : (-b - Math.sqrt(disc)) / a;
}

/** 원점 기준 z축 캡슐(선분 (0,0,−h)~(0,0,h), 반지름 r)과 광선의 첫 교차 t(≥0), 없으면 -1. h = 0이면 구 */
function rayCapsuleZ(ox, oy, oz, dx, dy, dz, h, r) {
  let best = raySphere(ox, oy, oz - h, dx, dy, dz, r), t;
  if (h <= 0) return best;
  t = raySphere(ox, oy, oz + h, dx, dy, dz, r);
  if (t >= 0 && (best < 0 || t < best)) best = t;
  const a = dx * dx + dy * dy, b = ox * dx + oy * dy, c = ox * ox + oy * oy - r * r; // 옆면(무한 원기둥) 중 |z| ≤ h 구간
  if (a > 1e-12 && c > 0 && b < 0) {
    const disc = b * b - a * c;
    if (disc >= 0) {
      t = (-b - Math.sqrt(disc)) / a;
      const z = oz + t * dz;
      if (z >= -h && z <= h && (best < 0 || t < best)) best = t;
    }
  }
  return best;
}

// 슬랩 판정 구간(재사용)
let T0 = 0, T1 = 0;
function slab(o, d, lo, hi) {
  if (d > -1e-12 && d < 1e-12) return o >= lo && o <= hi;
  let a = (lo - o) / d, b = (hi - o) / d;
  if (a > b) { const tmp = a; a = b; b = tmp; }
  if (a > T0) T0 = a;
  if (b < T1) T1 = b;
  return T0 <= T1;
}
/** 광선과 축정렬 박스의 진입 t(≥0), 없으면 -1. 박스 안에서 시작하면 -1(총구가 옥상 충돌체 안이어도 안전) */
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  T0 = -Infinity; T1 = Infinity;
  if (!slab(ox, dx, x0, x1) || !slab(oy, dy, y0, y1) || !slab(oz, dz, z0, z1)) return -1;
  return T0 >= 0 ? T0 : -1;
}
