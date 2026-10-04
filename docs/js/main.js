// 진입점 (PM 소유): 모듈 조립, 상태 머신, 메인 루프.
import { APP_VERSION, STATES as S, FLAGS } from './config.js';
import { bus } from './bus.js';
import { LEVELS, DIFFICULTY } from './data/levels.js';
import { createRenderer } from './gfx/renderer.js';
import { buildWorld } from './gfx/world.js';
import { ActorViews } from './gfx/actors.js';
import { Fx } from './gfx/fx.js';
import { Weapon } from './game/weapon.js';
import { Ballistics } from './game/ballistics.js';
import { AI } from './game/ai.js';
import { Session } from './game/session.js';
import { createHud } from './ui/hud.js';
import { createInput } from './ui/input.js';
import { createAudio } from './ui/audio.js';
import { loadProgress, saveProgress, clearProgress } from './ui/storage.js';
import { initPwa } from './ui/pwa.js';
import { installDebug } from './debug.js';

const canvas = document.getElementById('gl');
const hudRoot = document.getElementById('hud');

const gfx = createRenderer(canvas);
const actors = new ActorViews(gfx.scene);
const fx = new Fx(gfx.scene);
const weapon = new Weapon();
const ballistics = new Ballistics();
const ai = new AI();
const session = new Session();
const hud = createHud(hudRoot);
const input = createInput(hudRoot, canvas);
const audio = createAudio();

let progress = loadProgress();
let state = S.BOOT;
let level = null, world = null;
let nv = false, ending = 0, result = null, timeScale = 1, updatePending = false;
const hudFrame = { weapon: weapon.status, session: session.snap, range: -1, view: weapon.view, level: null, nv: false };

// ---------- 상태 전환 ----------
function setState(s) {
  state = s;
  input.setEnabled(s === S.PLAYING && ending === 0);
  bus.emit('state', { state: s });
}
// ?debug(PC 테스트 모드)에서만 전 스테이지를 열어 보여 준다. ?autotest는 실제 진행 상황을 써야 QA가 잠금을 검증할 수 있다.
const shownProgress = () => (FLAGS.debug && !FLAGS.autotest ? { ...progress, unlocked: LEVELS.length } : progress);
const isPortrait = () => window.matchMedia('(orientation: portrait) and (pointer: coarse)').matches;
// 난이도를 입힌 레벨(얕은 복사): timeLimit은 미리 배수 적용, 나머지 배수는 level.difficulty로 weapon·ai·session이 reset 때 읽는다.
// 레벨을 불러올 때 한 번 정해지므로 플레이 중 설정을 바꾸면 다음 시도부터 적용된다.
function withDifficulty(lv) {
  const key = DIFFICULTY[progress.settings.difficulty] ? progress.settings.difficulty : 'normal', d = DIFFICULTY[key];
  return { ...lv, timeLimit: Math.round(lv.timeLimit * d.time), difficulty: { key, ...d } };
}

function toTitle() {
  if (updatePending) return location.reload();
  unloadLevel();
  setState(S.TITLE);
  hud.show('title', { version: APP_VERSION, settings: progress.settings });
}
function toSelect() {
  if (updatePending) return location.reload();
  unloadLevel();
  setState(S.SELECT);
  hud.show('select', { levels: LEVELS, progress: shownProgress() });
}
function toBriefing(id) {
  const lv = LEVELS.find((l) => l.id === id);
  if (!lv) return toSelect();
  loadLevel(lv);
  setState(S.BRIEFING);
  hud.show('briefing', { level, best: progress.best[lv.id] || 0, stars: progress.stars[lv.id] || 0 });
}
function begin() {
  ending = 0; result = null;
  session.reset(level, ai, weapon);
  setState(S.PLAYING);
  hud.show('playing', { level });
}
function pause() {
  if (state !== S.PLAYING || ending > 0) return;
  setState(S.PAUSED);
  hud.show('paused', { level });
}
function resume() {
  if (state !== S.PAUSED || isPortrait()) return;
  setState(S.PLAYING);
  hud.show('playing', { level, resume: true });
}
function finishMission() {
  const r = result, id = level.id;
  if (r.success) {
    progress.stars[id] = Math.max(progress.stars[id] || 0, r.stars);
    progress.best[id] = Math.max(progress.best[id] || 0, r.score);
    progress.unlocked = Math.min(LEVELS.length, Math.max(progress.unlocked, id + 1));
    saveProgress(progress);
  }
  setState(S.RESULT);
  hud.show('result', { result: r, level, hasNext: id < LEVELS.length, best: progress.best[id] || 0, progress: shownProgress() });
}

// ---------- 레벨 로드/해제 ----------
function loadLevel(lv) {
  unloadLevel();
  level = withDifficulty(lv); hudFrame.level = level;
  gfx.setEnv(lv.env);
  world = buildWorld(gfx.scene, lv);
  ai.reset(level, world);
  weapon.reset(level);
  ballistics.reset(level, world);
  actors.build(ai.agents, ai.vehicles);
  actors.sync(ai.agents, ai.vehicles, 0);
  fx.clear();
  setNV(false);
  gfx.setView(weapon.view);
  gfx.compile(); // 첫 발사 때 셰이더 컴파일 끊김 방지
}
function unloadLevel() {
  if (!world) return;
  actors.clear(); fx.clear(); world.dispose(); world = null;
  setNV(false);
}
function setNV(on) {
  nv = !!on && !!(level && level.nightVision);
  hudFrame.nv = nv;
  gfx.setNightVision(nv); actors.setNightVision(nv); hud.setNightVision(nv);
  bus.emit('nv', { on: nv });
}

// ---------- 설정 ----------
function applySettings() {
  const st = progress.settings;
  input.setSensitivity(st.sens);
  input.setInvertY(st.invertY);
  audio.setEnabled(st.sound);
  gfx.setQuality(st.quality);
}

// ---------- UI 이벤트 ----------
bus.on('ui:start', () => { audio.unlock(); if (state === S.TITLE) toSelect(); });
bus.on('ui:select', ({ id }) => { if (state === S.SELECT) toBriefing(id); });
bus.on('ui:back', () => { if (state === S.BRIEFING) toSelect(); else if (state === S.SELECT) toTitle(); });
bus.on('ui:begin', () => { audio.unlock(); if (state === S.BRIEFING) begin(); });
bus.on('ui:resume', () => { audio.unlock(); resume(); });
bus.on('ui:retry', () => { if (level && (state === S.PAUSED || state === S.RESULT)) toBriefing(level.id); });
bus.on('ui:next', () => { if (state === S.RESULT && level) toBriefing(Math.min(LEVELS.length, level.id + 1)); });
bus.on('ui:menu', () => { if (state === S.PAUSED || state === S.RESULT || state === S.BRIEFING) toSelect(); });
bus.on('ui:settings', ({ settings }) => {
  const prevDiff = progress.settings.difficulty;
  progress.settings = { ...progress.settings, ...settings };
  saveProgress(progress);
  applySettings();
  bus.emit('settings', { settings: progress.settings });
  // 브리핑에서 난이도를 바꾸면 그 작전에 바로 적용(레벨 재로드). 플레이·일시정지 중이면 다음 시도부터.
  if (progress.settings.difficulty !== prevDiff && state === S.BRIEFING && level) toBriefing(level.id);
});
// 자이로 권한 요청은 반드시 탭 이벤트 안에서 동기적으로 시작해야 한다(iOS). bus.emit은 동기 호출이라 조건 충족.
bus.on('ui:gyro', ({ on }) => {
  const done = (ok) => {
    progress.settings.gyro = ok;
    saveProgress(progress);
    bus.emit('settings', { settings: progress.settings });
  };
  if (!on) { input.disableGyro(); return done(false); }
  input.enableGyro().then((ok) => {
    done(ok);
    hud.toast(ok ? '자이로 조준 ON' : '자이로를 사용할 수 없습니다 (HTTPS·권한 필요)', ok ? 'info' : 'warn');
  });
});
bus.on('missionEnd', (r) => {
  if (state !== S.PLAYING || ending > 0) return;
  result = r; ending = 1.5; // 마지막 장면을 1.5초 보여준 뒤 결과 화면
  input.setEnabled(false);
});

// ---------- 창/수명주기 ----------
function onResize() {
  gfx.resize();
  if (state === S.PLAYING && isPortrait()) pause();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 300));
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

initPwa({
  canvas,
  onHidden: () => { pause(); stopLoop(); audio.suspend(); },
  onVisible: () => { startLoop(); audio.resume(); },
  onContextLost: () => { pause(); stopLoop(); },
  onUpdateReady: () => {
    if (state === S.TITLE || state === S.SELECT) location.reload();
    else { updatePending = true; hud.toast('새 버전이 준비됐습니다. 메뉴로 나가면 적용됩니다.', 'info'); }
  },
});

// ---------- 메인 루프 ----------
const frameMs = new Float32Array(120);
let frameIdx = 0, frameCount = 0, raf = 0, last = 0, frameN = 0;

function startLoop() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}
function frame(now) {
  raf = requestAnimationFrame(frame);
  const ms = now - last;
  last = now;
  frameMs[frameIdx] = ms; frameIdx = (frameIdx + 1) % frameMs.length; frameCount++;
  const raw = Math.min(0.05, ms / 1000);
  const inp = input.poll();
  frameN++;

  if (state === S.PLAYING) {
    if (ending === 0) {
      if (inp.pause) { pause(); return; }
      if (inp.nv) setNV(!nv);
    }
    const dt = raw * timeScale;
    weapon.update(dt, inp, canvas.clientHeight || window.innerHeight);
    ai.update(dt);
    ballistics.update(dt, ai.agents, ai.vehicles);
    session.update(dt);
    actors.sync(ai.agents, ai.vehicles, dt);
    fx.update(dt, ballistics.bullets);
    if ((frameN & 3) === 0) hudFrame.range = ballistics.rangeAt(weapon.view, ai.agents);
    gfx.setView(weapon.view);
    hud.update(hudFrame);
    gfx.render();
    if (ending > 0 && (ending -= raw) <= 0) { ending = 0; finishMission(); }
  } else if (world && (frameN & 1) === 0) {
    gfx.render(); // 메뉴/브리핑/일시정지 뒤 배경은 30fps
  }
}

function perfStats() {
  const n = Math.min(frameCount, frameMs.length);
  if (!n) return { fps: 0, frameMsAvg: 0, frameMsP95: 0 };
  const arr = Array.from(frameMs.subarray(0, n)).sort((a, b) => a - b);
  const avg = arr.reduce((a, b) => a + b, 0) / n;
  return { fps: Math.round(1000 / avg), frameMsAvg: +avg.toFixed(2), frameMsP95: +arr[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(2) };
}

// ---------- 부팅 ----------
applySettings();
if (FLAGS.debug) {
  installDebug({
    version: APP_VERSION, bus, gfx, ai, weapon, ballistics, session, input,
    getState: () => state,
    getLevel: () => level,
    startStage: (id) => { toBriefing(id); begin(); },
    setTimeScale: (k) => { timeScale = k; },
    setNV,
    perfStats,
    unlockAll: () => { progress.unlocked = LEVELS.length; saveProgress(progress); },
    resetProgress: () => { clearProgress(); progress = loadProgress(); applySettings(); },
  });
}
if (FLAGS.debug && FLAGS.stage) toBriefing(FLAGS.stage);
else toTitle();
startLoop();
