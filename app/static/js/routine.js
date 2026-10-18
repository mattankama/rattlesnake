/**
 * Rattlesnake — Routine editor logic
 * Dynamic exercise list, autocomplete, instance management, save, delete.
 *
 * Rows are built with DOM APIs rather than interpolated HTML strings: an
 * exercise name containing an apostrophe used to break the inline handler,
 * because the attribute-escaped &#39; decoded back to ' before JS parsed it.
 */

let allExercises = [];
let exerciseIndex = 0;
let routineName = "";

document.addEventListener("DOMContentLoaded", init);

async function init() {
    try {
        allExercises = await fetchJSON("/api/exercises");
    } catch {
        allExercises = [];
    }

    document.getElementById("add-exercise-btn").addEventListener("click", () => {
        addExerciseRow();
    });

    document.getElementById("routine-form").addEventListener("submit", saveRoutine);

    // Order is read off the DOM at save time (see saveRoutine), so the drag has
    // nothing to persist of its own: moving the card *is* the edit, and Cancel
    // discards it with the rest of the form.
    RattlesnakeReorder.bind(document.getElementById("exercise-list"), {
        item: ".exercise-row",
        hold: ".exercise-row",
        // iOS owns long-press on a text input — it opens the selection
        // magnifier and the callout — and that is not a fight worth picking.
        never: "input, button, .autocomplete-list",
    });

    const deleteBtn = document.getElementById("delete-routine-btn");
    if (deleteBtn) {
        deleteBtn.addEventListener("click", showDeleteConfirm);
        document.getElementById("delete-cancel-btn")
            .addEventListener("click", hideDeleteConfirm);
        document.getElementById("delete-confirm-btn")
            .addEventListener("click", deleteRoutine);
    }

    if (window.ROUTINE_ID) {
        await loadRoutine(window.ROUTINE_ID);
    } else {
        addExerciseRow();
    }
}

async function loadRoutine(id) {
    try {
        const routine = await fetchJSON(`/api/routines/${id}`);
        routineName = routine.name;
        document.getElementById("routine-name").value = routine.name;

        const msg = document.getElementById("delete-confirm-message");
        if (msg) {
            msg.textContent = `Delete "${routine.name}"? This can't be undone.`;
        }

        for (const exercise of routine.exercises) {
            addExerciseRow(exercise.name, exercise.instances || []);
        }
    } catch (err) {
        showError(
            document.querySelector(".routine-container"),
            `Could not load this routine: ${err.message}`
        );
    }
}

// ---------------------------------------------------------------------------
// Exercise rows
// ---------------------------------------------------------------------------

function addExerciseRow(name = "", instances = []) {
    const list = document.getElementById("exercise-list");
    const idx = exerciseIndex++;

    const row = document.createElement("div");
    row.className = "exercise-row";
    row.dataset.idx = idx;

    // Header: name input + autocomplete + remove
    const header = document.createElement("div");
    header.className = "exercise-row-header";

    const wrapper = document.createElement("div");
    wrapper.className = "autocomplete-wrapper";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-input exercise-name-input";
    input.placeholder = "Exercise name";
    // Placeholders are Muted per §2, so they are decorative only; every field
    // carries its own accessible name.
    input.setAttribute("aria-label", "Exercise name");
    input.autocomplete = "off";
    input.dataset.idx = idx;
    input.value = name;

    const acList = document.createElement("div");
    acList.className = "autocomplete-list";
    acList.id = `autocomplete-${idx}`;

    wrapper.append(input, acList);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-text";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", "Remove exercise");
    removeBtn.addEventListener("click", () => row.remove());

    header.append(wrapper, removeBtn);

    // Instances, visibly nested under their exercise
    const instanceGroup = document.createElement("div");
    instanceGroup.className = "instance-group";

    const instanceLabel = document.createElement("span");
    instanceLabel.className = "field-label";
    instanceLabel.textContent = "Instances";

    const instanceList = document.createElement("div");
    instanceList.className = "instance-list";
    instanceList.id = `instances-${idx}`;

    const addInstanceBtn = document.createElement("button");
    addInstanceBtn.type = "button";
    addInstanceBtn.className = "btn btn-muted btn-small";
    addInstanceBtn.textContent = "+ Instance";
    addInstanceBtn.addEventListener("click", () => addInstanceRow(idx));

    instanceGroup.append(instanceLabel, instanceList, addInstanceBtn);
    row.append(header, instanceGroup);
    list.appendChild(row);

    for (const m of instances) {
        addInstanceRow(idx, m.name);
    }

    input.addEventListener("input", () => handleAutocomplete(input, idx));
    input.addEventListener("focus", () => handleAutocomplete(input, idx));
    input.addEventListener("blur", () => {
        // delay so a click on an autocomplete item still registers
        setTimeout(() => acList.classList.remove("show"), 200);
    });
}

function addInstanceRow(exerciseIdx, name = "") {
    const container = document.getElementById(`instances-${exerciseIdx}`);
    const row = document.createElement("div");
    row.className = "instance-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "instance-name-input";
    input.placeholder = "Instance name";
    input.setAttribute("aria-label", "Instance name");
    input.value = name;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-text";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", "Remove instance");
    removeBtn.addEventListener("click", () => row.remove());

    row.append(input, removeBtn);
    container.appendChild(row);
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

function handleAutocomplete(input, idx) {
    const query = input.value.trim().toLowerCase();
    const acList = document.getElementById(`autocomplete-${idx}`);

    if (!query) {
        acList.classList.remove("show");
        return;
    }

    const matches = allExercises.filter((e) =>
        e.name.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
        acList.classList.remove("show");
        return;
    }

    acList.innerHTML = "";
    for (const exercise of matches) {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        item.setAttribute("role", "option");
        item.textContent = exercise.name;
        // mousedown fires before blur, so the suggestion survives the blur handler
        item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            selectAutocomplete(idx, exercise.name);
        });
        acList.appendChild(item);
    }
    acList.classList.add("show");
}

function selectAutocomplete(idx, name) {
    const row = document.querySelector(`.exercise-row[data-idx="${idx}"]`);
    const input = row.querySelector(".exercise-name-input");
    input.value = name;

    document.getElementById(`autocomplete-${idx}`).classList.remove("show");

    const exercise = allExercises.find(
        (e) => e.name.toLowerCase() === name.toLowerCase()
    );
    if (exercise && exercise.instances && exercise.instances.length > 0) {
        document.getElementById(`instances-${idx}`).innerHTML = "";
        for (const m of exercise.instances) {
            addInstanceRow(idx, m.name);
        }
    }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function saveRoutine(e) {
    e.preventDefault();

    const container = document.querySelector(".routine-container");
    const nameInput = document.getElementById("routine-name");
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.focus();
        return;
    }

    const exercises = [];
    for (const row of document.querySelectorAll(".exercise-row")) {
        const exName = row.querySelector(".exercise-name-input").value.trim();
        if (!exName) continue;

        const instances = [];
        for (const mi of row.querySelectorAll(".instance-name-input")) {
            const mName = mi.value.trim();
            if (mName) instances.push({ name: mName });
        }

        exercises.push({ name: exName, instances });
    }

    const payload = { name, exercises };
    const saveBtn = document.getElementById("save-routine-btn");
    saveBtn.disabled = true;

    try {
        if (window.ROUTINE_ID) {
            await fetchJSON(`/api/routines/${window.ROUTINE_ID}`, {
                method: "PUT",
                body: JSON.stringify(payload),
            });
        } else {
            await fetchJSON("/api/routines", {
                method: "POST",
                body: JSON.stringify(payload),
            });
        }
        window.location.href = appUrl("/");
    } catch (err) {
        saveBtn.disabled = false;
        showError(container, `Could not save this routine: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// Delete — in-page confirm, never a native confirm() dialog
// ---------------------------------------------------------------------------

function showDeleteConfirm() {
    document.getElementById("delete-routine-btn").style.display = "none";
    document.getElementById("delete-confirm").style.display = "block";
    document.getElementById("delete-cancel-btn").focus();
}

function hideDeleteConfirm() {
    document.getElementById("delete-confirm").style.display = "none";
    const btn = document.getElementById("delete-routine-btn");
    btn.style.display = "";
    btn.focus();
}

async function deleteRoutine() {
    const container = document.querySelector(".routine-container");
    const btn = document.getElementById("delete-confirm-btn");
    btn.disabled = true;

    try {
        await fetchJSON(`/api/routines/${window.ROUTINE_ID}`, { method: "DELETE" });
        window.location.href = appUrl("/");
    } catch (err) {
        btn.disabled = false;
        hideDeleteConfirm();
        showError(container, `Could not delete this routine: ${err.message}`);
    }
}
