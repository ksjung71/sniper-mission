// PWA 수명주기 (mobile-ios-dev): 서비스워커 등록(FLAGS 준수), 백그라운드 전환, WebGL 컨텍스트 손실/복구.
// SW 등록 규칙: ?nosw(autotest 포함)면 안 함 · localhost/127.0.0.1은 ?sw=1일 때만 · 그 밖(https)은 항상.
import { FLAGS } from '../config.js';

/**
 * @param {{canvas:HTMLCanvasElement, onHidden:Function, onVisible:Function, onContextLost:Function, onUpdateReady:Function}} h
 */
export function initPwa(h) {
  let reg = null;
  const visible = () => { h.onVisible(); if (reg) reg.update().catch(() => {}); };
  document.addEventListener('visibilitychange', () => (document.hidden ? h.onHidden() : visible()));
  window.addEventListener('pageshow', (e) => { if (e.persisted && !document.hidden) visible(); }); // iOS 뒤로가기 캐시 복귀

  h.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); h.onContextLost(); });
  h.canvas.addEventListener('webglcontextrestored', () => location.reload()); // 텍스처·지오메트리 재생성보다 재시작이 안전

  // 공유용 단일 파일(dist/, 더블클릭 = file://)에서는 서비스워커를 쓸 수 없다
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const sw = navigator.serviceWorker;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (FLAGS.nosw || (local && !FLAGS.sw)) {
    // PC 개발 중 예전 ?sw=1 테스트의 SW가 남아 있으면 옛 파일을 서빙하므로 정리한다(로컬에서만).
    if (local && !FLAGS.sw) {
      sw.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      if (window.caches) caches.keys().then((ks) => ks.forEach((k) => k.startsWith('sniper-') && caches.delete(k))).catch(() => {});
    }
    return;
  }
  if (!window.isSecureContext) return;
  const hadController = !!sw.controller; // 첫 설치(clients.claim)는 업데이트가 아니다
  sw.addEventListener('controllerchange', () => { if (hadController) h.onUpdateReady(); });
  sw.register('sw.js', { scope: './', updateViaCache: 'none' })
    .then((r) => { reg = r; })
    .catch((e) => console.warn('[pwa] 서비스워커 등록 실패', e));
}
