const CACHE = 'recipes-v2'
const MAX_ENTRIES = 40

async function trim(cache) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((key) => cache.delete(key)))
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]))
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request)
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE)
        await cache.put(event.request, response.clone())
        await trim(cache)
      }
      return response
    } catch {
      return (await caches.match(event.request)) || (await caches.match('./'))
    }
  })())
})
