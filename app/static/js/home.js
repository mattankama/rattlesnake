/**
 * Rattlesnake — Home page logic
 * Saves abandoned workouts, fetches routines, renders the list, starts sessions.
 *
 * Each routine is a card: the name gets a full-width line of its own so it can
 * never be crushed by the action beside it, and the one ember fill on the card
 * is the action you came here to take. Deleting lives in the editor, behind a
 * confirm.
 */

document.addEventListener("DOMContentLoaded", initHome);

// Renamed from `init`: this file now shares a document with progress.js, and a
// bare `init` in both would leave one silently overwriting the other.
async function initHome() {
    // The sweep has to be the first API call on this page, with no await ahead
    // of it. progress.js's first GET queues behind the same boot promise, and
    // going first is what lets Progress draw a just-saved workout on this load.
    await saveAbandonedWorkouts();
    await loadRoutines();
}

/**
 * Complete any workout the lifter edited and then left open.
 *
 * Reaching Home usually means the session page is gone — Complete navigates
 * here, and so does relaunching the app after iOS has killed it. A failure
 * here loses nothing (the next load tries again), so it must never stand
 * between the lifter and the routine list.
 */
async function saveAbandonedWorkouts() {
    try {
        const { sessions } = await fetchJSON("/api/sessions/complete-abandoned", {
            method: "POST",
        });
        showAutoSavedNote(sessions);
    } catch (err) {
        console.warn("Could not save abandoned workouts:", err);
    }
}

/** One line per workout saved on this load; nothing at all otherwise. */
function showAutoSavedNote(sessions) {
    const note = document.getElementById("autosave-note");
    if (!note || sessions.length === 0) return;

    note.replaceChildren(
        ...sessions.map((session) => {
            const line = document.createElement("p");
            line.textContent =
                `Saved ${session.routine_name} from ${autoSavedWhen(session.completed_at)}` +
                ` — it was left unfinished.`;
            return line;
        }),
    );
    note.hidden = false;
}

/** "Oct 5, 7:42 PM", with the year only when it is not this one. */
function autoSavedWhen(iso) {
    const date = new Date(iso);
    const opts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return date.toLocaleString(undefined, opts);
}

async function loadRoutines() {
    const container = document.querySelector(".home-container");
    const list = document.getElementById("routines-list");
    const emptyState = document.getElementById("empty-state");

    try {
        const routines = await fetchJSON("/api/routines");
        clearError(container);

        if (routines.length === 0) {
            list.innerHTML = "";
            emptyState.style.display = "block";
            return;
        }

        emptyState.style.display = "none";
        list.innerHTML = routines
            .map(
                (r) => `
            <div class="routine-card" data-id="${r.id}">
                <div class="routine-card-info">
                    <div class="routine-card-name">${escapeHTML(r.name)}</div>
                    <div class="routine-card-meta">${r.exercise_count} exercise${r.exercise_count !== 1 ? "s" : ""}</div>
                </div>
                <div class="routine-card-actions">
                    <button class="btn btn-primary" data-action="start" data-id="${r.id}">Start</button>
                    <a href="${appUrl(`/routine/?id=${r.id}`)}" class="btn-text">Edit</a>
                </div>
            </div>
        `
            )
            .join("");

        list.querySelectorAll('[data-action="start"]').forEach((btn) => {
            btn.addEventListener("click", () =>
                startRoutine(Number(btn.dataset.id), btn)
            );
        });
    } catch (err) {
        list.innerHTML = "";
        emptyState.style.display = "none";
        showError(container, `Could not load routines: ${err.message}`);
    }
}

async function startRoutine(routineId, btn) {
    const container = document.querySelector(".home-container");
    if (btn) btn.disabled = true;

    try {
        const session = await fetchJSON("/api/sessions", {
            method: "POST",
            body: JSON.stringify({ routine_id: routineId }),
        });
        window.location.href = appUrl(`/session/?id=${session.id}`);
    } catch (err) {
        if (btn) btn.disabled = false;
        showError(container, `Could not start the session: ${err.message}`);
    }
}
