/*
 * Service Worker — Aramex Gate House Register
 * GitHub Pages: /aramex-gatehouse-system/
 *
 * IMPORTANT:
 * Whenever you publish a new app version, change CACHE_NAME.
 * Example: aramex-gatehouse-v2 -> aramex-gatehouse-v3
 *
 * Changes in v2:
 *  - The scripts the app needs (React, Babel, Firebase SDK) are now cached, so the
 *    installed app can open without internet. They come from a CDN and were
 *    previously never cached.
 *  - Version-pinned CDN files are served cache-first (they never change).
 *  - Page loads wait at most 4 seconds for the network, then use the saved copy,
 *    so a weak connection no longer freezes the app.
 *
 * If you change a CDN version in index.html, change it in CDN_SHELL below too.
 */

const APP_ROOT = '/aramex-gatehouse-system/';
const CACHE_NAME = 'aramex-gatehouse-v2';
const NETWORK_TIMEOUT_MS = 4000;

// Main application files to cache for offline access.
const APP_SHELL = [
  APP_ROOT,
  `${APP_ROOT}index.html`,
  `${APP_ROOT}manifest.json`,
  `${APP_ROOT}icon-192.png`,
  `${APP_ROOT}icon-512.png`
];

// Version-pinned scripts loaded by index.html (must match the exact URLs there).
const CDN_SHELL = [
  'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js',
  'https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-app-compat.js',
  'https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-auth-compat.js',
  'https://cdn.jsdelivr.net/npm/firebase@10.14.1/firebase-firestore-compat.js'
];

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

// Only exact-version CDN files (for example react@18.3.1) are safe to keep forever.
function isPinnedCdn(url) {
  return (
    url.hostname === 'cdn.jsdelivr.net' &&
    /@v?\d+\.\d+\.\d+/.test(url.pathname)
  );
}

// INSTALL: Cache the application shell and the pinned scripts.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await Promise.all(
      APP_SHELL.map(async (path) => {
        try {
          const response = await fetch(path, {
            cache: 'reload'
          });

          if (response.ok) {
            await cache.put(path, response);
          }
        } catch (error) {
          console.warn(
            '[Aramex SW] Could not cache:',
            path,
            error
          );
        }
      })
    );

    await Promise.all(
      CDN_SHELL.map(async (href) => {
        try {
          const response = await fetch(href, {
            mode: 'cors',
            credentials: 'omit'
          });

          if (response.ok) {
            await cache.put(href, response);
          }
        } catch (error) {
          console.warn(
            '[Aramex SW] Could not cache script:',
            href,
            error
          );
        }
      })
    );

    await self.skipWaiting();
  })());
});

// ACTIVATE: Remove old application caches.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames.map((name) => {
        if (
          name.startsWith('aramex-gatehouse-') &&
          name !== CACHE_NAME
        ) {
          return caches.delete(name);
        }
      })
    );

    await self.clients.claim();
  })());
});

// Exclude Firebase, authentication, APIs and external resources.
function shouldBypass(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  return (
    url.origin !== self.location.origin ||
    /firebase|firestore|identitytoolkit|securetoken|\/api(?:\/|$)/i
      .test(host + path)
  );
}

// Identify static files.
function isStaticAsset(request, url) {
  return (
    ['style', 'script', 'image', 'font'].includes(
      request.destination
    ) ||
    /\.(css|js|mjs|png|jpg|jpeg|svg|webp|ico|woff2?|ttf|otf)$/i
      .test(url.pathname)
  );
}

// Pinned CDN files: saved copy first, otherwise download and save.
async function cdnCacheFirst(url) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(url.href);

  if (hit) return hit;

  const response = await fetch(url.href, {
    mode: 'cors',
    credentials: 'omit'
  });

  if (response.ok) {
    await cache.put(url.href, response.clone());
  }

  return response;
}

// FETCH: Network-first for HTML, cache-first for static assets.
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Version-pinned CDN scripts (checked before the Firebase bypass, because
  // the Firebase SDK files also come from the CDN).
  if (isPinnedCdn(url)) {
    event.respondWith(cdnCacheFirst(url));
    return;
  }

  // Leave Firebase, APIs and external resources untouched.
  if (shouldBypass(url)) return;

  // HTML navigation: NETWORK FIRST (with a timeout).
  if (
    request.mode === 'navigate' ||
    request.destination === 'document'
  ) {
    event.respondWith((async () => {
      const networkPromise = fetch(request);

      try {
        const response = await withTimeout(
          networkPromise,
          NETWORK_TIMEOUT_MS
        );

        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);

          await cache.put(
            `${APP_ROOT}index.html`,
            response.clone()
          );
        }

        return response;

      } catch (error) {
        // Slow or offline: use the saved application.
        const cached =
          await caches.match(request) ||
          await caches.match(`${APP_ROOT}index.html`) ||
          await caches.match(APP_ROOT);

        if (cached) return cached;

        // Nothing saved yet: keep waiting for the network.
        try {
          return await networkPromise;
        } catch (networkError) {
          return new Response(
            'You are offline. Aramex Gate House Register is unavailable.',
            {
              status: 503,
              headers: {
                'Content-Type': 'text/plain'
              }
            }
          );
        }
      }
    })());

    return;
  }

  // Static assets: CACHE FIRST.
  if (isStaticAsset(request, url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);

      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (
          response.ok &&
          response.type === 'basic'
        ) {
          const cache = await caches.open(CACHE_NAME);

          await cache.put(
            request,
            response.clone()
          );
        }

        return response;

      } catch (error) {
        return new Response(
          '',
          {
            status: 504,
            statusText: 'Offline asset unavailable'
          }
        );
      }
    })());
  }
});
