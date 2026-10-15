/*
 * Music Vault service worker. Its one job is letting the installed app open
 * without a network: it keeps the app shell and the build's static files.
 *
 * What it never touches: anything cross-origin (Supabase, the R2 vault), the
 * /api routes, and the sign-in pages. Audio and covers already live in OPFS
 * and IndexedDB (lib/audioCache.ts, lib/artwork.ts), and the library in the
 * sync store, so with the shell cached a signed-in user can play downloads
 * offline.
 *
 * Bump VERSION to drop every cache this worker made.
 */
const VERSION = "v1";
const SHELL = `mv-shell-${VERSION}`;
const STATIC = `mv-static-${VERSION}`;
/** Every in-app address serves the same client shell, so one copy is enough. */
const SHELL_KEY = "/";
const NO_SHELL = ["/login", "/auth", "/account", "/help", "/api"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, STATIC]);
      for (const name of await caches.keys()) {
        if (name.startsWith("mv-") && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first, so a deploy shows at once; the saved shell when offline.
  if (request.mode === "navigate") {
    if (NO_SHELL.some((p) => url.pathname.startsWith(p))) return;
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // A redirect means signed out (to /login): never save that as the shell.
          if (response.ok && !response.redirected) {
            const cache = await caches.open(SHELL);
            await cache.put(SHELL_KEY, response.clone());
          }
          return response;
        } catch (err) {
          const cached = await caches.match(SHELL_KEY, { cacheName: SHELL });
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // Build output is content-hashed, so a cached copy is always right.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  // Icons and the manifest: answer from cache, refresh behind it.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) void cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? fresh;
      })(),
    );
  }
});
