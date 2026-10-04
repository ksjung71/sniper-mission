// 서비스워커 (mobile-ios-dev): 오프라인 실행을 위한 precache + cache-first.
// 버전을 올릴 때는 js/config.js의 APP_VERSION과 이 VERSION을 함께 바꾼다(캐시 이름이 바뀌어 새 파일을 받음).
const VERSION = '1.1.1';
const CACHE = `sniper-${VERSION}`;

// 명시적 상대경로 목록(sw.js 위치 = docs/ 기준). 새 파일을 만들면 여기에도 추가해야 오프라인에서 열린다.
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/main.js', 'js/bus.js', 'js/config.js', 'js/util.js', 'js/debug.js',
  'js/data/levels.js',
  'js/gfx/renderer.js', 'js/gfx/world.js', 'js/gfx/actors.js', 'js/gfx/fx.js', 'js/gfx/mesh.js',
  'js/game/weapon.js', 'js/game/ballistics.js', 'js/game/ai.js', 'js/game/session.js',
  'js/ui/hud.js', 'js/ui/input.js', 'js/ui/audio.js', 'js/ui/storage.js', 'js/ui/pwa.js',
  'vendor/three.module.min.js', 'vendor/three.core.min.js',
  'icons/apple-touch-icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))) // HTTP 캐시를 건너뛰고 새로 받음
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sniper-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // 내비게이션(?debug 등 쿼리 포함)은 캐시된 index.html로 대체
    e.respondWith(caches.match('index.html', { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
