# 0006 — Served from /rattlesnake/, with the site root guarding installs from before the move

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

GitHub Pages serves `mattankama.github.io/` only from a repository named
`mattankama.github.io`, and Rattlesnake lived in it. To give Rattlesnake its own repository and
put a home page for several apps at the root, that repository was renamed `rattlesnake`, which
Pages serves at `/rattlesnake/`. The origin does not change, so IndexedDB, where the workouts
are, carries over untouched. Three things installed before the move still point at the root:

- **The old offline worker**, at `/sw.js` and scoped to the whole origin. It is cache-first, so
  left alone it keeps serving the old app at the old URLs alongside the new one, both writing one
  database.
- **Home Screen icons**, whose `start_url` is `/`. On iOS each Home Screen app has its own
  storage, so that icon is the only way back to the lifter's workouts. Deleting it deletes them,
  and adding Rattlesnake again starts empty.
- **Bookmarks** to `/progress`, `/routine/` and `/session/`.

## Decision

**The app builds for a path.** `build_static.py --base /rattlesnake/` renders the pages with that
script root: `url_for` includes it, and `<html data-base>` hands it to `appUrl()`, which every
link and redirect in the JS goes through. The worker and the manifest work it out from their own
URLs. The default is still `/`, so a build for any other host is unchanged.

**The worker only touches its own caches.** Several sites share this origin, and Cache Storage
is per origin. The cache is named for the app's path (`rattlesnake:/rattlesnake/:<token>`),
activate deletes only this app's old ones, and lookups read only this app's cache. Caches from
before the move (`rattlesnake-<token>`) are deleted only by a worker at the root.

**The root site guards the old installs**, in three files in the `mattankama.github.io`
repository that must stay:

- `sw.js` is the update the old worker finds at its own URL. It deletes the old offline copy
  (Cache Storage only, never IndexedDB) and keeps `/` available offline.
- `index.html` sends a standalone launch, which is an old Home Screen icon, straight to
  `/rattlesnake/`, inside the same installed app and its storage.
- `404.html` forwards the old page URLs, query string and all.

## Consequences

- Nothing in the move writes to or deletes from IndexedDB. The cutover was rehearsed in Chromium
  with a workout saved by the old build: offline before the update, online after it, from a
  standalone launch, and offline after it. Every path reached the same workout.
- Anyone with an iOS Home Screen icon from before the move has to keep it. The README says so.
- The root `sw.js` has to stay for as long as anyone might open an install from before the move.

## Alternatives considered

- **Leave Rattlesnake at the root.** No migration at all, but the root could not be a home page
  for the other apps.
- **Have the root `sw.js` just unregister itself.** Simpler, but an old Home Screen icon would
  then have nothing to open with no signal, which is the gym.
