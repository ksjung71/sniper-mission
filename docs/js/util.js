// 공용 수학 유틸 (PM 소유)
export const DEG = Math.PI / 180;

// 시드 고정 난수(mulberry32). rng(seed)() → [0,1)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// 프레임레이트와 무관한 지수 감쇠 보간. lambda가 클수록 빨리 b에 수렴
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
// 각도를 (-PI, PI]로
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

// 카메라 규약: rotation.order='YXZ', rotation.y=yaw, rotation.x=pitch.
// yaw=0,pitch=0 이면 -Z를 바라봄. yaw>0 = 왼쪽으로 회전, pitch>0 = 위를 봄.
export function dirFromYawPitch(yaw, pitch, out = [0, 0, 0]) {
  const cp = Math.cos(pitch);
  out[0] = -Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = -Math.cos(yaw) * cp;
  return out;
}

// 인물/차량 heading 규약: 정면 벡터 = (sin h, 0, cos h). 경로 이동 시 heading = headingTo(dx, dz)
export const headingTo = (dx, dz) => Math.atan2(dx, dz);
