const CACHE = 'qsj-v13'

function isCacheableRequest(request) {
  if (request.method !== 'GET') return false

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false

  return request.mode === 'navigate' ||
    ['document', 'script', 'style', 'image', 'font', 'manifest'].includes(request.destination)
}

self.addEventListener('install', e => {
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
  if (!isCacheableRequest(e.request)) return

  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(r => {
      if (r.ok) {
        const clone = r.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
      }
      return r
    }).catch(() => caches.match(e.request))
  )
})
