// QA 자동 테스트 (qa-tester 소유). 기준: design/CONTRACT.md v1.1 (§7 이벤트, §8 DOM, §10 디버그 API, §11 예산, §12 소유권)
// 참고값: design/GDD.md §9.7, docs/js/data/levels.js (좌표·예상값은 가능한 한 __SNIPER__.actors()/level()로 런타임에 읽는다)
//
// 사용:  cd tests
//        node qa.mjs                 전체 실행(시나리오 1~16)
//        node qa.mjs --only 5,8      일부만 실행 (기존 qa-results.json이 있으면 해당 시나리오만 교체해 합침, --no-merge로 끔)
//        node qa.mjs --quick         성능 샘플 짧게(워밍업 1초 + 2초)
//        node qa.mjs --headful       창을 띄워서 실행
//        node qa.mjs --out <폴더>    qa-results.json / QA_REPORT.md 저장 위치 (기본: tests/)
//        node qa.mjs --list          시나리오 목록
// 전제: 서버 실행 중 (python tools/serve.py --quiet → http://localhost:8123/docs/). 게임 코드는 수정하지 않는다.
// 스크린샷: tests/screenshots/qa-*.png
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openGame, sleep, BASE, IPHONE_LANDSCAPE } from './smoke.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(HERE, 'screenshots');
const IPHONE_PORTRAIT = { ...IPHONE_LANDSCAPE, width: IPHONE_LANDSCAPE.height, height: IPHONE_LANDSCAPE.width, isLandscape: false };
const DEG = Math.PI / 180;

// ───────────────────────────── 옵션 ─────────────────────────────
const ARGS = process.argv.slice(2);
const argVal = (k) => {
  const i = ARGS.findIndex((a) => a === k || a.startsWith(k + '='));
  if (i < 0) return null;
  return ARGS[i].includes('=') ? ARGS[i].slice(ARGS[i].indexOf('=') + 1) : ARGS[i + 1] ?? '';
};
const OPT = {
  only: (argVal('--only') || '').split(',').map((s) => parseInt(s, 10)).filter((n) => n > 0),
  quick: ARGS.includes('--quick'),
  headful: ARGS.includes('--headful'),
  list: ARGS.includes('--list'),
  noMerge: ARGS.includes('--no-merge'),
  out: argVal('--out') ? path.resolve(argVal('--out')) : HERE,
};
const PERF_WARM = OPT.quick ? 1000 : 1500;
const PERF_DUR = OPT.quick ? 2000 : 5000;

// 계약 값을 런타임에 못 읽을 때 쓰는 기본값 (CONTRACT §3, levels.js BALANCE)
const FALLBACK = {
  BALANCE: { hipFov: 50, muzzle: 850, boltTime: 1.0, reloadTime: 2.2, magSize: 5, aimSens: 1.0 },
  BUDGET: { drawCalls: 100, tris: 120000 },
  BODY: { head: { y: 1.62, r: 0.13 }, torso: { y0: 0.9, y1: 1.5, hw: 0.24, hd: 0.15 } },
  VEHICLE: { sedan: { l: 4.6, w: 1.9, h: 1.45 } },
};
// CONTRACT §4 extras 치수표 중 충돌체가 있는 것 (로컬 X × 높이 × Z)
const EXTRA_DIM = { container: [12.2, 2.6, 2.44], stall: [3.0, 1.1, 1.6], wall: [8.0, 2.2, 0.4], car: [1.9, 1.45, 4.6], crate: [1.2, 1.2, 1.2] };

// CONTRACT §12 파일 소유권 → 의심 파일과 담당 에이전트
const FILES = {
  main: ['docs/js/main.js', 'PM'], debug: ['docs/js/debug.js', 'PM'], serve: ['tools/serve.py', 'PM'],
  levels: ['docs/js/data/levels.js', 'game-designer'],
  renderer: ['docs/js/gfx/renderer.js', 'graphics-dev'], world: ['docs/js/gfx/world.js', 'graphics-dev'],
  actors: ['docs/js/gfx/actors.js', 'graphics-dev'], fx: ['docs/js/gfx/fx.js', 'graphics-dev'],
  weapon: ['docs/js/game/weapon.js', 'gameplay-dev'], ballistics: ['docs/js/game/ballistics.js', 'gameplay-dev'],
  ai: ['docs/js/game/ai.js', 'gameplay-dev'], session: ['docs/js/game/session.js', 'gameplay-dev'],
  hud: ['docs/js/ui/hud.js', 'mobile-ios-dev'], input: ['docs/js/ui/input.js', 'mobile-ios-dev'],
  audio: ['docs/js/ui/audio.js', 'mobile-ios-dev'], storage: ['docs/js/ui/storage.js', 'mobile-ios-dev'],
  pwa: ['docs/js/ui/pwa.js', 'mobile-ios-dev'], css: ['docs/css/style.css', 'mobile-ios-dev'],
  html: ['docs/index.html', 'mobile-ios-dev'], sw: ['docs/sw.js', 'mobile-ios-dev'],
  manifest: ['docs/manifest.webmanifest', 'mobile-ios-dev'], icons: ['docs/icons/*', 'mobile-ios-dev'],
};

// ───────────────────────────── 브라우저 추적 ─────────────────────────────
// smoke.openGame()은 부팅 대기 중 예외가 나면 브라우저를 닫지 않는다 → launch를 감싸 시나리오 종료 시 확실히 닫는다.
const LAUNCHED = new Set();
const _launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async (o) => {
  const b = await _launch(o);
  LAUNCHED.add(b);
  b.once('disconnected', () => LAUNCHED.delete(b));
  return b;
};
const ENV = { chrome: null, node: process.version };

// ───────────────────────────── 페이지 주입 헬퍼 (window.__QA__) ─────────────────────────────
function qaLib() {
  if (window.__QA__) return;
  const describe = (el) => {
    if (!el || el.nodeType !== 1) return 'null';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + [...el.classList].slice(0, 3).join('.');
    for (const k of ['ui', 'btn', 'stage']) if (el.dataset && el.dataset[k] != null) s += `[data-${k}=${el.dataset[k]}]`;
    return s;
  };
  const opacityChain = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none') return 0;
      o *= +cs.opacity;
    }
    return o;
  };
  const info = (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return { exists: false, visible: false };
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    const visible = cs.visibility !== 'hidden' && opacityChain(el) > 0.05 && r.width > 1 && r.height > 1 && r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), W - 1), cy = Math.min(Math.max(r.top + r.height / 2, 1), H - 1);
    const top = visible ? document.elementFromPoint(cx, cy) : null;
    const covered = visible && !!top && top !== el && !el.contains(top);
    const txt = (el.innerText || el.textContent || '').trim();
    const disabled = !!el.disabled || el.getAttribute('aria-disabled') === 'true';
    const locked = disabled || ('locked' in el.dataset && el.dataset.locked !== 'false') || el.classList.contains('locked') || /🔒|잠김|locked/i.test(txt);
    return { exists: true, visible, covered, top: describe(top), x: r.left, y: r.top, w: r.width, h: r.height, cx, cy, disabled, locked, text: txt.slice(0, 100), desc: describe(el) };
  };
  // 버튼·UI가 아닌 빈 화면 지점(조준 드래그·마우스 클릭용)
  const safePoint = () => {
    const W = innerWidth, H = innerHeight;
    for (const [fx, fy] of [[0.5, 0.45], [0.45, 0.4], [0.55, 0.55], [0.4, 0.55], [0.6, 0.38], [0.5, 0.62], [0.35, 0.4]]) {
      const x = Math.round(W * fx), y = Math.round(H * fy), el = document.elementFromPoint(x, y);
      if (!el) continue;
      if (el.closest('button,[data-btn],[data-ui],[data-stage],[data-set],input,select,a,label')) continue;
      return { x, y, el: describe(el) };
    }
    return null;
  };
  const btnLayout = () => {
    const W = innerWidth, H = innerHeight;
    const bs = [...document.querySelectorAll('[data-btn]')].map((el) => ({ name: el.dataset.btn, i: info(el) })).filter((b) => b.i.visible);
    const overlaps = [];
    for (let a = 0; a < bs.length; a++) for (let b = a + 1; b < bs.length; b++) {
      const A = bs[a].i, B = bs[b].i;
      const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x), oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
      if (ox > 1 && oy > 1) overlaps.push(`${bs[a].name}↔${bs[b].name}`);
    }
    return {
      buttons: bs.map((b) => ({ name: b.name, x: Math.round(b.i.x), y: Math.round(b.i.y), w: Math.round(b.i.w), h: Math.round(b.i.h) })),
      overlaps,
      outside: bs.filter((b) => b.i.x < 0 || b.i.y < 0 || b.i.x + b.i.w > W + 0.5 || b.i.y + b.i.h > H + 0.5).map((b) => b.name),
      center: bs.filter((b) => b.i.x < W / 2 + 30 && b.i.x + b.i.w > W / 2 - 30 && b.i.y < H / 2 + 30 && b.i.y + b.i.h > H / 2 - 30).map((b) => b.name),
      small: bs.filter((b) => b.i.w < 44 || b.i.h < 44).map((b) => `${b.name}(${Math.round(b.i.w)}×${Math.round(b.i.h)})`),
      covered: bs.filter((b) => b.i.covered).map((b) => `${b.name}←${b.i.top}`),
    };
  };
  // PNG(base64) 목록 → 밝기·대비·색 평균, 2장이면 평균 절대 차이
  const analyze = async (list) => {
    const load = async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const W = 160, H = Math.max(1, Math.round((img.height * W) / img.width));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H);
      return { W, H, d: g.getImageData(0, 0, W, H).data, iw: img.width, ih: img.height };
    };
    const imgs = [];
    for (const b of list) imgs.push(await load(b));
    const stats = imgs.map(({ W, H, d, iw, ih }) => {
      const n = W * H;
      let r = 0, g = 0, b = 0, l = 0, l2 = 0, dark = 0, cl = 0, cl2 = 0, cn = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        r += d[i]; g += d[i + 1]; b += d[i + 2]; l += L; l2 += L * L;
        if (L < 16) dark++;
        if (x > W * 0.35 && x < W * 0.65 && y > H * 0.35 && y < H * 0.65) { cl += L; cl2 += L * L; cn++; }
      }
      const lum = l / n, clum = cl / cn;
      return {
        w: iw, h: ih, mean: [r / n, g / n, b / n].map((v) => +v.toFixed(1)), lum: +lum.toFixed(1),
        std: +Math.sqrt(Math.max(0, l2 / n - lum * lum)).toFixed(1), darkFrac: +(dark / n).toFixed(3),
        centerLum: +clum.toFixed(1), centerStd: +Math.sqrt(Math.max(0, cl2 / cn - clum * clum)).toFixed(1),
      };
    });
    let diff = null;
    if (imgs.length === 2 && imgs[0].d.length === imgs[1].d.length) {
      const a = imgs[0].d, b = imgs[1].d;
      let s = 0;
      for (let i = 0; i < a.length; i += 4) s += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      diff = +(s / (a.length / 4)).toFixed(2);
    }
    return { stats, diff };
  };
  // rAF 프레임 간격 측정 (게임 루프와 같은 vsync 기준)
  const probe = (() => {
    let on = false, times = [], last = 0;
    const f = (now) => { if (!on) return; times.push(now - last); last = now; requestAnimationFrame(f); };
    return {
      start() { on = true; times = []; last = performance.now(); requestAnimationFrame(f); },
      stop() {
        on = false;
        const a = times.slice(1).sort((x, y) => x - y);
        if (!a.length) return { frames: 0, fps: 0, avg: 0, p95: 0, max: 0 };
        const avg = a.reduce((s, v) => s + v, 0) / a.length;
        return { frames: a.length, fps: Math.round(1000 / avg), avg: +avg.toFixed(2), p95: +a[Math.min(a.length - 1, Math.floor(a.length * 0.95))].toFixed(2), max: +a[a.length - 1].toFixed(2) };
      },
    };
  })();
  window.__QA__ = { describe, info, safePoint, btnLayout, analyze, probe };
}

// ───────────────────────────── 공용 헬퍼 ─────────────────────────────
const api = (page, name, ...args) => page.evaluate((n, a) => window.__SNIPER__[n](...a), name, args);
const pnow = (page) => page.evaluate(() => Math.floor(performance.now()) - 1);
const r2 = (v, k = 3) => (typeof v === 'number' ? +v.toFixed(k) : v);
const v3 = (p) => (p ? `[${p.map((x) => r2(x, 2)).join(', ')}]` : '-');
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function waitFn(page, fn, timeout = 5000, ...args) {
  try {
    const h = await page.waitForFunction(fn, { timeout, polling: 50 }, ...args);
    const v = await h.jsonValue();
    await h.dispose().catch(() => {});
    return v;
  } catch (e) {
    if (/timeout|timed out|waiting failed/i.test(e.message)) return null;
    throw e;
  }
}
const waitState = (page, st, timeout = 5000) => waitFn(page, (s) => !!window.__SNIPER__ && window.__SNIPER__.state() === s, timeout, st);
const waitCanFire = (page, timeout = 4000) => waitFn(page, () => window.__SNIPER__.weapon().canFire, timeout);
const eventsSince = (page, type, since) => page.evaluate((t, s) => window.__SNIPER__.events(t || undefined).filter((e) => e.t >= s), type, since);
async function waitEvents(page, types, since, timeout = 2000) {
  return (await waitFn(page, (ts, s) => {
    const ev = window.__SNIPER__.events().filter((e) => e.t >= s && ts.includes(e.type));
    return ev.length ? ev : null;
  }, timeout, types, since)) || [];
}
async function waitAPI(page, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await page.evaluate(() => !!window.__SNIPER__)) return true; } catch { /* 탐색 중 */ }
    await sleep(200);
  }
  return false;
}
async function startStage(page, id) {
  await page.evaluate((n) => window.__SNIPER__.startStage(n), id);
  const ok = await waitState(page, 'PLAYING', 8000);
  await sleep(400);
  return !!ok;
}
async function consts(page) {
  const r = await page.evaluate(async () => {
    try {
      const L = await import('./js/data/levels.js');
      const C = await import('./js/config.js');
      return { BALANCE: L.BALANCE, BUDGET: C.BUDGET, BODY: C.BODY, VEHICLE: C.VEHICLE, APP_VERSION: C.APP_VERSION };
    } catch (e) { return { error: String(e) }; }
  }).catch((e) => ({ error: e.message }));
  if (r.error) return { ...FALLBACK, error: r.error };
  return { ...FALLBACK, ...r, BALANCE: { ...FALLBACK.BALANCE, ...r.BALANCE } };
}
const visInfo = (page, sel) => page.evaluate((s) => window.__QA__.info(s), sel);
const whyNot = (i) => (!i.exists ? '요소 없음' : !i.visible ? '안 보임' : i.covered ? `가려짐(${i.top})` : i.disabled ? 'disabled' : 'ok');

/** 요소 중앙을 실제 터치로 탭. force면 disabled여도 탭 */
async function tap(page, sel, { timeout = 4000, force = false } = {}) {
  const end = Date.now() + timeout;
  let i;
  for (;;) {
    i = await visInfo(page, sel);
    if (i.visible && !i.covered && (force || !i.disabled)) break;
    if (Date.now() > end) return { ok: false, why: whyNot(i), ...i };
    await sleep(100);
  }
  await page.touchscreen.tap(i.cx, i.cy);
  return { ok: true, ...i };
}
async function touchDrag(page, x0, y0, dx, dy, steps = 12) {
  const ts = page.touchscreen;
  const h = await ts.touchStart(x0, y0);
  for (let i = 1; i <= steps; i++) {
    const x = x0 + (dx * i) / steps, y = y0 + (dy * i) / steps;
    if (h && typeof h.move === 'function') await h.move(x, y); else await ts.touchMove(x, y);
    await sleep(20);
  }
  if (h && typeof h.end === 'function') await h.end(); else await ts.touchEnd();
}

// ---- 기하: 사선 판정(extras AABB, 차량, 다른 인물) ----
function extrasBoxes(level) {
  const out = [];
  for (const e of level?.world?.extras || []) {
    const d = EXTRA_DIM[e.type];
    if (!d) continue;
    const rot = Math.abs(Math.sin(e.rot || 0)) > 0.5, sx = rot ? d[2] : d[0], sz = rot ? d[0] : d[2], y0 = e.y || 0;
    out.push({ type: e.type, min: [e.x - sx / 2, y0, e.z - sz / 2], max: [e.x + sx / 2, y0 + d[1], e.z + sz / 2] });
  }
  return out;
}
function vehicleBoxes(vehicles, VEH) {
  return (vehicles || []).filter((v) => v.state !== 'gone').map((v) => {
    const s = VEH[v.kind] || VEH.sedan, sh = Math.abs(Math.sin(v.heading || 0)), ch = Math.abs(Math.cos(v.heading || 0));
    const ex = (sh * s.l + ch * s.w) / 2, ez = (ch * s.l + sh * s.w) / 2;
    return { type: 'vehicle:' + v.id, min: [v.x - ex, v.y || 0, v.z - ez], max: [v.x + ex, (v.y || 0) + s.h, v.z + ez] };
  });
}
function segHitsBox(o, p, b, pad = 0) {
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = p[i] - o[i], lo = b.min[i] - pad, hi = b.max[i] + pad;
    if (Math.abs(d) < 1e-9) { if (o[i] < lo || o[i] > hi) return false; continue; }
    let ta = (lo - o[i]) / d, tb = (hi - o[i]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
const segHitsBoxes = (o, p, boxes, pad) => boxes.find((b) => segHitsBox(o, p, b, pad))?.type || null;
/** 선분 o→p가 인물(세로 원기둥, 반경 r, 높이 0~2m)을 지나면 그 id */
function segPassesNear(o, p, actors, r = 0.7) {
  for (const a of actors) {
    if (['dead', 'boarded', 'escaped'].includes(a.state)) continue;
    for (let i = 0; i <= 300; i++) {
      const t = i / 300, x = o[0] + (p[0] - o[0]) * t, y = o[1] + (p[1] - o[1]) * t, z = o[2] + (p[2] - o[2]) * t;
      if (y < (a.y || 0) - 0.1 || y > (a.y || 0) + 2.0) continue;
      if (Math.hypot(x - a.x, z - a.z) < r) return a.id;
    }
  }
  return null;
}
/** 인물·exit와 멀리 떨어진 지면(경계 유발 없이 쏠 수 있는 곳). pitchLimit 안쪽 */
function safeGroundPoint(level, actors) {
  const [px, py, pz] = level.player.pos, pl = level.player.pitchLimit, yl = level.player.yawLimit;
  const dMin = py / Math.tan(Math.max(0.05, -pl[0] - 0.03));
  const R = (level.rules?.alertRadius ?? 12) + 12;
  for (const yaw of [0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4]) {
    if (yaw < yl[0] || yaw > yl[1]) continue;
    for (const k of [1.05, 1.25, 1.5, 2]) {
      const d = dMin * k, x = px - Math.sin(yaw) * d, z = pz - Math.cos(yaw) * d;
      const near = Math.min(Infinity, ...actors.map((a) => Math.hypot(a.x - x, a.z - z)));
      if (near >= R) return [x, 0, z];
    }
  }
  return null;
}

// ---- 사격 ----
/** 정지 지점 조준 사격 → 첫 hit/impact */
async function aimShot(page, point, { waitFire = true } = {}) {
  if (waitFire) await waitCanFire(page);
  await api(page, 'aimAt', point);
  await sleep(80);
  await api(page, 'aimAt', point);
  const since = await pnow(page);
  await api(page, 'fire');
  const ev = await waitEvents(page, ['hit', 'impact'], since, 2500);
  const shots = await eventsSince(page, 'shot', since);
  const hitE = ev.find((e) => e.type === 'hit'), impE = ev.find((e) => e.type === 'impact');
  return { since, shot: shots[0]?.payload || null, hit: hitE?.payload || null, impact: impE?.payload || null, hitT: hitE?.t, impactT: impE?.t };
}
/** 이동 표적 리드 사격: 조준점 = 부위 + 속도 × (거리/탄속 + 1프레임) */
async function leadShot(page, id, part, muzzle) {
  await waitCanFire(page);
  const fn = (id, part, muzzle, doFire) => {
    const A = window.__SNIPER__, a = A.actors().find((x) => x.id === id);
    if (!a) return null;
    const v = A.weapon().view, p = a[part];
    const dist = Math.hypot(p[0] - v.x, p[1] - v.y, p[2] - v.z), tof = dist / muzzle, t = tof + (doFire ? 1 / 60 : 0);
    const aim = [p[0] + a.vx * t, p[1], p[2] + a.vz * t];
    A.aimAt(aim);
    let since = null;
    if (doFire) { since = Math.floor(performance.now()) - 1; A.fire(); }
    return { since, dist, tof, speed: Math.hypot(a.vx, a.vz), lead: Math.hypot(a.vx, a.vz) * t, aim, pos: [a.x, a.y, a.z], state: a.state };
  };
  const pre = await page.evaluate(fn, id, part, muzzle, false);
  if (!pre) return { error: `actor ${id} 없음` };
  await sleep(50);
  const info = await page.evaluate(fn, id, part, muzzle, true);
  const ev = await waitEvents(page, ['hit', 'impact'], info.since, 2500);
  const hitE = ev.find((e) => e.type === 'hit'), impE = ev.find((e) => e.type === 'impact');
  return { ...info, hit: hitE?.payload || null, impact: impE?.payload || null };
}
/** 표적까지 사선(현재·0.3초 뒤 예상 위치)이 extras/차량/다른 인물에 막히지 않을 때까지 대기 */
async function waitClearShot(page, level, id, part, muzzle, timeout, { moving = false, C = FALLBACK, endMargin = 0 } = {}) {
  const boxes = extrasBoxes(level), end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    const s = await page.evaluate(() => ({ acts: window.__SNIPER__.actors(), veh: window.__SNIPER__.vehicles(), view: window.__SNIPER__.weapon().view }));
    const a = s.acts.find((x) => x.id === id);
    if (!a) return { ok: false, reason: `actor ${id} 없음` };
    if (['dead', 'boarded', 'escaped'].includes(a.state)) return { ok: false, reason: `표적 상태 ${a.state}` };
    const sp = Math.hypot(a.vx, a.vz);
    if (moving && sp < 0.5) { last = `정지 중(속도 ${r2(sp, 2)})`; await sleep(100); continue; }
    if (endMargin > 0) {
      const ad = level.actors.find((x) => x.id === id);
      const pts = ad?.path || [];
      const dEnd = Math.min(Infinity, ...pts.map((q) => Math.hypot(q[0] - a.x, q[1] - a.z)));
      if (dEnd < endMargin) { last = `경유지 근처(${r2(dEnd, 1)}m)`; await sleep(100); continue; }
    }
    const o = [s.view.x, s.view.y, s.view.z], p = a[part];
    const tof = dist3(p, o) / muzzle;
    const q = [p[0] + a.vx * (0.3 + tof), p[1], p[2] + a.vz * (0.3 + tof)];
    const allBoxes = [...boxes, ...vehicleBoxes(s.veh, C.VEHICLE)];
    const others = s.acts.filter((x) => x.id !== id);
    const blk = segHitsBoxes(o, p, allBoxes, 0.25) || segHitsBoxes(o, q, allBoxes, 0.25) || segPassesNear(o, p, others, 0.6) || segPassesNear(o, q, others, 0.6);
    if (!blk) return { ok: true, actor: a };
    last = `사선 차단: ${blk}`;
    await sleep(100);
  }
  return { ok: false, reason: `대기 시간 초과(${last})` };
}
const shotDesc = (r) => (r.hit ? `hit ${r.hit.agentId}/${r.hit.part} @${v3(r.hit.pos)} dist ${r2(r.hit.dist, 1)}m` : r.impact ? `impact ${r.impact.surface} @${v3(r.impact.pos)}` : r.shot ? 'shot 후 hit/impact 이벤트 없음' : 'shot 이벤트 없음(발사 안 됨)');

// ---- 오류 분류 ----
function classifyErrors(list) {
  const hard = [], soft = [];
  for (const e of list) {
    if (e.startsWith('pageerror:') || (e.startsWith('console:') && !/Failed to load resource/i.test(e))) hard.push(e);
    else soft.push(e);
  }
  return { hard, soft };
}
const imageFlags = (s) => {
  const f = [];
  if (s.lum < 8 && s.std < 6) f.push('검은 화면 의심');
  else if (s.std < 4) f.push('단색 화면 의심');
  if (s.darkFrac > 0.9) f.push('90% 이상 암부');
  return f;
};
async function analyzeShots(page, bufs) {
  try { return await page.evaluate((l) => window.__QA__.analyze(l), bufs.map((b) => Buffer.from(b).toString('base64'))); } catch (e) { return { error: e.message, stats: [] }; }
}
async function fetchInfo(rel) {
  try { const r = await fetch(BASE + rel, { cache: 'no-store' }); return { status: r.status, ct: r.headers.get('content-type') || '' }; } catch (e) { return { status: 0, ct: String(e.message || e) }; }
}

// ───────────────────────────── 시나리오 컨텍스트 ─────────────────────────────
function makeCtx(sc) {
  const ctx = {
    details: [], evidence: [], images: [], perf: [], memory: [], games: [], closed: false, skipped: null,
    check(label, ok, o = {}) {
      ok = !!ok;
      if (ctx.closed) return ok;
      ctx.details.push({ type: 'check', label, ok, expected: o.expected, actual: o.actual, suspects: o.suspects || sc.suspects || [] });
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && o.actual !== undefined ? '  → ' + fmt(o.actual, 160) : ''}`);
      return ok;
    },
    note(text) {
      if (ctx.closed) return;
      ctx.details.push({ type: 'note', text });
      console.log(`  ·  ${text}`);
    },
    skip(reason) { ctx.skipped = reason; ctx.note('SKIP: ' + reason); },
    async open(o = {}) {
      const t0 = Date.now();
      const g = await openGame({ headful: OPT.headful, ...o });
      g.bootMs = Date.now() - t0;
      g.exclude = [];
      ctx.games.push(g);
      g.page.setDefaultTimeout(20000);
      if (!ENV.chrome) ENV.chrome = await g.browser.version().catch(() => null);
      await g.page.evaluateOnNewDocument(qaLib);
      await g.page.evaluate(qaLib);
      if (o.reset !== false) await g.page.evaluate(() => { try { window.__SNIPER__.resetProgress(); } catch { /* 없음 */ } });
      return g;
    },
    excludeErrors(g, from, to = Infinity) { g.exclude.push([from, to]); },
    async shot(page, name) {
      const file = path.join(SHOT_DIR, `qa-${name}.png`);
      const buf = await page.screenshot({ path: file });
      ctx.evidence.push(`screenshots/qa-${name}.png`);
      return buf;
    },
    image(name, stats, extra = {}) {
      if (!stats) return [];
      const flags = imageFlags(stats);
      ctx.images.push({ file: `screenshots/qa-${name}.png`, scenario: sc.id, ...stats, flags, ...extra });
      return flags;
    },
    errorCheck() {
      const all = [];
      for (const g of ctx.games) g.errors.forEach((e, i) => { if (!g.exclude.some(([a, b]) => i >= a && i < b)) all.push(e); });
      const { hard, soft } = classifyErrors(all);
      ctx.check('미처리 에러(pageerror·console.error) 0개', hard.length === 0, { expected: '0개', actual: hard.length ? hard.slice(0, 6) : '0개', suspects: sc.suspects });
      if (soft.length) ctx.note(`네트워크 경고 ${soft.length}건: ${soft.slice(0, 4).join(' | ')}`);
    },
  };
  return ctx;
}
const fmt = (v, n = 400) => {
  if (v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};

// ───────────────────────────── 시나리오 ─────────────────────────────
const SCENARIOS = [];
const def = (id, name, suspects, timeout, repro, run) => SCENARIOS.push({ id, name, suspects, timeout, repro, run });

// 1. 부팅 ------------------------------------------------------------
def(1, '부팅', ['main', 'hud', 'html'], 60000, [
  'iPhone 가로 프로필(844×390, DPR 3, 터치)로 `?autotest&nosw&seed=1` 접속',
  '2.5초 대기하며 콘솔 에러·pageerror·4xx 응답·요청 실패 수집',
  '`__SNIPER__.state()`가 TITLE인지, 타이틀 문구·`[data-ui=start]`·버전 텍스트가 보이는지 확인',
], async (ctx) => {
  const g = await ctx.open({ reset: false });
  const { page, errors } = g;
  await sleep(2500);
  ctx.note(`부팅 시간(Chrome 실행 포함) ${g.bootMs}ms`);
  const st = await api(page, 'state');
  ctx.check('상태 TITLE', st === 'TITLE', { expected: 'TITLE', actual: st, suspects: ['main'] });
  const start = await visInfo(page, '[data-ui="start"]');
  ctx.check('시작 버튼 [data-ui=start] 표시', start.visible && !start.covered, { expected: '보이고 가려지지 않음', actual: whyNot(start), suspects: ['hud', 'css'] });
  const ver = await page.evaluate(() => window.__SNIPER__.version);
  const text = await page.evaluate(() => document.getElementById('hud')?.innerText || '');
  ctx.check(`버전 텍스트(${ver}) 표시`, !!ver && text.includes(ver), { expected: `#hud 텍스트에 ${ver}`, actual: text.replace(/\s+/g, ' ').slice(0, 140), suspects: ['hud'] });
  ctx.check('타이틀 문구("스나이퍼") 표시', /스나이퍼/.test(text), { expected: '타이틀 화면에 게임 이름', actual: text.replace(/\s+/g, ' ').slice(0, 140), suspects: ['hud'] });
  const buf = await ctx.shot(page, 'title');
  const an = await analyzeShots(page, [buf]);
  const fl = ctx.image('title', an.stats[0]);
  if (fl.length) ctx.note(`타이틀 스크린샷 자동 판정: ${fl.join(', ')}`);
  const rotate = await visInfo(page, '#rotate');
  ctx.check('가로 화면에서 #rotate 숨김', rotate.exists && !rotate.visible, { actual: rotate.exists ? (rotate.visible ? '보임' : '숨김') : '#rotate 없음', suspects: ['html', 'css'] });
  ctx.check('콘솔 에러·pageerror·4xx·요청 실패 0개', errors.length === 0, { expected: '0개', actual: errors.length ? errors.slice(0, 8) : '0개', suspects: ['main', 'html'] });
  // CONTRACT §11: CSS 애니메이션(@keyframes/animation), backdrop-filter, mix-blend-mode 금지 (정적 검사, 주석 제외)
  const css = await page.evaluate(async () => {
    const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
    const out = [];
    for (const h of hrefs) { try { out.push({ h, t: await (await fetch(h, { cache: 'no-store' })).text() }); } catch { out.push({ h, t: '' }); } }
    out.push({ h: 'inline <style>', t: [...document.querySelectorAll('style')].map((x) => x.textContent).join(' ') });
    return out;
  });
  const banned = [];
  for (const { h, t } of css) {
    const body = t.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [re, name] of [[/@keyframes/i, '@keyframes'], [/(^|[;{\s])animation(-name)?\s*:/i, 'animation'], [/backdrop-filter\s*:/i, 'backdrop-filter'], [/mix-blend-mode\s*:/i, 'mix-blend-mode']]) if (re.test(body)) banned.push(`${name} (${h.split('/').pop()})`);
  }
  ctx.check('CSS 금지 규칙(@keyframes·animation·backdrop-filter·mix-blend-mode) 없음 — CONTRACT §11', banned.length === 0, { actual: banned.length ? banned : `없음(${css.length}개 스타일 검사)`, suspects: ['css'] });
  ctx.customErrors = true; // 위에서 엄격하게 확인함
});

// 2. 세로 화면 ---------------------------------------------------------
def(2, '세로 화면', ['css', 'html', 'main'], 60000, [
  'iPhone 프로필로 `?autotest&nosw&seed=1` 접속 후 뷰포트를 390×844 세로(터치)로 변경',
  '`#rotate` 표시 확인 → 844×390 가로로 되돌려 숨김 확인',
  '`startStage(1)` 후 세로로 바꾸면 PAUSED, 가로 복귀 후 `ui:resume` → PLAYING 확인',
], async (ctx) => {
  const { page } = await ctx.open();
  await page.setViewport(IPHONE_PORTRAIT);
  await sleep(700);
  const mq = await page.evaluate(() => ({ portrait: matchMedia('(orientation: portrait)').matches, coarse: matchMedia('(pointer: coarse)').matches }));
  ctx.note(`세로 뷰포트 미디어쿼리: orientation:portrait=${mq.portrait}, pointer:coarse=${mq.coarse}`);
  const r1 = await visInfo(page, '#rotate');
  ctx.check('세로(390×844): #rotate 표시', r1.visible, { expected: '보임', actual: whyNot(r1), suspects: ['css', 'html'] });
  if (r1.visible && (r1.w < 390 * 0.8 || r1.h < 844 * 0.8)) ctx.note(`#rotate 크기 ${Math.round(r1.w)}×${Math.round(r1.h)} — 화면 전체를 덮지 않음`);
  await ctx.shot(page, 'portrait');
  await page.setViewport(IPHONE_LANDSCAPE);
  await sleep(700);
  const r2_ = await visInfo(page, '#rotate');
  ctx.check('가로(844×390): #rotate 숨김', r2_.exists && !r2_.visible, { expected: '숨김', actual: r2_.exists ? (r2_.visible ? '보임' : '숨김') : '없음', suspects: ['css'] });
  if (!(await startStage(page, 1))) return ctx.check('S1 PLAYING 진입', false, { suspects: ['main'] });
  await page.setViewport(IPHONE_PORTRAIT);
  const p = await waitState(page, 'PAUSED', 2500);
  ctx.check('플레이 중 세로 전환 → PAUSED', !!p, { expected: 'PAUSED', actual: await api(page, 'state'), suspects: ['main'] });
  await page.setViewport(IPHONE_LANDSCAPE);
  await sleep(700);
  await api(page, 'emit', 'ui:resume', {});
  const q = await waitState(page, 'PLAYING', 2500);
  ctx.check('가로 복귀 후 ui:resume → PLAYING', !!q, { expected: 'PLAYING', actual: await api(page, 'state'), suspects: ['main'] });
});

// 3. 실제 터치 흐름 ----------------------------------------------------
def(3, '실제 터치 흐름', ['hud', 'input', 'css'], 60000, [
  '`?autotest&nosw&seed=1` 접속 → `resetProgress()` + localStorage 비우기 (autotest는 실제 진행 상황을 표시, 전 스테이지 해제 표시는 `?debug` 단독일 때만)',
  '`[data-ui=start]` 탭 → SELECT, `[data-stage="2"]`가 잠겨 있고 탭해도 브리핑으로 넘어가지 않는지 확인',
  '`[data-stage="1"]` 탭 → BRIEFING → `[data-ui=begin]` 탭 → PLAYING, 인게임 버튼 `[data-btn=fire]` 등이 보이는지 확인',
], async (ctx) => {
  const { page } = await ctx.open(); // ctx.open이 resetProgress()를 호출
  await page.evaluate(() => { try { localStorage.removeItem('sniper.progress.v1'); } catch { /* 무시 */ } });
  const st0 = await api(page, 'state');
  ctx.check('시작 상태 TITLE', st0 === 'TITLE', { actual: st0, suspects: ['main'] });
  let t = await tap(page, '[data-ui="start"]', { timeout: 8000 });
  if (!ctx.check('타이틀 [data-ui=start] 탭', t.ok, { expected: '보이는 시작 버튼', actual: t.why, suspects: ['hud'] })) return;
  ctx.check('start 탭 → SELECT', !!(await waitState(page, 'SELECT', 3000)), { actual: await api(page, 'state'), suspects: ['hud', 'main'] });
  const s1 = await waitFn(page, () => !!window.__QA__.info('[data-stage="1"]').visible, 5000);
  if (!ctx.check('선택 화면: [data-stage="1"] 표시', !!s1, { actual: whyNot(await visInfo(page, '[data-stage="1"]')), suspects: ['hud'] })) return;
  const c1 = await visInfo(page, '[data-stage="1"]'), c2 = await visInfo(page, '[data-stage="2"]');
  ctx.check('스테이지 1 열림', !c1.locked, { expected: '잠기지 않음', actual: c1.locked ? `잠김(${c1.text})` : '열림', suspects: ['hud', 'storage'] });
  ctx.check('스테이지 2 잠김 표시(disabled/aria-disabled/.locked/data-locked/🔒)', c2.exists && c2.locked, { expected: '잠김', actual: c2.exists ? `${c2.desc} "${c2.text}"` : '요소 없음', suspects: ['hud', 'storage'] });
  for (const id of [3, 4, 5]) { const c = await visInfo(page, `[data-stage="${id}"]`); if (c.exists && !c.locked) ctx.note(`스테이지 ${id}가 잠겨 있지 않음`); }
  if (c2.visible) {
    await page.touchscreen.tap(c2.cx, c2.cy);
    await sleep(800);
    const b = await visInfo(page, '[data-ui="begin"]'), still = await visInfo(page, '[data-stage="1"]');
    ctx.check('잠긴 스테이지 2 탭 → 브리핑으로 넘어가지 않음', !b.visible && still.visible, { expected: '선택 화면 유지', actual: b.visible ? '브리핑 표시됨' : '선택 화면 아님', suspects: ['hud', 'main'] });
  }
  await ctx.shot(page, 'touch-select');
  t = await tap(page, '[data-stage="1"]');
  if (!ctx.check('[data-stage="1"] 탭', t.ok, { actual: t.why, suspects: ['hud'] })) return;
  const bv = await waitFn(page, () => !!window.__QA__.info('[data-ui="begin"]').visible, 5000);
  if (!ctx.check('브리핑: [data-ui=begin] 표시', !!bv, { actual: whyNot(await visInfo(page, '[data-ui="begin"]')), suspects: ['hud'] })) return;
  ctx.check('stage1 탭 → BRIEFING', (await api(page, 'state')) === 'BRIEFING', { actual: await api(page, 'state'), suspects: ['hud', 'main'] });
  await ctx.shot(page, 'touch-briefing');
  t = await tap(page, '[data-ui="begin"]');
  ctx.check('[data-ui=begin] 탭', t.ok, { actual: t.why, suspects: ['hud'] });
  ctx.check('begin 탭 → PLAYING', !!(await waitState(page, 'PLAYING', 5000)), { actual: await api(page, 'state'), suspects: ['hud', 'main'] });
  const fv = await waitFn(page, () => !!window.__QA__.info('[data-btn="fire"]').visible, 8000);
  ctx.check('PLAYING 진입: [data-btn=fire] 표시', !!fv, { expected: '인게임 HUD', actual: whyNot(await visInfo(page, '[data-btn="fire"]')), suspects: ['hud', 'main'] });
  if (fv) {
    await sleep(800);
    const missing = [];
    for (const b of ['fire', 'scope', 'zoom', 'breath', 'reload', 'pause']) { const i = await visInfo(page, `[data-btn="${b}"]`); if (!i.visible) missing.push(`${b}:${whyNot(i)}`); }
    ctx.check('S1 인게임 버튼 fire/scope/zoom/breath/reload/pause 표시', missing.length === 0, { actual: missing.length ? missing : '모두 보임', suspects: ['hud'] });
    const nv = await visInfo(page, '[data-btn="nv"]');
    ctx.note(`S1에서 [data-btn=nv]: ${nv.exists ? (nv.visible ? '보임(S1은 nightVision:false)' : '숨김') : '없음'}`);
    await ctx.shot(page, 'touch-playing');
  }
});

// 4. 조작 --------------------------------------------------------------
def(4, '조작(스테이지 1)', ['input', 'weapon', 'hud'], 90000, [
  '`?autotest`로 접속 → `startStage(1)`, `assist({noSway:true,noDrop:true,noWind:true})`',
  '버튼이 아닌 곳에서 오른쪽으로 150px 터치 드래그 → `weapon().view.yaw` 감소, 감도 = fov/화면높이',
  '`[data-btn=scope]`, `[data-btn=zoom]` 탭 → fov 변화',
  '인물에서 먼 지면을 `aimAt` → `[data-btn=fire]` 탭: mag −1, shot 이벤트 / 0.2초 뒤 재탭: 볼트로 차단',
  '남은 탄을 모두 쏜 뒤 reload start/end 이벤트, 탄창 복구 확인',
], async (ctx) => {
  const { page } = await ctx.open();
  if (!(await startStage(page, 1))) return ctx.check('S1 PLAYING 진입', false, { suspects: ['main'] });
  await api(page, 'assist', { noSway: true, noDrop: true, noWind: true });
  const C = await consts(page);
  const lv = await api(page, 'level'), acts = await api(page, 'actors');
  // 드래그
  const sp = await page.evaluate(() => window.__QA__.safePoint());
  if (!ctx.check('조준 드래그 시작점(버튼 아닌 곳) 확보', !!sp, { suspects: ['hud', 'css'] })) return;
  const H = await page.evaluate(() => document.getElementById('gl')?.clientHeight || innerHeight);
  const w0 = await api(page, 'weapon');
  await touchDrag(page, sp.x, sp.y, 150, 0);
  await sleep(350);
  const w1 = await api(page, 'weapon');
  const exp = 150 * ((w0.view.fov * DEG) / H) * (C.BALANCE.aimSens ?? 1);
  const dy = w0.view.yaw - w1.view.yaw;
  ctx.check('오른쪽 드래그 → yaw 감소', dy > 0.02, { expected: `감소(약 ${r2(exp)}rad)`, actual: `yaw ${r2(w0.view.yaw)} → ${r2(w1.view.yaw)} (시작점 ${sp.el})`, suspects: ['input', 'weapon'] });
  ctx.check('드래그 감도: 150px ≈ 150·fov/화면높이 (±40%)', Math.abs(dy - exp) <= 0.4 * exp, { expected: `${r2(exp)}rad`, actual: `${r2(dy)}rad`, suspects: ['input', 'weapon'] });
  // SCOPE / ZOOM
  let t = await tap(page, '[data-btn="scope"]');
  await sleep(600);
  const w2 = await api(page, 'weapon');
  ctx.check('SCOPE 탭 → 스코프 on, fov 감소', t.ok && w2.scoped && w2.view.fov < w1.view.fov - 1, { expected: `scoped, fov≈${lv.weapon.scopeFovs[0]}`, actual: t.ok ? `scoped=${w2.scoped}, fov ${r2(w1.view.fov, 2)} → ${r2(w2.view.fov, 2)}` : `탭 실패: ${t.why}`, suspects: ['input', 'weapon', 'hud'] });
  t = await tap(page, '[data-btn="zoom"]');
  await sleep(600);
  const w3 = await api(page, 'weapon');
  ctx.check('ZOOM 탭 → 줌 단계 증가, fov 감소', t.ok && w3.zoomIdx === 1 && w3.view.fov < w2.view.fov - 0.5, { expected: `zoomIdx 1, fov≈${lv.weapon.scopeFovs[1]}`, actual: t.ok ? `zoomIdx ${w2.zoomIdx}→${w3.zoomIdx}, fov ${r2(w2.view.fov, 2)} → ${r2(w3.view.fov, 2)}` : `탭 실패: ${t.why}`, suspects: ['input', 'weapon'] });
  // FIRE / 볼트
  const safe = safeGroundPoint(lv, acts);
  if (!safe) ctx.note('안전 착탄 지점 계산 실패 — 기본 조준으로 사격');
  const aimSafe = async () => { if (safe) await api(page, 'aimAt', safe); };
  await aimSafe();
  await waitCanFire(page);
  const m0 = (await api(page, 'weapon')).mag;
  let since = await pnow(page);
  t = await tap(page, '[data-btn="fire"]');
  const tapAt = Date.now();
  const sh = t.ok ? await waitEvents(page, ['shot'], since, 1500) : [];
  const m1 = (await api(page, 'weapon')).mag;
  ctx.check('FIRE 탭 → shot 이벤트', sh.length === 1, { expected: 'shot 1개', actual: t.ok ? `shot ${sh.length}개` : `탭 실패: ${t.why}`, suspects: ['input', 'weapon'] });
  ctx.check('FIRE 탭 → 탄 −1', m1 === m0 - 1, { expected: `${m0} → ${m0 - 1}`, actual: `${m0} → ${m1}`, suspects: ['weapon'] });
  await sleep(150);
  const since2 = await pnow(page);
  t = await tap(page, '[data-btn="fire"]');
  const gap = Date.now() - tapAt;
  await sleep(400);
  const sh2 = await eventsSince(page, 'shot', since2), m2 = (await api(page, 'weapon')).mag;
  ctx.check('1초 안 재탭 → 볼트로 발사 차단', t.ok && gap < 1000 && sh2.length === 0 && m2 === m1, { expected: 'shot 0개, 탄 유지', actual: `재탭 ${gap}ms 뒤, shot ${sh2.length}개, mag ${m1}→${m2}`, suspects: ['weapon'] });
  // 탄창 소진 → 재장전
  const sinceR = await pnow(page);
  for (let i = 0; i < 7; i++) {
    const w = await api(page, 'weapon');
    if (w.mag <= 0) break;
    if (!(await waitCanFire(page, 3000))) break;
    await aimSafe();
    await sleep(60);
    await tap(page, '[data-btn="fire"]');
    await sleep(250);
  }
  const emptied = await eventsSince(page, 'shot', sinceR);
  const phases = (await waitFn(page, (s) => {
    const ph = window.__SNIPER__.events('reload').filter((e) => e.t >= s).map((e) => ({ p: e.payload && e.payload.phase, t: e.t }));
    return ph.some((x) => x.p === 'end') ? ph : null;
  }, 5000, sinceR)) || (await eventsSince(page, 'reload', sinceR)).map((e) => ({ p: e.payload?.phase, t: e.t }));
  const st = phases.find((x) => x.p === 'start'), en = phases.find((x) => x.p === 'end');
  ctx.check(`${C.BALANCE.magSize}발 소진 → reload start`, !!st, { expected: "reload{phase:'start'}", actual: `추가 발사 ${emptied.length}발, reload 이벤트 ${JSON.stringify(phases.map((x) => x.p))}`, suspects: ['weapon'] });
  ctx.check(`reload end (약 ${C.BALANCE.reloadTime}초 뒤)`, !!en && !!st && Math.abs((en.t - st.t) / 1000 - C.BALANCE.reloadTime) < 0.8, { expected: `${C.BALANCE.reloadTime}s`, actual: st && en ? `${r2((en.t - st.t) / 1000, 2)}s` : 'end 없음', suspects: ['weapon'] });
  const wf = await api(page, 'weapon');
  ctx.check('재장전 후 탄창 가득', wf.mag === wf.magSize, { expected: `${wf.magSize}`, actual: `mag ${wf.mag}, reserve ${wf.reserve}`, suspects: ['weapon'] });
});

// 5. 헤드샷 ------------------------------------------------------------
def(5, '헤드샷(S1)', ['ballistics', 'weapon', 'session'], 60000, [
  '`startStage(1)`, `assist({noSway:true,noDrop:true,noWind:true})`, `scope(true,1)`',
  '`aimAt(t1.head)` (GDD §9.7: [−18, 1.62, −75], 약 100m) → `fire()`',
  "`events('hit')`의 agentId/part, `session().kills` +1, t1.state === 'dead' 확인",
], async (ctx) => {
  const { page } = await ctx.open();
  if (!(await startStage(page, 1))) return ctx.check('S1 PLAYING 진입', false, { suspects: ['main'] });
  await api(page, 'assist', { noSway: true, noDrop: true, noWind: true });
  await api(page, 'scope', true, 1);
  await sleep(500);
  const acts = await api(page, 'actors'), view = (await api(page, 'weapon')).view;
  const t = acts.find((a) => a.id === 't1' && a.required) || acts.find((a) => a.required);
  if (!ctx.check('필수 표적 존재', !!t, { suspects: ['levels', 'ai'] })) return;
  ctx.note(`표적 ${t.id} 머리 ${v3(t.head)}, 거리 ${r2(dist3(t.head, [view.x, view.y, view.z]), 1)}m (GDD §9.7: [−18, 1.62, −75], 약 100m)`);
  const k0 = (await api(page, 'session')).kills;
  const r = await aimShot(page, t.head);
  ctx.check(`hit 이벤트(대상 ${t.id})`, r.hit?.agentId === t.id, { expected: `hit ${t.id}`, actual: shotDesc(r), suspects: ['ballistics', 'weapon'] });
  ctx.check("hit.part === 'head'", r.hit?.part === 'head', { expected: 'head', actual: r.hit?.part ?? shotDesc(r), suspects: ['ballistics'] });
  await sleep(300);
  const k1 = (await api(page, 'session')).kills;
  ctx.check('session.kills +1', k1 === k0 + 1, { expected: `${k0 + 1}`, actual: `${k1}`, suspects: ['session'] });
  const a1 = (await api(page, 'actors')).find((a) => a.id === t.id);
  ctx.check(`${t.id}.state === 'dead'`, a1?.state === 'dead', { actual: a1?.state, suspects: ['ai'] });
  const sc = await eventsSince(page, 'score', r.since);
  ctx.note(`score 이벤트: ${sc.map((e) => `${e.payload.label} ${e.payload.delta}`).join(', ') || '없음'}`);
});

// 6. 이동 표적 ----------------------------------------------------------
def(6, '이동 표적 리드(S2)', ['ballistics', 'ai', 'weapon'], 75000, [
  '`startStage(2)`, `assist({noSway:true,noDrop:true,noWind:true})`, `scope(true,1)`',
  't1(z −150, x 방향 1.3m/s 순찰)이 걷기 시작하고 사선이 extras(컨테이너)·다른 인물에 막히지 않을 때까지 대기',
  '조준점 = 가슴 + (vx,vz) × (거리/탄속 + 1/60초) → `aimAt` → `fire()` → hit.agentId === t1 확인 (GDD §9.7 리드 약 0.27m)',
], async (ctx) => {
  const { page } = await ctx.open();
  if (!(await startStage(page, 2))) return ctx.check('S2 PLAYING 진입', false, { suspects: ['main'] });
  await api(page, 'assist', { noSway: true, noDrop: true, noWind: true });
  await api(page, 'scope', true, 1);
  const C = await consts(page), lv = await api(page, 'level'), acts = await api(page, 'actors');
  const t = acts.find((a) => a.id === 't1' && a.required) || acts.find((a) => a.required);
  if (!ctx.check('필수 표적 존재', !!t, { suspects: ['levels'] })) return;
  const mv = await waitFn(page, (id) => { const a = window.__SNIPER__.actors().find((x) => x.id === id); return a && Math.hypot(a.vx, a.vz) > 0.5 ? { vx: a.vx, vz: a.vz } : null; }, 15000, t.id);
  if (!ctx.check(`${t.id}가 이동 시작(속도 > 0.5m/s, 15초 안)`, !!mv, { expected: '순찰 이동(GDD §9.2: 출발 전 wait 3초)', actual: '정지 상태 유지', suspects: ['ai'] })) return;
  ctx.note(`이동 속도 (${r2(mv.vx, 2)}, ${r2(mv.vz, 2)}) m/s`);
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    const clr = await waitClearShot(page, lv, t.id, 'chest', C.BALANCE.muzzle, 20000, { moving: true, C, endMargin: 4 });
    if (!clr.ok) { ctx.note(`시도 ${attempt}: 사선 확보 실패 — ${clr.reason}`); break; }
    const r = await leadShot(page, t.id, 'chest', C.BALANCE.muzzle);
    ctx.note(`시도 ${attempt}: 거리 ${r2(r.dist, 1)}m, 비행 ${r2(r.tof, 3)}s, 속도 ${r2(r.speed, 2)}m/s, 리드 ${r2(r.lead, 3)}m → ${shotDesc(r)}`);
    if (r.hit?.agentId === t.id) { done = true; break; }
    if (r.hit) break; // 다른 인물 명중 → 중단
    if (r.impact && r.impact.surface !== 'ground') ctx.note(`시도 ${attempt}: ${r.impact.surface}에 막힘 — 사선 문제로 보고 재시도`);
    else break; // 지면 착탄 = 리드 실패
  }
  ctx.check(`리드 사격으로 이동 중인 ${t.id} 명중`, done, { expected: `hit ${t.id}`, actual: done ? 'hit' : '빗나감/차단 (노트 참고)', suspects: ['ballistics', 'ai'] });
});

// 7. 낙차 --------------------------------------------------------------
def(7, '낙차(S4)', ['ballistics'], 60000, [
  '`startStage(4)`, `assist({noSway:true,noWind:true,noDrop:false})`, `scope(true,1)`',
  't1(정지, 약 199m) 머리를 0.5·g·t²(t = 거리/탄속)만큼 위로 보정해 `aimAt` → `fire()` → part head (GDD §9.7: 낙차 0.14m)',
  '대조: 경비 g3(정지) 가슴을 보정 없이 쏴서 실측 낙차(조준 y − 명중 y)를 예측값과 비교',
], async (ctx) => {
  const { page } = await ctx.open();
  if (!(await startStage(page, 4))) return ctx.check('S4 PLAYING 진입', false, { suspects: ['main'] });
  await api(page, 'assist', { noSway: true, noWind: true, noDrop: false });
  await api(page, 'scope', true, 1);
  await sleep(500);
  const C = await consts(page), lv = await api(page, 'level'), acts = await api(page, 'actors');
  const view = (await api(page, 'weapon')).view, o = [view.x, view.y, view.z];
  const g = lv.ballistics.gravity;
  if (!ctx.check('S4 중력 > 0 (levels.js)', g > 0, { actual: g, suspects: ['levels'] })) return;
  const t = acts.find((a) => a.id === 't1' && a.required) || acts.find((a) => a.required);
  const d = dist3(t.head, o), tof = d / C.BALANCE.muzzle, drop = 0.5 * g * tof * tof;
  ctx.note(`${t.id} 머리 ${v3(t.head)}, 거리 ${r2(d, 1)}m, 비행 ${r2(tof, 3)}s, 예측 낙차 ${r2(drop)}m (GDD: 199m, 0.14m)`);
  const r = await aimShot(page, [t.head[0], t.head[1] + drop, t.head[2]]);
  ctx.check(`낙차 보정 조준 → ${t.id} 명중`, r.hit?.agentId === t.id, { expected: `hit ${t.id}`, actual: shotDesc(r), suspects: ['ballistics'] });
  ctx.check("낙차 보정 조준 → part 'head'", r.hit?.part === 'head', { expected: 'head (보정 없으면 몸통)', actual: r.hit?.part ?? shotDesc(r), suspects: ['ballistics'] });
  if (r.hit) ctx.note(`명중점 y ${r2(r.hit.pos[1])} vs 머리 중심 ${r2(t.head[1])} → 잔차 ${r2(r.hit.pos[1] - t.head[1])}m`);
  // 대조 사격(실측 낙차)
  const acts2 = await api(page, 'actors');
  const gd = acts2.find((a) => a.id === 'g3' && a.state !== 'dead') || acts2.find((a) => a.role === 'guard' && a.state !== 'dead' && Math.hypot(a.vx, a.vz) < 0.05);
  if (!gd || Math.hypot(gd.vx, gd.vz) > 0.05) { ctx.note('정지한 경비가 없어 실측 낙차 대조를 건너뜀'); return; }
  const blk = segPassesNear(o, gd.chest, acts2.filter((a) => a.id !== gd.id), 0.6) || segHitsBoxes(o, gd.chest, extrasBoxes(lv), 0.2);
  if (blk) { ctx.note(`대조 사선 차단(${blk}) — 건너뜀`); return; }
  const d2 = dist3(gd.chest, o), tof2 = d2 / C.BALANCE.muzzle, drop2 = 0.5 * g * tof2 * tof2;
  const r2_ = await aimShot(page, gd.chest);
  if (r2_.hit?.agentId !== gd.id) { ctx.check(`대조: 보정 없이 ${gd.id} 가슴 사격 → 명중`, false, { expected: `hit ${gd.id}(body)`, actual: shotDesc(r2_), suspects: ['ballistics'] }); return; }
  const meas = gd.chest[1] - r2_.hit.pos[1];
  ctx.check(`실측 낙차 ≈ 0.5·g·t² (${gd.id}, ${r2(d2, 1)}m)`, Math.abs(meas - drop2) <= Math.max(0.04, 0.35 * drop2), { expected: `${r2(drop2)}m (±${r2(Math.max(0.04, 0.35 * drop2))})`, actual: `${r2(meas)}m (part ${r2_.hit.part})`, suspects: ['ballistics'] });
});

// 8. 민간인 -------------------------------------------------------------
def(8, '민간인 오사(S3)', ['session', 'ballistics', 'hud'], 60000, [
  '`startStage(3)`, `assist({noSway:true,noDrop:true,noWind:true})`, `scope(true,1)`',
  '정지한 민간인 c3 머리 [−12, 1.62, −124.5] 조준 → `fire()` (사선에 다른 인물이 있으면 비킬 때까지 대기)',
  "`missionEnd{success:false, reason:'civilian'}`, RESULT 전환, `[data-ui=retry]` 표시 확인",
], async (ctx) => {
  const { page } = await ctx.open();
  if (!(await startStage(page, 3))) return ctx.check('S3 PLAYING 진입', false, { suspects: ['main'] });
  await api(page, 'assist', { noSway: true, noDrop: true, noWind: true });
  await api(page, 'scope', true, 1);
  await sleep(500);
  const C = await consts(page), lv = await api(page, 'level'), acts = await api(page, 'actors');
  ctx.check('S3 rules.civilianFail === true', lv.rules?.civilianFail === true, { actual: lv.rules?.civilianFail, suspects: ['levels'] });
  const c = acts.find((a) => a.id === 'c3') || acts.find((a) => a.role === 'civilian' && Math.hypot(a.vx, a.vz) < 0.05);
  if (!ctx.check('정지한 민간인 존재', !!c, { suspects: ['levels'] })) return;
  ctx.note(`민간인 ${c.id} 머리 ${v3(c.head)} (GDD §9.7: [−12, 1.62, −124.5])`);
  const clr = await waitClearShot(page, lv, c.id, 'head', C.BALANCE.muzzle, 15000, { C });
  if (!clr.ok) ctx.note(`사선 대기 실패(${clr.reason}) — 그대로 사격`);
  const r = await aimShot(page, c.head);
  ctx.check(`민간인 ${c.id} 명중`, r.hit?.agentId === c.id, { expected: `hit ${c.id}`, actual: shotDesc(r), suspects: ['ballistics'] });
  const me = (await waitEvents(page, ['missionEnd'], r.since, 3000))[0]?.payload;
  ctx.check("missionEnd{success:false, reason:'civilian'}", me && me.success === false && me.reason === 'civilian', { expected: "success:false, reason:'civilian'", actual: me ? `success:${me.success}, reason:${me.reason}` : 'missionEnd 없음', suspects: ['session'] });
  if (me) {
    const ok = await waitState(page, 'RESULT', 4000);
    ctx.check('1.5초 뒤 RESULT 전환', !!ok, { actual: await api(page, 'state'), suspects: ['main'] });
    await sleep(500);
    const rt = await visInfo(page, '[data-ui="retry"]');
    ctx.check('결과 화면 [data-ui=retry] 표시', rt.visible && !rt.covered, { actual: whyNot(rt), suspects: ['hud'] });
    await ctx.shot(page, 'civilian-result');
  }
});

// 9. 경계 --------------------------------------------------------------
def(9, '경계(3m 착탄)', ['ai', 'ballistics'], 60000, [
  '`startStage(1)`, `assist({noSway:true,noDrop:true,noWind:true})`',
  't1에서 3m 떨어진 지면(옆 또는 앞쪽, 다른 인물·extras와 사선이 겹치지 않는 지점) `aimAt` → `fire()`',
  'impact가 t1에서 1.5~4.5m인지 확인 후, 착탄 시각부터 1.5초 안에 t1.state가 alert 또는 flee가 되는지 확인 (S1 alertRadius 6)',
], async (ctx) => {
  const { page } = await ctx.open();
  if (!(await startStage(page, 1))) return ctx.check('S1 PLAYING 진입', false, { suspects: ['main'] });
  await api(page, 'assist', { noSway: true, noDrop: true, noWind: true });
  const lv = await api(page, 'level'), acts = await api(page, 'actors'), view = (await api(page, 'weapon')).view;
  const o = [view.x, view.y, view.z], boxes = extrasBoxes(lv);
  const t = acts.find((a) => a.id === 't1' && a.required) || acts.find((a) => a.required);
  ctx.note(`표적 ${t.id} @${v3([t.x, t.y, t.z])}, alertRadius ${lv.rules?.alertRadius}`);
  let done = false;
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [2.12, 2.12], [-2.12, 2.12]]) {
    const p = [t.x + dx, 0, t.z + dz];
    const blk = segPassesNear(o, p, acts, 0.8) || segHitsBoxes(o, p, boxes, 0.2);
    if (blk) { ctx.note(`후보 ${v3(p)} 건너뜀(사선: ${blk})`); continue; }
    const r = await aimShot(page, p);
    if (r.hit) { ctx.check('경계 테스트 사격이 인물을 맞히지 않음', false, { actual: shotDesc(r), suspects: ['ballistics'] }); return; }
    if (!r.impact) { ctx.check('3m 착탄 사격 → impact 이벤트', false, { actual: shotDesc(r), suspects: ['ballistics', 'weapon'] }); return; }
    const dImp = Math.hypot(r.impact.pos[0] - t.x, r.impact.pos[2] - t.z);
    if (dImp < 1.5 || dImp > 4.5) { ctx.note(`후보 ${v3(p)}: 착탄이 의도와 다름(${r.impact.surface} @${v3(r.impact.pos)}, 표적에서 ${r2(dImp, 1)}m) — 다음 후보`); continue; }
    ctx.note(`착탄 ${r.impact.surface} @${v3(r.impact.pos)}, 표적에서 ${r2(dImp, 2)}m`);
    const res = await waitFn(page, (id) => { const a = window.__SNIPER__.actors().find((x) => x.id === id); return a && (a.state === 'alert' || a.state === 'flee') ? { state: a.state, t: performance.now() } : null; }, 2500, t.id);
    const cur = (await api(page, 'actors')).find((a) => a.id === t.id);
    const react = res ? Math.round(res.t - r.impactT) : null;
    ctx.check(`1.5초 안에 ${t.id}가 alert/flee`, !!res && react <= 1500, { expected: '≤ 1500ms', actual: res ? `${res.state}, ${react}ms` : `2.5초 동안 ${cur?.state}`, suspects: ['ai'] });
    const al = (await eventsSince(page, 'alert', r.since)).find((e) => e.payload?.agentId === t.id);
    ctx.check(`alert 이벤트(agentId ${t.id}) 발신`, !!al, { actual: al ? 'alert 있음' : 'alert 이벤트 없음', suspects: ['ai'] });
    done = true;
    break;
  }
  if (!done) ctx.check('경계 테스트 착탄 지점 확보', false, { actual: '유효한 3m 착탄 지점이 없음(노트 참고)', suspects: ['world', 'ballistics'] });
});

// 10. 야간투시 ----------------------------------------------------------
def(10, '야간투시(S4)', ['renderer', 'actors'], 60000, [
  '`startStage(4)`, `assist({noSway:true})`, 1.5초 대기',
  '`nv(false)` 상태 drawCalls 최대값·스크린샷(qa-stage4-nv-off.png) → `nv(true)` 후 동일(qa-stage4-nv-on.png)',
  'drawCalls 증가 ≤ 2, 화면 변화(평균 픽셀 차이), 녹색 톤(G 평균이 R·B보다 큼) 확인',
], async (ctx) => {
  const { page } = await ctx.open();
  if (!(await startStage(page, 4))) return ctx.check('S4 PLAYING 진입', false, { suspects: ['main'] });
  await api(page, 'assist', { noSway: true });
  await sleep(1500);
  const sample = async () => { let mx = 0; for (let i = 0; i < 6; i++) { mx = Math.max(mx, (await api(page, 'stats')).drawCalls || 0); await sleep(150); } return mx; };
  await api(page, 'nv', false);
  await sleep(400);
  const dcOff = await sample();
  const off = await ctx.shot(page, 'stage4-nv-off');
  const since = await pnow(page);
  await api(page, 'nv', true);
  await sleep(1000);
  const nvEv = await eventsSince(page, 'nv', since);
  ctx.check('nv(true) → nv{on:true} 이벤트', nvEv.some((e) => e.payload?.on === true), { actual: JSON.stringify(nvEv.map((e) => e.payload)), suspects: ['main'] });
  const dcOn = await sample();
  const on = await ctx.shot(page, 'stage4-nv-on');
  await api(page, 'nv', false);
  ctx.check('NV 켜도 drawCalls 증가 ≤ 2', dcOn - dcOff <= 2, { expected: `≤ ${dcOff + 2}`, actual: `${dcOff} → ${dcOn}`, suspects: ['renderer', 'actors'] });
  const an = await analyzeShots(page, [off, on]);
  if (an.error) return ctx.note(`이미지 분석 실패: ${an.error}`);
  const [a, b] = an.stats;
  ctx.image('stage4-nv-off', a);
  ctx.image('stage4-nv-on', b);
  ctx.note(`NV off: 밝기 ${a.lum}, RGB ${a.mean} / NV on: 밝기 ${b.lum}, RGB ${b.mean}, 평균 차이 ${an.diff}`);
  ctx.check('NV 켜면 화면이 바뀜(평균 픽셀 차이 > 4)', an.diff > 4, { actual: an.diff, suspects: ['renderer'] });
  ctx.check('NV 화면이 녹색 톤(G > R·1.15, G > B·1.15)', b.mean[1] > b.mean[0] * 1.15 && b.mean[1] > b.mean[2] * 1.15, { expected: '녹색 우세', actual: `RGB ${b.mean}`, suspects: ['renderer', 'actors'] });
  ctx.check('NV 화면이 검은 화면 아님', !imageFlags(b).includes('검은 화면 의심'), { actual: `밝기 ${b.lum}, 대비 ${b.std}`, suspects: ['renderer'] });
});

// 11. VIP --------------------------------------------------------------
def(11, 'VIP(S5)', ['ai', 'session', 'storage', 'main'], 150000, [
  '`startStage(5)`, `timeScale(8)` 후 방치 → `missionEnd.reason === "escaped"` (GDD §9.7: 실제 약 10초)',
  'RESULT에서 `[data-ui=retry]` 탭 → `[data-ui=begin]` 탭 (없으면 `ui:retry`/`ui:begin` emit)',
  '`timeScale(1)`, assist 3종, 최대 줌, 사선이 열린 순간 VIP 가슴을 리드 조준해 사격',
  'missionEnd success·stars ≥ 1, RESULT 후 localStorage `sniper.progress.v1`의 stars[5]·best[5] 갱신 확인',
], async (ctx) => {
  const { page } = await ctx.open();
  if (!(await startStage(page, 5))) return ctx.check('S5 PLAYING 진입', false, { suspects: ['main'] });
  const C = await consts(page);
  const eta0 = (await api(page, 'session')).vipEta;
  ctx.note(`시작 vipEta ${r2(eta0, 1)}s (탑승까지 남은 초)`);
  const since = await pnow(page), t0 = Date.now();
  await api(page, 'timeScale', 8);
  const me = (await waitEvents(page, ['missionEnd'], since, 60000))[0]?.payload;
  const realS = (Date.now() - t0) / 1000;
  await api(page, 'timeScale', 1);
  ctx.check("방치(timeScale 8) → missionEnd reason 'escaped'", me && me.success === false && me.reason === 'escaped', { expected: "success:false, reason:'escaped' (실제 약 10초)", actual: me ? `success:${me.success}, reason:${me.reason}, 실제 ${r2(realS, 1)}s` : `60초 안에 missionEnd 없음`, suspects: ['ai', 'session'] });
  if (me) ctx.note(`escaped까지 실제 ${r2(realS, 1)}s (헤드리스 저FPS면 dt 0.05 상한 때문에 더 걸릴 수 있음)`);
  // 재시작
  if (!(await waitState(page, 'RESULT', 5000))) ctx.note(`RESULT로 안 바뀜(state ${await api(page, 'state')}) — startStage로 재시작`);
  await sleep(500);
  let via = 'DOM';
  let t = await tap(page, '[data-ui="retry"]', { timeout: 2000 });
  if (!t.ok) { via = 'emit'; await api(page, 'emit', 'ui:retry', {}); }
  if (await waitState(page, 'BRIEFING', 3000)) {
    await sleep(300);
    t = await tap(page, '[data-ui="begin"]', { timeout: 2000 });
    if (!t.ok) { via += '/emit'; await api(page, 'emit', 'ui:begin', {}); }
  }
  if (!(await waitState(page, 'PLAYING', 3000))) { via = 'startStage'; await startStage(page, 5); }
  ctx.note(`재시작 경로: ${via}`);
  if (!ctx.check('재시작 후 PLAYING', (await api(page, 'state')) === 'PLAYING', { suspects: ['main', 'hud'] })) return;
  await api(page, 'timeScale', 1);
  await api(page, 'assist', { noSway: true, noDrop: true, noWind: true });
  const lv = await api(page, 'level');
  await api(page, 'scope', true, lv.weapon.scopeFovs.length - 1);
  await sleep(400);
  const vip = (await api(page, 'actors')).find((a) => a.role === 'vip' || a.id === 'vip');
  if (!ctx.check('VIP 존재', !!vip, { suspects: ['levels', 'ai'] })) return;
  const since2 = await pnow(page);
  let killed = false;
  for (let attempt = 1; attempt <= 3 && !killed; attempt++) {
    const clr = await waitClearShot(page, lv, vip.id, 'chest', C.BALANCE.muzzle, 25000, { C });
    if (!clr.ok) { ctx.note(`시도 ${attempt}: ${clr.reason}`); break; }
    const r = await leadShot(page, vip.id, 'chest', C.BALANCE.muzzle);
    ctx.note(`시도 ${attempt}: 거리 ${r2(r.dist, 1)}m, 속도 ${r2(r.speed, 2)}m/s, 리드 ${r2(r.lead, 3)}m → ${shotDesc(r)}`);
    if (r.hit?.agentId === vip.id) killed = true;
  }
  ctx.check('VIP 사살', killed, { expected: 'hit vip', actual: killed ? 'hit' : '실패(노트 참고)', suspects: ['ballistics', 'ai'] });
  const me2 = (await waitEvents(page, ['missionEnd'], since2, 3000))[0]?.payload;
  ctx.check('missionEnd success(cleared)', me2?.success === true, { expected: "success:true, reason:'cleared'", actual: me2 ? `success:${me2.success}, reason:${me2.reason}, score ${me2.score}` : '없음', suspects: ['session'] });
  ctx.check('stars ≥ 1', (me2?.stars ?? 0) >= 1, { actual: me2?.stars, suspects: ['session'] });
  if (!me2?.success) return;
  ctx.check('RESULT 전환', !!(await waitState(page, 'RESULT', 4000)), { actual: await api(page, 'state'), suspects: ['main'] });
  await sleep(300);
  const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('sniper.progress.v1')); } catch (e) { return { error: String(e) }; } });
  ctx.check('localStorage sniper.progress.v1 갱신(stars[5] ≥ 1, best[5] = 점수)', !!saved && (saved.stars?.[5] ?? 0) >= 1 && saved.best?.[5] === me2.score, { expected: `stars[5] ≥ 1, best[5] = ${me2.score}`, actual: saved ? `stars ${JSON.stringify(saved.stars)}, best ${JSON.stringify(saved.best)}, unlocked ${saved.unlocked}` : '저장 없음', suspects: ['storage', 'main'] });
  await ctx.shot(page, 'vip-result');
});

// 12. 성능 --------------------------------------------------------------
def(12, '성능', ['renderer', 'world', 'actors'], OPT.quick ? 150000 : 300000, [
  '`startStage(N)` (N=1..5), 워밍업 후 5초(--quick 2초) 동안 rAF 프레임 간격과 `stats()` 샘플링',
  '`page.emulateCPUThrottling(4)`로 반복',
  'drawCalls ≤ 100, tris ≤ 120000 판정. FPS는 데스크톱 headless(소프트웨어 GL 가능) 기준 상대 비교용',
], async (ctx) => {
  const { page } = await ctx.open();
  const C = await consts(page);
  const B = C.BUDGET;
  for (const throttled of [false, true]) {
    await page.emulateCPUThrottling(throttled ? 4 : null);
    for (const id of [1, 2, 3, 4, 5]) {
      if (!(await startStage(page, id))) { ctx.check(`S${id}${throttled ? ' (CPU×4)' : ''} PLAYING 진입`, false, { suspects: ['main'] }); continue; }
      await sleep(PERF_WARM);
      await page.evaluate(() => window.__QA__.probe.start());
      const samples = [];
      const end = Date.now() + PERF_DUR;
      while (Date.now() < end) { samples.push(await api(page, 'stats')); await sleep(250); }
      const pr = await page.evaluate(() => window.__QA__.probe.stop());
      const last = samples[samples.length - 1] || {};
      const row = {
        stage: id, throttled, fps: pr.fps, p95: pr.p95, frameMsAvg: pr.avg, maxFrameMs: pr.max, frames: pr.frames,
        gameFps: last.fps, gameP95: last.frameMsP95,
        drawCalls: Math.max(0, ...samples.map((s) => s.drawCalls || 0)), tris: Math.max(0, ...samples.map((s) => s.tris || 0)),
        pixelRatio: median(samples.map((s) => s.pixelRatio || 0)), pixelRatioMin: Math.min(...samples.map((s) => s.pixelRatio || 0)),
      };
      ctx.perf.push(row);
      console.log(`  perf S${id}${throttled ? ' CPU×4' : ''}: ${row.fps}fps p95 ${row.p95}ms dc ${row.drawCalls} tri ${row.tris} pr ${row.pixelRatio}`);
      ctx.check(`S${id}${throttled ? ' (CPU×4)' : ''} 프레임 진행`, pr.frames > 0 && (last.fps || 0) > 0, { actual: `rAF ${pr.frames}프레임, 게임 fps ${last.fps}`, suspects: ['main', 'renderer'] });
      if (!throttled) {
        ctx.check(`S${id} drawCalls ≤ ${B.drawCalls}`, row.drawCalls > 0 && row.drawCalls <= B.drawCalls, { expected: `1~${B.drawCalls}`, actual: row.drawCalls, suspects: ['world', 'actors', 'renderer'] });
        ctx.check(`S${id} tris ≤ ${B.tris}`, row.tris <= B.tris, { expected: `≤ ${B.tris}`, actual: row.tris, suspects: ['world', 'actors'] });
      }
    }
  }
  await page.emulateCPUThrottling(null);
});

// 13. 수명주기 ----------------------------------------------------------
def(13, '수명주기', ['pwa', 'main', 'renderer'], 120000, [
  '`startStage(1)` 후 document.hidden=true·visibilityState=hidden으로 바꾸고 visibilitychange 발송 → PAUSED',
  'visible로 되돌려 다시 발송 → PAUSED 유지 → `ui:resume` → PLAYING',
  '`WEBGL_lose_context.loseContext()` → PAUSED·미처리 에러 0 → `restoreContext()` 후 미처리 에러 0',
  '메모리: 스테이지 1→5 순환 3회 + S5 연속 재로드 5회, `stats().geometries/textures`(renderer.info.memory) 기록 → 2·3회차 순환과 연속 재로드에서 값이 늘지 않는지 확인(1회차는 캐시 워밍업)',
], async (ctx) => {
  const g = await ctx.open();
  const { page } = g;
  if (!(await startStage(page, 1))) return ctx.check('S1 PLAYING 진입', false, { suspects: ['main'] });
  // 메모리 누수: 스테이지 1→5 순환을 3회 반복. 1회차는 워밍업(처음 쓰는 공유 지오메트리가 캐시에 남는 것은 상한이 있으므로 허용)
  // → 2·3회차에서 같은 스테이지 값이 늘면 dispose 누락. 마지막으로 S5를 5회 연속 재로드해 같은 스테이지 반복도 확인
  const memSnap = async (id, cycle) => { await sleep(900); const s = await api(page, 'stats'); ctx.memory.push({ cycle, stage: id, geometries: s.geometries, textures: s.textures, drawCalls: s.drawCalls }); };
  let memOk = true;
  for (let cycle = 1; cycle <= 3 && memOk; cycle++) {
    for (const id of [1, 2, 3, 4, 5]) {
      if (cycle > 1 || id > 1) { if (!(await startStage(page, id))) { ctx.check(`메모리 측정: S${id} 재진입`, false, { suspects: ['main'] }); memOk = false; break; } }
      await memSnap(id, cycle);
    }
  }
  if (memOk) { for (let i = 0; i < 4; i++) { await startStage(page, 5); await sleep(200); } await startStage(page, 5); await memSnap(5, 'S5×5'); }
  if (ctx.memory.some((m) => typeof m.geometries !== 'number')) ctx.note('stats()에 geometries/textures가 없어 누수 판정 생략');
  else if (memOk) {
    const at = (c, id) => ctx.memory.find((m) => m.cycle === c && m.stage === id);
    ctx.note(`메모리(geo/tex) 1회차: ${[1, 2, 3, 4, 5].map((id) => `S${id} ${at(1, id).geometries}/${at(1, id).textures}`).join(', ')}`);
    ctx.note(`메모리(geo/tex) 3회차: ${[1, 2, 3, 4, 5].map((id) => `S${id} ${at(3, id).geometries}/${at(3, id).textures}`).join(', ')}`);
    const grow = [1, 2, 3, 4, 5].map((id) => ({ id, g: at(3, id).geometries - at(2, id).geometries, t: at(3, id).textures - at(2, id).textures }));
    const bad = grow.filter((x) => x.g > 1 || x.t > 0);
    ctx.check('2→3회차 순환에서 스테이지별 geometries(+1 이하)·textures 증가 없음', bad.length === 0, { expected: '증가 없음', actual: bad.length ? bad.map((x) => `S${x.id} geo +${x.g} tex +${x.t}`) : grow.map((x) => `S${x.id} ${x.g >= 0 ? '+' : ''}${x.g}/${x.t >= 0 ? '+' : ''}${x.t}`).join(', '), suspects: ['world', 'actors', 'fx', 'renderer'] });
    const s5a = at(3, 5), s5b = ctx.memory.find((m) => m.cycle === 'S5×5');
    ctx.check('S5 연속 재로드 5회 후 geometries·textures 증가 없음', s5b.geometries - s5a.geometries <= 1 && s5b.textures - s5a.textures <= 0, { actual: `geo ${s5a.geometries}→${s5b.geometries}, tex ${s5a.textures}→${s5b.textures}`, suspects: ['world', 'actors', 'renderer'] });
    const warm = at(2, 1).geometries - at(1, 1).geometries;
    if (warm > 0) ctx.note(`첫 순환 뒤 S1 geometries +${warm} — 처음 쓴 공유 지오메트리가 캐시에 남는 것으로 보임(이후 순환에서 증가 없음 → 누수 아님)`);
  }
  if (!(await startStage(page, 1))) return ctx.check('S1 PLAYING 진입(수명주기)', false, { suspects: ['main'] });
  const setVis = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await setVis(true);
  ctx.check('visibilitychange(hidden) → PAUSED', !!(await waitState(page, 'PAUSED', 2000)), { expected: 'PAUSED', actual: await api(page, 'state'), suspects: ['pwa', 'main'] });
  await setVis(false);
  await sleep(600);
  const st2 = await api(page, 'state');
  ctx.check('visible 복귀 후 PAUSED 유지(자동 재개 안 함)', st2 === 'PAUSED', { actual: st2, suspects: ['main', 'pwa'] });
  await api(page, 'emit', 'ui:resume', {});
  ctx.check('ui:resume → PLAYING', !!(await waitState(page, 'PLAYING', 2000)), { actual: await api(page, 'state'), suspects: ['main', 'hud'] });
  await sleep(300);
  const e0 = g.errors.length;
  const lost = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
    if (!gl) return 'no-gl';
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return 'no-ext';
    window.__qaLoseExt = ext;
    ext.loseContext();
    return 'lost';
  });
  if (!ctx.check('WEBGL_lose_context 사용 가능', lost === 'lost', { actual: lost, suspects: ['renderer'] })) return;
  await sleep(1500);
  const st4 = await api(page, 'state').catch(() => '?');
  ctx.check('컨텍스트 손실 → PAUSED', st4 === 'PAUSED', { actual: st4, suspects: ['pwa', 'main'] });
  const h1 = classifyErrors(g.errors.slice(e0)).hard;
  ctx.check('컨텍스트 손실 후 미처리 에러 0개', h1.length === 0, { actual: h1.length ? h1.slice(0, 5) : '0개', suspects: ['renderer', 'pwa', 'main'] });
  const e1 = g.errors.length;
  try { await page.evaluate(() => window.__qaLoseExt && window.__qaLoseExt.restoreContext()); } catch (e) { ctx.note(`restoreContext 호출 중 탐색 발생: ${e.message.slice(0, 80)}`); }
  await sleep(2500);
  const back = await waitAPI(page, 10000);
  let st5 = '없음';
  if (back) { try { st5 = await api(page, 'state'); } catch { st5 = '?'; } }
  ctx.note(`restoreContext 후 상태: ${st5} (pwa.js가 복구 시 페이지를 다시 로드하면 TITLE)`);
  const h2 = classifyErrors(g.errors.slice(e1)).hard;
  ctx.check('컨텍스트 복구 후 미처리 에러 0개', h2.length === 0, { actual: h2.length ? h2.slice(0, 5) : '0개', suspects: ['renderer', 'pwa'] });
  ctx.excludeErrors(g, e0); // 위에서 따로 판정함
});

// 14. PWA --------------------------------------------------------------
def(14, 'PWA', ['sw', 'manifest', 'html', 'pwa'], 90000, [
  '`?sw=1&debug`로 접속 (autotest는 nosw를 강제하므로 사용하지 않음)',
  '`navigator.serviceWorker.ready`와 controller 확인 (첫 로드에 controller가 없으면 1회 reload)',
  '`page.setOfflineMode(true)` 후 reload → `__SNIPER__` 부팅·TITLE 확인, 실패한 요청 목록 확인',
  'manifest fetch·파싱(필드, 상대경로, 아이콘 파일), 메타 태그, apple-touch-icon 확인 → 끝나면 SW unregister·캐시 삭제',
], async (ctx) => {
  const g = await ctx.open({ query: 'sw=1&debug' });
  const { page } = g;
  try {
    const hasSW = await page.evaluate(() => 'serviceWorker' in navigator);
    if (!ctx.check('navigator.serviceWorker 지원', hasSW, { suspects: ['pwa'] })) return;
    const reg = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then((r) => ({ scope: r.scope, active: !!r.active, script: r.active && r.active.scriptURL })),
      new Promise((res) => setTimeout(() => res(null), 12000)),
    ]));
    ctx.check('serviceWorker.ready (12초 안)', !!reg && reg.active, { expected: '활성 SW', actual: reg ? JSON.stringify(reg) : '등록 안 됨', suspects: ['pwa', 'sw'] });
    if (reg) {
      ctx.check('SW scope가 /docs/ (상대경로 등록)', /\/docs\/$/.test(reg.scope), { actual: reg.scope, suspects: ['pwa'] });
      const swm = await fetchInfo(new URL(reg.script || 'sw.js', BASE).pathname.replace(/^\/docs\//, ''));
      ctx.check('sw.js MIME text/javascript', swm.status === 200 && /javascript/.test(swm.ct), { actual: `${swm.status} ${swm.ct}`, suspects: ['serve'] });
    }
    let ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (!ctrl && reg) {
      ctx.note('첫 로드에 controller 없음(clients.claim 미사용 가능) → reload 후 확인');
      await page.reload({ waitUntil: 'load' });
      await waitAPI(page, 15000);
      ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    }
    ctx.check('페이지가 SW의 제어를 받음(controller)', ctrl, { suspects: ['sw', 'pwa'] });
    // 오프라인
    if (reg) {
      const m = g.errors.length;
      await page.setOfflineMode(true);
      let booted = false, st = '?';
      try {
        await page.reload({ waitUntil: 'load', timeout: 20000 });
        booted = await waitAPI(page, 15000);
        if (booted) { await sleep(1500); st = await api(page, 'state'); }
      } catch (e) { ctx.note(`오프라인 reload 실패: ${e.message.slice(0, 120)}`); }
      ctx.check('오프라인 reload 후 부팅(TITLE)', booted && st === 'TITLE', { expected: 'TITLE', actual: booted ? st : '부팅 안 됨', suspects: ['sw'] });
      if (booted) await ctx.shot(page, 'pwa-offline');
      const offErr = g.errors.slice(m);
      const failedReq = offErr.filter((e) => /^requestfailed|^http /.test(e) && !/ERR_ABORTED/.test(e));
      ctx.check('오프라인 로드 중 실패한 요청 0개(precache 누락 없음)', failedReq.length === 0, { actual: failedReq.length ? failedReq.slice(0, 6) : '0개', suspects: ['sw'] });
      const offHard = classifyErrors(offErr).hard.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
      if (offHard.length) ctx.check('오프라인 로드 중 미처리 에러 0개', false, { actual: offHard.slice(0, 5), suspects: ['sw', 'pwa'] });
      await page.setOfflineMode(false);
      ctx.excludeErrors(g, m, g.errors.length);
    }
    // manifest
    const man = await page.evaluate(async () => {
      const l = document.querySelector('link[rel="manifest"]');
      if (!l) return { missing: true };
      const url = new URL(l.getAttribute('href'), document.baseURI).href;
      let status = 0, ct = '', json = null, err = null;
      try { const r = await fetch(url, { cache: 'no-store' }); status = r.status; ct = r.headers.get('content-type') || ''; const tx = await r.text(); try { json = JSON.parse(tx); } catch (e) { err = String(e); } } catch (e) { err = String(e); }
      const icons = [];
      if (json && Array.isArray(json.icons)) for (const ic of json.icons) {
        let st = 0, ict = '';
        try { const ir = await fetch(new URL(ic.src, url).href, { cache: 'no-store' }); st = ir.status; ict = ir.headers.get('content-type') || ''; } catch { /* 실패 */ }
        icons.push({ src: ic.src, sizes: ic.sizes, purpose: ic.purpose, status: st, ct: ict });
      }
      return { href: l.getAttribute('href'), url, status, ct, json, err, icons };
    });
    if (ctx.check('<link rel="manifest"> 존재', !man.missing, { suspects: ['html'] })) {
      ctx.check('manifest 링크가 상대경로', !/^(\/|https?:)/.test(man.href), { actual: man.href, suspects: ['html'] });
      ctx.check('manifest 200 + JSON 파싱', man.status === 200 && !!man.json, { actual: `${man.status} ${man.ct} ${man.err || ''}`, suspects: ['manifest'] });
      const j = man.json || {};
      const miss = ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons'].filter((k) => j[k] == null || j[k] === '');
      ctx.check('manifest 필수 필드(name, short_name, start_url, scope, display, background_color, theme_color, icons)', miss.length === 0, { actual: miss.length ? `누락: ${miss.join(', ')}` : '모두 있음', suspects: ['manifest'] });
      ctx.check("display가 standalone/fullscreen", ['standalone', 'fullscreen'].includes(j.display), { actual: j.display, suspects: ['manifest'] });
      ctx.check('orientation이 landscape 계열', /landscape/.test(j.orientation || ''), { actual: j.orientation, suspects: ['manifest'] });
      ctx.check('start_url·scope가 상대경로', ![j.start_url, j.scope].some((u) => typeof u === 'string' && /^(\/|https?:)/.test(u)), { actual: `start_url ${j.start_url}, scope ${j.scope}`, suspects: ['manifest'] });
      const sizes = man.icons.map((i) => i.sizes || '').join(' ');
      ctx.check('아이콘 192·512 크기 포함', /192x192/.test(sizes) && /512x512/.test(sizes), { actual: sizes || '아이콘 없음', suspects: ['manifest', 'icons'] });
      const badIcons = man.icons.filter((i) => i.status !== 200 || !/image\/png/.test(i.ct));
      ctx.check('manifest 아이콘 파일 모두 200 + image/png', man.icons.length > 0 && badIcons.length === 0, { actual: badIcons.length ? badIcons.map((i) => `${i.src} ${i.status} ${i.ct}`) : `${man.icons.length}개 정상`, suspects: ['icons'] });
      ctx.check('manifest MIME application/manifest+json', /application\/manifest\+json/.test(man.ct), { actual: man.ct, suspects: ['serve'] });
    }
    // 메타
    const meta = await page.evaluate(async () => {
      const m = (n) => document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') ?? null;
      const ati = document.querySelector('link[rel="apple-touch-icon"]');
      let atiStatus = 0, atiCt = '';
      if (ati) { try { const r = await fetch(new URL(ati.getAttribute('href'), document.baseURI).href, { cache: 'no-store' }); atiStatus = r.status; atiCt = r.headers.get('content-type') || ''; } catch { /* 실패 */ } }
      return { viewport: m('viewport'), capable: m('apple-mobile-web-app-capable'), mcapable: m('mobile-web-app-capable'), status: m('apple-mobile-web-app-status-bar-style'), title: m('apple-mobile-web-app-title'), theme: m('theme-color'), ati: ati?.getAttribute('href') ?? null, atiStatus, atiCt };
    });
    ctx.check('viewport: width=device-width + viewport-fit=cover', /width=device-width/.test(meta.viewport || '') && /viewport-fit=cover/.test(meta.viewport || ''), { actual: meta.viewport, suspects: ['html'] });
    ctx.check('apple-mobile-web-app-capable 또는 mobile-web-app-capable = yes', meta.capable === 'yes' || meta.mcapable === 'yes', { actual: `apple ${meta.capable}, mobile ${meta.mcapable}`, suspects: ['html'] });
    ctx.check('apple-mobile-web-app-status-bar-style 존재', !!meta.status, { actual: meta.status, suspects: ['html'] });
    ctx.check('theme-color 존재', !!meta.theme, { actual: meta.theme, suspects: ['html'] });
    ctx.check('apple-touch-icon 링크 + 파일 200 PNG', !!meta.ati && meta.atiStatus === 200 && /image\/png/.test(meta.atiCt), { actual: `${meta.ati} ${meta.atiStatus} ${meta.atiCt}`, suspects: ['html', 'icons'] });
    if (!meta.title) ctx.note('apple-mobile-web-app-title 없음(홈 화면 이름이 <title>로 표시됨)');
  } finally {
    try { await page.setOfflineMode(false); } catch { /* 닫힘 */ }
    const n = await page.evaluate(async () => {
      const rs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(rs.map((r) => r.unregister()));
      if (self.caches) for (const k of await caches.keys()) await caches.delete(k);
      return rs.length;
    }).catch(() => -1);
    ctx.note(`정리: SW ${n}개 unregister, 캐시 삭제`);
  }
});

// 15. PC 데스크톱 --------------------------------------------------------
def(15, 'PC 데스크톱(마우스·키보드)', ['input', 'serve'], 90000, [
  '데스크톱 1280×720(마우스·키보드, 터치 없음)으로 `?autotest&nosw&seed=1` 접속, `startStage(4)`, assist 3종, 안전한 지면 조준',
  'Space(발사), E(스코프), Q(줌), 휠 위/아래(zoom ±1), Shift(숨참기), R(재장전), N(야간투시), 좌클릭(발사), 우클릭(스코프), Esc(일시정지) 입력 후 weapon 상태·이벤트 확인',
  '`js/main.js`, `manifest.webmanifest`의 Content-Type 확인 (tools/serve.py MIME)',
], async (ctx) => {
  const { page } = await ctx.open({ desktop: true });
  const mq = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches }));
  ctx.note(`미디어: pointer coarse=${mq.coarse}, fine=${mq.fine}`);
  const rot = await visInfo(page, '#rotate');
  ctx.check('데스크톱에서 #rotate 숨김', !rot.visible, { actual: rot.visible ? '보임' : '숨김', suspects: ['css'] });
  if (!(await startStage(page, 4))) return ctx.check('S4 PLAYING 진입', false, { suspects: ['main'] });
  await api(page, 'assist', { noSway: true, noDrop: true, noWind: true });
  const lv = await api(page, 'level'), acts = await api(page, 'actors');
  const safe = safeGroundPoint(lv, acts);
  const aimSafe = async () => { if (safe) await api(page, 'aimAt', safe); };
  const W = () => api(page, 'weapon');
  const nz = lv.weapon.scopeFovs.length;
  const sp = (await page.evaluate(() => window.__QA__.safePoint())) || { x: 640, y: 320 };
  await page.mouse.move(sp.x, sp.y);
  // Space
  await aimSafe(); await waitCanFire(page);
  let since = await pnow(page);
  await page.keyboard.press('Space');
  let ev = await waitEvents(page, ['shot'], since, 1500);
  ctx.check('Space → 발사(shot)', ev.length >= 1, { expected: 'shot', actual: `shot ${ev.length}개`, suspects: ['input'] });
  // E
  await api(page, 'scope', false, 0); await sleep(400);
  let w0 = await W();
  await page.keyboard.press('KeyE'); await sleep(500);
  let w1 = await W();
  ctx.check('E → 스코프 켜짐(fov 감소)', w1.scoped && w1.view.fov < w0.view.fov - 1, { actual: `scoped ${w0.scoped}→${w1.scoped}, fov ${r2(w0.view.fov, 1)}→${r2(w1.view.fov, 1)}`, suspects: ['input'] });
  // Q
  await api(page, 'scope', true, 0); await sleep(400);
  w0 = await W();
  await page.keyboard.press('KeyQ'); await sleep(500);
  w1 = await W();
  ctx.check('Q → 줌 단계 변경', w1.zoomIdx !== w0.zoomIdx, { actual: `zoomIdx ${w0.zoomIdx}→${w1.zoomIdx}`, suspects: ['input'] });
  // 휠
  await api(page, 'scope', true, 0); await sleep(400);
  w0 = await W();
  await page.mouse.wheel({ deltaY: -120 }); await sleep(500);
  w1 = await W();
  ctx.check('휠 위 → zoom +1', w1.scoped && w1.zoomIdx === Math.min(1, nz - 1), { expected: 'zoomIdx 0→1', actual: `zoomIdx ${w0.zoomIdx}→${w1.zoomIdx}, scoped ${w1.scoped}`, suspects: ['input'] });
  w0 = w1;
  await page.mouse.wheel({ deltaY: 120 }); await sleep(500);
  w1 = await W();
  ctx.check('휠 아래 → zoom −1', w1.zoomIdx < w0.zoomIdx || (w0.zoomIdx === 0 && !w1.scoped), { expected: `zoomIdx ${w0.zoomIdx}→${Math.max(0, w0.zoomIdx - 1)}`, actual: `zoomIdx ${w0.zoomIdx}→${w1.zoomIdx}, scoped ${w1.scoped}`, suspects: ['input'] });
  // Shift
  await page.keyboard.down('ShiftLeft'); await sleep(400);
  const hold = (await W()).holding;
  await page.keyboard.up('ShiftLeft'); await sleep(300);
  const rel = (await W()).holding;
  ctx.check('Shift 누르는 동안 숨참기(holding)', hold === true && rel === false, { actual: `누름 ${hold}, 뗌 ${rel}`, suspects: ['input', 'weapon'] });
  // R
  w0 = await W();
  since = await pnow(page);
  await page.keyboard.press('KeyR');
  ev = await waitEvents(page, ['reload'], since, 1500);
  ctx.check('R → 재장전 시작', ev.some((e) => e.payload?.phase === 'start'), { actual: `mag ${w0.mag}/${w0.magSize}, reload 이벤트 ${JSON.stringify(ev.map((e) => e.payload))}`, suspects: ['input', 'weapon'] });
  await waitFn(page, (s) => window.__SNIPER__.events('reload').some((e) => e.t >= s && e.payload && e.payload.phase === 'end'), 4000, since);
  // N
  since = await pnow(page);
  await page.keyboard.press('KeyN');
  ev = await waitEvents(page, ['nv'], since, 1500);
  ctx.check('N → 야간투시 켜짐(nv{on:true})', ev.some((e) => e.payload?.on === true), { actual: JSON.stringify(ev.map((e) => e.payload)), suspects: ['input', 'main'] });
  since = await pnow(page);
  await page.keyboard.press('KeyN');
  ev = await waitEvents(page, ['nv'], since, 1500);
  ctx.check('N 다시 → 야간투시 꺼짐', ev.some((e) => e.payload?.on === false), { actual: JSON.stringify(ev.map((e) => e.payload)), suspects: ['input', 'main'] });
  // 좌클릭
  await api(page, 'scope', false, 0);
  await aimSafe(); await waitCanFire(page);
  since = await pnow(page);
  await page.mouse.click(sp.x, sp.y);
  await sleep(400);
  const lock = await page.evaluate(() => (document.pointerLockElement ? window.__QA__.describe(document.pointerLockElement) : null));
  let shots = await eventsSince(page, 'shot', since);
  const firstFired = shots.length > 0;
  if (!firstFired) { await aimSafe(); await waitCanFire(page); await page.mouse.click(sp.x, sp.y); await sleep(400); shots = await eventsSince(page, 'shot', since); }
  ctx.note(`포인터 잠금: ${lock || '없음(헤드리스에서 거부될 수 있음)'}, 첫 클릭에서 발사=${firstFired}`);
  ctx.check('마우스 좌클릭 → 발사', shots.length >= 1, { actual: `shot ${shots.length}개`, suspects: ['input'] });
  // 우클릭
  await sleep(300);
  w0 = await W();
  await page.mouse.click(sp.x, sp.y, { button: 'right' });
  await sleep(500);
  w1 = await W();
  ctx.check('마우스 우클릭 → 스코프 전환', w1.scoped !== w0.scoped, { actual: `scoped ${w0.scoped}→${w1.scoped}`, suspects: ['input'] });
  // 마우스 이동 조준: 포인터 잠금이 걸렸을 때만 판정(감도 = fov/화면높이, CONTRACT §2)
  w0 = await W();
  const lockNow = await page.evaluate(() => !!document.pointerLockElement);
  const Hpx = await page.evaluate(() => document.getElementById('gl')?.clientHeight || innerHeight);
  await page.mouse.move(sp.x + 120, sp.y, { steps: 8 });
  await sleep(300);
  w1 = await W();
  const dyaw = w0.view.yaw - w1.view.yaw, expYaw = 120 * ((w0.view.fov * DEG) / Hpx);
  if (lockNow) ctx.check('포인터 잠금 중 마우스 오른쪽 이동 → yaw 감소(≈120·fov/화면높이 ±50%)', dyaw > 0 && Math.abs(dyaw - expYaw) <= 0.5 * expYaw, { expected: `${r2(expYaw, 4)}rad 감소`, actual: `yaw ${r2(w0.view.yaw, 4)}→${r2(w1.view.yaw, 4)} (fov ${r2(w0.view.fov, 1)})`, suspects: ['input'] });
  else ctx.note(`포인터 잠금 없음 → 마우스 이동 조준 미판정(yaw ${r2(w0.view.yaw)}→${r2(w1.view.yaw)}), play_pc.bat에서 확인`);
  // Esc
  await page.keyboard.press('Escape');
  const p = await waitState(page, 'PAUSED', 2000);
  ctx.check('Esc → 일시정지(PAUSED)', !!p, { actual: await api(page, 'state'), suspects: ['input', 'main'] });
  // MIME
  const js = await fetchInfo('js/main.js');
  ctx.check('MIME: .js → text/javascript', js.status === 200 && /text\/javascript/.test(js.ct), { actual: `${js.status} ${js.ct}`, suspects: ['serve'] });
  const mf = await fetchInfo('manifest.webmanifest');
  ctx.check('MIME: .webmanifest → application/manifest+json', mf.status === 200 && /application\/manifest\+json/.test(mf.ct), { actual: `${mf.status} ${mf.ct}`, suspects: mf.status === 404 ? ['manifest'] : ['serve'] });
});

// 16. 이미지 확인 ---------------------------------------------------------
def(16, '이미지 확인', ['renderer', 'world', 'actors', 'hud', 'css'], 120000, [
  '스테이지 1~5마다 `startStage(N)`, `assist({noSway:true})`, 1.5초 대기 후 `qa-stageN-hip.png`',
  '첫 필수 표적 가슴 `aimAt` + 최대 줌 스코프 1초 후 `qa-stageN-scope.png`',
  '자동 분석(밝기·대비) + 인게임 버튼 배치(겹침·화면 밖·중앙 가림) 확인. 이미지는 사람이 직접 열어 확인',
], async (ctx) => {
  const { page } = await ctx.open();
  for (const id of [1, 2, 3, 4, 5]) {
    if (!(await startStage(page, id))) { ctx.check(`S${id} PLAYING 진입`, false, { suspects: ['main'] }); continue; }
    await api(page, 'assist', { noSway: true });
    await sleep(1500);
    if (id === 1 || id === 4) {
      const lay = await page.evaluate(() => window.__QA__.btnLayout());
      ctx.check(`S${id} 인게임 버튼 표시`, lay.buttons.length > 0, { actual: `${lay.buttons.length}개`, suspects: ['hud'] });
      ctx.check(`S${id} 인게임 버튼끼리 겹치지 않음`, lay.overlaps.length === 0, { actual: lay.overlaps.length ? lay.overlaps : '없음', suspects: ['hud', 'css'] });
      ctx.check(`S${id} 버튼이 모두 화면 안`, lay.outside.length === 0, { actual: lay.outside.length ? lay.outside : '없음', suspects: ['css'] });
      ctx.check(`S${id} 화면 중앙(조준점 ±30px)을 가리는 버튼 없음`, lay.center.length === 0, { actual: lay.center.length ? lay.center : '없음', suspects: ['css'] });
      ctx.check(`S${id} 버튼이 다른 요소에 가려지지 않음`, lay.covered.length === 0, { actual: lay.covered.length ? lay.covered : '없음', suspects: ['hud', 'css'] });
      if (lay.small.length) ctx.note(`S${id} 44pt 미만 터치 영역: ${lay.small.join(', ')}`);
      ctx.note(`S${id} 버튼 배치: ${lay.buttons.map((b) => `${b.name}(${b.x},${b.y} ${b.w}×${b.h})`).join(' ')}`);
    }
    const hip = await ctx.shot(page, `stage${id}-hip`);
    const lv = await api(page, 'level'), acts = await api(page, 'actors');
    const tgt = acts.find((a) => a.required) || acts[0];
    if (tgt) await api(page, 'aimAt', tgt.chest);
    await api(page, 'scope', true, lv.weapon.scopeFovs.length - 1);
    await sleep(1000);
    const sc = await ctx.shot(page, `stage${id}-scope`);
    const an = await analyzeShots(page, [hip, sc]);
    if (an.error) { ctx.note(`S${id} 이미지 분석 실패: ${an.error}`); continue; }
    const fh = ctx.image(`stage${id}-hip`, an.stats[0], { stage: id, view: 'hip' });
    const fs_ = ctx.image(`stage${id}-scope`, an.stats[1], { stage: id, view: 'scope', aim: tgt?.id });
    ctx.check(`S${id} 비조준 화면이 검은/단색 화면 아님`, !fh.some((f) => /검은|단색/.test(f)), { actual: `밝기 ${an.stats[0].lum}, 대비 ${an.stats[0].std} ${fh.join(',')}`, suspects: ['renderer', 'world'] });
    ctx.check(`S${id} 스코프 화면이 검은/단색 화면 아님`, !fs_.some((f) => /검은|단색/.test(f)), { actual: `밝기 ${an.stats[1].lum}, 대비 ${an.stats[1].std} ${fs_.join(',')}`, suspects: ['renderer', 'hud'] });
    if (id === 4) {
      await api(page, 'nv', true);
      await sleep(800);
      const nvb = await ctx.shot(page, 'stage4-scope-nv');
      const an2 = await analyzeShots(page, [nvb]);
      if (an2.stats?.[0]) ctx.image('stage4-scope-nv', an2.stats[0], { stage: 4, view: 'scope+nv' });
      await api(page, 'nv', false);
    }
    await api(page, 'scope', false, 0);
  }
  ctx.note('스크린샷은 사람이 직접 열어 확인해야 함: 표적이 보이는지, UI 겹침, 이상한 색/깨짐');
});

// ───────────────────────────── 실행기 ─────────────────────────────
async function runScenario(sc) {
  console.log(`\n[qa] #${sc.id} ${sc.name}`);
  const ctx = makeCtx(sc);
  const before = new Set(LAUNCHED);
  const t0 = Date.now();
  let timer;
  const runP = Promise.resolve().then(() => sc.run(ctx));
  runP.catch(() => {});
  try {
    await Promise.race([runP, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`시나리오 타임아웃(${Math.round(sc.timeout / 1000)}초)`)), sc.timeout); })]);
  } catch (e) {
    ctx.check('시나리오가 예외 없이 끝남', false, { actual: e?.stack ? e.stack.split('\n').slice(0, 3).map((s) => s.trim()).join(' | ') : String(e), suspects: sc.suspects });
  } finally {
    clearTimeout(timer);
  }
  if (!ctx.customErrors && ctx.games.length) ctx.errorCheck();
  ctx.closed = true;
  for (const b of [...LAUNCHED]) if (!before.has(b)) await b.close().catch(() => {});
  const checks = ctx.details.filter((d) => d.type === 'check');
  const status = checks.some((c) => !c.ok) ? 'fail' : ctx.skipped || !checks.length ? 'skip' : 'pass';
  console.log(`[qa] #${sc.id} → ${status.toUpperCase()} (${checks.filter((c) => c.ok).length}/${checks.length}, ${Math.round((Date.now() - t0) / 1000)}s)`);
  return {
    id: sc.id, name: sc.name, status, runAt: new Date().toISOString(), durationMs: Date.now() - t0,
    details: ctx.details, evidence: ctx.evidence, repro: sc.repro, _perf: ctx.perf, _images: ctx.images, _memory: ctx.memory,
  };
}

// ───────────────────────────── 결과 파일 ─────────────────────────────
function writeOutputs(ran) {
  fs.mkdirSync(OPT.out, { recursive: true });
  const jsonPath = path.join(OPT.out, 'qa-results.json');
  let scenarios = ran.map(({ _perf, _images, _memory, ...s }) => s);
  let perf = ran.flatMap((s) => s._perf);
  let images = ran.flatMap((s) => s._images);
  let memory = ran.flatMap((s) => s._memory);
  if (OPT.only.length && !OPT.noMerge && fs.existsSync(jsonPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const ids = new Set(scenarios.map((s) => s.id));
      scenarios = [...(prev.scenarios || []).filter((s) => !ids.has(s.id)), ...scenarios].sort((a, b) => a.id - b.id);
      if (!ids.has(12)) perf = prev.perf || [];
      if (!ids.has(13)) memory = prev.memory || [];
      images = [...(prev.images || []).filter((i) => !ids.has(i.scenario)), ...images];
    } catch (e) { console.warn('[qa] 기존 결과 병합 실패:', e.message); }
  }
  const summary = { pass: 0, fail: 0, skip: 0 };
  for (const s of scenarios) summary[s.status]++;
  const json = {
    runAt: new Date().toISOString(), summary, scenarios, perf, memory, images,
    env: { base: BASE, chrome: ENV.chrome, node: ENV.node, quick: OPT.quick, only: OPT.only, headless: !OPT.headful },
  };
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  const mdPath = path.join(OPT.out, 'QA_REPORT.md');
  // 수동 확인 소견(사람이 이미지를 보고 쓴 부분)은 재실행해도 보존한다
  let manual = null;
  try { const m = fs.readFileSync(mdPath, 'utf8').match(/<!-- manual:start -->\n([\s\S]*?)<!-- manual:end -->/); if (m) manual = m[1]; } catch { /* 첫 실행 */ }
  fs.writeFileSync(mdPath, buildReport(json, manual));
  return { jsonPath, mdPath, summary };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const fileOf = (k) => FILES[k] || [k, '?'];
function buildReport(r, manual = null) {
  const L = [];
  const st = (s) => ({ pass: 'PASS', fail: '**FAIL**', skip: 'SKIP' }[s] || s);
  L.push('# 스나이퍼 미션 QA 보고서', '');
  L.push(`- 실행 시각: ${r.runAt}`);
  L.push(`- 대상: ${r.env.base} · Chrome ${r.env.chrome || '?'} (${r.env.headless ? 'headless' : 'headful'}) + puppeteer-core · Node ${r.env.node}`);
  L.push(`- 옵션: ${r.env.quick ? '--quick ' : ''}${r.env.only?.length ? `--only ${r.env.only.join(',')} (나머지는 이전 결과 병합)` : '전체 실행'}`);
  L.push(`- 결과: **pass ${r.summary.pass} · fail ${r.summary.fail} · skip ${r.summary.skip}**`);
  L.push('- 기준: `design/CONTRACT.md` v1.1, `design/GDD.md` §9.7, `docs/js/data/levels.js` · 원본 데이터: `tests/qa-results.json`');
  L.push('- 자동 판정 외에 스크린샷을 직접 열어 확인한 소견(발견한 UI 문제 포함)은 **§4 수동 확인 소견**에 있습니다.', '');

  L.push('## 1. 요약', '', '| # | 시나리오 | 결과 | 통과 항목 | 비고 |', '|---|---|---|---|---|');
  for (const s of r.scenarios) {
    const cs = s.details.filter((d) => d.type === 'check');
    const firstFail = cs.find((c) => !c.ok);
    L.push(`| ${s.id} | ${esc(s.name)} | ${st(s.status)} | ${cs.filter((c) => c.ok).length}/${cs.length} | ${esc(firstFail ? firstFail.label : '')} |`);
  }
  L.push('');

  L.push('## 2. 실패 항목 (담당 에이전트별)', '');
  const byAgent = new Map();
  for (const s of r.scenarios) for (const c of s.details) {
    if (c.type !== 'check' || c.ok) continue;
    const sus = (c.suspects?.length ? c.suspects : ['main']).map(fileOf);
    const agent = sus[0][1];
    if (!byAgent.has(agent)) byAgent.set(agent, []);
    byAgent.get(agent).push({ s, c, sus });
  }
  if (!byAgent.size) L.push('실패 항목이 없습니다.', '');
  for (const [agent, items] of byAgent) {
    L.push(`### ${agent} (${items.length}건)`, '');
    for (const { s, c, sus } of items) {
      L.push(`#### [#${s.id} ${esc(s.name)}] ${esc(c.label)}`);
      L.push('- 재현 절차:');
      (s.repro || []).forEach((step, i) => L.push(`  ${i + 1}. ${step}`));
      L.push(`  - 자동 재현: \`cd tests && node qa.mjs --only ${s.id}\``);
      L.push(`- 기대값: ${esc(c.expected !== undefined ? fmt(c.expected) : '확인 항목 문구 참고')}`);
      L.push(`- 실제값: ${esc(c.actual !== undefined ? fmt(c.actual) : '-')}`);
      L.push(`- 의심 파일: ${sus.map(([f, a]) => `\`${f}\` (${a})`).join(', ')}`);
      if (s.evidence?.length) L.push(`- 증거: ${s.evidence.map((e) => `\`${e}\``).join(', ')}`);
      L.push('');
    }
  }

  L.push('## 3. 성능', '');
  L.push('> 데스크톱 Chrome headless(소프트웨어 GL일 수 있음)에서 iPhone 가로 프로필(DPR 3 → pixelRatio 최대 2)로 측정했습니다. **FPS·프레임 시간은 iPhone 실측이 아니며 스테이지 간·변경 전후 상대 비교용**입니다. 예산 판정(CONTRACT §11)은 drawCalls ≤ 100, tris ≤ 120000에만 적용합니다. FPS/평균/p95/최대는 테스트가 rAF로 직접 잰 값, "게임 fps"는 `stats()` 값입니다.', '');
  if (r.perf?.length) {
    L.push('| 스테이지 | CPU 스로틀 | FPS | 평균 ms | p95 ms | 최대 ms | 게임 fps | drawCalls | tris | pixelRatio | 예산 |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const p of r.perf) {
      const ok = p.drawCalls <= 100 && p.tris <= 120000;
      L.push(`| S${p.stage} | ${p.throttled ? '×4' : '없음'} | ${p.fps} | ${p.frameMsAvg} | ${p.p95} | ${p.maxFrameMs} | ${p.gameFps ?? '-'} | ${p.drawCalls} | ${p.tris} | ${p.pixelRatio}${p.pixelRatioMin !== p.pixelRatio ? ` (최저 ${p.pixelRatioMin})` : ''} | ${ok ? 'OK' : '**초과**'} |`);
    }
    const cap = Math.max(...r.perf.map((p) => p.fps || 0));
    const atCap = r.perf.filter((p) => p.fps >= cap * 0.97).length;
    if (atCap >= r.perf.length / 2) L.push('', `- 측정 PC에서는 프레임이 약 ${cap}fps(화면 주사율)에 묶여 있어 FPS 차이가 거의 드러나지 않습니다. 부하 차이는 **CPU×4에서의 p95·최대 프레임 시간** 증가로 비교하세요.`);
  } else L.push('성능 시나리오(#12)를 실행하지 않았습니다.');
  L.push('');

  L.push('## 4. 스크린샷 관찰 소견', '');
  if (r.images?.length) {
    L.push('| 파일 | 평균 밝기(0~255) | 대비(표준편차) | 평균 RGB | 중앙 밝기/대비 | 자동 판정 |', '|---|---|---|---|---|---|');
    for (const i of r.images) L.push(`| \`${i.file}\` | ${i.lum} | ${i.std} | ${i.mean?.join(', ')} | ${i.centerLum}/${i.centerStd} | ${i.flags?.length ? i.flags.join(', ') : '정상 범위'} |`);
  } else L.push('이미지 시나리오(#10, #16)를 실행하지 않았습니다.');
  L.push('', '- 자동 판정은 검은 화면·단색 화면만 잡습니다. 표적 가시성, UI 겹침, 색·깨짐은 **이미지를 직접 열어** 확인한 소견을 아래에 적습니다.');
  L.push('', '### 수동 확인 소견 (이미지를 직접 열어 확인, qa.mjs 재실행 시에도 보존됨)', '');
  L.push('<!-- manual:start -->');
  L.push((manual ?? '- (Phase D에서 이미지를 열어 기입)\n').replace(/\n+$/, ''));
  L.push('<!-- manual:end -->', '');

  L.push('## 4-1. 메모리 누수 (스테이지 재로드)', '');
  if (r.memory?.length) {
    L.push('`renderer.info.memory` 값을 스테이지를 다시 로드할 때마다 기록했습니다. 같은 스테이지를 다시 로드했는데 값이 계속 늘면 `dispose()` 누락입니다(#13).', '');
    L.push('| 순서 | 순환 | 스테이지 | geometries | textures | drawCalls |', '|---|---|---|---|---|---|');
    r.memory.forEach((m, i) => L.push(`| ${i + 1} | ${typeof m.cycle === 'number' ? `${m.cycle}회차` : m.cycle ?? '-'} | S${m.stage} | ${m.geometries ?? '-'} | ${m.textures ?? '-'} | ${m.drawCalls ?? '-'} |`));
  } else L.push('수명주기 시나리오(#13)를 실행하지 않았습니다.');
  L.push('');

  L.push('## 5. 시나리오별 측정 노트', '');
  for (const s of r.scenarios) {
    const notes = s.details.filter((d) => d.type === 'note');
    if (!notes.length) continue;
    L.push(`- **#${s.id} ${esc(s.name)}**`);
    for (const n of notes) L.push(`  - ${n.text}`);
  }
  L.push('');

  L.push('## 6. 실기기 확인 필요', '');
  L.push('자동 테스트(데스크톱 Chrome 에뮬레이션)로는 확인할 수 없는 항목입니다. iPhone Safari에서 직접 확인해야 합니다.', '');
  L.push('- **자이로 방향**: 기기를 오른쪽으로 돌리면 조준이 오른쪽(yaw 감소), 위로 들면 위쪽으로 움직이는지. 설정에서 켤 때 권한 요청이 탭 안에서 뜨는지');
  L.push('- **무음 모드 사운드**: 벨소리 스위치가 무음일 때 효과음 재생 여부, 백그라운드 복귀 후 오디오 재개');
  L.push('- **실제 FPS·발열**: iPhone Safari에서 스테이지별 프레임, 동적 해상도(pixelRatio) 조정, 5분 이상 플레이 시 발열·스로틀');
  L.push('- **홈 화면 앱 동작**: "홈 화면에 추가" 후 standalone 전체 화면, 상태 표시줄, 오프라인 실행, 새 버전 적용 흐름');
  L.push('- **노치·홈 인디케이터 safe-area**: Chrome 에뮬레이션은 safe-area inset이 0이므로 버튼이 노치/인디케이터와 겹치지 않는지');
  L.push('- **실제 멀티터치**: 드래그 조준 중 FIRE·BREATH 동시 입력, 버튼 반응 지연');
  L.push('- **PC 포인터 잠금**: 헤드리스에서는 Pointer Lock이 거부될 수 있어 마우스 이동 조준은 실제 브라우저(`play_pc.bat`)에서 확인');
  L.push('');
  return L.join('\n');
}

// ───────────────────────────── main ─────────────────────────────
async function main() {
  if (OPT.list) { for (const s of SCENARIOS) console.log(`${String(s.id).padStart(2)}. ${s.name}`); return; }
  const unknown = OPT.only.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknown.length) { console.error(`[qa] 없는 시나리오 번호: ${unknown.join(',')} (--list로 확인)`); process.exitCode = 2; return; }
  try { await fetch(BASE); } catch {
    console.error('[qa] 서버가 꺼져 있습니다. 먼저 실행: python tools/serve.py --quiet');
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const list = OPT.only.length ? SCENARIOS.filter((s) => OPT.only.includes(s.id)) : SCENARIOS;
  const t0 = Date.now();
  const ran = [];
  for (const sc of list) ran.push(await runScenario(sc));
  const { jsonPath, mdPath, summary } = writeOutputs(ran);
  console.log(`\n[qa] 완료 ${Math.round((Date.now() - t0) / 1000)}s — pass ${summary.pass} · fail ${summary.fail} · skip ${summary.skip}`);
  for (const s of ran) console.log(`  #${String(s.id).padStart(2)} ${s.status.toUpperCase().padEnd(4)} ${s.name}`);
  console.log(`[qa] ${jsonPath}\n[qa] ${mdPath}`);
  process.exitCode = summary.fail ? 1 : 0;
}

process.on('unhandledRejection', (e) => console.error('[qa] unhandledRejection:', e?.message || e));
main()
  .catch((e) => { console.error('[qa] 치명적 오류:', e); process.exitCode = 2; })
  .finally(async () => { for (const b of [...LAUNCHED]) await b.close().catch(() => {}); });
