// 공유 상수 (PM 소유, 고정). 변경은 PM만 — 필요하면 CONTRACT CHANGE REQUEST.
export const APP_VERSION = '1.1.1'; // sw.js의 VERSION과 반드시 동일

export const STATES = Object.freeze({
  BOOT: 'BOOT', TITLE: 'TITLE', SELECT: 'SELECT', BRIEFING: 'BRIEFING',
  PLAYING: 'PLAYING', PAUSED: 'PAUSED', RESULT: 'RESULT',
});

// 인물 치수(m). 그래픽 메시와 탄도 히트박스가 같은 값을 쓴다.
// 인물 로컬 좌표: 발 = (0,0,0), 정면 = +Z, 좌우 = X. heading으로 Y축 회전.
export const BODY = Object.freeze({
  height: 1.8,
  head: Object.freeze({ y: 1.62, r: 0.13 }),                       // 구: 중심 높이, 반지름
  torso: Object.freeze({ y0: 0.9, y1: 1.5, hw: 0.24, hd: 0.15 }),  // 박스: 높이 범위, 반폭(X), 반깊이(Z)
  legs: Object.freeze({ y0: 0.0, y1: 0.9, hw: 0.2, hd: 0.13 }),
});

// 차량 치수(m). 로컬: 정면 = +Z(길이 l), 폭 = X(w), 높이 = Y(h)
export const VEHICLE = Object.freeze({
  sedan: Object.freeze({ l: 4.6, w: 1.9, h: 1.45 }),
});

// 인물 외형 목록. levels.js의 actor.look은 이 중 하나여야 한다(graphics가 모두 구현).
export const LOOKS = Object.freeze({
  red_cap:    '빨간 모자 + 갈색 재킷 (표적용)',
  suit_black: '검은 정장 (표적용)',
  vip:        '흰 정장 + 금색 넥타이 (VIP)',
  guard:      '남색 전술복 + 조끼 (경비/경호원)',
  worker:     '주황 조끼 + 노란 안전모 (항구 작업자)',
  civ_a:      '파란 셔츠 + 청바지 (민간인)',
  civ_b:      '분홍 원피스 (민간인)',
  civ_c:      '초록 후드 (민간인)',
  civ_d:      '노란 티셔츠 + 회색 바지 (민간인)',
});

export const BUDGET = Object.freeze({ drawCalls: 100, tris: 120000, maxPixelRatio: 2, minPixelRatio: 1 });

// URL 쿼리 플래그: ?autotest ?debug ?nosw ?sw=1 ?seed=N ?stage=N
export const FLAGS = (() => {
  const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const num = (k) => (q.has(k) && q.get(k) !== '' && !isNaN(+q.get(k)) ? +q.get(k) : null);
  return Object.freeze({
    autotest: q.has('autotest'),
    debug: q.has('debug') || q.has('autotest'),
    nosw: q.has('nosw') || q.has('autotest'),
    sw: q.get('sw') === '1',
    seed: num('seed'),
    stage: num('stage'),
  });
})();
