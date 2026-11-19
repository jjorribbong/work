// 마주톡 오프라인 캐시: 앱 화면은 인터넷 없이도 열리게 함(음성 인식은 인터넷 필요)
const CACHE = 'majutalk-v5';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// 최신 버전 우선, 인터넷이 없으면 저장된 버전 사용
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(cc => cc.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request))
  );
});
