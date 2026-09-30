/*
 * Cross-origin isolation for static hosting (Hugging Face Spaces, GitHub Pages).
 *
 * The AI models run in WebAssembly, which can only use more than one CPU core when the
 * page is "cross-origin isolated". That needs two response headers a static host can't
 * be told to send, so this service worker adds them to the app's own responses:
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: credentialless  (cross-origin files still load, without cookies)
 * Nothing else is changed or cached.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then((response) => {
      if (response.status === 0) return response;
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "credentialless");
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }).catch((error) => {
      console.error("coi-serviceworker fetch failed", error);
      throw error;
    }),
  );
});
