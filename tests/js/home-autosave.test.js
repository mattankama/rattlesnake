/**
 * Home's half of saving an abandoned workout: make the sweep the first call on
 * the page, say what it saved, and never let it stand in front of the routines.
 *
 * home.js only touches the DOM from inside its handlers, so it loads into a
 * sandbox with a hand-rolled document and a fetchJSON that records each call.
 *
 * Run with: node --test tests/js/
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HOME_JS = path.join(__dirname, "../../app/static/js/home.js");
const SWEEP = "/api/sessions/complete-abandoned";

/** home.js in a box. `sweep` answers the auto-save call. */
function loadHome(sweep) {
    const calls = [];
    const note = {
        hidden: true,
        lines: [],
        replaceChildren(...lines) {
            this.lines = lines;
        },
    };
    const list = { innerHTML: "", querySelectorAll: () => [] };
    const elements = { "autosave-note": note, "routines-list": list, "empty-state": { style: {} } };

    let onReady = null;
    const sandbox = {
        console: { warn() {} },
        document: {
            addEventListener: (type, fn) => {
                if (type === "DOMContentLoaded") onReady = fn;
            },
            getElementById: (id) => elements[id] || null,
            querySelector: () => ({}),
            createElement: () => ({ textContent: "" }),
        },
        fetchJSON: async (url, options = {}) => {
            calls.push(`${options.method || "GET"} ${url}`);
            if (url === SWEEP) return sweep();
            if (url === "/api/routines") return [{ id: 1, name: "Push Day", exercise_count: 2 }];
            throw new Error(`unexpected call: ${url}`);
        },
        clearError() {},
        showError() {},
        escapeHTML: (s) => s,
        appUrl: (path) => path,
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(HOME_JS, "utf8"), sandbox);

    return { open: () => onReady(), calls, note, list };
}

test("home saves abandoned workouts", async (t) => {
    await t.test("the sweep goes first, and names what it saved", async () => {
        const home = loadHome(async () => ({
            sessions: [{ routine_name: "<b>Push</b> Day", completed_at: "2026-10-05T19:10:00.000" }],
        }));

        await home.open();

        assert.deepEqual(home.calls, [`POST ${SWEEP}`, "GET /api/routines"]);
        assert.equal(home.note.hidden, false);
        assert.equal(home.note.lines.length, 1);
        // textContent, not markup: a routine name is whatever the lifter typed.
        assert.match(home.note.lines[0].textContent, /^Saved <b>Push<\/b> Day from .+ — it was left unfinished\.$/);
    });

    await t.test("nothing saved leaves the note hidden", async () => {
        const home = loadHome(async () => ({ sessions: [] }));

        await home.open();

        assert.equal(home.note.hidden, true);
        assert.deepEqual(home.note.lines, []);
    });

    await t.test("a failed sweep still shows the routines", async () => {
        const home = loadHome(async () => {
            throw new Error("storage blocked");
        });

        await home.open();

        assert.match(home.list.innerHTML, /Push Day/);
        assert.equal(home.note.hidden, true);
    });
});
