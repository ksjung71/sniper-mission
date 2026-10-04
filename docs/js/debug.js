// 디버그/자동 테스트 훅 (PM 소유). ?debug 또는 ?autotest 에서만 설치된다.
import { partPos } from './game/ballistics.js';

/** window.__SNIPER__ API를 설치하고, #dbg에 FPS/드로우콜 오버레이를 표시한다. */
export function installDebug(ctx) {
  const ring = [];
  ctx.bus.on('*', (type, payload) => {
    ring.push({ t: Math.round(performance.now()), type, payload });
    if (ring.length > 200) ring.shift();
  });
  const api = {
    version: ctx.version,
    state: () => ctx.getState(),
    /** 해당 스테이지를 브리핑 없이 바로 PLAYING으로 */
    startStage: async (id) => { ctx.startStage(id); return ctx.getState(); },
    level: () => ctx.getLevel(),
    actors: () => ctx.ai.agents.map((a) => ({
      id: a.id, role: a.role, required: a.required, state: a.state, x: a.x, y: a.y, z: a.z, heading: a.heading,
      // head·chest는 자세(숙임·상하 반동)를 반영한 '보이는 위치' = 판정 위치
      vx: a.vx || 0, vz: a.vz || 0, head: partPos(a, 'head'), chest: partPos(a, 'chest'), pose: a.pose ? { ...a.pose } : null,
    })),
    vehicles: () => ctx.ai.vehicles.map((v) => ({ id: v.id, kind: v.kind, color: v.color, x: v.x, y: v.y, z: v.z, heading: v.heading, speed: v.speed, state: v.state })),
    aimAt: (p) => ctx.weapon.aimAt(p[0], p[1], p[2]),
    scope: (on, zoomIdx = 0) => ctx.weapon.setScope(on, zoomIdx),
    /** 실제 입력 경로(input.poll)를 거쳐 발사 */
    fire: () => ctx.input.inject({ fire: true }),
    input: (partial) => ctx.input.inject(partial),
    assist: (o) => { ctx.weapon.setAssist(o); ctx.ballistics.setAssist(o); },
    timeScale: (k) => ctx.setTimeScale(k),
    session: () => ({ ...ctx.session.snap, ended: ctx.session.ended }),
    weapon: () => ({ ...ctx.weapon.status, view: { ...ctx.weapon.view } }),
    stats: () => {
      const mem = ctx.gfx.renderer ? ctx.gfx.renderer.info.memory : {};
      return { ...ctx.perfStats(), ...ctx.gfx.stats(), geometries: mem.geometries, textures: mem.textures, state: ctx.getState() };
    },
    events: (type) => ring.filter((e) => !type || e.type === type),
    clearEvents: () => { ring.length = 0; },
    unlockAll: () => ctx.unlockAll(),
    resetProgress: () => ctx.resetProgress(),
    nv: (on) => ctx.setNV(on),
    emit: (type, payload) => ctx.bus.emit(type, payload),
  };
  window.__SNIPER__ = api;

  const el = document.getElementById('dbg');
  if (el) {
    el.classList.add('on');
    setInterval(() => {
      const s = api.stats();
      el.textContent = `${s.fps}fps ${s.frameMsAvg}ms p95 ${s.frameMsP95}ms | dc ${s.drawCalls} tri ${s.tris} | pr ${s.pixelRatio} | ${s.state}`;
    }, 500);
  }
  return api;
}
