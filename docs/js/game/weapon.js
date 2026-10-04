// 조준(드래그/자이로), 스코프·줌, 흔들림·숨참기, 반동, 볼트액션, 탄창·재장전. 발사 시 'shot' 이벤트.
// 흔들림·반동은 view 자체에 적용한다 → 크로스헤어(화면 중앙)가 곧 탄이 나가는 방향. 비조준만 hipSpread 산포가 붙는다.
// 프레임 루프에서 할당 없음(이벤트 payload 제외).
import { bus } from '../bus.js';
import { BALANCE as B } from '../data/levels.js';
import { DEG, clamp, damp, rng, dirFromYawPitch } from '../util.js';

const TAU = Math.PI * 2;
const BOLT_SFX = 0.25;            // 발사 → 볼트 조작 소리까지(초)
const DRIFT = 0.3;                // 저주파 드리프트 진폭(swayAmp 배수)
const DRIFT_F = [0.07, 0.053];    // 드리프트 주파수(Hz) yaw, pitch
const SWAY_LAMBDA = 6;            // 숨 참기/해제 시 흔들림 배수가 바뀌는 속도(약 0.3초)

export class Weapon {
  constructor() {
    /** 렌더러에 넘기는 최종 시점(흔들림·반동 포함). 객체 재사용 */
    this.view = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: B.hipFov };
    /** HUD가 읽는 상태. 객체 재사용 */
    this.status = {
      mag: 0, magSize: B.magSize, reserve: 0, scoped: false, zoomIdx: 0, zoomLabel: '',
      boltT: 1, reloadT: 1, breath: 1, holding: false, exhausted: false, canFire: true,
    };
    this.assist = { noSway: false };
    this.level = null;
    this._dir = [0, 0, 0];
    this._rand = Math.random;
    this.baseYaw = 0; this.basePitch = 0;   // 플레이어가 겨눈 기준 조준(흔들림·반동 제외)
    this.offYaw = 0; this.offPitch = 0;     // 흔들림 + 반동 오프셋
    this.recYaw = 0; this.recPitch = 0;     // 반동(지수 복귀)
    this.swayT = 0; this.phase = 0; this.swayMul = 1;
    this.swayK = 1; this.breathMax = B.breathMax;   // 난이도 배수(level.difficulty) 적용값
    this.bolt = 0; this.boltSfx = 0; this.reloading = 0; this.exhaleT = 0; this.needRelease = false;
  }

  reset(level) {
    this.level = level;
    const p = level.player, s = this.status, v = this.view;
    this._rand = rng(((level.world && level.world.seed) || level.id) * 7 + 3);
    const D = level.difficulty;
    this.swayK = D ? D.sway : 1; this.breathMax = B.breathMax * (D ? D.breath : 1);
    this.baseYaw = p.yaw; this.basePitch = p.pitch;
    v.x = p.pos[0]; v.y = p.pos[1]; v.z = p.pos[2]; v.yaw = p.yaw; v.pitch = p.pitch; v.fov = B.hipFov;
    s.mag = B.magSize; s.magSize = B.magSize; s.reserve = level.weapon.reserve;
    s.scoped = false; s.zoomIdx = 0; s.zoomLabel = '';
    s.boltT = 1; s.reloadT = 1; s.breath = 1; s.holding = false; s.exhausted = false; s.canFire = true;
    this.offYaw = this.offPitch = this.recYaw = this.recPitch = 0;
    this.swayT = this._rand() * 60; this.phase = this._rand() * TAU;
    this.swayMul = this.assist.noSway ? 0 : 1;
    this.bolt = this.boltSfx = this.reloading = this.exhaleT = 0; this.needRelease = false;
  }

  /** 스코프 상태 지정(입력 처리와 디버그/QA 공용). 'scope' 이벤트를 보낸다 */
  setScope(on, zoomIdx = this.status.zoomIdx) {
    const s = this.status, w = this.level.weapon;
    s.scoped = !!on;
    s.zoomIdx = clamp(zoomIdx | 0, 0, w.scopeFovs.length - 1);
    s.zoomLabel = s.scoped ? w.zoomLabels[s.zoomIdx] : '';
    this.view.fov = s.scoped ? w.scopeFovs[s.zoomIdx] : B.hipFov;
    bus.emit('scope', { on: s.scoped, zoomIdx: s.zoomIdx });
  }

  /**
   * @param {number} dt 초
   * @param {object} input InputState (createInput().poll())
   * @param {number} viewportH 캔버스 CSS 높이(px) — 드래그 감도 = 시야각/화면높이
   */
  update(dt, input, viewportH) {
    const s = this.status, L = this.level, v = this.view;
    if (!L) return;
    // 1) 조준: 화면 높이만큼 드래그 = 시야 하나. 자이로는 스코프 중 sqrt(fov/hipFov)배로 둔하게
    const k = ((v.fov * DEG) / Math.max(1, viewportH)) * B.aimSens;
    const g = s.scoped ? Math.sqrt(v.fov / B.hipFov) : 1;
    const P = L.player;
    this.baseYaw = clamp(this.baseYaw - input.aimDX * k + input.gyroYaw * g, P.yawLimit[0], P.yawLimit[1]);
    this.basePitch = clamp(this.basePitch - input.aimDY * k + input.gyroPitch * g, P.pitchLimit[0], P.pitchLimit[1]);

    // 2) 스코프 토글 / 줌 단계(+1: 비조준→0단계, 마지막→0 순환 · −1: 이전 단계, 0단계면 해제)
    const n = L.weapon.scopeFovs.length;
    if (input.scope) this.setScope(!s.scoped);
    if (input.zoom > 0) this.setScope(true, s.scoped ? (s.zoomIdx + 1) % n : 0);
    else if (input.zoom < 0 && s.scoped) {
      if (s.zoomIdx > 0) this.setScope(true, s.zoomIdx - 1); else this.setScope(false);
    }

    // 3) 숨 참기 스태미나
    this._breath(dt, !!input.breath);

    // 4) 볼트 / 재장전
    if (this.bolt > 0) this.bolt = Math.max(0, this.bolt - dt);
    if (this.boltSfx > 0 && (this.boltSfx -= dt) <= 0) {
      this.boltSfx = 0;
      if (s.mag > 0) bus.emit('bolt', {}); // 마지막 탄 뒤에는 볼트 대신 재장전 소리
    }
    if (this.reloading > 0 && (this.reloading -= dt) <= 0) {
      this.reloading = 0;
      const m = Math.min(s.magSize - s.mag, s.reserve);
      s.mag += m; s.reserve -= m;
      bus.emit('reload', { phase: 'end' });
    }
    if (this.reloading === 0 && s.mag < s.magSize && s.reserve > 0 && (input.reload || (s.mag === 0 && this.boltSfx === 0))) {
      this.reloading = B.reloadTime;
      bus.emit('reload', { phase: 'start' });
    }
    s.boltT = 1 - this.bolt / B.boltTime;
    s.reloadT = this.reloading > 0 ? 1 - this.reloading / B.reloadTime : 1;
    s.canFire = this.bolt === 0 && this.reloading === 0 && s.mag > 0;

    // 5) 최종 view = 기준 조준 + 흔들림 + 반동
    this._sway(dt);

    // 6) 발사
    if (input.fire) {
      if (s.canFire) this._fire();
      else if (s.mag === 0 && s.reserve === 0) bus.emit('dryfire', {});
    }
  }

  _breath(dt, want) {
    const s = this.status;
    if (!want) this.needRelease = false;
    if (s.exhausted) { // 강제 호흡: 버튼 무시
      s.holding = false;
      if ((this.exhaleT -= dt) <= 0) { this.exhaleT = 0; s.exhausted = false; }
    } else if (want && !this.needRelease && s.breath > 0) {
      s.holding = true;
      s.breath -= dt / this.breathMax;
      if (s.breath <= 0) { // 한계 → 강제 호흡, 버튼을 한 번 떼야 다시 참을 수 있음
        s.breath = 0; s.holding = false; s.exhausted = true; this.exhaleT = B.exhaleTime; this.needRelease = true;
      }
    } else {
      s.holding = false;
      s.breath = Math.min(1, s.breath + dt / B.breathRecover);
    }
  }

  _sway(dt) {
    const s = this.status, v = this.view;
    const target = s.exhausted ? B.exhaleMul : s.holding ? B.breathMul : 1;
    this.swayMul = this.assist.noSway ? 0 : damp(this.swayMul, target, SWAY_LAMBDA, dt);
    const t = (this.swayT += dt), m = this.swayMul * B.swayAmp * this.swayK, ph = this.phase;
    const sy = m * (Math.sin(TAU * B.swayFreq[0] * t) + DRIFT * Math.sin(TAU * DRIFT_F[0] * t + ph * 2));
    const sp = m * (Math.sin(TAU * B.swayFreq[1] * t + ph) + DRIFT * Math.sin(TAU * DRIFT_F[1] * t + 1.7));
    const r = Math.exp(-B.recoilReturn * dt);
    this.recYaw *= r; this.recPitch *= r;
    this.offYaw = sy + this.recYaw; this.offPitch = sp + this.recPitch;
    v.yaw = this.baseYaw + this.offYaw;
    v.pitch = this.basePitch + this.offPitch;
    v.fov = s.scoped ? this.level.weapon.scopeFovs[s.zoomIdx] : B.hipFov;
  }

  _fire() {
    const s = this.status, v = this.view, noSway = this.assist.noSway;
    s.mag--; s.canFire = false; s.boltT = 0;
    this.bolt = B.boltTime; this.boltSfx = BOLT_SFX;
    let yaw = v.yaw, pitch = v.pitch;
    if (!s.scoped && !noSway) { // 비조준 산포: 반경 hipSpread 원 안에 균일
      const r = B.hipSpread * Math.sqrt(this._rand()), th = TAU * this._rand();
      yaw += (r * Math.cos(th)) / Math.max(0.2, Math.cos(pitch)); pitch += r * Math.sin(th);
    }
    const d = dirFromYawPitch(yaw, pitch, this._dir);
    bus.emit('shot', { origin: [v.x, v.y, v.z], dir: [d[0], d[1], d[2]], scoped: s.scoped, zoomIdx: s.zoomIdx });
    if (!noSway) { // 반동: 위로 튀고 좌우로 살짝, recoilReturn 속도로 기준 조준에 복귀(기준 조준은 그대로)
      const ky = (this._rand() - 0.5) * B.recoilKick * 0.5;
      this.recPitch += B.recoilKick; this.recYaw += ky;
      this.offPitch += B.recoilKick; this.offYaw += ky;
      v.yaw = this.baseYaw + this.offYaw; v.pitch = this.basePitch + this.offPitch;
    }
  }

  /** 디버그/QA용: 화면 중앙(흔들림 제외)이 (x,y,z)를 향하도록 기준 조준을 맞춘다 */
  aimAt(x, y, z) {
    const v = this.view, dx = x - v.x, dy = y - v.y, dz = z - v.z;
    this.baseYaw = Math.atan2(-dx, -dz);
    this.basePitch = Math.atan2(dy, Math.hypot(dx, dz));
    v.yaw = this.baseYaw + this.offYaw; v.pitch = this.basePitch + this.offPitch;
  }

  /** {noSway}: 흔들림·반동·산포를 0으로 */
  setAssist(o) {
    Object.assign(this.assist, o);
    if (this.assist.noSway) {
      this.swayMul = 0; this.offYaw = this.offPitch = this.recYaw = this.recPitch = 0;
      this.view.yaw = this.baseYaw; this.view.pitch = this.basePitch;
    }
  }
}
