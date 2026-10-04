// 인물/차량 상태를 소유. 경로 이동·순찰·호위·차량 탑승, 경계·도주. 'alert','escaped' 이벤트.
// 경로 의미(CONTRACT §4 v1.1): pos → path[0] → path[1] …, 경유지마다 wait초 대기.
//   patrol 왕복(pos = path[0], 출발 전 대기) · walk 마지막 점에서 idle · toVehicle 마지막 점에서 즉시 탑승 · escort 대상 로컬 offset.
// 경로 추종은 인덱스와 스칼라만 쓴다(프레임 루프 할당 없음, 이벤트 payload 제외).
import { bus } from '../bus.js';
import { BODY } from '../config.js';
import { rng, wrapAngle } from '../util.js';

const RUN = 4.5;                       // 경계 후 달리기(m/s)
const CAR_MAX = 12, CAR_ACC = 3;       // 차량 최고속도·가속도 → S5 203m를 약 19초
const REACT = 0.6, REACT_RND = 0.6;    // 경계 → 도주 반응 시간 0.6~1.2초
const WALK_GAIT = 1.5, RUN_GAIT = 2.6; // 걸음 주기 1회당 이동 거리(m)
const ZERO2 = [0, 0];

/** 각도 a를 target 쪽으로 지수 감쇠 회전 */
const turn = (a, target, lambda, dt) => wrapAngle(a + wrapAngle(target - a) * (1 - Math.exp(-lambda * dt)));

export class AI {
  constructor() {
    /** @type {Array<object>} Agent: {id,role,look,required,x,y,z,heading,vx,vz,state,anim,gait,deadT} (+ 내부 _필드) */
    this.agents = [];
    /** @type {Array<object>} Vehicle: {id,kind,color,x,y,z,heading,speed,state} (+ 내부 _필드) */
    this.vehicles = [];
    this._byId = new Map(); this._vById = new Map();
    this.level = null; this._rand = Math.random; this._reactK = 1;
    bus.on('hit', (h) => this._onHit(h));
    bus.on('impact', (e) => this._onImpact(e));
  }

  reset(level, world) {
    this.level = level; this.world = world;
    this._rand = rng(((level.world && level.world.seed) || level.id) * 13 + 5);
    this._reactK = level.difficulty ? level.difficulty.react : 1; // 난이도: 경계 → 도주 반응 시간 배수
    const req = new Set(level.objective.ids);
    this.vehicles = (level.vehicles || []).map((d) => ({
      id: d.id, kind: d.kind, color: d.color ?? 0x333333, x: d.pos[0], y: 0, z: d.pos[1], heading: d.heading || 0,
      speed: 0, state: 'parked', _path: d.path || [], _i: 0, // 순환 참조 없음(debug vehicles()가 펼쳐 직렬화)
    }));
    this._vById = new Map(this.vehicles.map((v) => [v.id, v]));
    this.agents = level.actors.map((d) => ({
      id: d.id, role: d.role, look: d.look, required: req.has(d.id),
      x: d.pos[0], y: d.y || 0, z: d.pos[1], heading: d.heading || 0, vx: 0, vz: 0,
      state: 'idle', anim: 'stand', gait: this._rand(), deadT: -1,
      // 자세(판정과 그래픽 공용, CONTRACT §5): 걷기·달리기·경계 비율, 상체 숙임(rad), 골반 상하(m), 허벅지 스윙(rad)
      pose: { spd: 0, walk: 0, run: 0, al: 0, lean: 0, bob: 0, stride: 0 },
      // 내부: 모드('still'|'path'|'escort'|'alert'|'flee'|'dead'|'out'), 경로 인덱스/방향/대기, 경계 반응, 목표점
      _d: d, _mode: 'still', _i: 0, _dir: 1, _wait: 0, _run: false, _alerted: false, _react: 0, _tx: 0, _tz: 0,
      _baseH: d.heading || 0, _lookH: d.heading || 0, _lookT: 1 + this._rand() * 5, _follow: null, _veh: null,
    }));
    this._byId = new Map(this.agents.map((a) => [a.id, a]));
    for (const a of this.agents) {
      const d = a._d, P = d.path || [];
      if (d.behavior === 'escort') { a._follow = this._byId.get(d.follow) || null; a._mode = a._follow ? 'escort' : 'still'; }
      else if ((d.behavior === 'patrol' || d.behavior === 'walk' || d.behavior === 'toVehicle') && P.length) {
        a._mode = 'path'; a._i = 0;
        if (Math.hypot(P[0][0] - a.x, P[0][1] - a.z) < 0.3) this._arrive(a); // pos = path[0] → 출발 전 대기
      }
    }
  }

  update(dt) {
    for (let i = 0; i < this.vehicles.length; i++) this._drive(this.vehicles[i], dt);
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a._mode === 'dead') { a.deadT += dt; continue; }
      if (a._mode === 'out') { if (a.state === 'boarded' && a._veh) { a.x = a._veh.x; a.z = a._veh.z; } continue; }
      const px = a.x, pz = a.z;
      switch (a._mode) {
        case 'still': this._idle(a, dt); break;
        case 'path': this._path(a, dt); break;
        case 'escort': this._escort(a, dt); break;
        case 'alert': // 소리 난 쪽을 돌아보고 반응 시간 뒤 도주
          a.heading = turn(a.heading, Math.atan2(a._tx - a.x, a._tz - a.z), 8, dt);
          if ((a._react -= dt) <= 0) this._flee(a);
          break;
        case 'flee': if (this._moveTo(a, a._tx, a._tz, RUN, dt)) this._escape(a); break;
      }
      if (a._mode === 'out' || a._mode === 'dead') continue;
      // 실제 속도(QA 리드 계산용), 걸음 주기, 애니메이션
      if (dt > 0) { a.vx = (a.x - px) / dt; a.vz = (a.z - pz) / dt; }
      const sp = Math.hypot(a.vx, a.vz), run = sp > 2.6;
      a.gait = (a.gait + (sp * dt) / (run ? RUN_GAIT : WALK_GAIT)) % 1;
      a.anim = run ? 'run' : sp > 0.1 ? 'walk' : 'stand';
      if (a.state !== 'alert' && a.state !== 'flee') a.state = sp > 0.1 ? 'walk' : 'idle';
      this._pose(a, sp, dt);
    }
  }

  /** 판정에 영향을 주는 자세 값. actors.js가 같은 값으로 뼈를 움직이고 ballistics가 히트박스를 맞춘다 */
  _pose(a, sp, dt) {
    const P = a.pose;
    P.spd += (sp - P.spd) * (1 - Math.exp(-8 * dt));
    P.al += ((a.state === 'alert' ? 1 : 0) - P.al) * (1 - Math.exp(-6 * dt));
    P.walk = Math.min(1, P.spd / 0.9); P.run = Math.max(0, Math.min(1, (P.spd - 2.2) / 1.8));
    const al = P.al * (1 - P.walk), ph = a.gait * Math.PI * 2;
    P.lean = 0.04 * P.walk + 0.2 * P.run + 0.16 * al;                                                   // 척추에서 앞으로 숙임
    P.bob = (0.022 + 0.035 * P.run) * Math.cos(2 * ph) * P.walk - 0.02 * P.run - 0.04 * al;            // 걸음 두 번에 한 번 위아래, 달리기·경계는 낮게
    P.stride = (0.42 + 0.34 * P.run) * P.walk;                                                         // 허벅지 앞뒤 스윙 진폭
  }

  get(id) { return this._byId.get(id); }

  /** (session 전용) toVehicle 인물이 탑승할 때까지 예상 초. 탑승 뒤에는 차량이 경로 끝에 닿을 때까지. 해당 없음 -1 */
  _eta(id) {
    const a = this._byId.get(id);
    if (!a || a._d.behavior !== 'toVehicle' || a._mode === 'dead' || a.state === 'escaped') return -1;
    if (a.state === 'boarded') return a._veh ? carEta(a._veh) : -1;
    if (a._mode !== 'path' && a._mode !== 'alert') return -1;
    const P = a._d.path, n = P.length;
    let dist = Math.hypot(P[a._i][0] - a.x, P[a._i][1] - a.z);
    for (let i = a._i; i < n - 1; i++) dist += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    if (a._alerted) return Math.max(0, a._mode === 'alert' ? a._react : 0) + dist / RUN;
    return dist / (a._d.speed || 1.3) + Math.max(0, a._wait) + (n - 1 - a._i) * (a._d.wait || 0);
  }

  // ---------- 행동 ----------
  _idle(a, dt) { // 제자리. 가끔 고개를 돌리듯 기본 heading ±0.35rad 안에서 살짝 회전
    if ((a._lookT -= dt) <= 0) {
      a._lookT = 3 + this._rand() * 5;
      a._lookH = a._baseH + (this._rand() * 2 - 1) * 0.35;
    }
    a.heading = turn(a.heading, a._lookH, 2, dt);
  }

  _path(a, dt) {
    const p = a._d.path[a._i];
    if (a._wait > 0) { // 경유지 대기. 마지막 1초 동안 다음 점 쪽으로 몸을 돌림
      if ((a._wait -= dt) < 1) a.heading = turn(a.heading, Math.atan2(p[0] - a.x, p[1] - a.z), 4, dt);
      return;
    }
    if (this._moveTo(a, p[0], p[1], a._run ? RUN : a._d.speed || 1.3, dt)) this._arrive(a);
  }

  /** 경유지 a._i 도착 처리: 다음 인덱스와 대기 시간을 정하거나 경로를 끝낸다 */
  _arrive(a) {
    const d = a._d, n = d.path.length;
    if (d.behavior === 'patrol') {
      if (n < 2) return this._still(a);
      if (a._i + a._dir < 0 || a._i + a._dir >= n) a._dir = -a._dir;
      a._i += a._dir; a._wait = d.wait || 0;
    } else if (a._i >= n - 1) {
      if (d.behavior === 'toVehicle') this._board(a); else this._still(a);
    } else {
      a._i++; a._wait = a._run ? 0 : d.wait || 0;
    }
  }

  _escort(a, dt) {
    const f = a._follow;
    if (f._mode === 'dead' || f.state === 'escaped') { this._alert(a, f.x, f.z); a._mode = 'alert'; return; }
    if (f.state === 'boarded') { if (a._alerted) a._mode = 'alert'; else this._still(a); return; } // 대상 탑승 → 그 자리 idle
    if (f._alerted && !a._alerted) this._alert(a, f._tx, f._tz); // 경계해도 대상 곁을 지키며 따라 달림
    // 월드 위치 = 대상 + (dx·cos h + dz·sin h, −dx·sin h + dz·cos h), heading = 대상 heading
    const h = f.heading, c = Math.cos(h), s = Math.sin(h), o = a._d.offset || ZERO2;
    a.x = f.x + o[0] * c + o[1] * s; a.z = f.z - o[0] * s + o[1] * c;
    a.heading = h;
  }

  /** (tx,tz)로 sp m/s 직선 이동. 도착하면 true */
  _moveTo(a, tx, tz, sp, dt) {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz), step = sp * dt;
    if (d > 1e-6) a.heading = turn(a.heading, Math.atan2(dx, dz), 10, dt);
    if (d <= step) { a.x = tx; a.z = tz; return true; }
    a.x += (dx / d) * step; a.z += (dz / d) * step;
    return false;
  }

  _still(a) { a._mode = 'still'; a._baseH = a._lookH = a.heading; }

  _board(a) {
    const v = this._vById.get(a._d.vehicle);
    if (!v || v.state === 'gone') return this._escape(a);
    a._mode = 'out'; a.state = 'boarded'; a.anim = 'hidden'; a.vx = a.vz = 0; a._veh = v;
    if (v.state === 'parked') v.state = 'driving';
  }

  _escape(a) {
    a._mode = 'out'; a.state = 'escaped'; a.anim = 'hidden'; a.vx = a.vz = 0;
    bus.emit('escaped', { agentId: a.id, role: a.role, required: a.required });
  }

  // ---------- 경계 ----------
  _alert(a, sx, sz) {
    if (a._alerted || a._mode === 'dead' || a._mode === 'out') return;
    a._alerted = true; a.state = 'alert';
    a._tx = sx; a._tz = sz; a._react = (REACT + this._rand() * REACT_RND) * this._reactK;
    if (a._mode !== 'escort') a._mode = 'alert'; // 호위는 대상이 살아 있는 동안 곁을 지킨다
    bus.emit('alert', { agentId: a.id, pos: [a.x, a.y + BODY.head.y, a.z] });
  }

  /** 반응 시간이 끝남: VIP(toVehicle)는 남은 경로를 달려서 차로, 나머지는 가장 가까운 exit로 */
  _flee(a) {
    a.state = 'flee';
    if (a._d.behavior === 'toVehicle' && a._d.path.length && !a._veh) { a._mode = 'path'; a._run = true; a._wait = 0; return; }
    const ex = this.level.exits;
    let best = Infinity;
    for (let i = 0; i < ex.length; i++) {
      const d = Math.hypot(ex[i][0] - a.x, ex[i][1] - a.z);
      if (d < best) { best = d; a._tx = ex[i][0]; a._tz = ex[i][1]; }
    }
    if (best === Infinity) { a._mode = 'still'; return; }
    a._mode = 'flee';
  }

  _onImpact(e) {
    if (!this.level) return;
    const R = this.level.rules.alertRadius, p = e.pos;
    for (const a of this.agents) {
      const dx = a.x - p[0], dz = a.z - p[2];
      if (dx * dx + dz * dz <= R * R) this._alert(a, p[0], p[2]);
    }
  }

  _onHit(h) { // 명중 = 즉사. witnessRadius 안의 다른 인물은 경계
    const a = this._byId.get(h.agentId);
    if (!a || a._mode === 'dead' || a._mode === 'out') return;
    a._mode = 'dead'; a.state = 'dead'; a.anim = 'dead'; a.deadT = 0; a.vx = a.vz = 0;
    const P = a.pose; P.spd = P.walk = P.run = P.lean = P.bob = P.stride = 0;
    const R = this.level.rules.witnessRadius;
    for (const o of this.agents) {
      const dx = o.x - a.x, dz = o.z - a.z;
      if (o !== a && dx * dx + dz * dz <= R * R) this._alert(o, a.x, a.z);
    }
  }

  // ---------- 차량 ----------
  _drive(v, dt) {
    if (v.state !== 'driving') return;
    const P = v._path;
    v.speed = Math.min(CAR_MAX, v.speed + CAR_ACC * dt);
    let step = v.speed * dt;
    while (v._i < P.length) {
      const p = P[v._i], dx = p[0] - v.x, dz = p[1] - v.z, d = Math.hypot(dx, dz);
      if (d > 1e-6) v.heading = turn(v.heading, Math.atan2(dx, dz), 4, dt);
      if (d > step) { v.x += (dx / d) * step; v.z += (dz / d) * step; return; }
      v.x = p[0]; v.z = p[1]; step -= d; v._i++;
    }
    v.state = 'gone'; v.speed = 0; // 경로 끝 → 탑승자 탈출
    for (let i = 0; i < this.agents.length; i++) if (this.agents[i]._veh === v && this.agents[i].state === 'boarded') this._escape(this.agents[i]);
  }
}

/** 차량이 경로 끝까지 가는 예상 초(가속 포함) */
function carEta(v) {
  if (v.state === 'gone') return 0;
  const P = v._path;
  if (v._i >= P.length) return 0;
  let D = Math.hypot(P[v._i][0] - v.x, P[v._i][1] - v.z);
  for (let i = v._i; i < P.length - 1; i++) D += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
  const s = v.speed, dAcc = (CAR_MAX * CAR_MAX - s * s) / (2 * CAR_ACC);
  if (dAcc >= D) return (-s + Math.sqrt(s * s + 2 * CAR_ACC * D)) / CAR_ACC;
  return (CAR_MAX - s) / CAR_ACC + (D - dAcc) / CAR_MAX;
}
