/**
 * The data layer must survive sharing a scope with the screens.
 *
 * Every file ships as a plain <script>, so all ten of them land in one global
 * scope in load order. local-api.js and session.js/routine.js both wanted the
 * names `updateSet`, `addSet`, `completeSession` and `deleteRoutine`; the screen
 * scripts load last, so their versions won and four API routes silently ran UI
 * code. Nothing threw — writes just stopped happening.
 *
 * tests/js/local-api.test.js cannot catch that: it imports one module on its
 * own, which is the one arrangement the browser never uses. So this file loads
 * everything the way a page does, and then checks the API still works.
 *
 * Run with: node --test tests/js/
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const JS = path.join(__dirname, "../../app/static/js");

// Every file that wraps itself in a namespace, data layer or not: reorder.js
// is screen code, but it ships the same way and must leak just as little.
const NAMESPACED = ["store.js", "local-api.js", "persist.js", "reorder.js"];
const SCREENS = ["app.js", "pager.js", "home.js", "progress.js", "routine.js", "session.js"];

/** Every name these files declare at the top of a line — near enough to scope. */
function declaredNames(files) {
    const names = new Set();
    for (const file of files) {
        const source = fs.readFileSync(path.join(JS, file), "utf8");
        for (const match of source.matchAll(/^(?:async function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
            names.add(match[1]);
        }
    }
    return names;
}

// The order base.html loads them in, then the screen scripts every page adds.
const LOAD_ORDER = [
    "store.js",
    "local-api.js",
    "persist.js",
    "app.js",
    "reorder.js",
    "pager.js",
    "home.js",
    "progress.js",
    "routine.js",
    "session.js",
];

/** A page, near enough: the scripts only touch the DOM from inside handlers. */
function loadPage() {
    const listeners = [];
    const noop = () => {};
    const element = new Proxy(
        { style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
          addEventListener: noop, appendChild: noop, prepend: noop, remove: noop,
          setAttribute: noop, getAttribute: () => null, querySelector: () => null,
          querySelectorAll: () => [], focus: noop, textContent: "", innerHTML: "", value: "" },
        { get: (target, prop) => (prop in target ? target[prop] : undefined) },
    );

    const context = {
        console,
        indexedDB: undefined, // storage unavailable — boot() degrades, which is fine here
        navigator: { storage: undefined },
        location: { search: "", pathname: "/", hostname: "127.0.0.1" },
        history: { replaceState: noop },
        performance: { now: () => 0 },
        setTimeout,
        clearTimeout,
        queueMicrotask,
        Promise,
        URLSearchParams,
        document: {
            addEventListener: (type, fn) => listeners.push([type, fn]),
            getElementById: () => element,
            querySelector: () => element,
            querySelectorAll: () => [],
            createElement: () => element,
            body: element,
            documentElement: element,
        },
    };
    context.window = context;
    context.self = context;
    context.globalThis = context;

    vm.createContext(context);
    for (const file of LOAD_ORDER) {
        vm.runInContext(fs.readFileSync(path.join(JS, file), "utf8"), context, { filename: file });
    }
    return context;
}

test("script scope", async (t) => {
    await t.test("every page script loads together without throwing", () => {
        assert.doesNotThrow(loadPage);
    });

    await t.test("the data layer reaches the page under its own namespace", () => {
        const page = loadPage();
        assert.equal(typeof page.RattlesnakeStore.createStore, "function");
        assert.equal(typeof page.RattlesnakeAPI.handleRequest, "function");
        assert.equal(typeof page.RattlesnakePersist.boot, "function");
        assert.equal(typeof page.RattlesnakeReorder.bind, "function");
    });

    await t.test("the namespaced modules leak no bare globals", () => {
        const page = loadPage();

        // Derived rather than listed, so a name added to the data layer later is
        // covered without anyone remembering to come back here. A name the
        // screens also declare is theirs to own — that is the collision this
        // whole file exists for, and the next test proves it is now harmless.
        const screenNames = declaredNames(SCREENS);
        const leaked = [...declaredNames(NAMESPACED)]
            .filter((name) => !screenNames.has(name))
            .filter((name) => page[name] !== undefined);

        assert.deepEqual(leaked, [], `escaped into the page scope: ${leaked.join(", ")}`);
    });

    await t.test("the routes the screens shadowed still do their own work", () => {
        const page = loadPage();
        const store = page.RattlesnakeStore.createStore();
        const call = (method, url, body) => page.RattlesnakeAPI.handleRequest(store, method, url, body);

        const routine = call("POST", "/api/routines", {
            name: "Push Day",
            exercises: [{ name: "Chest Press", instances: [{ name: "Cybex" }] }],
        }).body;
        const session = call("POST", "/api/sessions", { routine_id: routine.id }).body;
        const entryId = session.entries[0].id;
        const setId = session.entries[0].sets[0].id;

        // PUT /session-sets/:id — shadowed by session.js's updateSet()
        assert.equal(call("PUT", `/api/session-sets/${setId}`, { weight: 135, reps: 10 }).body.weight, 135);

        // POST /session-entries/:id/sets — shadowed by session.js's addSet()
        assert.equal(call("POST", `/api/session-entries/${entryId}/sets`, { weight: 145, reps: 8 }).status, 201);

        // PUT /sessions/:id/complete — shadowed by session.js's completeSession()
        assert.equal(call("PUT", `/api/sessions/${session.id}/complete`).body.status, "completed");

        // DELETE /routines/:id — shadowed by routine.js's deleteRoutine()
        assert.equal(call("DELETE", `/api/routines/${routine.id}`).status, 204);
        assert.equal(call("GET", `/api/routines/${routine.id}`).status, 404);
    });
});
