/*
 * Cross-origin isolation and a file cache for static hosting (Hugging Face Spaces,
 * GitHub Pages).
 *
 * The AI models run in WebAssembly, which can only use more than one CPU core when the
 * page is "cross-origin isolated". That needs two response headers a static host can't
 * be told to send, so this service worker adds them to the app's own responses:
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: credentialless  (cross-origin files still load, without cookies)
 *
 * It also keeps the app's own build files and pictures in the browser, because these
 * hosts tell the browser to keep them briefly or not at all (Hugging Face re-sends every
 * picture and the 27 MB AI runtime on each visit). The page itself is always fetched
 * fresh, so a new deployment is picked up on the next load.
 */
const CACHE = "lexintel-files-v1";
const MAX_FILES = 300;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if (name.startsWith("lexintel-files-") && name !== CACHE) await caches.delete(name);
  }
  await self.clients.claim();
})()));

/*
 * Hugging Face serves images through a redirect to its CDN. A plain <img> request that
 * follows it comes back unreadable ("opaque"), and the embedder policy then blocks it.
 * Asking for the same file with CORS keeps it readable, so the headers can be added.
 */
function load(request) {
  if (request.mode !== "no-cors") return fetch(request);
  return fetch(request.url, { mode: "cors", credentials: "omit", headers: request.headers })
    .catch(() => fetch(request));
}

function isolated(response) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/*
 * "keep":    build files under assets/ carry a content hash in their name and never change.
 * "refresh": pictures are shown from the cache at once and re-fetched in the background.
 */
function cacheRule(request, url) {
  if (request.method !== "GET" || request.headers.has("range")) return null;
  if (/\/assets\/[^/]+$/.test(url.pathname)) return "keep";
  if (/\/images\/[^/]+$/.test(url.pathname)) return "refresh";
  return null;
}

async function store(cache, url, response) {
  const type = response.headers.get("content-type") || "";
  if (response.status !== 200 || type.includes("text/html")) return;
  await cache.put(url, response);
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) await cache.delete(old);
}

async function respond(event, rule) {
  const request = event.request;
  const cache = rule ? await caches.open(CACHE).catch(() => null) : null;
  const fromNetwork = async () => {
    const response = isolated(await load(request));
    if (cache) event.waitUntil(store(cache, request.url, response.clone()).catch(() => {}));
    return response;
  };
  const cached = cache ? await cache.match(request.url) : undefined;
  if (!cached) return fromNetwork();
  if (rule === "refresh") event.waitUntil(fromNetwork().catch(() => {}));
  return cached;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    respond(event, cacheRule(request, url)).catch((error) => {
      console.error("coi-serviceworker fetch failed", error);
      throw error;
    }),
  );
});
