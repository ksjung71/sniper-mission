// 동기식 이벤트 버스 (PM 소유). 구독은 생성자에서 1회만, reset()에서 재구독 금지.
const map = new Map();

export const bus = {
  on(type, fn) {
    let set = map.get(type);
    if (!set) map.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  },
  off(type, fn) {
    const set = map.get(type);
    if (set) set.delete(fn);
  },
  // 리스너 하나가 예외를 던져도 나머지와 게임 루프는 계속 돈다(에러는 콘솔에 남겨 smoke가 잡게 함).
  emit(type, payload) {
    const set = map.get(type);
    if (set) for (const fn of [...set]) call(fn, type, payload, false);
    const all = map.get('*');
    if (all) for (const fn of [...all]) call(fn, type, payload, true);
  },
};

function call(fn, type, payload, wildcard) {
  try {
    if (wildcard) fn(type, payload);
    else fn(payload);
  } catch (err) {
    console.error(`[bus] '${type}' listener error:`, err);
  }
}
