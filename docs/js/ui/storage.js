// 진행 상황 저장 (mobile-ios-dev). localStorage가 막혀 있으면(사파리 개인정보 보호 모드 등) 메모리에만 보관.
const KEY = 'sniper.progress.v1';
const QUALITY = ['auto', 'high', 'low'];
const DIFF = ['easy', 'normal', 'hard']; // data/levels.js DIFFICULTY 키
let memory = null;

export function defaultProgress() {
  return { v: 1, unlocked: 1, stars: {}, best: {}, settings: { sens: 1, gyro: false, sound: true, quality: 'auto', invertY: false, difficulty: 'normal' } };
}

// 손상되었거나 예전 형식인 값을 안전한 범위로 정리
function sanitize(p) {
  const d = defaultProgress(), s = { ...d.settings, ...(p.settings || {}) };
  s.sens = Math.min(2, Math.max(0.4, +s.sens || 1));
  if (!QUALITY.includes(s.quality)) s.quality = 'auto';
  if (!DIFF.includes(s.difficulty)) s.difficulty = 'normal'; // v1.0 저장값에는 없음 → 보통
  s.gyro = !!s.gyro; s.sound = s.sound !== false; s.invertY = !!s.invertY;
  return { ...d, ...p, unlocked: Math.max(1, p.unlocked | 0 || 1), stars: p.stars || {}, best: p.best || {}, settings: s };
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.v === 1) return sanitize(p);
    }
  } catch (e) { /* 무시 */ }
  return memory ? JSON.parse(JSON.stringify(memory)) : defaultProgress();
}

export function saveProgress(p) {
  memory = JSON.parse(JSON.stringify(p));
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* 메모리 보관으로 대체 */ }
}

export function clearProgress() {
  memory = null;
  try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
}
