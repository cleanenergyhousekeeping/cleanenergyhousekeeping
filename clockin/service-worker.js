const CACHE_NAME = "ce-clockin-shell-v217";

const APP_SHELL_FILES = [
  "/clockin/",
  "/clockin/index.html",
  "/clockin/style.css",
  "/clockin/app.js",
  "/clockin/seed.html",
  "/clockin/manifest.webmanifest",
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
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
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

  event.respondWith(
    fetch(request).catch(function () {
      return caches.match(request).then(function (cachedResponse) {
        return cachedResponse || caches.match("/clockin/index.html");
      });
    })
  );
});
