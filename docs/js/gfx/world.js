// 테마별 절차 생성 월드 (graphics-dev). 같은 seed → 같은 장면(util.rng).
// 정적 메시는 재질 하나로 병합(창문 = 128² 캔버스 텍스처를 면 크기 비례 월드 UV로 반복), 나무·컨테이너·상자는 InstancedMesh + setColorAt.
// 절차 배치물은 CONTRACT §4 배치 규칙(점·경로 선분·차량 반경 3m, 사선 1.2/1.62m, 도주로 2m)을 통과한 것만 놓고, extras는 그대로 배치한다.
import * as THREE from '../../vendor/three.module.min.js';
import { rng } from '../util.js';
import { prep, winUV, place, mergeGeometries, carGeo, shared } from './mesh.js';

const H = Math.PI / 2, TW = 16, TH = 14; // 창문 타일 1장 = 4칸(4m) × 4층(3.5m)
const EXTRA = { container: [12.2, 2.6, 2.44], stall: [3, 1.1, 1.6], wall: [8, 2.2, 0.4], crate: [1.2, 1.2, 1.2], car: [1.9, 1.45, 4.6], awning: [4, 2.75, 3], lamp: [0.3, 6, 0.3], tree: [4, 6, 4] };
const GREENS = [0x4caf50, 0x43a047, 0x66bb6a, 0x388e3c, 0x7cb342];
const CARS = [0xe53935, 0x1e88e5, 0xfdd835, 0xeceff1, 0x43a047, 0x263238, 0xfb8c00, 0x8e24aa];
const CONT = [0xd84315, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0x00897b, 0xef6c00, 0x607d8b, 0xc62828];
const FRUIT = [0xe53935, 0xfb8c00, 0xfdd835, 0x7cb342, 0x8e24aa, 0xfafafa];
const PAL = { // 바닥·건물은 인물보다 한 톤 차분하게
  downtown: { ground: 0xbdb8ae, road: 0x5d6168, roof: 0x8f8b86, b: [0xd9967e, 0x86aed6, 0xe0c784, 0x92c39b, 0xb99bd0, 0xe5dccb, 0x9fb0c2, 0xeba96f, 0x77b9b6] },
  harbor: { ground: 0xb5ada2, road: 0x6a6660, roof: 0x7d7a76, b: [0xa8b4c0, 0xc9a27e, 0x8fa9a0, 0xd8c8a8, 0x9a8fb0, 0xc7b39b] },
  market: { ground: 0xcdbfa6, road: 0x6b6560, roof: 0xa0705a, b: [0xe8a07a, 0x7fc4cc, 0xf0cf72, 0xc59ad6, 0x95cc92, 0xf09a9a, 0x9cc0e6, 0xf5e6c8] },
  night: { ground: 0x9097a2, road: 0x50545c, roof: 0x3a3d44, b: [0x4d5562, 0x5d5249, 0x46525c, 0x58606a, 0x4f4a58] },
  vip: { ground: 0xcfc8bb, road: 0x4a4d55, roof: 0x8a8580, b: [0xd8cfc0, 0xa9b8c8, 0xc8b49a, 0xb7c4b0, 0xe2d6c2, 0x9aa6b4] },
};
const _o = new THREE.Object3D(), _c = new THREE.Color();
const shade = (c, k) => _c.setHex(c).multiplyScalar(k).getHex();

/** 선분 a→b가 AABB와 만나는지(슬랩). 배치 검사 전용 */
function segBox(ax, ay, az, bx, by, bz, x0, y0, z0, x1, y1, z1) {
  const a = [ax, ay, az], d = [bx - ax, by - ay, bz - az], lo = [x0, y0, z0], hi = [x1, y1, z1];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return false; continue; }
    let u = (lo[i] - a[i]) / d[i], v = (hi[i] - a[i]) / d[i];
    if (u > v) { const t = u; u = v; v = t; }
    if (u > t0) t0 = u;
    if (v < t1) t1 = v;
    if (t0 > t1) return false;
  }
  return true;
}

/** 창문 텍스처 128². lit=false: 흰 벽 + 유리(낮·map), lit=true: 검은 벽 + 무작위로 켜진 창(밤·emissiveMap) */
function winTexture(lit, R) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = lit ? '#000' : '#fff'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x = i * 32 + 6, y = j * 32 + 7;
    if (lit) { if (R() < 0.42) { g.fillStyle = R() < 0.6 ? '#ffcf73' : '#fff0c4'; g.fillRect(x, y, 20, 18); } continue; }
    g.fillStyle = '#5d6f86'; g.fillRect(x, y, 20, 18);
    g.fillStyle = '#93abc6'; g.fillRect(x, y, 20, 5);
    g.fillStyle = '#e4e4e4'; g.fillRect(x + 9, y, 2, 18);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function containerGeo() { // 12.2×2.6×2.44, 골판 리브 포함(흰색 → 인스턴스 색이 곱해짐)
  const p = [prep(new THREE.BoxGeometry(12.2, 2.6, 2.44), 0xffffff, 0, 1.3, 0)];
  for (let i = -2; i <= 2; i++) p.push(prep(new THREE.BoxGeometry(0.14, 2.44, 2.52), 0xcfcfcf, i * 2.3, 1.3, 0));
  p.push(prep(new THREE.BoxGeometry(0.08, 2.4, 2.3), 0xb0b0b0, 6.12, 1.3, 0));
  return mergeGeometries(p);
}

/**
 * 레벨의 정적 월드를 만든다(땅, 건물, 소품, 플레이어 옥상). 하늘은 renderer가 그린다.
 * @returns {{ colliders: Array<{min:number[], max:number[], surface:string}>,
 *             surfaceAt(x:number, z:number): 'ground'|'water', dispose(): void }}
 */
export function buildWorld(scene, level) {
  const theme = PAL[level.theme] ? level.theme : 'downtown', P = PAL[theme], night = theme === 'night';
  shared.theme = theme;
  const R = rng(level.world.seed || 1), rr = (a, b) => a + (b - a) * R(), pick = (a) => a[(R() * a.length) | 0];
  const dens = level.world.density ?? 0.6, eye = level.player.pos;
  const parts = [], gp = [], gc = [], colliders = [], keep = [], sight = [], reserved = [];
  const inst = { box: [], cont: [], crown: [], trunk: [] };

  // ---------- 배치 규칙 (CONTRACT §4: 1 점 3m, 2 경로 선분 3m + 5m 샘플 사선, 3 차량 3m, 4 사선 1.2/1.62m, 5 도주로 2m) ----------
  const seg = (a, b, r) => keep.push([a[0], a[1], b[0], b[1], r]);
  for (const a of level.actors) {
    const pts = [a.pos, ...(a.path || [])], y = a.y || 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[i + 1] || p, n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 5));
      seg(p, q, 3);
      for (let k = 0; k <= n; k++) {
        const x = p[0] + ((q[0] - p[0]) * k) / n, z = p[1] + ((q[1] - p[1]) * k) / n;
        sight.push([x, y + 1.2, z], [x, y + 1.62, z]);
      }
    }
    let ex = null, bd = Infinity;
    for (const e of level.exits) { const d = Math.hypot(e[0] - a.pos[0], e[1] - a.pos[1]); if (d < bd) { bd = d; ex = e; } }
    if (ex) seg(a.pos, ex, 2);
  }
  for (const e of level.exits) seg(e, e, 3);
  for (const v of level.vehicles || []) { const p = [v.pos, ...(v.path || [])]; for (let i = 0; i < p.length; i++) seg(p[i], p[i + 1] || p[i], 3); }
  const overlaps = (x0, z0, x1, z1) => reserved.some((q) => x0 < q[2] && x1 > q[0] && z0 < q[3] && z1 > q[1]);
  const keepOut = (x0, z0, x1, z1) => keep.some((k) => segBox(k[0], 0, k[1], k[2], 0, k[3], x0 - k[4], -1, z0 - k[4], x1 + k[4], 1, z1 + k[4]));
  const los = (x0, y0, z0, x1, y1, z1) => sight.some((s) => segBox(eye[0], eye[1], eye[2], s[0], s[1], s[2], x0, y0, z0, x1, y1, z1));
  const free = (x0, z0, x1, z1, h) => !overlaps(x0, z0, x1, z1) && !keepOut(x0, z0, x1, z1) && !los(x0, 0, z0, x1, h, z1);
  // 높이 상한: 플레이어 주변은 눈높이 아래, 표적 쪽 시야 쐐기(가장 가까운 actor보다 앞)는 1~2층 → 비조준 화면에서 작전 구역이 한눈에 보임
  const near = Math.min(...level.actors.map((a) => Math.hypot(a.pos[0] - eye[0], a.pos[1] - eye[2])));
  const cap = (x, z) => {
    const dx = x - eye[0], dz = eye[2] - z, d = Math.hypot(dx, dz);
    if (dz > 0 && Math.abs(dx) < 30 + dz * 0.6 && d < near - 8) return d < near * 0.45 ? 7 : 0; // 0 = 건물 대신 주차장
    return eye[1] - 4 + Math.max(0, d - 50) * 0.35;
  };

  // ---------- 그리기 도우미 ----------
  const box = (x0, y0, z0, x1, y1, z1, c, top = c, win = 0) => {
    const g = prep(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), c, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, top);
    if (win) winUV(g, TW * win, TH, ((R() * 4) | 0) / 4);
    parts.push(g);
  };
  const rbox = (w, h, d, c, x, y, z, ry = 0, top = c) => parts.push(prep(new THREE.BoxGeometry(w, h, d), c, x, y + h / 2, z, ry, top));
  const quad = (x0, z0, x1, z1, y, c) => parts.push(prep(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)), c, (x0 + x1) / 2, y, (z0 + z1) / 2, 0, c, -H));
  const solid = (x0, y0, z0, x1, y1, z1, surface = 'prop') => colliders.push({ min: [x0, y0, z0], max: [x1, y1, z1], surface });
  function disc(x, y, z, ux, uy, uz, vx, vy, vz, r, col, a) { // 가산 글로우 원판(중심 불투명 → 가장자리 0)
    _c.setHex(col);
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2;
      const c0 = Math.cos(a0) * r, s0 = Math.sin(a0) * r, c1 = Math.cos(a1) * r, s1 = Math.sin(a1) * r;
      gp.push(x, y, z, x + ux * c0 + vx * s0, y + uy * c0 + vy * s0, z + uz * c0 + vz * s0, x + ux * c1 + vx * s1, y + uy * c1 + vy * s1, z + uz * c1 + vz * s1);
      gc.push(_c.r, _c.g, _c.b, a, _c.r, _c.g, _c.b, 0, _c.r, _c.g, _c.b, 0);
    }
  }
  const halo = (x, y, z, r, col, a) => { const dx = eye[0] - x, dz = eye[2] - z, l = Math.hypot(dx, dz) || 1; disc(x, y, z, dz / l, 0, -dx / l, 0, 1, 0, r, col, a); };
  function tree(x, z, c = pick(GREENS), s = rr(0.85, 1.15), check = true) {
    if (check && !free(x - 2 * s, z - 2 * s, x + 2 * s, z + 2 * s, 6 * s)) return;
    inst.trunk.push([x, 0, z, s, 2.5 * s, s, 0, 0x6d4c33]);
    inst.crown.push([x, 4.25 * s, z, 2 * s, 1.75 * s, 2 * s, R() * 6, c]);
    reserved.push([x - 1, z - 1, x + 1, z + 1]);
  }
  function lamp(x, z, pole = 0x37474f, light = 0, check = false) {
    if (check && (overlaps(x - 0.4, z - 0.4, x + 0.4, z + 0.4) || keepOut(x - 0.2, z - 0.2, x + 0.2, z + 0.2))) return;
    rbox(0.16, 6, 0.16, pole, x, 0, z); rbox(0.5, 0.18, 0.34, light ? 0xfff4d0 : 0xdedbd2, x, 5.85, z);
    if (light) { halo(x, 5.8, z, 2.8, light, 0.5); halo(x, 5.8, z, 0.6, 0xfffbea, 1); disc(x, 0.14, z, 1, 0, 0, 0, 0, 1, 7, light, 0.3); }
  }
  function car(x, z, ry, c, check = true, col = true) { // col=false: 장식용(주차장) — 충돌체 수를 줄여 탄도 판정 부담 감소
    const rot = Math.abs(Math.sin(ry)) > 0.5, hx = rot ? 2.3 : 0.95, hz = rot ? 0.95 : 2.3;
    if (check && !free(x - hx, z - hz, x + hx, z + hz, 1.45)) return;
    parts.push(place(carGeo(c), x, 0, z, ry));
    if (col) solid(x - hx, 0, z - hz, x + hx, 1.45, z + hz);
    reserved.push([x - hx - 0.5, z - hz - 0.5, x + hx + 0.5, z + hz + 0.5]);
  }
  function building(x0, z0, x1, z1, h, c, o = {}) {
    if (x1 - x0 < 4 || z1 - z0 < 4 || overlaps(x0, z0, x1, z1) || keepOut(x0, z0, x1, z1)) return false;
    h = Math.max(3.5, Math.min(h, cap((x0 + x1) / 2, (z0 + z1) / 2)));
    for (const t of [h, h * 0.55, 7]) { // 사선에 걸리면 낮춰서 재시도
      const hh = Math.max(3.5, Math.round(Math.min(t, h) / 3.5) * 3.5);
      if (los(x0, 0, z0, x1, hh, z1)) continue;
      box(x0, 0, z0, x1, hh, z1, c, o.roof ?? P.roof, o.bay || 1);
      solid(x0, 0, z0, x1, hh, z1, 'building'); reserved.push([x0, z0, x1, z1]);
      if (o.door) box((x0 + x1) / 2 - 3, 0, z1, (x0 + x1) / 2 + 3, Math.min(4.5, hh - 1), z1 + 0.15, 0x6b7078);
      if (x1 - x0 > 9 && z1 - z0 > 9 && R() < 0.7 && !los(x0, hh, z0, x1, hh + 3, z1)) {
        const ax = rr(x0 + 2, x1 - 5), az = rr(z0 + 2, z1 - 5);
        box(ax, hh, az, ax + rr(2, 3.5), hh + rr(1.2, 2.4), az + rr(2, 3.5), 0xb4b8bd);
        if (R() < 0.4) parts.push(prep(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 8), 0x9c8a74, rr(x0 + 2, x1 - 2), hh + 1.2, rr(z0 + 2, z1 - 2)));
      }
      return true;
    }
    return false;
  }
  function lots(x0, z0, x1, z1, hf, pal, o) { // BSP로 블록을 필지로 나눠 건물 배치
    const w = x1 - x0, d = z1 - z0;
    if (w < 5 || d < 5) return;
    if ((w <= (o.max || 26) && d <= (o.max || 26)) || w * d < 120) {
      if (cap((x0 + x1) / 2, (z0 + z1) / 2) <= 0) return parking(x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6);
      if (R() < dens + 0.3) building(x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, hf((x0 + x1) / 2, (z0 + z1) / 2), pick(pal), o);
      else if (o.park !== false) { tree(rr(x0 + 2, x1 - 2), rr(z0 + 2, z1 - 2)); tree(rr(x0 + 2, x1 - 2), rr(z0 + 2, z1 - 2)); }
      return;
    }
    const sx = w > d, m = Math.max(4, Math.round((rr(0.35, 0.65) * (sx ? w : d)) / 2) * 2);
    if (sx) { lots(x0, z0, x0 + m, z1, hf, pal, o); lots(x0 + m, z0, x1, z1, hf, pal, o); }
    else { lots(x0, z0, x1, z0 + m, hf, pal, o); lots(x0, z0 + m, x1, z1, hf, pal, o); }
  }
  function parking(x0, z0, x1, z1) { // 낮은 차량만 → 작전 구역 앞을 가리지 않음
    quad(x0, z0, x1, z1, 0.04, shade(P.road, 1.35));
    for (let x = x0 + 1.6; x + 1.6 < x1; x += 3) {
      quad(x - 1.55, z0 + 0.8, x - 1.45, z1 - 0.8, 0.08, 0xdedede);
      if (R() < 0.45 && z1 - z0 > 6) car(x, (z0 + z1) / 2, 0, pick(CARS), true, false);
    }
  }
  function grid(xs, zs, hf, o = {}) { // 도로 중심선 사이 블록(인도 3m) 채우기
    const s = 8;
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++)
      lots(xs[i] + s, Math.min(zs[j], zs[j + 1]) + s, xs[i + 1] - s, Math.max(zs[j], zs[j + 1]) - s, hf, o.pal || P.b, o);
  }
  const DASH = night ? 0xc9b458 : 0xeeeae0;
  function roadZ(x, z0, z1, w = 10) { quad(x - w / 2, z0, x + w / 2, z1, 0.05, P.road); for (let z = Math.max(z0, -330) + 3; z + 3 < z1; z += 10) quad(x - 0.12, z, x + 0.12, z + 3, 0.1, DASH); }
  function roadX(z, x0, x1, w = 10) { quad(x0, z - w / 2, x1, z + w / 2, 0.05, P.road); for (let x = Math.max(x0, -300) + 3; x + 3 < Math.min(x1, 300); x += 10) quad(x, z - 0.12, x + 3, z + 0.12, 0.1, DASH); }
  function zebra(cx, cz, alongX) {
    for (let i = -4; i <= 4; i++) {
      if (alongX) quad(cx - 1.5, cz + i * 1.1 - 0.3, cx + 1.5, cz + i * 1.1 + 0.3, 0.1, 0xf4f4f0);
      else quad(cx + i * 1.1 - 0.3, cz - 1.5, cx + i * 1.1 + 0.3, cz + 1.5, 0.1, 0xf4f4f0);
    }
  }

  // ---------- extras: 디자이너 의도 그대로(CONTRACT §4 치수표) ----------
  function extra(e) {
    const ry = e.rot || 0, c = e.color ?? 0x888888, s = EXTRA[e.type] || [1, 1, 1], cs = Math.cos(ry), sn = Math.sin(ry);
    const L = (lx, lz) => [e.x + lx * cs + lz * sn, e.z - lx * sn + lz * cs];
    const rot = Math.abs(sn) > 0.5, hx = (rot ? s[2] : s[0]) / 2, hz = (rot ? s[0] : s[2]) / 2;
    if (['container', 'stall', 'wall', 'crate'].includes(e.type)) solid(e.x - hx, 0, e.z - hz, e.x + hx, s[1], e.z + hz);
    if (e.type !== 'car') reserved.push([e.x - hx - 0.8, e.z - hz - 0.8, e.x + hx + 0.8, e.z + hz + 0.8]);
    switch (e.type) {
      case 'container': inst.cont.push([e.x, 0, e.z, 1, 1, 1, ry, c]); break;
      case 'crate': rbox(1.2, 1.2, 1.2, c, e.x, 0, e.z, ry, shade(c, 1.25)); rbox(1.24, 0.12, 1.24, shade(c, 0.7), e.x, 0.54, e.z, ry); break;
      case 'wall': rbox(8, 2.2, 0.4, c, e.x, 0, e.z, ry, shade(c, 0.75)); break;
      case 'car': car(e.x, e.z, ry, c, false); break;
      case 'stall':
        rbox(3, 1.0, 1.6, c, e.x, 0, e.z, ry, 0xf4ecdc);
        for (let i = -2; i <= 2; i++) { const p = L(i * 0.56, 0.15); rbox(0.44, 0.1, 0.9, FRUIT[(i + 2 + Math.abs((e.x * 7) | 0)) % FRUIT.length], p[0], 1.0, p[1], ry); }
        break;
      case 'awning':
        for (const px of [-1.9, 1.9]) for (const pz of [-1.4, 1.4]) { const p = L(px, pz); rbox(0.08, 2.6, 0.08, 0x6d4c41, p[0], 0, p[1], ry); }
        for (let i = 0; i < 4; i++) { const p = L(-1.5 + i, 0); rbox(1, 0.15, 3, i % 2 ? 0xfafafa : c, p[0], 2.6, p[1], ry); }
        break;
      case 'lamp': lamp(e.x, e.z, night ? 0x3a3f47 : c, night ? c : 0); break;
      case 'tree': tree(e.x, e.z, c, 1, false); break;
    }
  }

  // ---------- 플레이어 옥상: 옥상 = 눈높이 −1.3m, 앞 1m에 낮은 난간(상단 눈 −0.74m → 35° 아래, pitch 하한 24°보다 아래) ----------
  function rooftop() {
    const [px, ey, pz] = eye, ry = ey - 1.3, fz = pz - 1.0, rc = night ? 0x5b6068 : 0x8a8d92;
    box(px - 9, 0, fz, px + 9, ry, pz + 24, pick(P.b), night ? 0x4a4d55 : 0xa29d94, 1);
    solid(px - 9, 0, fz, px + 9, ry, pz + 24, 'building');
    box(px - 9, ry, fz, px + 9, ry + 0.14, fz + 0.3, rc);
    box(px - 9, ry + 0.5, fz + 0.08, px + 9, ry + 0.56, fz + 0.2, rc);
    for (let x = px - 8.85; x < px + 9; x += 1.475) box(x - 0.03, ry, fz + 0.11, x + 0.03, ry + 0.5, fz + 0.17, rc);
    for (const sx of [-9, 9]) box(px + sx - 0.06, ry + 0.5, fz, px + sx + 0.06, ry + 0.56, pz + 6, rc);
    reserved.push([px - 13, fz - 3, px + 13, pz + 30]);
  }

  // ---------- 테마 ----------
  function downtown() {
    const xs = [-252, -190, -130, -70, -8, 22, 84, 146, 208, 270], zs = [70, 6, -88, -150, -220, -290, -360, -430, -520];
    for (const x of xs) roadZ(x, -520, 70);
    for (const z of zs) roadX(z, -400, 400);
    for (const x of [-8, 22]) for (const z of [-88, -150]) { zebra(x, z + 7.5, false); zebra(x, z - 7.5, false); zebra(x - 7.5, z, true); zebra(x + 7.5, z, true); }
    for (const x of [-8, 22]) for (let z = -16; z > -330; z -= 13) {
      tree(x - 6.5, z); tree(x + 6.5, z);
      if (R() < 0.45) lamp(x + (R() < 0.5 ? -6.3 : 6.3), z - 6.5, 0x37474f, 0, true);
      if (R() < 0.3) car(x + (R() < 0.5 ? -2.6 : 2.6), z - 6, 0, pick(CARS));
    }
    grid(xs, zs, (x, z) => rr(10, 30) + Math.max(0, -z - 140) * 0.12 + (R() < 0.15 ? rr(15, 35) : 0));
  }
  function harbor() { // 물: 플레이어 앞 운하(z −110~−40)와 바다(z < −275). 육지 야적장 z −275~−110
    const W = 0x2f6f96, Q = 0x857f76;
    quad(-1000, -40, 1000, 300, 0, P.ground); quad(-1000, -275, 1000, -110, 0, 0xaaa398);
    quad(-1000, -110, 1000, -40, -0.5, W); quad(-1000, -1100, 1000, -275, -0.5, W);
    box(-1000, -0.7, -40.3, 1000, 0, -40, Q); box(-1000, -0.7, -110, 1000, 0, -109.7, Q); box(-1000, -0.7, -275.3, 1000, 0, -275, Q);
    quad(-400, -112.3, 400, -111.9, 0.05, 0xf2c94c);
    for (let i = 0; i < 70; i++) { const z = i < 25 ? rr(-108, -42) : rr(-700, -280), x = rr(-350, 350); quad(x, z, x + rr(3, 12), z + rr(0.25, 0.6), -0.48, i % 3 ? 0x4f8fb4 : 0xf0b080); }
    for (const [x, c] of [[-150, 0xd84a3a], [-75, 0xf2b632], [75, 0xd84a3a], [150, 0xf2b632]]) crane(x, -269, c);
    let row = 0;
    for (let z = -121; z > -262; z -= 7, row++) {
      if (row % 4 === 3) continue; // 통로
      for (let x = -180; x < 180; x += 14) {
        if (R() > dens) continue;
        const cx = x + rr(-0.8, 0.8), n = 1 + ((R() * (Math.abs(x) > 70 ? 3 : 2)) | 0), h = n * 2.6;
        if (!free(cx - 6.2, z - 1.3, cx + 6.2, z + 1.3, h)) continue;
        for (let k = 0; k < n; k++) inst.cont.push([cx, k * 2.6, z, 1, 1, 1, 0, pick(CONT)]);
        solid(cx - 6.1, 0, z - 1.22, cx + 6.1, h, z + 1.22); reserved.push([cx - 6.5, z - 1.5, cx + 6.5, z + 1.5]);
      }
    }
    ship(-110, -350, 150, 0x8e2b2b); ship(170, -420, 120, 0x22406e); ship(20, -540, 170, 0x2e5d4b);
    const sheds = { max: 45, bay: 1.5, park: false };
    lots(-330, -265, -128, -116, () => rr(9, 16), P.b, sheds); lots(128, -265, 330, -116, () => rr(9, 16), P.b, sheds);
    lots(-330, -34, -14, 60, () => rr(8, 26), P.b, {}); lots(14, -34, 330, 60, () => rr(8, 26), P.b, {});
    for (let x = -200; x <= 200; x += 9) if (!overlaps(x - 0.3, -112.6, x + 0.3, -112) && !keepOut(x - 0.3, -112.6, x + 0.3, -112)) inst.box.push([x, 0, -112.3, 0.45, 0.6, 0.45, 0, 0x3b3b3b]);
  }
  function crane(x, z, c) {
    if (overlaps(x - 9, z - 7, x + 9, z + 7) || keepOut(x - 9, z - 7, x + 9, z + 7) || los(x - 9, 0, z - 62, x + 9, 45, z + 32)) return;
    for (const sx of [-8, 7.2]) for (const sz of [-6, 5.2]) { box(x + sx, 0, z + sz, x + sx + 0.8, 30, z + sz + 0.8, c); solid(x + sx, 0, z + sz, x + sx + 0.8, 30, z + sz + 0.8); }
    box(x - 8, 27, z - 6, x + 8, 29, z - 5.2, c); box(x - 8, 27, z + 5.2, x + 8, 29, z + 6, c);
    box(x - 8, 12, z - 6, x - 7.2, 13, z + 6, c); box(x + 7.2, 12, z - 6, x + 8, 13, z + 6, c);
    box(x - 1.3, 30, z - 62, x + 1.3, 32.5, z + 30, c); box(x - 3.5, 32.5, z + 2, x + 3.5, 37, z + 10, 0xf1f1f1);
    box(x - 0.6, 32.5, z + 18, x + 0.6, 44, z + 19.2, c);
    reserved.push([x - 9, z - 7, x + 9, z + 7]);
  }
  function ship(x, z, len, c) {
    const x0 = x - len / 2, x1 = x + len / 2;
    box(x0, -0.5, z - 9, x1, 7, z + 9, c, 0x7a5a48); solid(x0, -0.5, z - 9, x1, 7, z + 9, 'building');
    box(x1 - 22, 7, z - 7, x1 - 8, 19, z + 7, 0xf2f2f2, 0xd0d0d0, 1); box(x1 - 16, 19, z - 1.5, x1 - 12, 25, z + 1.5, 0x30343a);
    for (let cx = x0 + 10; cx < x1 - 36; cx += 12.6) for (const r of [-1.4, 1.4]) {
      const n = 1 + ((R() * 2) | 0);
      for (let k = 0; k < n; k++) inst.cont.push([cx + 6.1, 7 + k * 2.6, z + r * 1.8, 1, 1, 1, 0, pick(CONT)]);
    }
  }
  function market() { // 노점 두 줄 사이 통로(z −125~−157)·입구(x −10~10)·골목(x ≈ −45, 52)은 광장 예약 + 경로 규칙으로 비움
    const xs = [-262, -196, -130, -72, 78, 140, 206, 270], zs = [70, 6, -100, -194, -262, -330, -400, -480];
    for (const x of xs) roadZ(x, -480, 70, 9);
    for (const z of zs) roadX(z, -400, 400, 9);
    quad(-67, -189, 73, -95, 0.03, 0xe8d8b8);
    for (let i = 0; i < 23; i++) for (let j = 0; j < 16; j++) if ((i + j) & 1) quad(-66 + i * 6, -190 + j * 6, -60 + i * 6, -184 + j * 6, 0.06, 0xdcc8a2);
    for (let x = -62; x <= 68; x += 13) { tree(x, -98.5, pick(GREENS), 0.8); tree(x, -186, pick(GREENS), 0.8); }
    for (const [x, z] of [[-64, -104], [70, -104], [-64, -182], [70, -182], [-64, -142], [70, -142]]) lamp(x, z, 0x37474f, 0, true);
    reserved.push([-68, -190, 74, -94]);
    grid(xs, zs, (x, z) => rr(7, 15) + Math.max(0, -z - 250) * 0.06, { max: 24 });
  }
  function warehouse() { // night: 창고 단지. 단지 마당은 비우고 둘레에 펜스·가로등
    const xs = [-250, -170, -98, 101, 175, 255], zs = [70, 4, -132, -252, -330, -420, -520];
    for (const x of xs) roadZ(x, -520, 70);
    for (const z of zs) roadX(z, -400, 400);
    quad(-93, -247, 96, -137, 0.03, 0xa3a9b2);
    fence(-93, -137, 96, -137); fence(-93, -247, 96, -247); fence(-93, -247, -93, -137); fence(96, -247, 96, -137);
    for (const z of [-20, -70, -120, -170, -220, -280]) { lamp(-104, z, 0x3a3f47, 0xffd27a, true); lamp(107, z, 0x3a3f47, 0xffd27a, true); }
    for (const x of [-60, -20, 40, 80]) lamp(x, -127.5, 0x3a3f47, 0xffd27a, true);
    for (let i = 0; i < 16; i++) {
      const x = rr(-86, 86), z = rr(-242, -142), r = R() < 0.5, hx = r ? 1.3 : 6.2, hz = r ? 6.2 : 1.3, n = 1 + ((R() * 2) | 0);
      if (!free(x - hx, z - hz, x + hx, z + hz, n * 2.6)) continue;
      for (let k = 0; k < n; k++) inst.cont.push([x, k * 2.6, z, 1, 1, 1, r ? H : 0, pick([0x455a64, 0x5d4037, 0x37474f, 0x6d4c41, 0x4e5b31])]);
      solid(x - hx + 0.1, 0, z - hz + 0.1, x + hx - 0.1, n * 2.6, z + hz - 0.1); reserved.push([x - hx, z - hz, x + hx, z + hz]);
    }
    reserved.push([-96, -250, 99, -134]);
    grid(xs, zs, () => rr(8, 15), { max: 42, bay: 1.5, door: true, park: false });
  }
  function fence(x0, z0, x1, z1) { // 4m 패널. 도주로·경로와 겹치는 패널은 생략(= 출입구)
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 4), c = 0x8d96a0;
    for (let i = 0; i < n; i++) {
      const ax = x0 + ((x1 - x0) * i) / n, az = z0 + ((z1 - z0) * i) / n, bx = x0 + ((x1 - x0) * (i + 1)) / n, bz = z0 + ((z1 - z0) * (i + 1)) / n;
      const lx = Math.min(ax, bx) - 0.04, hx = Math.max(ax, bx) + 0.04, lz = Math.min(az, bz) - 0.04, hz = Math.max(az, bz) + 0.04;
      if (keepOut(lx, lz, hx, hz)) continue;
      box(ax - 0.05, 0, az - 0.05, ax + 0.05, 2.2, az + 0.05, c);
      box(lx, 2.0, lz, hx, 2.07, hz, c); box(lx, 1.0, lz, hx, 1.05, hz, c);
    }
  }
  function vip() { // 호텔 정면 z −312.5(정문 x −40), 진입로 z −288~−298은 건물 금지
    const xs = [-300, -235, -170, -100, -30, 40, 140, 205, 270], zs = [70, 6, -70, -140, -205, -262, -293, -365, -430, -510];
    for (const z of zs) roadX(z, -400, 400);
    for (const x of [-300, -235, -170, 140, 205, 270]) roadZ(x, -510, 70);
    for (const x of [-100, -30, 40]) roadZ(x, -262, 70);
    quad(-170, -312.5, 136, -298, 0.03, 0xe9dfcf); quad(-170, -287.5, 136, -271, 0.03, 0x93bf7e);
    hotel();
    for (let x = -160; x <= 130; x += 15) tree(x, -280);
    fountain(-100, -305); fountain(85, -305);
    for (let x = -146; x <= 66; x += 10) {
      if (!free(x - 3, -310.5, x + 3, -308.7, 0.6)) continue;
      box(x - 3, 0, -310.5, x + 3, 0.55, -308.7, 0x7b8f5a, pick([0xe57399, 0xffd54f, 0xff8a65, 0xba68c8]));
      reserved.push([x - 3, -310.5, x + 3, -308.7]);
    }
    for (let x = -150; x <= 130; x += 7.5) if (R() < 0.45) car(x, -296.6, H, pick(CARS));
    for (let x = -165; x <= 135; x += 25) lamp(x, -299.6, 0xcfd8dc, 0, true);
    reserved.push([-172, -366, 138, -262]);
    grid(xs, zs, (x, z) => (z < -360 ? rr(55, 120) : rr(10, 30)));
  }
  function hotel() {
    const rf = 0x9a8f80;
    box(-110, 0, -345, 30, 56, -312.5, 0xf0e2c6, rf, 1); solid(-110, 0, -345, 30, 56, -312.5, 'building');
    for (const [a, b] of [[-150, -110], [30, 70]]) { box(a, 0, -340, b, 24.5, -316, 0xe2cdaa, rf, 1); solid(a, 0, -340, b, 24.5, -316, 'building'); }
    box(-112, 56, -347, 32, 59.5, -310.5, 0xcdb48a);
    box(-100, 0, -312.5, 20, 5.2, -312.3, 0x3a4858); box(-44, 0, -312.3, -36, 3.8, -312.2, 0x24292f); // 로비 유리·정문(정면 바깥)
    if (!los(-48, 4.4, -312.5, -32, 4.9, -304)) box(-48, 4.4, -312.5, -32, 4.9, -304, 0xc9a45c, 0xb08d57);
    quad(-41.3, -312.4, -38.7, -301, 0.07, 0xb71c1c);
  }
  function fountain(x, z) {
    if (!free(x - 3.4, z - 3.4, x + 3.4, z + 3.4, 2.6)) return;
    const st = 0xd9d2c5;
    parts.push(prep(new THREE.CylinderGeometry(3.3, 3.4, 0.7, 12), st, x, 0.35, z), prep(new THREE.CylinderGeometry(2.95, 2.95, 0.1, 12), 0x6ec6f0, x, 0.62, z),
      prep(new THREE.CylinderGeometry(0.35, 0.5, 2.0, 8), st, x, 1.0, z), prep(new THREE.CylinderGeometry(1.2, 0.4, 0.3, 10), st, x, 2.15, z, 0, 0x8fd3f5));
    solid(x - 3.4, 0, z - 3.4, x + 3.4, 0.7, z + 3.4); reserved.push([x - 3.6, z - 3.6, x + 3.6, z + 3.6]);
  }

  // ---------- 생성 ----------
  if (theme !== 'harbor') quad(-1000, -1100, 1000, 300, 0, P.ground);
  for (const e of level.world.extras || []) extra(e);
  rooftop();
  ({ downtown, harbor, market, night: warehouse, vip })[theme]();

  // ---------- 메시화: 정적 1 + 인스턴스 ≤4 + (밤) 글로우 1 ----------
  const group = new THREE.Group(), geos = [], mats = [], texs = [], insts = [];
  const tex = winTexture(false, R), mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
  texs.push(tex); mats.push(mat);
  if (night) {
    const lit = winTexture(true, R);
    texs.push(lit); mat.emissiveMap = lit; mat.emissive.setHex(0xffffff);
    mat.userData.nv = (on) => mat.emissive.setHex(on ? 0x9cff9c : 0xffffff);
  }
  const add = (o) => { o.matrixAutoUpdate = false; o.updateMatrix(); group.add(o); return o; };
  const sg = mergeGeometries(parts); parts.length = 0;
  geos.push(sg); add(new THREE.Mesh(sg, mat));
  const TPL = {
    box: () => prep(new THREE.BoxGeometry(1, 1, 1), 0xffffff, 0, 0.5, 0), cont: containerGeo,
    crown: () => prep(new THREE.IcosahedronGeometry(1, 0), 0xffffff), trunk: () => prep(new THREE.CylinderGeometry(0.18, 0.26, 1, 6), 0xffffff, 0, 0.5, 0),
  };
  for (const k in inst) {
    const list = inst[k];
    if (!list.length) continue;
    const g = TPL[k](), m = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((d, i) => {
      _o.position.set(d[0], d[1], d[2]); _o.scale.set(d[3], d[4], d[5]); _o.rotation.set(0, d[6], 0); _o.updateMatrix();
      m.setMatrixAt(i, _o.matrix); m.setColorAt(i, _c.setHex(d[7]));
    });
    m.computeBoundingSphere(); geos.push(g); insts.push(m); add(m);
  }
  if (gp.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(gc, 4));
    g.computeBoundingSphere();
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    gm.userData.nv = (on) => gm.color.setHex(on ? 0x9cff9c : 0xffffff);
    geos.push(g); mats.push(gm); add(new THREE.Mesh(g, gm)).renderOrder = 2;
  }
  scene.add(group);

  return {
    colliders,
    surfaceAt: theme === 'harbor' ? (x, z) => ((z < -40 && z > -110) || z < -275 ? 'water' : 'ground') : () => 'ground',
    dispose() {
      scene.remove(group);
      for (const m of insts) m.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}
