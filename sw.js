const CACHE = "chatllm-v4-runtime-fixes";
const LOCAL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./chatllm-runtime-fixes.js",
  "./manifest.webmanifest",
  "./assets/chatllm-logo-transparent.png",
  "./assets/chatllm-mark-light.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(LOCAL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/app.js")) {
    event.respondWith(fetchPatchedApp(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => cached))
  );
});

async function fetchPatchedApp(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const appResponse = cached || await fetch(request);
  const appText = await appResponse.clone().text();

  let fixesText = "";
  try {
    const fixesUrl = new URL("./chatllm-runtime-fixes.js", request.url).href;
    const fixesRequest = new Request(fixesUrl, { cache: "reload" });
    const fixesResponse = await fetch(fixesRequest).catch(() => cache.match(fixesRequest));
    fixesText = fixesResponse ? await fixesResponse.text() : "";
  } catch (_) {}

  const patched = appText.includes("__chatllmRuntimeFixesFetchWrapped")
    ? appText
    : `${fixesText}\n\n${appText}`;

  return new Response(patched, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
