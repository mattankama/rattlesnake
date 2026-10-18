/**
 * Rattlesnake — Pager
 *
 * Home and Progress are two panes of a single document, laid side by side on one
 * track. The track follows the finger through the whole drag and snaps to the
 * nearest pane on release — direct manipulation, the way a phone's tab strip
 * behaves, rather than a flick that triggers an animation afterwards.
 *
 * That is only possible because nothing navigates. Both panes are in the DOM and
 * both have already loaded their data, so there is no request to wait on, no
 * blank frame to cover, and the content under your finger is real at every point
 * in the gesture.
 *
 * The URL is kept in step with replaceState, so a reload — or opening /progress
 * directly — lands on the pane you were looking at, without filling the history
 * stack with one entry per swipe.
 *
 * The one hard part is deciding, from the first few pixels, whether a finger is
 * swiping the track or scrolling a pane — and then holding on to that decision.
 * Both halves are spelled out where they happen, in bindDrag.
 */

const PANES = [
    { id: "pane-home", path: appUrl("/"), title: "Rattlesnake" },
    { id: "pane-progress", path: appUrl("/progress"), title: "Progress — Rattlesnake" },
];

/**
 * Controls that own the tap they sit under: their click does something, so a
 * stray one is not free.
 *
 * A drag may still start on one. The swipe has to work from anywhere the thumb
 * lands, and on Progress the two pickers cover the whole top of the pane — a
 * gesture that dies because it began 30px too high is exactly the kind of "it
 * didn't take" this pager is trying to stop having. What a control buys is a
 * longer run-up (CONTROL_SLOP) before the track will claim the gesture, which a
 * tap — even a wobbly one, thumb rolling as it lifts — never travels.
 */
const CONTROLS =
    "button, a, input, select, textarea, .custom-select, [role='combobox']";

const DECIDE_SLOP = 8;        // px of horizontal travel before the track claims a drag
const CONTROL_SLOP = 24;      // ...when the finger came down on a control
const EDGE_RESISTANCE = 0.35; // drag past the first/last pane feels like rubber
const VELOCITY_WINDOW = 120;  // ms of recent travel that counts as the flick

// How far off-axis the finger may stray and still read as horizontal.
//
// A swipe is an arc, not a line. The thumb pivots at its base, so coming back
// from Progress bows — down and right for a right hand, up and right for a left
// one — and the bow's vertical component is largest exactly where its horizontal
// component is smallest: in the first few millimetres, which is where this
// decision gets made. Demanding that dx beat dy outright threw those swipes
// away, and threw them away permanently, mid-gesture, which is the worst moment
// to do it.
//
// 0.55 is a ~61° cone around the horizontal. Note what it does as a gesture
// grows: the allowance is generous in absolute terms and strict in relative
// ones. 10px of drift is free; 300px of drift needs 165px of sideways travel to
// go with it. A scroll's dy runs away from its dx, so a scroll leaves the cone
// almost immediately and never comes back — which is what lets the cone be this
// wide at the start, where swipes actually live.
const HORIZONTAL_CONE = 0.55;

// Going further in, versus coming back. Returning is deliberately far the
// cheaper gesture — a fraction of the travel — because you leave Progress
// far more often than you enter it, usually one-handed mid-workout, and the two
// failures are not equal: an under-shot drag back strands you on a pane you were
// trying to leave, while an over-eager one only shows a chart you dismiss the
// same way.
const SNAP_DISTANCE = 0.22;      // fraction of a pane that counts as "gone"
const SNAP_VELOCITY = 0.45;      // px/ms — a fast flick commits on its own
// Barely more than the slop that claims the drag in the first place: any
// deliberate sideways movement is read as "take me back". The hard floor is
// DECIDE_SLOP — below that the track never claims the pointer, so no amount of
// lowering these two can commit a shorter gesture than that.
const SNAP_DISTANCE_BACK = 0.04;
const SNAP_VELOCITY_BACK = 0.12;

const pager = {
    el: null,
    track: null,
    index: 0,
    width: 0,
    dragging: false,
    decided: false,
    startX: 0,
    startY: 0,
    slop: DECIDE_SLOP,
    onControl: false,
    swallowClick: false,
    samples: [],
};

document.addEventListener("DOMContentLoaded", initPager);

function initPager() {
    pager.el = document.getElementById("pager");
    pager.track = document.getElementById("pager-track");
    if (!pager.el || !pager.track) return;

    pager.width = pager.el.clientWidth;
    pager.index = clampIndex(Number(window.START_PANE) || 0);
    settle(pager.index, false);

    window.addEventListener("resize", () => {
        pager.width = pager.el.clientWidth;
        // A resize is not a gesture: re-place the track, do not animate it there.
        offsetTrack(restingOffset(pager.index), false);
    });

    bindDrag();
    bindKeys();
}

function clampIndex(i) {
    return Math.max(0, Math.min(PANES.length - 1, i));
}

function restingOffset(index) {
    return -index * pager.width;
}

/**
 * Place the track. `animate` marks a settled position; live drag positions must
 * not animate, or the transform chases the finger instead of tracking it.
 */
function offsetTrack(px, animate) {
    pager.track.classList.toggle("snapping", !!animate);
    pager.track.style.transform = `translate3d(${px}px, 0, 0)`;
}

/** Move to a pane and make the rest of the page agree with it. */
function settle(index, animate) {
    pager.index = clampIndex(index);
    offsetTrack(restingOffset(pager.index), animate);

    const pane = PANES[pager.index];
    if (location.pathname !== pane.path) {
        history.replaceState({ pane: pager.index }, "", pane.path);
    }
    document.title = pane.title;

    // The pane you cannot see should not be reachable by tabbing into it.
    PANES.forEach((p, i) => {
        const el = document.getElementById(p.id);
        if (el) el.inert = i !== pager.index;
    });
}

/**
 * Remember where the finger has been lately. Release speed is measured over the
 * last VELOCITY_WINDOW of the drag, not averaged since touchdown: a swipe that
 * began with a pause, or wandered before it committed, is still a flick if it
 * left fast, and averaging is what quietly turned those into non-events.
 */
function sample(x, t) {
    const s = pager.samples;
    s.push({ x, t });
    while (s.length > 2 && t - s[1].t >= VELOCITY_WINDOW) s.shift();
}

/** px/ms across the samples still inside the window. */
function flickVelocity() {
    const s = pager.samples;
    if (s.length < 2) return 0;
    const first = s[0];
    const last = s[s.length - 1];
    const dt = last.t - first.t;
    return dt > 0 ? (last.x - first.x) / dt : 0;
}

function bindDrag() {
    const el = pager.el;

    el.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        pager.dragging = true;
        pager.decided = false;
        pager.swallowClick = false;
        pager.startX = e.clientX;
        pager.startY = e.clientY;
        pager.onControl = !!(e.target.closest && e.target.closest(CONTROLS));
        pager.slop = pager.onControl ? CONTROL_SLOP : DECIDE_SLOP;
        pager.samples = [];
        sample(e.clientX, performance.now());
    });

    el.addEventListener("pointermove", (e) => {
        if (!pager.dragging) return;
        const dx = e.clientX - pager.startX;
        const dy = e.clientY - pager.startY;
        sample(e.clientX, performance.now());

        // A gesture is horizontal, or NOT YET horizontal. There is deliberately
        // no third, "given up" state, because we are not the ones who get to
        // declare a gesture vertical: the browser is. The moment it starts
        // scrolling a pane it takes the pointer and sends a pointercancel, and
        // that is the only authority on the question that cannot be wrong.
        //
        // What we had instead was a give-up rule of our own, which fired on
        // gestures the browser was perfectly happy to let through, and fired
        // irreversibly — a swipe that bowed early was dead for the rest of the
        // stroke no matter how far it then travelled sideways, so the only way
        // out was to lift and try again. Waiting costs nothing: until the track
        // claims the pointer the pane still scrolls natively, so an undecided
        // gesture is not a stalled one.
        if (!pager.decided) {
            if (Math.abs(dx) < pager.slop) return;
            if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_CONE) return;
            pager.decided = true;
            el.setPointerCapture(e.pointerId);
        }

        offsetTrack(withResistance(restingOffset(pager.index) + dx), false);
    });

    // Once the track has the gesture, it keeps it. `touch-action: pan-y` leaves
    // the browser free to start scrolling a pane at ANY point in a touch, not
    // just at its start — and a swipe that bows hands it that opening halfway
    // through, when the finger is already 100px out. Starting a scroll cancels
    // the pointer, so the track would stop dead mid-stroke and snap back.
    // Refusing the default on every move we own closes that door.
    el.addEventListener(
        "touchmove",
        (e) => {
            if (pager.decided && e.cancelable) e.preventDefault();
        },
        { passive: false }
    );

    /**
     * @param {boolean} chose — whether the gesture got to finish on its own
     *   terms. A pointerup did. A pointercancel did not: something else took the
     *   finger, and a pane change nobody asked for is worse than a snap back to
     *   the pane they were already on.
     */
    const finish = (e, chose) => {
        if (!pager.dragging) return;
        pager.dragging = false;
        if (!pager.decided) return;
        pager.decided = false;
        // The drag is over, but a click may still be on its way. See below.
        pager.swallowClick = pager.onControl;
        if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
        }

        if (!chose) {
            settle(pager.index, true);
            return;
        }

        sample(e.clientX, performance.now());
        const dx = e.clientX - pager.startX;
        const velocity = flickVelocity();

        // Rightward travel heads back toward Home, and asks for less to commit.
        const returning = dx > 0;
        const minDistance = pager.width *
            (returning ? SNAP_DISTANCE_BACK : SNAP_DISTANCE);
        const minVelocity = returning ? SNAP_VELOCITY_BACK : SNAP_VELOCITY;

        // Either a long enough drag or a quick enough flick commits; anything
        // shorter and slower falls back to where it came from.
        const commits =
            Math.abs(dx) > minDistance || Math.abs(velocity) > minVelocity;

        let target = pager.index;
        if (commits) target += dx < 0 ? 1 : -1;
        settle(target, true);
    };

    el.addEventListener("pointerup", (e) => finish(e, true));
    el.addEventListener("pointercancel", (e) => finish(e, false));

    // A drag that started on a control can still end as a click on it, and
    // swiping away from a routine card must not start its session. A gesture the
    // track claimed was not a tap, so the click it trails is dropped — once, and
    // only for a drag that began somewhere a click would have meant something.
    el.addEventListener(
        "click",
        (e) => {
            if (!pager.swallowClick) return;
            pager.swallowClick = false;
            e.preventDefault();
            e.stopPropagation();
        },
        true
    );
}

/** Past the first or last pane the track still moves, but grudgingly. */
function withResistance(px) {
    const max = 0;
    const min = restingOffset(PANES.length - 1);
    if (px > max) return max + (px - max) * EDGE_RESISTANCE;
    if (px < min) return min + (px - min) * EDGE_RESISTANCE;
    return px;
}

/**
 * Arrow keys move between panes. There is no visible control by design, and a
 * drag needs a pointer — without this the second pane would be unreachable to
 * anyone on a keyboard.
 */
function bindKeys() {
    document.addEventListener("keydown", (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        // Arrow keys inside a control belong to it: they move between options in
        // an open picker, or along the text in a field.
        if (e.target.closest && e.target.closest(CONTROLS)) return;
        if (e.key === "ArrowRight") settle(pager.index + 1, true);
        else if (e.key === "ArrowLeft") settle(pager.index - 1, true);
    });
}
