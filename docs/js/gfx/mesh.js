// 지오메트리 가공·병합 유틸 (graphics-dev, examples/jsm 의존 없음). 빌드 시점 전용 — 프레임 루프에서 호출하지 않는다.
import * as THREE from '../../vendor/three.module.min.js';

/** 창문 텍스처의 '벽' 픽셀 UV. 무늬가 없는 면(지붕·소품)은 모두 이 한 점을 샘플한다. */
export const PLAIN_UV = 1.5 / 128;
/** gfx 모듈 간 공유 상태(world.js가 테마를 기록 → actors.js가 야간 손전등 여부 판단) */
export const shared = { theme: '' };

const _m = new THREE.Matrix4(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _c = new THREE.Color();

/** 행렬 적용 헬퍼: 회전(rx 먼저, 그다음 ry) 후 이동 */
export function place(g, x = 0, y = 0, z = 0, ry = 0, rx = 0) {
  _e.set(rx, ry, 0, 'YXZ');
  return g.applyMatrix4(_m.makeRotationFromEuler(_e).setPosition(x, y, z));
}

/** 인덱스 제거 + 배치 + 단색 칠하기(위를 향한 면은 top색) + UV를 PLAIN으로. 원본 geo는 해제된다. */
export function prep(geo, color, x = 0, y = 0, z = 0, ry = 0, top = color, rx = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  place(g, x, y, z, ry, rx);
  const n = g.attributes.position.count, nr = g.attributes.normal.array, col = new Float32Array(n * 3);
  _c.setHex(color); const r = _c.r, gr = _c.g, b = _c.b; _c.setHex(top);
  for (let i = 0; i < n; i++) {
    const t = nr[i * 3 + 1] > 0.6;
    col[i * 3] = t ? _c.r : r; col[i * 3 + 1] = t ? _c.g : gr; col[i * 3 + 2] = t ? _c.b : b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(PLAIN_UV), 2));
  return g;
}

/** 옆면에 월드 평면 UV(창문 타일 tw×th m)를 준다. 윗면·밑면은 PLAIN. 층·칸이 건물끼리 맞물린다. */
export function winUV(g, tw, th, offU = 0) {
  const p = g.attributes.position.array, nr = g.attributes.normal.array, uv = g.attributes.uv.array;
  for (let i = 0, n = p.length / 3; i < n; i++) {
    if (Math.abs(nr[i * 3 + 1]) > 0.5) continue;
    uv[i * 2] = (Math.abs(nr[i * 3]) > 0.5 ? p[i * 3 + 2] : p[i * 3]) / tw + offU;
    uv[i * 2 + 1] = p[i * 3 + 1] / th;
  }
  return g;
}

/** non-indexed로 바꿔 position/normal/color(3)/uv를 하나로 병합. 빠진 속성은 기본값(흰색, PLAIN UV). 입력은 해제된다. */
export function mergeGeometries(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1);
  const uv = new Float32Array(n * 2).fill(PLAIN_UV);
  let o = 0;
  for (const g of list) {
    const a = g.attributes;
    pos.set(a.position.array, o * 3);
    if (a.normal) nrm.set(a.normal.array, o * 3);
    if (a.color && a.color.itemSize === 3) col.set(a.color.array, o * 3);
    if (a.uv) uv.set(a.uv.array, o * 2);
    o += a.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  for (const g of list) g.dispose();
  return out;
}

/** 로우폴리 세단(VEHICLE.sedan 4.6×1.9×1.45, 로컬 +Z = 앞). world 정적 차량과 actors 차량이 공유 */
export function carGeo(color) {
  const B = (w, h, d, c, x, y, z, top = c) => prep(new THREE.BoxGeometry(w, h, d), c, x, y + h / 2, z, 0, top);
  const p = [B(1.9, 0.62, 4.6, color, 0, 0.28, 0), B(1.62, 0.55, 2.4, 0x2a3440, 0, 0.9, -0.25, color)];
  for (const sx of [-0.82, 0.82]) for (const sz of [-1.45, 1.45]) p.push(B(0.24, 0.56, 0.64, 0x1b1b1b, sx, 0, sz));
  for (const sx of [-0.6, 0.6]) p.push(B(0.42, 0.14, 0.04, 0xfff6d0, sx, 0.66, 2.31), B(0.42, 0.14, 0.04, 0xd32f2f, sx, 0.66, -2.31));
  return mergeGeometries(p);
}
