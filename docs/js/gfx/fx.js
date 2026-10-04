// 이펙트 (graphics-dev): 탄 트레이서(풀 4), 착탄·명중 퍼프(빌보드 원판 풀 8), 비조준 발사 시 총구 화염·연기.
// 모두 생성자에서 한 번만 만들고 버퍼를 갱신한다(드로우콜 2). 프레임 루프에서 할당하지 않는다.
import * as THREE from '../../vendor/three.module.min.js';
import { bus } from '../bus.js';

const NT = 4, TV = 18, NP = 8, SEG = 8, PV = SEG * 3; // 트레이서 수·정점(리본 6 + 글로우 12), 퍼프 수, 원판 분할, 퍼프당 정점
const DEG = Math.PI / 180, PX = 2.4 / 390;     // 트레이서 폭 ≈ 화면 높이 390pt 기준 2.4pt(배율과 무관)
// [r, g, b, alpha, size0, size1, life, rise m/s, 세로 늘림]
const KIND = {
  ground: [0.72, 0.6, 0.45, 0.9, 0.3, 2.2, 0.75, 0.8, 1],
  water: [0.9, 0.96, 1, 0.95, 0.25, 1.4, 0.6, 1.6, 2.6],
  ripple: [0.85, 0.93, 1, 0.7, 0.4, 2.6, 0.7, 0, 0.35],
  building: [0.86, 0.84, 0.8, 0.75, 0.3, 1.8, 0.7, 0.4, 1],
  debris: [0.28, 0.26, 0.24, 0.95, 0.15, 0.8, 0.4, 0.1, 1], // 밝은 벽에서도 보이는 어두운 파편 코어
  hit: [0.9, 0.08, 0.06, 1, 0.25, 1.2, 0.6, 0.25, 1],
  flash: [1, 0.85, 0.45, 1, 0.06, 0.3, 0.08, 0, 1],
  smoke: [0.85, 0.85, 0.85, 0.45, 0.08, 0.5, 0.8, 0.3, 1],
};
const _cam = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3();
const _h = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Vector3();
const DIA = [[0, 1, 1, 1], [1, 1, 0, -1], [0, -1, 1, -1], [1, -1, 0, 1]]; // 마름모 삼각형: [축A(0=right,1=up), 부호, 축B, 부호]
const COS = [], SIN = [];
for (let k = 0; k <= SEG; k++) { COS.push(Math.cos((k / SEG) * Math.PI * 2)); SIN.push(Math.sin((k / SEG) * Math.PI * 2)); }

/** 트레이서 정점 1개: base + dir*off, 색 고정(밝은 황백), 알파 a */
function vtx(P, C, i, base, dir, off, a) {
  P[i * 3] = base.x + dir.x * off; P[i * 3 + 1] = base.y + dir.y * off; P[i * 3 + 2] = base.z + dir.z * off;
  C[i * 4] = 1; C[i * 4 + 1] = 0.93; C[i * 4 + 2] = 0.62; C[i * 4 + 3] = a;
}

function dynMesh(verts, mat, order) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false; m.renderOrder = order; m.matrixAutoUpdate = false;
  return m;
}

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.cam = null;
    const base = { vertexColors: true, transparent: true, depthWrite: false, fog: false };
    this.trace = dynMesh(NT * TV, new THREE.MeshBasicMaterial({ ...base, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 5);
    this.puff = dynMesh(NP * PV, new THREE.MeshBasicMaterial({ ...base, side: THREE.DoubleSide }), 4);
    scene.add(this.trace, this.puff);
    this.p = Array.from({ length: NP }, () => ({ on: false, t: 0, x: 0, y: 0, z: 0, k: KIND.ground }));
    this.dirty = true;
    bus.on('impact', (e) => {
      if (e.surface === 'water') { this._spawn('water', e.pos); this._spawn('ripple', e.pos); }
      else { this._spawn(e.surface === 'ground' ? 'ground' : 'building', e.pos); this._spawn('debris', e.pos); }
    });
    bus.on('hit', (e) => this._spawn('hit', e.pos));
    bus.on('shot', (s) => { // 비조준(소총 모델이 보일 때)만 총구 화염·연기
      const c = this._camera();
      if (s.scoped || !c) return;
      _m.set(0.38, -0.286, -1.64).applyMatrix4(c.matrixWorld);
      this._spawn('flash', _m); this._spawn('smoke', _m);
    });
    this.clear();
  }
  _camera() { return this.cam || (this.cam = this.scene.getObjectByProperty('isCamera', true) || null); }
  _spawn(kind, pos) {
    let best = this.p[0];
    for (const q of this.p) { if (!q.on) { best = q; break; } if (q.t / q.k[6] > best.t / best.k[6]) best = q; }
    best.on = true; best.t = 0; best.k = KIND[kind];
    best.x = pos.x ?? pos[0]; best.y = pos.y ?? pos[1]; best.z = pos.z ?? pos[2];
    this.dirty = true;
  }
  /** @param {number} dt @param {Array} bullets ballistics.bullets(풀) — active인 것만 그린다 */
  update(dt, bullets) {
    const c = this._camera();
    if (!c) return;
    const e = c.matrixWorld.elements;
    _cam.set(e[12], e[13], e[14]); _r.set(e[0], e[1], e[2]); _u.set(e[4], e[5], e[6]);
    const kpx = 2 * Math.tan((c.fov * DEG) / 2) * PX;
    // 트레이서: 탄 머리에서 진행 반대 방향으로 최대 24m 꼬리(발사점 3m 이내는 생략) + 머리 글로우(정면에서 봐도 보이게)
    const tp = this.trace.geometry.attributes.position, tc = this.trace.geometry.attributes.color, TP = tp.array, TC = tc.array;
    let n = 0;
    for (let i = 0; bullets && i < bullets.length && n < NT; i++) {
      const b = bullets[i];
      if (!b.active) continue;
      const trav = Math.hypot(b.x - b.ox, b.y - b.oy, b.z - b.oz);
      if (trav < 4) continue;
      _d.set(b.vx, b.vy, b.vz).normalize();
      _h.set(b.x, b.y, b.z); _t.copy(_h).addScaledVector(_d, -Math.min(24, trav - 3));
      _s.copy(_h).sub(_cam).cross(_d).normalize();
      const dh = _h.distanceTo(_cam), wh = dh * kpx, wt = _t.distanceTo(_cam) * kpx, g = dh * kpx * 4.5, o = n * TV;
      vtx(TP, TC, o, _t, _s, -wt, 0); vtx(TP, TC, o + 1, _t, _s, wt, 0); vtx(TP, TC, o + 2, _h, _s, wh, 1);
      vtx(TP, TC, o + 3, _t, _s, -wt, 0); vtx(TP, TC, o + 4, _h, _s, wh, 1); vtx(TP, TC, o + 5, _h, _s, -wh, 1);
      for (let k = 0; k < 4; k++) { // 마름모 4삼각형: 중심 불투명 → 가장자리 0
        const d = DIA[k], v = o + 6 + k * 3;
        vtx(TP, TC, v, _h, _r, 0, 1); vtx(TP, TC, v + 1, _h, d[0] ? _u : _r, d[1] * g, 0); vtx(TP, TC, v + 2, _h, d[2] ? _u : _r, d[3] * g, 0);
      }
      n++;
    }
    this.trace.geometry.setDrawRange(0, n * TV);
    if (n) { tp.needsUpdate = true; tc.needsUpdate = true; }
    // 퍼프: 카메라를 향한 원판, 커지며 사라짐
    const pp = this.puff.geometry.attributes.position, pc = this.puff.geometry.attributes.color, P = pp.array, C = pc.array;
    let any = this.dirty;
    for (let i = 0; i < NP; i++) {
      const q = this.p[i], k = q.k, o = i * PV;
      if (q.on && (q.t += dt) >= k[6]) { q.on = false; any = true; }
      if (!q.on) { if (this.dirty || any) for (let v = 0; v < PV; v++) C[(o + v) * 4 + 3] = 0; continue; }
      any = true;
      const f = q.t / k[6], a = k[3] * (1 - f), cy = q.y + k[7] * q.t, st = k[8];
      const dc = Math.hypot(q.x - _cam.x, q.y - _cam.y, q.z - _cam.z), grow = 1 - (1 - f) * (1 - f);
      const size = Math.max(k[4] + (k[5] - k[4]) * grow, dc * kpx * 5 * grow); // 비조준 원거리에서도 최소 약 12pt
      for (let s = 0; s < SEG; s++) {
        const b = (o + s * 3) * 3, cb = (o + s * 3) * 4;
        P[b] = q.x; P[b + 1] = cy; P[b + 2] = q.z;
        for (let j = 0; j < 2; j++) {
          const cs = COS[s + j] * size, sn = SIN[s + j] * size * st, w = b + 3 + j * 3;
          P[w] = q.x + _r.x * cs + _u.x * sn; P[w + 1] = cy + _r.y * cs + _u.y * sn; P[w + 2] = q.z + _r.z * cs + _u.z * sn;
        }
        for (let j = 0; j < 3; j++) { const w = cb + j * 4; C[w] = k[0]; C[w + 1] = k[1]; C[w + 2] = k[2]; C[w + 3] = j === 0 ? a : 0; }
      }
    }
    if (any) { pp.needsUpdate = true; pc.needsUpdate = true; }
    this.dirty = false;
  }
  clear() {
    for (const q of this.p) q.on = false;
    this.trace.geometry.setDrawRange(0, 0);
    this.puff.geometry.attributes.color.array.fill(0);
    this.puff.geometry.attributes.color.needsUpdate = true;
    this.dirty = true;
  }
}
