const CACHE_NAME = 'typeless-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', e => {
  // 不快取外部 API 請求
  if (e.request.url.includes('generativelanguage.googleapis.com')) return;
  
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
