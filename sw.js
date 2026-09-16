/* FreelancerOS service worker — cache-first for static assets, API untouched. */
const CACHE = "freelanceros-v2";
const STATIC = [
  "index.html",
  "demo.html",
  "app.html",
  "success.html",
  "privacy.html",
  "terms.html",
  "styles.css",
  "app.js",
  "dashboard.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
  "templates/contract-template.md",
  "templates/proposal-template.md",
  "templates/onboarding-form.md"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(STATIC); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () {})
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  /* Only handle same-origin GETs; never cache API or checkout traffic. */
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        return res;
      });
    })
  );
});
