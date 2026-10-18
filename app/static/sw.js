/**
 * Rattlesnake — offline shell.
 *
 * There is no API to be offline from: the data is on the phone. What this
 * worker adds is the app itself — the HTML, CSS, JS and font — so that opening
 * Rattlesnake in a basement gym with no bars of signal is the same as opening
 * it at home.
 *
 * Served from the app's root (not /static/) because a worker can only control
 * pages at or below its own path, and this one has to control all of them.
 */

/**
 * The path the app is served under: "" at the root of a host, "/rattlesnake" on
 * GitHub Pages. The worker sits at the top of the app, so its own folder is it.
 */
const ROOT = new URL(".", self.location.href).pathname.replace(/\/$/, "");

const VERSION = "__BUILD__";

// mattankama.github.io serves several sites from one origin, and every cache on
// an origin is shared — caches.match() searches all of them. So the cache is
// named for the app's path, and activate only clears this app's old ones.
const PREFIX = `rattlesnake:${ROOT}/:`;
const CACHE = PREFIX + VERSION;

// What caches were called before they carried a path: "rattlesnake-" and a
// build token. Only a worker at the root of the origin ever made them.
const UNSCOPED = /^rattlesnake-[0-9a-f]{12}$/;

/** A cache this worker owns and has replaced: safe to delete. */
function isStale(name) {
    if (name === CACHE) return false;
    return name.startsWith(PREFIX) || (ROOT === "" && UNSCOPED.test(name));
}

// The whole app. It is small enough to take in one bite, which is what makes
// "works offline" true on the first visit rather than after the right pages
// happen to have been opened.
const SHELL = [
    "/",
    "/progress",
    "/routine/",
    "/session/",
    "/static/css/style.css",
    "/static/js/store.js",
    "/static/js/local-api.js",
    "/static/js/persist.js",
    "/static/js/reorder.js",
    "/static/js/app.js",
    "/static/js/pager.js",
    "/static/js/home.js",
    "/static/js/progress.js",
    "/static/js/routine.js",
    "/static/js/session.js",
    "/static/fonts/archivo-latin-var.woff2",
    "/static/manifest.webmanifest",
    "/static/icons/favicon.svg",
    "/static/icons/icon.svg",
    "/static/icons/icon-192.png",
    "/static/icons/icon-512.png",
    "/static/icons/apple-touch-icon.png",
].map((path) => ROOT + path);

/**
 * Store one shell URL, with the redirected flag stripped.
 *
 * A Response whose redirected flag is set cannot be returned for a navigation:
 * the browser rejects it outright and the page fails to open, offline and on.
 * Hosts disagree about trailing slashes and redirect `/progress` to `/progress/`
 * (or back) to reach their preferred form, so a plain `cache.add()` quietly
 * poisons whichever pages went through a redirect on the way in. Rebuilding the
 * response from its body is what drops the flag.
 */
async function precache(cache, url) {
    const response = await fetch(url);
    if (!response.ok) return;

    await cache.put(
        url,
        new Response(await response.blob(), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        }),
    );
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            // Individually, so one 404 in the list cannot fail the whole install
            // and leave the app with no offline copy at all.
            .then((cache) => Promise.all(SHELL.map((url) => precache(cache, url).catch(() => {}))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((names) => Promise.all(names.filter(isStale).map((name) => caches.delete(name))))
            .then(() => self.clients.claim()),
    );
});

/**
 * The cache keys worth trying for a request, best first.
 *
 * Two things have to be normalised away, and both of them are the difference
 * between opening in the gym and not:
 *
 * 1. The query string. `/session/?id=2` and `/session/?id=9` are the same file —
 *    which session it is gets read by the page, not chosen by the server. Matched
 *    literally, every session would be a miss.
 * 2. The trailing slash. Hosts disagree about whether `/progress` or `/progress/`
 *    is canonical and redirect to whichever they prefer. Online that redirect is
 *    invisible; offline there is nobody to serve it, so the form the lifter
 *    happens to arrive with has to hit the copy we actually stored.
 */
function cacheKeys(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const alternate = path.endsWith("/") ? path.slice(0, -1) : path + "/";

    const paths = [path];
    if (alternate) paths.push(alternate); // "" when path was "/" — nothing to add
    return paths.map((p) => new Request(url.origin + p));
}

/**
 * The first of those keys that is actually in this app's cache. Only this app's:
 * a worker that used to sit at the root of the origin may have cached these
 * same URLs, and caches.match() would happily serve its stale copies.
 */
async function findCached(request) {
    const cache = await caches.open(CACHE);
    for (const key of cacheKeys(request)) {
        const hit = await cache.match(key);
        if (hit) return hit;
    }
    return undefined;
}

/**
 * Cache first, then refresh in the background.
 *
 * Cache first because the gym is the hostile case and a cached answer is
 * instant. The background refresh is what keeps a deployed fix from waiting
 * forever behind a cache that is already good enough — it lands on the next
 * open, which is soon enough for a workout log.
 */
self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    if (new URL(request.url).origin !== self.location.origin) return;

    const key = cacheKeys(request)[0];

    event.respondWith(
        findCached(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE).then((cache) => cache.put(key, copy));
                    }
                    return response;
                })
                // Offline and nothing cached for this exact page: the shell is
                // still better than the browser's error page, and every route
                // here renders from the same local data anyway.
                .catch(() => cached || caches.open(CACHE).then((cache) => cache.match(ROOT + "/")));

            return cached || network;
        }),
    );
});
