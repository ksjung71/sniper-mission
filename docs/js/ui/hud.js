// 모든 화면(DOM)과 인게임 HUD (mobile-ios-dev). 사용자 조작은 'ui:*' 이벤트로 main에 알린다.
// 성능: innerHTML은 화면 전환 때만 쓴다. update(frame)은 이전 값을 캐시해 바뀐 값만 DOM에 쓰고, 움직임은 transform만 바꾼다.
import { bus } from '../bus.js';
import { defaultProgress } from './storage.js';
import { BALANCE, DIFFICULTY } from '../data/levels.js';

const DEG = Math.PI / 180;
const RING = 2 * Math.PI * 46; // FIRE 진행 링 둘레(viewBox 100 기준 r=46)
const IS_PC = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
const REASON = { cleared: '모든 표적 제거', civilian: '민간인 피격', escaped: '표적 도주', time: '시간 초과', ammo: '탄약 소진' };
const THEME = { downtown: '#3b9cff', harbor: '#ff8a3d', market: '#ff5a6a', night: '#a78bfa', vip: '#f5c242' };
// GDD §8: PC에서는 힌트의 버튼 이름을 키로 바꿔 보여 준다. 문구가 바뀌어 일치하지 않으면 원문 그대로.
const PC_HINT = [[/화면을 드래그해/, '화면을 클릭한 뒤 마우스로'], [/SCOPE 버튼으로/, '우클릭(또는 E)으로'], [/ZOOM을 눌러/, '마우스 휠을 올려'],
  [/BREATH를 누르고/, 'Shift를 누르고'], [/FIRE!/, '좌클릭!']];
const PC_KEYS = [['마우스 이동', '조준 (화면을 클릭하면 마우스가 잠김)'], ['좌클릭 · Space', '발사'], ['우클릭 · E', '스코프 켜기/끄기'],
  ['휠 위 / 아래 · Q', '줌 확대 / 축소'], ['Shift (누르는 동안)', '숨 참기'], ['R', '재장전'], ['N', '야간투시 (스테이지 4)'], ['Esc', '일시정지 · 마우스 잠금 해제']];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (n) => Math.round(n).toLocaleString('en-US');
const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const starsHtml = (n) => [0, 1, 2].map((i) => `<i class="st${i < n ? ' got' : ''}">★</i>`).join('');
const pcHint = (s) => (IS_PC ? PC_HINT.reduce((a, [re, r]) => a.replace(re, r), s) : s);
const btn = (ui, label, cls = '') => `<button type="button" class="btn ${cls}" data-ui="${ui}">${label}</button>`;
// 난이도 3단계 선택(설정·브리핑 공용). 누르면 'ui:settings' {difficulty}
const diffSeg = (cur) => `<div class="seg">${Object.entries(DIFFICULTY).map(([k, d]) =>
  `<button type="button" data-set="difficulty" data-v="${k}"${k === cur ? ' class="on"' : ''}>${d.label}</button>`).join('')}</div>`;
const diffNote = (d) => `흔들림 ${Math.round(d.sway * 100)}% · 숨 참기 ${(BALANCE.breathMax * d.breath).toFixed(1)}초 · 점수 ×${d.score}`;
const ARROW = '<svg viewBox="-12 -12 24 24"><path d="M-9 0H7M1-6l7 6-7 6"/></svg>';
const LOGO = '<svg class="logo-ico" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#22d3ee" stroke-width="5"/>'
  + '<circle cx="50" cy="50" r="24" fill="none" stroke="#ff8a1f" stroke-width="3" stroke-dasharray="6 5"/>'
  + '<path d="M50 4v26M50 70v26M4 50h26M70 50h26" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="50" r="5" fill="#ff3b3b"/></svg>';
// 밀도트(1 mil = 1 mrad) 경로. 저배율에서는 5 mil 간격으로 바꿔 겹치지 않게 한다.
const dots = (step, n, up) => {
  let d = '';
  for (let k = step; k <= n; k += step) d += `M${k} 0h0M${-k} 0h0M0 ${k}h0`;
  for (let k = step; k <= up; k += step) d += `M0 ${-k}h0`;
  return d;
};
const NS = 'vector-effect="non-scaling-stroke"';
const SCOPE = `<div class="mask"></div>
<svg class="ret" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet"><path class="thin" ${NS} d="M-96 0H96M0-96V96"/>
<path class="post" ${NS} d="M-96 0H-46M46 0H96M0 46V96M0-96V-58"/><circle class="dot" r="0.9"/></svg>
<svg class="mil" data-h="milSvg" viewBox="-70 -70 140 140" preserveAspectRatio="xMidYMid meet"><path class="fine" ${NS} d="${dots(1, 10, 5)}"/>
<path class="fine big" ${NS} d="${dots(5, 10, 5)}"/><path class="coarse" ${NS} d="${dots(5, 40, 20)}"/></svg>
<div class="sinfo"><b data-h="zl"></b><span data-h="rng">---m</span><span class="sw" data-h="sw"><i data-h="swarr">${ARROW}</i><em data-h="sws"></em></span><small data-h="mil"></small></div>`;

export function createHud(root) {
  root.innerHTML = '<div class="scr"></div><div class="toast"></div>';
  const scr = root.querySelector('.scr'), toastEl = root.querySelector('.toast');
  root.classList.toggle('pc', IS_PC);
  let screen = '', P = null, ended = false, C = {}, level = null, wind = null, settings = defaultProgress().settings, toastT = 0, popI = 0, alertT = 0;
  const vip = { prev: -1, boarded: false }; // vipEta: 탑승 전 = 탑승까지, 탑승 후 = 차량 탈출까지(값이 다시 커짐, CONTRACT v1.2)
  const tut = { idx: -1, aim: 0, py: 0, pp: 0, breathT: 0, breathed: false, scoped: false, zoomed: false, shot: false, at: 0 };
  const setCls = (el, c, on) => el && el.classList.toggle(c, !!on);
  const pulse = (el) => { if (!el) return; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); };

  function toast(text, kind = 'info') {
    toastEl.hidden = false;
    toastEl.textContent = text;
    toastEl.className = `toast on ${kind}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }
  // 토스트는 .scr 밖에 있어 화면이 바뀌어도 남으므로, 종료·화면 전환 때 즉시 지운다(트랜지션 없이)
  function clearToast() { clearTimeout(toastT); toastEl.className = 'toast'; toastEl.hidden = true; }
  // 플레이 중 이벤트 토스트: 종료 연출(1.5초) 동안에는 띄우지 않는다
  const gameToast = (text, kind) => { if (P && !ended) toast(text, kind); };

  // ---------- 화면 HTML ----------
  const titleHtml = (d) => `<div class="title tap-start">
    <button type="button" class="btn ghost gear" data-ui="settings">⚙ 설정</button>
    <div class="logo">${LOGO}<h1>스나이퍼 미션</h1><p class="en">SNIPER MISSION</p></div>
    ${btn('start', IS_PC ? '클릭하여 시작' : '탭하여 시작', 'pri big')}
    <p class="tip">${IS_PC ? 'PC: 마우스·키보드로 플레이 · 조작법은 ⚙ 설정에서 확인' : '가로 화면 전용 · 소리를 켜고 플레이하세요'}</p>
    <span class="ver">v${esc(d.version)}</span></div>`;

  const selectHtml = (d) => {
    const pr = d.progress || defaultProgress();
    let total = 0;
    const cards = d.levels.map((lv) => {
      const locked = lv.id > pr.unlocked, st = pr.stars[lv.id] || 0, best = pr.best[lv.id] || 0;
      total += st;
      return `<button type="button" class="card${locked ? ' locked' : ''}" data-stage="${lv.id}" style="--ac:${THEME[lv.theme] || '#22d3ee'}"${locked ? ' disabled aria-disabled="true"' : ''}>
        <span class="no">${String(lv.id).padStart(2, '0')}</span><b class="nm">${esc(lv.name)}</b><span class="sub">${esc(lv.subtitle)}</span>
        <span class="stars">${starsHtml(st)}</span><span class="best">${locked ? '🔒 잠김' : best ? `최고 ${num(best)}` : '기록 없음'}</span></button>`;
    }).join('');
    return `<div class="menu select"><header>${btn('back', '‹ 뒤로', 'ghost')}<h2>작전 선택</h2><span class="tot">★ ${total} / ${d.levels.length * 3}</span></header>
      <div class="cards">${cards}</div></div>`;
  };

  const rangeOf = (lv) => {
    const p = lv.player.pos;
    let lo = Infinity, hi = 0;
    for (const a of lv.actors) {
      if (!lv.objective.ids.includes(a.id)) continue;
      for (const q of [a.pos, ...(a.path || [])]) {
        const d = Math.hypot(q[0] - p[0], (a.y || 0) + 1.2 - p[1], q[1] - p[2]);
        lo = Math.min(lo, d); hi = Math.max(hi, d);
      }
    }
    return lo === Infinity ? '-' : Math.round(lo) === Math.round(hi) ? `${Math.round(lo)}m` : `${Math.round(lo)}~${Math.round(hi)}m`;
  };
  const windHtml = (w) => (w.speed > 0
    ? `<i class="warr" style="transform:rotate(${w.dir}rad)">${ARROW}</i> ${Math.cos(w.dir) > 0.3 ? '오른쪽' : Math.cos(w.dir) < -0.3 ? '왼쪽' : ''} ${w.speed}m/s`
    : '없음');

  const briefHtml = (d) => {
    const lv = d.level, b = lv.ballistics, fail = lv.rules.civilianFail;
    const dk = lv.difficulty?.key || settings.difficulty || 'normal', dd = DIFFICULTY[dk] || DIFFICULTY.normal;
    const fact = (k, v, cls = '') => `<li><span>${k}</span><b class="${cls}">${v}</b></li>`;
    return `<div class="menu brief" style="--ac:${THEME[lv.theme] || '#22d3ee'}"><div class="sheet">
      <div class="col main"><p class="kick">작전 ${lv.id} · ${esc(lv.subtitle)}</p><h2>${esc(lv.name)}</h2>
        <p class="txt scroll">${esc(lv.briefing)}</p><div class="tgt"><span>🎯 표적</span><b>${esc(lv.targetDesc)}</b></div>
        <div class="diff"><span>난이도</span>${diffSeg(dk)}<small>${diffNote(dd)}</small></div></div>
      <div class="col side"><ul class="facts">${fact('제한 시간', mmss(lv.timeLimit))}${fact('거리', rangeOf(lv))}
        ${fact('바람', windHtml(b.wind), b.wind.speed > 0 ? 'warn' : '')}${fact('낙차', b.gravity > 0 ? '있음 (탄이 떨어짐)' : '없음', b.gravity > 0 ? 'warn' : '')}
        ${fact('민간인 피격', fail ? '즉시 실패' : '감점 −1,500', fail ? 'bad' : '')}${fact('배율', esc(lv.weapon.zoomLabels.join(' · ')))}
        ${lv.nightVision ? fact('야간투시', IS_PC ? 'N 키로 켜기' : 'NV 버튼') : ''}</ul>
        <div class="rec"><span class="stars">${starsHtml(d.stars || 0)}</span><span>${d.best ? `최고 ${num(d.best)}` : '첫 도전'}</span></div>
        <div class="acts">${btn('back', '뒤로', 'ghost')}${btn('begin', '작전 시작 ▶', 'pri')}</div></div></div></div>`;
  };

  const pausedHtml = (d) => `<div class="menu pause"><div class="sheet small"><h2>일시정지</h2><p class="kick">${esc(d.level?.name || '')}</p>
    <div class="grid">${btn('resume', '▶ 계속', 'pri')}${btn('retry', '↻ 재도전')}${btn('settings', '⚙ 설정')}${btn('menu', '☰ 메뉴')}</div>
    ${IS_PC ? '<p class="tip">계속하면 마우스가 다시 잠깁니다 · 안 잠기면 화면을 한 번 클릭하세요</p>' : ''}</div></div>`;

  const resultHtml = (d) => {
    const r = d.result, lv = d.level, ok = r.success;
    let reason = REASON[r.reason] || r.reason;
    if (r.reason === 'escaped' && lv.objective.escapeVehicle) reason = 'VIP가 차량으로 탈출';
    const rows = (r.breakdown || []).map((x) => `<tr><td>${esc(x.label)}</td><td>${x.value > 0 ? '+' : ''}${num(x.value)}</td></tr>`).join('');
    const isNew = ok && r.score >= (d.best || 0) && r.score > 0;
    return `<div class="menu res ${ok ? 'win' : 'lose'}"><div class="sheet">
      <div class="col main"><p class="kick">작전 ${lv.id} · ${esc(lv.name)}</p><h2>${ok ? '임무 성공' : '임무 실패'}</h2>
        <p class="reason">${ok ? '✔' : '✖'} ${esc(reason)}</p><div class="stars big">${starsHtml(r.stars || 0)}</div></div>
      <div class="col side"><table class="bd">${rows}<tr class="sum"><td>총점</td><td>${num(r.score)}</td></tr></table>
        <p class="best">${isNew ? '<b class="new">최고 기록!</b> ' : ''}최고 점수 ${num(d.best || 0)}</p>
        <div class="acts">${ok && d.hasNext ? btn('next', '다음 작전 ▶', 'pri') : ''}${btn('retry', '↻ 재도전', ok && d.hasNext ? '' : 'pri')}${btn('menu', '☰ 메뉴', 'ghost')}</div>
      </div></div></div>`;
  };

  const settingsHtml = () => `<div class="modal"><div class="sheet set">
    <header><h2>설정</h2>${btn('back', '닫기 ✕', 'ghost')}</header>
    <div class="set-body scroll"><section class="opts">
      <div class="row"><span>난이도<small>플레이 중 변경은 다음 시도부터</small></span>${diffSeg(settings.difficulty)}</div>
      <div class="row"><span>조준 감도</span><input type="range" min="0.4" max="2" step="0.05" data-set="sens"><output data-o="sens"></output></div>
      <div class="row"><span>자이로 조준<small>아이폰 · HTTPS 필요</small></span><button type="button" class="tog" data-set="gyro"></button></div>
      <div class="row"><span>사운드</span><button type="button" class="tog" data-set="sound"></button></div>
      <div class="row"><span>화질</span><div class="seg">${[['auto', '자동'], ['high', '높음'], ['low', '낮음']].map(([v, l]) =>
        `<button type="button" data-set="quality" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="row"><span>상하 반전 (Y축)</span><button type="button" class="tog" data-set="invertY"></button></div></section>
    <section class="keys"><h3>🖱 PC 조작법</h3><table>${PC_KEYS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
      <p class="tip">터치: 빈 곳을 드래그해 조준 · 버튼은 화면 양쪽 아래</p></section></div></div></div>`;

  const playHtml = (lv) => {
    const w = lv.ballistics.wind;
    const hb = (b, label, key, extra = '') => `<button type="button" class="hb" data-btn="${b}"${extra}><b${b === 'zoom' ? ' data-h="zoomLbl"' : ''}>${label}</b><kbd>${key}</kbd></button>`;
    return `<div class="play${lv.theme === 'night' ? ' night' : ''}">
      <div class="cross" data-h="cross"><i></i></div><div class="scope" data-h="scope">${SCOPE}</div>
      <div class="hitx go" data-h="hitx"><svg viewBox="-10 -10 20 20"><path d="M-9-9l5 5M9-9l-5 5M-9 9l5-5M9 9l-5-5"/></svg></div><div class="vred go" data-h="vred"></div><div class="nvfx"></div>
      <div class="tl"><button type="button" class="hb pz" data-btn="pause" aria-label="일시정지"><b>II</b><kbd>Esc</kbd></button>
        <div class="obj"><b data-h="obj"></b><span>${esc(lv.targetDesc)}</span></div></div>
      <div class="tc"><div class="timer" data-h="time"></div><div class="eta" data-h="eta" hidden><span data-h="etaL">VIP 탑승까지</span> <b data-h="etaV"></b>초</div>
        ${w.speed > 0 ? `<div class="wind"><i data-h="warr">${ARROW}</i>바람 ${w.speed}m/s</div>` : ''}<div class="hint" data-h="hint"></div></div>
      <div class="tr"><div class="score" data-h="score">0</div><div class="pops" data-h="pops"><i class="go"></i><i class="go"></i><i class="go"></i></div></div>
      <div class="endban" data-h="end"></div><div class="lockhint" data-h="lock">🖱 화면을 클릭하면 마우스 조준이 시작됩니다</div>
      <div class="bl">${hb('scope', 'SCOPE', '우클릭')}${hb('zoom', 'ZOOM', '휠')}${hb('reload', 'R', 'R')}${hb('nv', 'NV', 'N', lv.nightVision ? '' : ' hidden')}</div>
      <div class="br"><div class="ammo go" data-h="ammo"><div class="mag" data-h="mag"></div><span data-h="res"></span></div>
        <button type="button" class="hb breath" data-btn="breath"><b>BREATH</b><span class="bar"><i data-h="bbar"></i></span><kbd>Shift</kbd></button>
        <button type="button" class="fire" data-btn="fire"><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" data-h="ring"/></svg>
          <b data-h="fireLbl">FIRE</b><kbd>클릭</kbd></button></div></div>`;
  };

  // ---------- 설정 ----------
  function syncSettings() {
    const m = scr.querySelector('.modal');
    if (!m) return;
    const r = m.querySelector('[data-set="sens"]');
    r.value = settings.sens;
    m.querySelector('[data-o="sens"]').textContent = (+settings.sens).toFixed(2);
    for (const t of m.querySelectorAll('.tog')) { t.classList.remove('wait'); setCls(t, 'on', settings[t.dataset.set]); t.setAttribute('aria-pressed', !!settings[t.dataset.set]); }
    for (const b of m.querySelectorAll('.seg [data-set]')) setCls(b, 'on', b.dataset.v === settings[b.dataset.set]);
  }
  function onSet(t) {
    const k = t.dataset.set;
    if (k === 'gyro') { t.classList.add('wait'); bus.emit('ui:gyro', { on: !settings.gyro }); } // iOS 권한: 탭 핸들러 안에서 동기 emit
    else if (k === 'quality' || k === 'difficulty') { if (settings[k] !== t.dataset.v) bus.emit('ui:settings', { settings: { [k]: t.dataset.v } }); }
    else if (k === 'sound' || k === 'invertY') bus.emit('ui:settings', { settings: { [k]: !settings[k] } });
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ui],[data-stage],[data-set]');
    if (!t) { if (e.target.closest('.tap-start')) bus.emit('ui:start', {}); return; }
    if (t.disabled) return;
    if (t.dataset.stage) return bus.emit('ui:select', { id: +t.dataset.stage });
    if (t.dataset.set) return onSet(t);
    const u = t.dataset.ui;
    if (u === 'settings') { scr.insertAdjacentHTML('beforeend', settingsHtml()); syncSettings(); }
    else if (u === 'back' && t.closest('.modal')) t.closest('.modal').remove();
    else bus.emit(`ui:${u}`, {});
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.set === 'sens') root.querySelector('[data-o="sens"]').textContent = (+e.target.value).toFixed(2);
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.set === 'sens') bus.emit('ui:settings', { settings: { sens: +e.target.value } });
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') scr.querySelector('.modal')?.remove();
  });
  window.addEventListener('resize', () => { C.fov = -1; });
  const lockHint = () => setCls(P?.lock, 'on', IS_PC && screen === 'playing' && !document.pointerLockElement && 'requestPointerLock' in Element.prototype);
  document.addEventListener('pointerlockchange', lockHint);

  // ---------- 게임 이벤트 연출 ----------
  bus.on('settings', (e) => { settings = e.settings; syncSettings(); });
  bus.on('score', (e) => {
    if (!P) return;
    const el = P.pops.children[popI++ % 3];
    el.textContent = `${e.label} ${e.delta > 0 ? '+' : ''}${num(e.delta)}`;
    el.className = e.delta < 0 ? 'bad' : /HEAD/i.test(e.label) ? 'head' : '';
    pulse(el);
  });
  bus.on('hit', (h) => {
    if (!P) return;
    P.hitx.className = `hitx ${h.role === 'civilian' ? 'civ' : h.part === 'head' ? 'head' : ''}`;
    pulse(P.hitx);
    if (h.role === 'civilian') pulse(P.vred);
  });
  bus.on('alert', () => {
    const now = performance.now();
    if (P && now - alertT > 2500) { alertT = now; gameToast('! 경계 — 주변이 눈치챘습니다', 'warn'); }
  });
  bus.on('objective', (o) => { if (o.done > 0 && o.done < o.total) gameToast(`표적 ${o.done}/${o.total} 제거 · 남은 표적을 찾으세요`, 'info'); });
  bus.on('escaped', (e) => { if (e.required) gameToast('표적이 도주했습니다!', 'bad'); });
  // 움직이는 표적을 아깝게 놓침: 진행 방향 오차와 필요 리드(m·밀도트)를 알려 준다. 높이만 빗나간 경우(진행 방향 오차 작음)는 생략
  bus.on('nearMiss', (e) => {
    if (e.off < 0.25) return;
    const mil = Math.max(1, Math.round((e.lead / Math.max(1, e.dist)) * 1000)), off = e.off.toFixed(1);
    gameToast(e.ahead ? `너무 앞 — 약 ${off}m 덜 앞을 겨누세요` : `리드 부족 — 약 ${off}m 더 앞을 겨누세요 · 필요 리드 ≈ ${e.lead.toFixed(1)}m (밀도트 ${mil}칸)`, 'warn');
  });
  bus.on('dryfire', () => { if (P && !ended) { gameToast('탄약이 없습니다', 'bad'); pulse(P.ammo); } });
  bus.on('scope', (e) => { if (e.on) tut.scoped = true; if (e.on && e.zoomIdx >= 1) tut.zoomed = true; });
  bus.on('shot', () => { tut.shot = true; });
  bus.on('missionEnd', (r) => {
    if (!P) return;
    P.end.textContent = r.success ? '임무 성공' : `임무 실패 · ${REASON[r.reason] || ''}`;
    P.end.className = `endban on ${r.success ? 'win' : 'lose'}`;
    P.lock.hidden = true;
    ended = true; clearToast(); // 종료 배너와 겹치지 않게
  });

  // ---------- 튜토리얼 힌트 (GDD §8) ----------
  function renderHint() {
    const h = level?.hints || [], on = tut.idx >= 0 && tut.idx < h.length;
    if (!P) return;
    if (on) P.hint.textContent = pcHint(h[tut.idx]);
    setCls(P.hint, 'on', on);
  }
  const hintMet = (i) => [tut.aim >= 0.05, tut.scoped, tut.zoomed, tut.breathed, tut.shot][i] ?? true;
  function tutorial(f, dt, now) {
    const h = level.hints, last = h.length - 1;
    if (tut.idx < 0 || tut.idx > last) return;
    const d = Math.abs(f.view.yaw - tut.py) + Math.abs(f.view.pitch - tut.pp);
    tut.py = f.view.yaw; tut.pp = f.view.pitch;
    if (d > 0.0004 && d < 0.3) tut.aim += d; // 흔들림(프레임당 약 0.0001rad)은 제외
    tut.breathT = f.weapon.holding ? tut.breathT + dt : 0;
    if (tut.breathT >= 0.5) tut.breathed = true;
    let i = tut.idx;
    while (i < last && hintMet(i)) i++;
    if (i !== tut.idx) { tut.idx = i; tut.at = now; renderHint(); }
    else if (i === last && now - tut.at > 4000) { tut.idx = h.length; renderHint(); }
  }

  // ---------- 공개 API ----------
  return {
    show(name, data = {}) {
      screen = name; P = null; C = {}; ended = false;
      root.dataset.screen = name;
      root.classList.remove('scoped');
      if (name !== 'playing') clearToast(); // 플레이 중 토스트가 메뉴·결과 화면을 가리지 않게
      if (data.settings) settings = data.settings;
      if (name === 'title') scr.innerHTML = titleHtml(data);
      else if (name === 'select') scr.innerHTML = selectHtml(data);
      else if (name === 'briefing') scr.innerHTML = briefHtml(data);
      else if (name === 'paused') scr.innerHTML = pausedHtml(data);
      else if (name === 'result') {
        scr.innerHTML = resultHtml(data);
        const el = scr.firstElementChild;
        setTimeout(() => el.classList.add('anim'), 60);
      } else if (name === 'playing') {
        level = data.level; wind = level.ballistics.wind;
        scr.innerHTML = playHtml(level);
        P = {};
        for (const el of scr.querySelectorAll('[data-h]')) P[el.dataset.h] = el;
        for (const el of scr.querySelectorAll('[data-btn]')) P[`b_${el.dataset.btn}`] = el;
        P.ring.style.strokeDasharray = RING;
        if (wind.speed > 0) P.sws.textContent = `${wind.speed}m/s`; else P.sw.hidden = true;
        if (!data.resume) {
          vip.prev = -1; vip.boarded = false;
          Object.assign(tut, { idx: level.hints?.length ? 0 : -1, aim: 0, breathT: 0, breathed: false, scoped: false, zoomed: false, shot: false, at: performance.now() });
          if (level.nightVision) setTimeout(() => !root.classList.contains('nv') && gameToast(IS_PC ? '어두우면 N 키로 야간투시(NV)를 켜세요' : '어두우면 NV 버튼으로 야간투시를 켜세요', 'info'), 800);
        }
        tut.py = NaN;
        renderHint(); lockHint();
      } else scr.innerHTML = '';
    },

    update(f) {
      if (!P) return;
      const w = f.weapon, s = f.session, v = f.view, now = performance.now();
      const dt = C.lt ? Math.min(0.1, (now - C.lt) / 1000) : 0;
      C.lt = now;
      const t = Math.max(0, Math.ceil(s.timeLeft));
      if (t !== C.t) { C.t = t; P.time.textContent = mmss(t); setCls(P.time, 'low', t <= 20); }
      const eta = s.vipEta >= 0 ? Math.ceil(s.vipEta) : -1;
      if (eta !== C.eta) {
        if (vip.prev >= 0 && eta > vip.prev + 2 && !vip.boarded) { vip.boarded = true; gameToast('VIP가 차량에 탑승했습니다', 'bad'); }
        if (eta >= 0) vip.prev = eta;
        C.eta = eta; P.eta.hidden = eta < 0; P.etaV.textContent = eta;
        if (vip.boarded !== C.eb) { C.eb = vip.boarded; P.etaL.textContent = vip.boarded ? '차량 탈출까지' : 'VIP 탑승까지'; setCls(P.eta, 'car', vip.boarded); }
        setCls(P.eta, 'low', eta >= 0 && eta <= 10 && !vip.boarded); // 경고색은 탑승 전 단계에만
      }
      if (s.score !== C.sc) { C.sc = s.score; P.score.textContent = num(s.score); }
      if (s.objectiveText !== C.ob) { C.ob = s.objectiveText; P.obj.textContent = s.objectiveText; }
      if (w.magSize !== C.ms) { C.ms = w.magSize; P.mag.innerHTML = '<i></i>'.repeat(w.magSize); C.mag = -1; }
      if (w.mag !== C.mag) { C.mag = w.mag; const k = P.mag.children; for (let i = 0; i < k.length; i++) setCls(k[i], 'e', i >= w.mag); }
      if (w.reserve !== C.rs) { C.rs = w.reserve; P.res.textContent = `+${w.reserve}`; }
      const rl = w.reloadT < 1, p = Math.round((rl ? w.reloadT : w.boltT) * 60) / 60;
      if (p !== C.p) { C.p = p; P.ring.style.strokeDashoffset = String(RING * (1 - p)); }
      if (rl !== C.rl) { C.rl = rl; setCls(P.b_fire, 'rl', rl); P.fireLbl.textContent = rl ? '장전 중' : 'FIRE'; }
      if (w.canFire !== C.cf) { C.cf = w.canFire; setCls(P.b_fire, 'wait', !w.canFire); }
      const b = Math.round(w.breath * 50) / 50;
      if (b !== C.b) { C.b = b; P.bbar.style.transform = `scaleX(${b})`; }
      if (w.holding !== C.h) { C.h = w.holding; setCls(P.b_breath, 'on', w.holding); }
      if (w.exhausted !== C.ex) { C.ex = w.exhausted; setCls(P.b_breath, 'ex', w.exhausted); }
      if (w.scoped !== C.so) { C.so = w.scoped; setCls(P.scope, 'on', w.scoped); setCls(P.cross, 'off', w.scoped); setCls(P.b_scope, 'on', w.scoped); setCls(root, 'scoped', w.scoped); }
      if (w.zoomLabel !== C.zl) { C.zl = w.zoomLabel; P.zl.textContent = w.zoomLabel; P.zoomLbl.textContent = w.zoomLabel || 'ZOOM'; }
      if (w.scoped) {
        const fov = Math.round(v.fov * 100) / 100, r = f.range > 0 ? Math.round(f.range) : -1;
        if (fov !== C.fov) { // 밀도트: viewBox를 시야각(mrad)으로 맞춰 점 간격이 실제 1 mil이 되게 한다
          C.fov = fov;
          const H = window.innerHeight || 390, F = fov * DEG * 1000, Fw = (F * (window.innerWidth || H)) / H, coarse = H / F < 6;
          P.milSvg.setAttribute('viewBox', `${-Fw / 2} ${-F / 2} ${Fw} ${F}`);
          setCls(P.milSvg, 'c', coarse); C.step = coarse ? 5 : 1; C.r = -2;
        }
        if (r !== C.r) { C.r = r; P.rng.textContent = r > 0 ? `${r}m` : '---m'; P.mil.textContent = r > 0 ? `점 간격 ≈ ${Math.round((r * C.step) / 10)}cm` : `점 간격 ${C.step} mil`; }
      }
      if (wind.speed > 0) { // 화면 기준 바람 방향 = wind.dir + yaw (yaw>0 이면 왼쪽을 보므로 바람이 시계 방향으로 돌아 보임)
        const a = Math.round((wind.dir + v.yaw) * 50) / 50;
        if (a !== C.wa) { C.wa = a; const tr = `rotate(${a}rad)`; if (P.warr) P.warr.style.transform = tr; P.swarr.style.transform = tr; }
      }
      if (f.nv !== C.nv) { C.nv = f.nv; setCls(P.b_nv, 'on', f.nv); }
      if (level.hints?.length) tutorial(f, dt, now);
    },

    toast,
    setNightVision(on) { root.classList.toggle('nv', !!on); },
  };
}
