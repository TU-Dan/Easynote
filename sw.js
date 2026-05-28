const CACHE = 'qsj-v1'
const ASSETS = ['./', './index.html', './style.css', './app.js', './api.js', './manifest.json', './icons/icon.svg']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  const url = e.request.url
  if (url.includes('api.deepseek.com') || url.includes('api.notion.com')) return
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)))
})
