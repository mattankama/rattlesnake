/**
 * The offline guarantee, tested without a browser.
 *
 * sw.js is loaded into a stub worker scope so its fetch handler can be called
 * directly. The case that matters is the one that actually broke: a session URL
 * carries `?id=2`, the precache holds `/session/`, and a literal match misses —
 * which offline means the app refusing to open, in the gym, which is the entire
 * situation the worker exists for.
 *
 * Run with: node --test tests/js/
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SW = path.join(__dirname, "../../app/static/sw.js");
const ORIGIN = "https://rattlesnake.example";

/**
 * Load sw.js into a fake worker global, with a cache we control.
 *
 * `root` is where the worker is served from: "" for the root of a host,
 * "/rattlesnake" for GitHub Pages. `cacheNames` is every cache already on the
 * origin, for the activate handler to sort through.
 */
function loadWorker({ precached = [], online = true, redirects = [], root = "", cacheNames = [] } = {}) {
    const stored = new Map(precached.map((url) => [ORIGIN + url, { body: `body:${url}`, redirected: false }]));
    const listeners = {};
    const deleted = [];

    const lookup = async (request) => {
        const url = typeof request === "string" ? ORIGIN + request : request.url;
        if (!stored.has(url)) return undefined;
        const entry = stored.get(url);
        return { ...entry, ok: true, clone: () => ({ ...entry }) };
    };

    const cache = {
        add: async (url) => stored.set(ORIGIN + url, { body: `body:${url}`, redirected: false }),
        put: async (request, response) => {
            const url = typeof request === "string" ? ORIGIN + request : request.url;
            stored.set(url, { body: response.body, redirected: !!response.redirected });
        },
        keys: async () => [...stored.keys()].map((url) => ({ url })),
        match: lookup,
    };

    const context = {
        console,
        URL,
        Promise,
        Request: class { constructor(url) { this.url = String(url); this.method = "GET"; } },
        caches: {
            open: async () => cache,
            keys: async () => cacheNames,
            delete: async (name) => { deleted.push(name); return true; },
            match: lookup,
        },
        // A Response rebuilt from a body has no redirected flag — that is the
        // whole point of precache(), so the stub has to model it.
        Response: class {
            constructor(body, init = {}) {
                this.body = body;
                this.status = init.status ?? 200;
                this.statusText = init.statusText ?? "";
                this.headers = init.headers;
                this.ok = this.status >= 200 && this.status < 300;
                this.redirected = false;
            }
        },
        fetch: async (input) => {
            if (!online) throw new Error("offline");
            const url = typeof input === "string" ? ORIGIN + input : input.url;
            const path = url.slice(ORIGIN.length);
            return {
                ok: true,
                status: 200,
                statusText: "OK",
                headers: {},
                // Hosts redirect to their preferred trailing-slash form; anything
                // that went through one comes back with this flag set.
                redirected: redirects.includes(path),
                body: `network:${url}`,
                blob: async () => `network:${url}`,
                clone: () => ({ body: `network:${url}` }),
            };
        },
        self: {
            location: { origin: ORIGIN, href: `${ORIGIN}${root}/sw.js` },
            addEventListener: (type, fn) => { listeners[type] = fn; },
            skipWaiting: async () => {},
            clients: { claim: async () => {} },
        },
    };
    context.self.caches = context.caches;

    vm.createContext(context);
    vm.runInContext(fs.readFileSync(SW, "utf8"), context, { filename: "sw.js" });

    /** Run the install handler, as the browser does on first load. */
    const request_install = async () => {
        let done;
        await listeners.install({ waitUntil: (p) => { done = p; } });
        await done;
    };

    /**
     * Fire a request at the worker and return what it responds with, or
     * undefined when it declines to handle it at all.
     */
    const request = async function request(url, { method = "GET", origin = ORIGIN } = {}) {
        let responded;
        let handled = false;
        listeners.fetch({
            request: { url: origin + url, method },
            respondWith: (p) => { handled = true; responded = p; },
        });
        return handled ? await responded : undefined;
    };

    /** Run the activate handler, as the browser does once install is done. */
    const request_activate = async () => {
        let done;
        await listeners.activate({ waitUntil: (p) => { done = p; } });
        await done;
    };

    request.install = request_install;
    request.activate = request_activate;
    request.deleted = deleted;
    request.cacheName = vm.runInContext("CACHE", context);
    request.stored = stored;
    // `const` stays in the script's lexical scope rather than landing on the
    // context, so the worker's own shell list is read by evaluating it in place.
    request.shell = vm.runInContext("SHELL", context);
    return request;
}

test("service worker", async (t) => {
    await t.test("serves a precached page offline", async () => {
        const request = loadWorker({ precached: ["/", "/session/"], online: false });
        assert.equal((await request("/"))?.body, "body:/");
    });

    await t.test("a session URL offline is served by the cached page", async () => {
        // The regression: cached "/session/", asked for "/session/?id=2".
        const request = loadWorker({ precached: ["/session/"], online: false });
        assert.equal((await request("/session/?id=2"))?.body, "body:/session/");
    });

    await t.test("a routine edit URL offline is served the same way", async () => {
        const request = loadWorker({ precached: ["/routine/"], online: false });
        assert.equal((await request("/routine/?id=7"))?.body, "body:/routine/");
    });

    await t.test("falls back to the shell for a page never cached", async () => {
        const request = loadWorker({ precached: ["/"], online: false });
        assert.equal((await request("/progress"))?.body, "body:/");
    });

    await t.test("prefers the cache when online, so the gym never waits", async () => {
        const request = loadWorker({ precached: ["/static/css/style.css"], online: true });
        assert.equal((await request("/static/css/style.css"))?.body, "body:/static/css/style.css");
    });

    await t.test("goes to the network for something it has never seen", async () => {
        const request = loadWorker({ precached: [], online: true });
        assert.equal((await request("/static/js/app.js"))?.body, `network:${ORIGIN}/static/js/app.js`);
    });

    await t.test("does not touch writes", async () => {
        const request = loadWorker({ precached: ["/"], online: true });
        assert.equal(await request("/", { method: "POST" }), undefined);
    });

    await t.test("does not touch other origins", async () => {
        const request = loadWorker({ precached: ["/"], online: true });
        assert.equal(await request("/x", { origin: "https://elsewhere.example" }), undefined);
    });
});

test("service worker, trailing slashes", async (t) => {
    // Hosts disagree about whether /progress or /progress/ is canonical and
    // redirect to their preference. Offline there is no redirect to follow, so
    // whichever form the lifter arrives with has to find what was precached.

    await t.test("a slashless path finds the cached directory form", async () => {
        const request = loadWorker({ precached: ["/progress/"], online: false });
        assert.equal((await request("/progress"))?.body, "body:/progress/");
    });

    await t.test("a slashed path finds the cached flat form", async () => {
        const request = loadWorker({ precached: ["/progress"], online: false });
        assert.equal((await request("/progress/"))?.body, "body:/progress");
    });

    await t.test("a session URL still resolves through both normalisations", async () => {
        const request = loadWorker({ precached: ["/session"], online: false });
        assert.equal((await request("/session/?id=2"))?.body, "body:/session");
    });

    await t.test("the root is not mistaken for something else", async () => {
        const request = loadWorker({ precached: ["/"], online: false });
        assert.equal((await request("/"))?.body, "body:/");
    });
});

test("service worker, precaching", async (t) => {
    // The trap this guards: a Response whose redirected flag is set cannot be
    // returned for a navigation. The browser rejects it and the page fails to
    // open — which is how /progress broke, because a directory-index host sends
    // /progress to /progress/ and cache.add() stored the redirected response.

    await t.test("stores every shell URL", async () => {
        const request = loadWorker({ online: true });
        await request.install();
        // Read off the worker's own SHELL rather than a copy of it, so the next
        // file added to the app is covered without anyone editing this test —
        // and an unlisted file is a broken screen on a phone with no signal.
        assert.ok(request.shell.length > 5, "the shell list was not read");
        for (const path of request.shell) {
            assert.ok(request.stored.has(ORIGIN + path), `${path} was not precached`);
        }
    });

    await t.test("a page that arrived via a redirect is stored without the flag", async () => {
        const request = loadWorker({ online: true, redirects: ["/progress"] });
        await request.install();
        assert.equal(request.stored.get(ORIGIN + "/progress").redirected, false);
    });

    await t.test("and that page is then servable as a navigation", async () => {
        const request = loadWorker({ online: true, redirects: ["/progress"] });
        await request.install();
        const response = await request("/progress");
        assert.equal(response.redirected, false, "a redirected response would fail the navigation");
    });

    await t.test("one unreachable URL does not sink the whole install", async () => {
        const request = loadWorker({ online: false });
        await assert.doesNotReject(() => request.install());
    });
});

test("service worker, served under a path", async (t) => {
    // GitHub Pages serves the app at mattankama.github.io/rattlesnake/, with the
    // worker at /rattlesnake/sw.js. Everything it caches and falls back to has to
    // carry that path, or the gym gets the browser's offline page.

    await t.test("precaches the app under its own path", async () => {
        const request = loadWorker({ online: true, root: "/rattlesnake" });
        await request.install();
        for (const path of request.shell) {
            assert.ok(path.startsWith("/rattlesnake/"), `${path} is outside the app`);
            assert.ok(request.stored.has(ORIGIN + path), `${path} was not precached`);
        }
        assert.ok(request.stored.has(ORIGIN + "/rattlesnake/session/"));
    });

    await t.test("a session URL offline is served by the cached page", async () => {
        const request = loadWorker({ precached: ["/rattlesnake/session/"], online: false, root: "/rattlesnake" });
        assert.equal((await request("/rattlesnake/session/?id=2"))?.body, "body:/rattlesnake/session/");
    });

    await t.test("falls back to the app's home, not the site's", async () => {
        const request = loadWorker({ precached: ["/", "/rattlesnake/"], online: false, root: "/rattlesnake" });
        assert.equal((await request("/rattlesnake/progress"))?.body, "body:/rattlesnake/");
    });
});

test("service worker, clearing old caches", async (t) => {
    // Every cache on an origin is shared, and mattankama.github.io serves several
    // sites from one. A worker that deletes every cache but its own wipes theirs.

    await t.test("names its cache for the path it serves", () => {
        assert.equal(loadWorker({ root: "/rattlesnake" }).cacheName, "rattlesnake:/rattlesnake/:__BUILD__");
        assert.equal(loadWorker({ root: "" }).cacheName, "rattlesnake:/:__BUILD__");
    });

    await t.test("clears its own previous versions", async () => {
        const request = loadWorker({
            root: "/rattlesnake",
            cacheNames: ["rattlesnake:/rattlesnake/:0123456789ab", "rattlesnake:/rattlesnake/:__BUILD__"],
        });
        await request.activate();
        assert.deepEqual(request.deleted, ["rattlesnake:/rattlesnake/:0123456789ab"]);
    });

    await t.test("leaves other sites' caches on the origin alone", async () => {
        // The unscoped one belongs to the worker that sat at the site root before
        // the move. Retiring it is the root site's job (its own sw.js).
        const request = loadWorker({
            root: "/rattlesnake",
            cacheNames: ["intonation-v1", "home-v1", "rattlesnake:/:0123456789ab", "rattlesnake-0123456789ab"],
        });
        await request.activate();
        assert.deepEqual(request.deleted, []);
    });

    await t.test("at the root of a host, also clears the caches it made before they had a path", async () => {
        // Left behind, they would win: caches.match() searches oldest first.
        const request = loadWorker({
            root: "",
            cacheNames: ["rattlesnake-0123456789ab", "rattlesnake:/:0123456789ab", "intonation-v1"],
        });
        await request.activate();
        assert.deepEqual(request.deleted, ["rattlesnake-0123456789ab", "rattlesnake:/:0123456789ab"]);
    });
});
