// 터치(드래그 조준 + data-btn 버튼), 자이로, PC 마우스(포인터 락)·키보드 입력을 InputState 하나로 모은다 (mobile-ios-dev).
// - 터치: data-btn을 누르면 플래그, 그 밖은 pointerId별 드래그 조준(멀티터치: 왼손 드래그 + 오른손 FIRE)
// - PC: PLAYING 중 빈 곳 클릭 → 포인터 락 → movementX/Y 조준, 좌클릭 발사, 우클릭 스코프, 휠 줌, Shift 숨참기, R, N, Esc
//       잠금 불가 시 드래그 조준 + Space 발사, E 스코프, Q 줌
import { DEG } from '../util.js';

const KEYS = { Space: 'fire', KeyE: 'scope', KeyQ: 'zoom', KeyR: 'reload', KeyN: 'nv', Escape: 'pause' };
const isShift = (c) => c === 'ShiftLeft' || c === 'ShiftRight';

/**
 * @param {HTMLElement} root #hud (버튼과 조준 드래그를 받는 오버레이)
 * @param {HTMLCanvasElement} canvas #gl (포인터 락 대상)
 */
export function createInput(root, canvas) {
  // st = 다음 poll까지 모으는 값, out = poll()이 돌려주는 재사용 객체
  const st = { aimDX: 0, aimDY: 0, gyroYaw: 0, gyroPitch: 0, fire: false, scope: false, zoom: 0, reload: false, nv: false, pause: false, breath: false };
  const out = { ...st };
  const drags = new Map(); // pointerId → {x, y}
  const btns = new Map();  // pointerId → 누르고 있는 data-btn 요소
  let enabled = false, sens = 1, invertY = false, lastType = '', lockFailT = -1e9, wheelT = 0;
  let breathCount = 0, breathKey = false, gyroOn = false, gyroSeen = false, gyroLast = 0, selfExit = false;
  const canLock = typeof canvas.requestPointerLock === 'function';
  const locked = () => document.pointerLockElement === canvas;

  const press = (name) => {
    if (name === 'zoom') st.zoom = 1;
    else if (name !== 'breath' && name in st) st[name] = true;
  };
  const clearEdges = () => {
    st.aimDX = st.aimDY = st.gyroYaw = st.gyroPitch = st.zoom = 0;
    st.fire = st.scope = st.reload = st.nv = st.pause = false;
  };
  const release = (id) => {
    const b = btns.get(id);
    if (!b) return;
    btns.delete(id);
    b.classList.remove('down');
    if (b.dataset.btn === 'breath') breathCount = Math.max(0, breathCount - 1);
  };

  // 포인터 락. 크롬은 Esc로 푼 직후 약 1초 동안 재요청을 거절하므로 실패 시 잠시 드래그로 대체한다.
  function lock() {
    if (!canLock || locked() || performance.now() - lockFailT < 1200) return false;
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { lockFailT = performance.now(); });
    } catch (e) { lockFailT = performance.now(); return false; }
    return true;
  }
  document.addEventListener('pointerlockerror', () => { lockFailT = performance.now(); });
  // 사용자가 잠금을 풀면(Esc·창 전환) 일시정지. 코드가 직접 푼 경우(setEnabled(false))는 이벤트가 늦게 와도 무시
  document.addEventListener('pointerlockchange', () => {
    if (locked()) return;
    if (selfExit) { selfExit = false; return; }
    if (enabled) st.pause = true;
  });

  // ---------- 터치 / 잠기지 않은 마우스 ----------
  document.addEventListener('pointerdown', (e) => { lastType = e.pointerType; }, true);
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-btn]');
    if (b) {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      release(e.pointerId);
      btns.set(e.pointerId, b);
      b.classList.add('down');
      if (b.dataset.btn === 'breath') breathCount++;
      else press(b.dataset.btn);
      return;
    }
    if (!enabled || e.target.closest('button,input,select,a,.modal')) return;
    if (e.pointerType === 'mouse') {
      if (e.button === 2) { press('scope'); return; }
      if (e.button !== 0 || lock()) return; // 첫 클릭은 잠금만 걸고 발사하지 않음
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    }
    drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  window.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    st.aimDX += e.clientX - d.x; st.aimDY += e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
  });
  const up = (e) => { drags.delete(e.pointerId); release(e.pointerId); };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);

  // ---------- 잠긴 마우스 ----------
  document.addEventListener('mousedown', (e) => {
    if (!locked()) return;
    if (e.button === 0) press('fire');
    else if (e.button === 2) press('scope');
    else if (e.button === 1) { e.preventDefault(); st.zoom = 1; }
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked()) return;
    const mx = e.movementX || 0, my = e.movementY || 0;
    if (Math.abs(mx) > 400 || Math.abs(my) > 400) return; // 일부 환경의 포인터 락 튐 값 무시
    st.aimDX += mx; st.aimDY += my;
  });
  window.addEventListener('wheel', (e) => {
    if (enabled || e.ctrlKey) e.preventDefault();
    if (!enabled || Math.abs(e.deltaY) < 1) return;
    const now = performance.now();
    if (now - wheelT < 150) return; // 트랙패드 연속 이벤트를 한 칸으로
    wheelT = now;
    st.zoom = e.deltaY < 0 ? 1 : -1;
  }, { passive: false });

  // ---------- 키보드 ----------
  window.addEventListener('keydown', (e) => {
    if (isShift(e.code)) { breathKey = true; return; }
    const k = KEYS[e.code];
    if (!k || !enabled) return;
    e.preventDefault();
    if (e.repeat) return;
    if (k === 'zoom') st.zoom = 1; else st[k] = true;
  });
  window.addEventListener('keyup', (e) => { if (isShift(e.code)) breathKey = false; });
  window.addEventListener('blur', () => { breathKey = false; drags.clear(); });

  // ---------- 브라우저 기본 동작 차단 (iOS 바운스, 확대, 길게 누르기 메뉴) ----------
  document.addEventListener('touchmove', (e) => { if (!e.target.closest?.('.scroll,input')) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- 자이로: rotationRate(deg/s) × dt 적분, 가로 방향에 맞춰 축 보정 ----------
  function onMotion(e) {
    const r = e.rotationRate;
    if (!r || r.beta == null) return;
    gyroSeen = true;
    const dt = gyroLast ? Math.min(0.1, (e.timeStamp - gyroLast) / 1000) : 0;
    gyroLast = e.timeStamp;
    if (!enabled || dt <= 0) return;
    const ang = (((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) + 360) % 360;
    const b = (r.beta || 0) * DEG * dt, g = (r.gamma || 0) * DEG * dt;
    // 가로 90°: 화면 위쪽 = 기기 +x, 화면 오른쪽 = 기기 −y. yaw>0 = 왼쪽, pitch>0 = 위쪽(CONTRACT §2)
    if (ang === 90) { st.gyroYaw += b; st.gyroPitch -= g; }
    else if (ang === 270) { st.gyroYaw -= b; st.gyroPitch += g; }
    else if (ang === 180) { st.gyroYaw -= g; st.gyroPitch -= b; }
    else { st.gyroYaw += g; st.gyroPitch += b; }
  }

  return {
    poll() {
      const k = enabled;
      out.aimDX = k ? st.aimDX * sens : 0;
      out.aimDY = k ? st.aimDY * sens * (invertY ? -1 : 1) : 0;
      out.gyroYaw = k ? st.gyroYaw : 0;
      out.gyroPitch = k ? st.gyroPitch : 0;
      out.fire = k && st.fire; out.scope = k && st.scope; out.reload = k && st.reload;
      out.nv = k && st.nv; out.pause = k && st.pause;
      out.zoom = k ? st.zoom : 0;
      out.breath = k && (breathCount > 0 || breathKey || st.breath);
      clearEdges();
      return out;
    },
    /** 디버그/QA: 다음 poll에 값을 주입(실제 입력 경로를 통과). breath는 false를 줄 때까지 유지 */
    inject(partial) { Object.assign(st, partial); },
    /** 반드시 탭 핸들러 안에서 호출(iOS 권한 팝업). HTTPS가 아니거나 거부·센서 없음이면 false */
    enableGyro() {
      if (gyroOn) return Promise.resolve(true);
      if (!window.isSecureContext || typeof window.DeviceMotionEvent === 'undefined') return Promise.resolve(false);
      let req;
      try {
        const DM = window.DeviceMotionEvent, DO = window.DeviceOrientationEvent;
        req = typeof DM.requestPermission === 'function' ? DM.requestPermission()
          : DO && typeof DO.requestPermission === 'function' ? DO.requestPermission() : 'granted';
      } catch (e) { return Promise.resolve(false); }
      return Promise.resolve(req).then((r) => {
        if (r !== 'granted') return false;
        gyroSeen = false; gyroLast = 0;
        window.addEventListener('devicemotion', onMotion);
        return new Promise((res) => setTimeout(() => {
          if (!gyroSeen) window.removeEventListener('devicemotion', onMotion);
          gyroOn = gyroSeen;
          res(gyroSeen);
        }, 1000));
      }).catch(() => false);
    },
    disableGyro() { window.removeEventListener('devicemotion', onMotion); gyroOn = false; },
    setSensitivity(k) { sens = +k || 1; },
    setInvertY(b) { invertY = !!b; },
    setEnabled(b) {
      enabled = !!b;
      clearEdges();
      if (!enabled) {
        drags.clear(); btns.clear(); breathCount = 0; breathKey = false; st.breath = false;
        if (locked()) { selfExit = true; document.exitPointerLock(); }
      } else if (lastType === 'mouse' && (!navigator.userActivation || navigator.userActivation.isActive)) {
        lock(); // '작전 시작'/'계속'을 마우스로 눌렀다면 바로 마우스 조준 상태로
      }
    },
  };
}
