// 미션 진행: 타이머, 점수, 목표, 승패 판정. 'score','objective','missionEnd' 이벤트.
// 점수(GDD §4.1): 사살 kill + 거리×perMeter (+head 헤드샷) (+guard 경비) · 민간인 civilian
//   클리어 보너스 = 남은 초×timePerSec + 명중률(적 명중/발사)×accuracy · 별 = 클리어 ★1, stars[1] ★2, stars[2] ★3
import { bus } from '../bus.js';
import { BALANCE } from '../data/levels.js';

const AMMO_GRACE = 1.5; // 탄약 소진 후 마지막 탄이 날아가 명중할 여유(초)

export class Session {
  constructor() {
    /** HUD가 읽는 스냅샷. 객체 재사용. hits = 적(표적·경비·VIP) 명중 수(민간인은 civHits) */
    this.snap = { timeLeft: 0, score: 0, kills: 0, required: 0, shots: 0, hits: 0, headshots: 0, civHits: 0, objectiveText: '', vipEta: -1 };
    this.ended = true;
    this.level = null; this.ai = null; this.weapon = null;
    this._pts = { kill: 0, head: 0, dist: 0, guard: 0, civ: 0 }; // 결과 화면 내역
    this._vipId = null; this._ammoT = 0; this._diff = null;
    bus.on('shot', () => { if (!this.ended) this.snap.shots++; });
    bus.on('hit', (h) => this._onHit(h));
    bus.on('escaped', (e) => { if (!this.ended && e.required) this._end(false, 'escaped'); });
  }

  reset(level, ai, weapon) {
    this.level = level; this.ai = ai; this.weapon = weapon;
    const s = this.snap, P = this._pts;
    s.timeLeft = level.timeLimit; s.score = 0; s.kills = 0; s.required = level.objective.ids.length;
    s.shots = 0; s.hits = 0; s.headshots = 0; s.civHits = 0; s.vipEta = -1;
    P.kill = P.head = P.dist = P.guard = P.civ = 0;
    const vip = level.objective.ids.find((id) => { const a = ai.get(id); return a && a.role === 'vip'; });
    this._vipId = vip || null;
    this._diff = level.difficulty || null; // 난이도: 클리어 최종 점수 배수(timeLimit은 main이 이미 적용)
    this.ended = false; this._ammoT = 0;
    if (this._vipId) s.vipEta = ai._eta(this._vipId);
    this._objective();
  }

  update(dt) {
    if (this.ended) return;
    const s = this.snap;
    s.timeLeft = Math.max(0, s.timeLeft - dt);
    if (this._vipId) s.vipEta = this.ai._eta(this._vipId); // 탑승까지(탑승 뒤엔 차량 탈출까지) 남은 초
    if (s.timeLeft <= 0) return this._end(false, 'time');
    const w = this.weapon.status;
    this._ammoT = w.mag === 0 && w.reserve === 0 ? this._ammoT + dt : 0;
    if (this._ammoT >= AMMO_GRACE) this._end(false, 'ammo');
  }

  _objective() {
    const s = this.snap;
    s.objectiveText = this._vipId ? 'VIP 저지' : `표적 ${s.kills}/${s.required}`;
    bus.emit('objective', { text: s.objectiveText, done: s.kills, total: s.required });
  }

  _onHit(h) {
    if (this.ended) return;
    const s = this.snap, sc = BALANCE.score, P = this._pts;
    this._ammoT = 0;
    if (h.role === 'civilian') {
      s.civHits++; P.civ += sc.civilian;
      this._add(sc.civilian, '민간인!');
      if (this.level.rules.civilianFail) this._end(false, 'civilian');
      return;
    }
    s.hits++;
    const head = h.part === 'head', m = Math.round(h.dist), dist = Math.round(h.dist * sc.perMeter);
    const guard = h.role === 'guard' ? sc.guard : 0;
    P.kill += sc.kill; P.dist += dist; P.guard += guard;
    if (head) { s.headshots++; P.head += sc.head; }
    this._add(sc.kill + dist + (head ? sc.head : 0) + guard, `${head ? 'HEADSHOT' : guard ? '경비 사살' : '사살'} ${m}m`);
    const a = this.ai.get(h.agentId);
    if (a && a.required) {
      s.kills++;
      this._objective();
      if (s.kills >= s.required) this._end(true, 'cleared');
    }
  }

  _add(delta, label) {
    this.snap.score += delta;
    bus.emit('score', { delta, label, total: this.snap.score });
  }

  /** 첫 종료 사유만 처리하고 ended=true */
  _end(success, reason) {
    if (this.ended) return;
    this.ended = true;
    const s = this.snap, sc = BALANCE.score, P = this._pts;
    if (this._vipId) s.vipEta = this.ai._eta(this._vipId); // 사살·탈출이면 -1
    const time = success ? Math.round(s.timeLeft * sc.timePerSec) : 0;
    const acc = success ? Math.round((s.shots ? Math.min(1, s.hits / s.shots) : 0) * sc.accuracy) : 0;
    s.score += time + acc;
    const breakdown = [
      { label: '사살', value: P.kill }, { label: '헤드샷', value: P.head }, { label: '거리', value: P.dist },
    ];
    if (P.guard) breakdown.push({ label: '경비 보너스', value: P.guard });
    breakdown.push({ label: '민간인', value: P.civ }, { label: '남은 시간', value: time }, { label: '명중률', value: acc });
    const D = this._diff;
    if (success && D && D.score !== 1) { // 별 기준은 그대로, 최종 점수에만 배수 → 쉬움은 ★3이 어렵고 어려움은 쉬워진다
      const adj = Math.round(s.score * D.score) - s.score;
      s.score += adj;
      breakdown.push({ label: `난이도 보정 (${D.label} ×${D.score})`, value: adj });
    }
    const th = this.level.stars;
    const stars = success ? (s.score >= th[2] ? 3 : s.score >= th[1] ? 2 : 1) : 0;
    bus.emit('missionEnd', { success, reason, score: s.score, stars, breakdown, levelId: this.level.id });
  }
}
