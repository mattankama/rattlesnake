# Rattlesnake

A mobile-first web app for logging weightlifting workouts. Every exercise auto-fills with
the sets, reps, and weight from the last time it was performed on that instance, so the lifter
can start the set immediately and only adjust what changed. All data is on the lifter's phone —
no account, no cloud sync, no server.

**The app that ships is a folder of static files.** `python3 scripts/build_static.py` writes
`dist/`, which any host can serve. The API runs in the browser (`app/static/js/local-api.js`)
against IndexedDB, and a service worker keeps the whole thing working with no signal.

There is no backend. Flask is a development tool and nothing more: it serves the four pages
while you work, and renders them once at build time. It holds no data, has no database and
answers no API — **the domain logic lives in `app/static/js/`, and that is the only copy.**

## Navigation

Read the document before working in the area it covers. Do not reconstruct these from the code.

- **[.claude/CONTEXT.md](./CONTEXT.md)** — domain model, glossary, user flows, deletion
  rules, and explicit non-goals. Read before touching `app/static/js/store.js` or
  `app/static/js/local-api.js`, or before using the words *exercise*, *instance*, *routine*, *session*, *set*, or *lastSession* —
  each is a defined term here and they do not mean what they'd mean in another lifting app.
- **[.claude/design_guidelines.md](./design_guidelines.md)** — the FORGE design system, as
  actually implemented in `app/static/css/style.css`. Read before any change to markup, CSS, or
  visual behaviour. If the code and that document disagree, one of them is a bug — say which,
  don't silently pick a side.
- **[docs/adr/](../docs/adr/)** — architecture decision records. Check for one covering your area
  before changing a decision it locks in.

## Skills

Project skills live in `.claude/skills/` and Claude Code loads them automatically. Invoke one
with the Skill tool, or by name as `/<skill-name>`. Run **`/ask-matt`** to route yourself to the
right skill when you're unsure which fits.

Most-used here: `/tdd`, `/code-review`, `/diagnosing-bugs`, `/domain-modeling`, `/retro`.

Two things to know about the bundled library, because its skills were written generically:

- They assume `CONTEXT.md` lives at the repo root. **Here it is `.claude/CONTEXT.md`.** Use that
  path; do not create a second one at the root.
- Several target TypeScript repos (`/migrate-to-shoehorn`, `/setup-ts-deep-modules`,
  `/setup-pre-commit`) and simply don't apply to this Python codebase.

## Layout

| Path | What's there |
|---|---|
| `app/__init__.py` | Flask app factory. Four page routes and a static folder, nothing else |
| `app/routes/views.py` | Page routes; thin, renders the four templates |
| `app/static/js/store.js` | In-memory relational store — the domain model in CONTEXT.md, in code |
| `app/static/js/local-api.js` | **The API.** Twenty-two routes, all the domain logic, on the device |
| `app/static/js/persist.js` | IndexedDB mirror — loads on boot, writes behind, `settled()` |
| `app/static/sw.js` | Offline shell; served from the app's root for scope (`/rattlesnake/sw.js` live) |
| `scripts/build_static.py` | Renders the four pages into `dist/`; `--base` for a host that serves it under a path |
| `app/templates/` | `base`, `pager` (+ `_pane_home`, `_pane_progress`), `routine`, `session` |
| `app/static/css/style.css` | The whole FORGE system; the only stylesheet |
| `tests/` | pytest suite — page rendering and the build. `conftest.py` holds the fixtures |
| `tests/js/` | **The main suite.** `node --test` over the API, store, scope and worker |
| `dist/` | Build output. Generated, gitignored, never edited by hand |
| `run.py` | Dev entrypoint, binds `127.0.0.1:5001` (`HOST=0.0.0.0` for the phone) |

## Protocol

- **Never make any changes that will alter or delete any user's data after creating a new build of the app.** 
  If a modification seems like it could affect user data, you MUST stop and ask how to proceed
- **Both suites have to pass, and the JavaScript one is the important one.**
  `node --test tests/js/*.test.js` — nothing to install — covers the code
  that actually runs on the phone. `python3 -m pytest --cov=app --cov-report=term-missing` —
  currently 63 tests, 100%, and **90% coverage is the floor** — covers only page rendering and
  the build, so a green pytest run says almost nothing about the app. Fix failures and coverage
  regressions immediately; never report work as done while either is red, and never lower the
  bar to make a run pass.
- **The dev server is port 5001** — `python3 run.py`. Don't substitute another port.
  It binds loopback and runs the reloader, so template and code edits reload themselves. To
  reach it from a phone on the same wifi, `HOST=0.0.0.0 python3 run.py` — that drops the
  Werkzeug debugger console automatically, because it is a remote shell for anyone else on the
  network. `FLASK_DEBUG=0` for a quiet, non-reloading server.
- **To deploy, build the folder** — `python3 scripts/build_static.py`, then upload `dist/` to
  any static host. Check it first with `python3 -m http.server -d dist 8000`. The service worker
  is deliberately not registered on `localhost`/`127.0.0.1`, so its cache can never serve you a
  stale file mid-edit; that also means offline has to be tested from a real deployment.
- **Live, it is served from `mattankama.github.io/rattlesnake/`**, built with
  `--base /rattlesnake/` by `.github/workflows/deploy.yml`. So every link between pages goes
  through `url_for` in templates or `appUrl()` in JS: a bare `"/"` is the site root, which is
  another site. Until October 2026 the app lived at that root, and the root repository's `sw.js`,
  `index.html` and `404.html` keep installs from then working — see
  [docs/adr/0006](../docs/adr/0006-served-from-rattlesnake-path.md).
- **Mobile is the target, not an afterthought.** Every change has to hold up one-handed at
  phone width, mid-set, in bad gym light. Interactive controls stay ≥44×44px.
- **Dark-mode-only.** Light mode is deliberately unimplemented; don't add it, and don't add a
  theme toggle.

## Working in the data layer

`app/static/js/` is where the app is. Three files sit under the screens: `store.js` holds the
rows, `local-api.js` answers the twenty-two routes against them, and `persist.js` mirrors the whole
thing into IndexedDB. The screens still call `fetchJSON` exactly as they did when there was a
server; the call just never leaves the phone.

Two traps specific to this arrangement, both of which have already cost a debugging session:

- **Every JS file shares one global scope.** They ship as plain `<script>` tags, so the data
  layer is wrapped in a namespace (`RattlesnakeAPI`, `RattlesnakeStore`, `RattlesnakePersist`).
  `session.js` and `local-api.js` both wanted `updateSet`, `addSet`, `completeSession` and
  `deleteRoutine`; the screen scripts load last, so their versions won and four routes silently
  ran UI code. Nothing threw — writes just stopped. `tests/js/script-scope.test.js` loads every
  file the way a page does and will catch the next one. Never add a bare global to the data
  layer.
- **A write is not saved until `settled()` resolves.** The screens navigate on the line after a
  call returns, and a page going away takes an unfinished IndexedDB transaction with it.
  `fetchJSON` awaits persistence for anything that is not a GET; keep it that way.
