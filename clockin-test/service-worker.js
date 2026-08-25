const CACHE_NAME = "ce-clockin-test-shell-v20";

const APP_SHELL_FILES = [
  "/clockin-test/",
  "/clockin-test/index.html",
  "/clockin-test/style.css?v=20",
  "/clockin-test/app.js?v=20",
  "/clockin-test/seed.html",
  "/clockin-test/manifest.webmanifest",
  "/clockin/icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key.startsWith("ce-clockin-test-shell-") && key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const isNavigationRequest = request.mode === "navigate";
  const requestUrl = new URL(request.url);
  const isCriticalTestShellAsset =
    requestUrl.origin === self.location.origin &&
    (
      requestUrl.pathname === "/clockin-test/" ||
      requestUrl.pathname === "/clockin-test/index.html" ||
      requestUrl.pathname === "/clockin-test/style.css" ||
      requestUrl.pathname === "/clockin-test/app.js"
    );

  event.respondWith(
    fetch(
      isCriticalTestShellAsset
        ? new Request(request, { cache: "no-store" })
        : request
    )
      .then(function (response) {
        return response;
      })
      .catch(function () {
        return caches.match(request).then(function (cachedResponse) {
          if (cachedResponse) {
            return cachedResponse;
          }

          if (isNavigationRequest) {
            return caches.match("/clockin-test/index.html");
          }

          return Response.error();
        });
      })
  );
});
