// WebAudio 합성 사운드(음원 파일 없음) (mobile-ios-dev). 게임 이벤트를 생성자에서 구독.
// iOS: 첫 탭에서 AudioContext 생성 + resume + 1샘플 무음 재생. interrupted/suspended가 되면 다음 탭에서 다시 resume.
// 저격총 소리(총성·볼트·재장전·빈 격발)는 첫 탭 직후 샘플 단위로 미리 합성(사전 렌더링)해 버퍼로 재생한다:
//   총성 = 초음속 크랙(N파) + 총구 폭발(차단 주파수가 내려가는 노이즈) + 저역 쿵(포화) + 건물 메아리 + 우르릉 꼬리(스테레오), 3종 무작위.
//   볼트 = 손잡이 올림 → 당김(마찰) → 걸림 → 밀기 → 약실 폐쇄 → 잠금 + 탄피가 옥상 바닥에 튕기는 소리. 금속음은 비조화 공진 모드 합성.
import { bus } from '../bus.js';

const VOL = 0.8;
const TAU = Math.PI * 2;
const safe = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); };
const rnd = () => Math.random() * 2 - 1;

// ---------- 샘플 합성 (순수 함수: Float32Array에 더해 쓴다) ----------
const METAL = [[1, 1, 1], [2.76, 0.55, 0.7], [5.4, 0.3, 0.45], [8.93, 0.18, 0.3]]; // 강철 부품: [주파수 배수, 진폭, 감쇠 배수]
const BRASS = [[1, 1, 1.6], [2.32, 0.55, 1.1], [4.07, 0.3, 0.7]];                 // 황동 탄피: 높고 길게 울림

/** 금속 충돌음: 짧은 고역 틱 + 감쇠 공진 모드(재귀 오실레이터) */
function clink(out, sr, t0, f, gain, decay, modes = METAL) {
  const i0 = Math.floor(t0 * sr);
  if (i0 >= out.length) return;
  for (const [k, a, dk] of modes) {
    const w = (TAU * f * k * (0.98 + Math.random() * 0.04)) / sr;
    if (w >= Math.PI) continue;
    const tau = decay * dk * sr, d = Math.exp(-1 / tau), c2 = 2 * Math.cos(w), n = Math.min(out.length - i0, Math.floor(tau * 7));
    const ph = Math.random() * TAU;
    let y1 = Math.sin(ph), y2 = Math.sin(ph - w), env = a * gain;
    for (let i = 0; i < n; i++) { const y0 = c2 * y1 - y2; y2 = y1; y1 = y0; out[i0 + i] += env * y0; env *= d; }
  }
  const m = Math.min(out.length - i0, Math.floor(0.003 * sr));
  let hp = 0, px = 0;
  for (let i = 0; i < m; i++) { const x = rnd(); hp = 0.6 * (hp + x - px); px = x; out[i0 + i] += hp * gain * 0.9 * (1 - i / m); }
}

/** 마찰음(볼트·탄창이 미끄러짐): 대역통과 노이즈 × 거친 진폭 요동 */
function scrape(out, sr, t0, dur, f, gain) {
  const i0 = Math.floor(t0 * sr), n = Math.min(out.length - i0, Math.floor(dur * sr));
  const w = (TAU * f) / sr, al = Math.sin(w) / 5, a0 = 1 + al; // Q 2.5 대역통과(RBJ)
  const b0 = al / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, g = 0, gt = 0;
  for (let i = 0; i < n; i++) {
    if (i % 90 === 0) gt = 0.3 + Math.random();
    g += (gt - g) * 0.05;
    const x = rnd(), y = b0 * (x - x2) - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i0 + i] += y * g * gain * Math.sin((Math.PI * i) / n);
  }
}

/** 둔탁한 충돌(탄창이 바닥에 떨어짐): 저역 감쇠 사인 + 짧은 저역 노이즈 */
function thud(out, sr, t0, f, gain) {
  const i0 = Math.floor(t0 * sr), n = Math.min(out.length - i0, Math.floor(0.25 * sr));
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    lp += 0.08 * (rnd() - lp);
    out[i0 + i] += gain * (Math.sin(TAU * f * t) * Math.exp(-t / 0.045) + lp * 3 * Math.exp(-t / 0.012));
  }
}

/** 채널들을 함께 피크 정규화 */
function normalize(chs, peak) {
  let pk = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
  const k = peak / (pk || 1);
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
  return chs;
}

/** 저격총 총성(스테레오 [L, R]). 직접음 → 건물 메아리(멀수록 고역이 깎임, 좌우 번갈아) → 우르릉 꼬리 */
function gunshot(sr) {
  const n = Math.floor(sr * 2.6), L = new Float32Array(n), R = new Float32Array(n), D = new Float32Array(Math.floor(sr * 0.45));
  const kb = 0.85 + Math.random() * 0.3, fb = 34 + Math.random() * 10;
  let l1 = 0, l2 = 0, ph = 0;
  for (let i = 0; i < D.length; i++) {
    const t = i / sr, atk = Math.min(1, t / 0.0005);
    let x = t < 0.0009 ? 1 - t / 0.00045 : t < 0.0012 ? -1 + (t - 0.0009) / 0.0003 : 0;  // 초음속 크랙: N파(+1 → −1 → 0)
    x += rnd() * 0.6 * Math.exp(-t / 0.0015);                                             // 크랙 고역 성분
    const a = 1 - Math.exp((-TAU * (220 + 6500 * Math.exp(-t / 0.018))) / sr);
    const z = rnd(); l1 += a * (z - l1); l2 += a * (l1 - l2);
    x += l2 * kb * 2.4 * atk * (0.7 * Math.exp(-t / 0.014) + 0.3 * Math.exp(-t / 0.1));   // 총구 폭발: 밝게 터졌다가 빠르게 어두워짐
    ph += (TAU * (fb + 80 * Math.exp(-t / 0.022))) / sr;
    x += Math.sin(ph) * 0.95 * atk * Math.exp(-t / 0.08);                                  // 저역 쿵: 음높이가 내려가는 사인
    D[i] = Math.tanh(x * 1.5);                                                             // 포화 → 펀치
  }
  for (let i = 0; i < D.length; i++) { L[i] += D[i]; R[i] += D[i]; }
  // 건물 반사(슬랩백): [지연 s, 크기, 오른쪽 비율]
  for (const [d, g, p] of [[0.09, 0.3, 0.86], [0.2, 0.22, 0.14], [0.33, 0.16, 0.9], [0.5, 0.11, 0.18], [0.78, 0.07, 0.78], [1.12, 0.045, 0.25]]) {
    const o = Math.floor(d * sr * (0.93 + Math.random() * 0.14)), a = 1 - Math.exp((-TAU * (2600 / (1 + d * 7))) / sr);
    const gl = g * Math.sqrt(1 - p) * 1.41, gr = g * Math.sqrt(p) * 1.41;
    let y = 0, y2 = 0;
    for (let i = 0; i < D.length && o + i < n; i++) { y += a * (D[i] - y); y2 += a * (y - y2); L[o + i] += y2 * gl; R[o + i] += y2 * gr; }
  }
  // 우르릉 꼬리: 좌우 독립 저역 노이즈 × 느린 요동, 차단 주파수가 내려가며 사라짐
  let a1 = 0, b1 = 0, a2 = 0, b2 = 0, wb = 1, wt = 1;
  const s0 = Math.floor(0.015 * sr);
  for (let i = s0; i < n; i++) {
    const t = i / sr;
    if (i % 512 === 0) wt = 0.45 + Math.random() * 1.1;
    wb += (wt - wb) * 0.003;
    const a = 1 - Math.exp((-TAU * (110 + 1000 * Math.exp(-t / 0.2))) / sr);
    a1 += a * (rnd() - a1); b1 += a * (a1 - b1); a2 += a * (rnd() - a2); b2 += a * (a2 - b2);
    const e = Math.min(1, (t - 0.015) / 0.08) * Math.exp(-t / 0.6) * wb * 0.9;
    L[i] += b1 * e; R[i] += b2 * e;
  }
  for (let i = 0; i < n; i++) { const f = Math.min(1, (n - i) / (0.05 * sr)); L[i] = Math.tanh(L[i]) * f; R[i] = Math.tanh(R[i]) * f; }
  return normalize([L, R], 0.95);
}

/** 볼트 조작(발사 0.25초 뒤 'bolt'부터): 올림 → 당김 → 걸림·배출 → 밀기 → 폐쇄 → 잠금, 탄피가 바닥에 튕김 */
function boltSfx(sr) {
  const o = new Float32Array(Math.floor(sr * 0.95));
  clink(o, sr, 0, 1850, 0.45, 0.03);
  scrape(o, sr, 0.035, 0.12, 3300, 0.8);
  clink(o, sr, 0.16, 2500, 0.6, 0.025);
  scrape(o, sr, 0.27, 0.09, 2700, 0.65);
  clink(o, sr, 0.365, 1250, 0.8, 0.045);
  clink(o, sr, 0.445, 2100, 0.45, 0.025);
  for (const [t, g] of [[0.52, 0.2], [0.645, 0.11], [0.725, 0.06], [0.775, 0.035]]) clink(o, sr, t, 4300 + Math.random() * 400, g, 0.05, BRASS);
  return normalize([o], 0.8);
}

/** 재장전 시작(2.2초 뒤 'end'): 볼트 열기 → 탄창 해제·빠짐·바닥에 떨어짐 → 새 탄창 삽입·걸림 */
function reloadStartSfx(sr) {
  const o = new Float32Array(Math.floor(sr * 1.75));
  clink(o, sr, 0, 1850, 0.45, 0.03);
  scrape(o, sr, 0.035, 0.12, 3300, 0.8);
  clink(o, sr, 0.16, 2500, 0.55, 0.025);
  clink(o, sr, 0.48, 2900, 0.35, 0.015);
  scrape(o, sr, 0.52, 0.08, 1800, 0.45);
  thud(o, sr, 0.74, 150, 0.5); clink(o, sr, 0.745, 900, 0.25, 0.02);
  scrape(o, sr, 1.32, 0.07, 1600, 0.5);
  clink(o, sr, 1.4, 1100, 0.85, 0.04);
  clink(o, sr, 1.46, 2400, 0.45, 0.02);
  return normalize([o], 0.75);
}

/** 재장전 끝: 볼트 밀기 → 약실 폐쇄 → 잠금 */
function reloadEndSfx(sr) {
  const o = new Float32Array(Math.floor(sr * 0.4));
  scrape(o, sr, 0, 0.08, 2700, 0.65);
  clink(o, sr, 0.09, 1250, 0.8, 0.045);
  clink(o, sr, 0.17, 2100, 0.45, 0.025);
  return normalize([o], 0.75);
}

/** 빈 격발: 공이가 헛치는 가벼운 딸깍 */
function dryFireSfx(sr) {
  const o = new Float32Array(Math.floor(sr * 0.15));
  clink(o, sr, 0, 3100, 0.4, 0.012);
  clink(o, sr, 0.012, 1700, 0.15, 0.01);
  return normalize([o], 0.5);
}

/** 테스트·분석용(브라우저 밖에서도 실행 가능한 순수 합성 함수) */
export const synth = { gunshot, boltSfx, reloadStartSfx, reloadEndSfx, dryFireSfx };

export function createAudio() {
  let ctx = null, master = null, verb = null, noise = null, enabled = true;
  const SFX = { shot: [], bolt: null, rlStart: null, rlEnd: null, dry: null };

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 미지원 */ } // 무음 스위치와 무관하게 재생
    ctx = new AC();
    // 리미터에 가깝게: 총성 피크만 살짝 누르고 타격감은 살린다(기본값 −24dB·12:1은 총성을 납작하게 만듦)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.001; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = enabled ? VOL : 0;
    master.connect(comp);
    const sr = ctx.sampleRate;
    noise = ctx.createBuffer(1, sr, sr); // 1초 백색소음, 기타 효과음이 재사용
    const nd = noise.getChannelData(0);
    for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
    const len = Math.floor(sr * 1.4), ir = ctx.createBuffer(2, len, sr); // 잔향 임펄스(감쇠 노이즈)
    for (let c = 0; c < 2; c++) { const a = ir.getChannelData(c); for (let i = 0; i < len; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; }
    verb = ctx.createConvolver();
    verb.buffer = ir;
    const vg = ctx.createGain();
    vg.gain.value = 0.35;
    verb.connect(vg).connect(master);
    setTimeout(bake, 0); // 탭 처리를 막지 않도록 다음 틱에 합성
    return true;
  }

  // ---------- 사전 렌더링 버퍼 ----------
  const toBuf = (chs) => {
    const b = ctx.createBuffer(chs.length, chs[0].length, ctx.sampleRate);
    chs.forEach((c, i) => b.getChannelData(i).set(c));
    return b;
  };
  function bakeTools() {
    if (SFX.bolt) return;
    const sr = ctx.sampleRate;
    SFX.bolt = toBuf(boltSfx(sr)); SFX.rlStart = toBuf(reloadStartSfx(sr)); SFX.rlEnd = toBuf(reloadEndSfx(sr)); SFX.dry = toBuf(dryFireSfx(sr));
  }
  const bakeShot = () => SFX.shot.push(toBuf(gunshot(ctx.sampleRate)));
  function bake() { // 총성 1종 + 도구음을 먼저, 나머지 총성 2종은 나눠서(아이폰에서 한 번에 수십 ms 막지 않게)
    if (!ctx) return;
    if (!SFX.shot.length) bakeShot();
    bakeTools();
    setTimeout(() => { if (SFX.shot.length < 2) bakeShot(); setTimeout(() => { if (SFX.shot.length < 3) bakeShot(); }, 50); }, 50);
  }
  const playBuf = (b, t, gain, rate) => {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = b; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g).connect(master);
    s.start(t);
  };
  const jit = (k) => 1 - k + Math.random() * 2 * k;

  const ready = () => ctx && enabled && ctx.state === 'running';
  const play = (fn) => { if (ready()) try { fn(ctx.currentTime); } catch (e) { /* 소리만 생략 */ } };
  const envelope = (g, t, a, peak, d) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const send = (g, rev) => { if (rev) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r).connect(verb); } };
  function hiss(t, { dur = 0.1, type = 'lowpass', f = 1000, f2 = 0, q = 0.8, vol = 0.4, rev = 0 }) {
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    envelope(g, t, 0.002, vol, dur);
    s.connect(fl).connect(g).connect(master);
    send(g, rev);
    s.start(t, Math.random() * 0.4, dur + 0.05);
  }
  function tone(t, { f = 440, f2 = 0, dur = 0.15, type = 'sine', vol = 0.2, a = 0.004, rev = 0 }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    envelope(g, t, a, vol, dur);
    o.connect(g).connect(master);
    send(g, rev);
    o.start(t);
    o.stop(t + a + dur + 0.05);
  }

  // ---------- 게임 이벤트 → 효과음 ----------
  bus.on('shot', (e) => play((t) => {
    if (!SFX.shot.length) bakeShot();
    playBuf(SFX.shot[(Math.random() * SFX.shot.length) | 0], t, e && e.scoped ? 1 : 0.85, jit(0.04)); // 스코프 중엔 귀에 가까워 조금 더 크게
  }));
  bus.on('bolt', () => play((t) => { bakeTools(); playBuf(SFX.bolt, t, 0.9, jit(0.03)); }));
  bus.on('reload', (e) => play((t) => { bakeTools(); playBuf(e && e.phase === 'end' ? SFX.rlEnd : SFX.rlStart, t, 0.85, jit(0.02)); }));
  bus.on('dryfire', () => play((t) => { bakeTools(); playBuf(SFX.dry, t, 0.8, jit(0.05)); }));
  bus.on('scope', (e) => play((t) => { hiss(t, { dur: 0.05, type: 'bandpass', f: 1800, q: 3, vol: 0.12 }); tone(t, { f: e && e.on ? 620 : 420, dur: 0.05, vol: 0.05 }); }));
  bus.on('hit', (h) => play((t) => {
    hiss(t, { dur: 0.12, f: 520, vol: 0.55 });            // 퍽
    tone(t, { f: 150, f2: 60, dur: 0.12, vol: 0.3 });
    if (h && h.role === 'civilian') tone(t + 0.05, { f: 110, dur: 0.45, type: 'sawtooth', vol: 0.12 });
    else if (h && h.part === 'head') { tone(t + 0.02, { f: 1320, dur: 0.55, vol: 0.2 }); tone(t + 0.02, { f: 2640, dur: 0.3, vol: 0.06 }); } // 딩
  }));
  bus.on('impact', (e) => play((t) => {
    if (e && e.surface === 'water') hiss(t, { dur: 0.35, type: 'bandpass', f: 1400, f2: 380, q: 1.2, vol: 0.22 });
    else hiss(t, { dur: 0.12, f: 1500, f2: 400, vol: 0.16 });
    if (e && (e.surface === 'vehicle' || e.surface === 'prop')) tone(t, { f: 950, f2: 760, dur: 0.14, type: 'triangle', vol: 0.06 });
  }));
  bus.on('alert', () => play((t) => { tone(t, { f: 880, dur: 0.1, type: 'square', vol: 0.06 }); tone(t + 0.14, { f: 660, dur: 0.12, type: 'square', vol: 0.06 }); }));
  bus.on('nv', (e) => play((t) => { if (e && e.on) tone(t, { f: 1500, f2: 5200, dur: 0.4, vol: 0.04 }); }));
  bus.on('missionEnd', (r) => play((t) => {
    const notes = r && r.success ? [523, 659, 784, 1047] : [392, 330, 262];
    notes.forEach((f, i) => tone(t + i * (r.success ? 0.12 : 0.18), { f, dur: 0.38, type: 'triangle', vol: 0.18, rev: 0.4 }));
  }));
  bus.on('*', (type) => { if (type.startsWith('ui:')) play((t) => tone(t, { f: 1250, dur: 0.03, type: 'triangle', vol: 0.1 })); });

  // 전화·Siri 등으로 interrupted/suspended가 된 뒤 다음 탭에서 다시 깨운다
  const kick = () => { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) safe(ctx.resume()); };
  for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, kick, true);

  return {
    /** 반드시 사용자 제스처(탭) 핸들러 안에서 호출 */
    unlock() {
      try {
        if (!ctx && !build()) return;
        if (ctx.state !== 'running') safe(ctx.resume());
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) { /* 오디오 없이 진행 */ }
    },
    setEnabled(b) {
      enabled = !!b;
      if (master) master.gain.setTargetAtTime(enabled ? VOL : 0, ctx.currentTime, 0.02);
    },
    suspend() { if (ctx && ctx.state === 'running') safe(ctx.suspend()); },
    resume() { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') safe(ctx.resume()); },
  };
}
