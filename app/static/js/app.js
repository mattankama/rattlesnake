/**
 * Rattlesnake — Shared utilities
 * Dark-mode-only — no theme switching needed.
 */

/**
 * The path the app is served under: "" in dev, "/rattlesnake" on GitHub Pages.
 * base.html writes it onto <html data-base>, from whatever the build was given.
 */
const APP_BASE = document.documentElement.dataset.base || "";

/**
 * A page of this app, by its dev path ("/", "/session/?id=4"), as the browser
 * needs it. Every link and redirect between pages goes through here. fetchJSON's
 * "/api/..." routes do not: they never leave the phone, so they have no host path.
 *
 * @param {string} path
 * @returns {string}
 */
function appUrl(path) {
    return APP_BASE + path;
}

/**
 * The store, loaded from IndexedDB. Every screen waits on this before its first
 * call, so nothing can read an empty database while the rows are still arriving.
 */
const appReady = RattlesnakePersist.boot(
    RattlesnakeStore.createStore,
    RattlesnakeStore.TABLES,
    showStorageWarning,
).then((result) => {
    if (!result.durable) showStorageWarning();
    return result;
});

/**
 * Call the API. The API is on this phone — see local-api.js — but the shape of
 * this function is still fetch's, because that is what every screen was written
 * against and there is nothing to gain by rewriting eighteen call sites.
 *
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<any>}
 */
async function fetchJSON(url, options = {}) {
    const storage = await appReady;

    const method = (options.method || "GET").toUpperCase();
    let body = {};
    if (options.body) {
        try {
            body = JSON.parse(options.body);
        } catch (err) {
            throw new Error("Could not read request body");
        }
    }

    const { status, body: payload } = RattlesnakeAPI.handleRequest(storage.store, method, url, body);

    // Wait for the write to land before answering. Saving a routine sets
    // location.href on the very next line, and a page that goes away takes any
    // unfinished IndexedDB transaction with it — so resolving early here is a
    // lost workout. An HTTP call gave this guarantee by accident; this is it
    // said out loud.
    if (method !== "GET") {
        await storage.settled();
    }

    if (status === 204) {
        return null;
    }
    if (status >= 400) {
        throw new Error((payload && payload.error) || `Request failed: ${status}`);
    }
    return payload;
}

/**
 * Say so, once, when nothing can be saved.
 *
 * This is the one failure the lifter has to hear about immediately: the app
 * looks completely normal with storage blocked, right up until the session is
 * gone. Usually it means a private window.
 */
function showStorageWarning() {
    if (document.getElementById("storage-warning")) return;

    const banner = document.createElement("div");
    banner.id = "storage-warning";
    banner.className = "storage-warning";
    banner.setAttribute("role", "alert");
    banner.textContent =
        "This browser is not letting Rattlesnake save. Your workout will be lost when you close the tab.";

    const mount = () => document.body.prepend(banner);
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);
}

/**
 * Escape a string for safe insertion as HTML text content.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
}

/**
 * Surface a failure the user can actually see. A silent console.error looks
 * identical to "nothing happened" (§1).
 * @param {HTMLElement} container — element to prepend the message to
 * @param {string} message
 */
function showError(container, message) {
    if (!container) return;
    clearError(container);
    const box = document.createElement("div");
    box.className = "inline-error";
    box.setAttribute("role", "alert");
    box.textContent = message;
    container.prepend(box);
}

/**
 * Remove any error message previously shown in this container.
 * @param {HTMLElement} container
 */
function clearError(container) {
    if (!container) return;
    const existing = container.querySelector(":scope > .inline-error");
    if (existing) existing.remove();
}

/**
 * Custom dropdown component — replaces native <select> (§10 checklist).
 * Usage:
 *   const dropdown = new CustomSelect(container, {
 *       placeholder: 'Select instance',
 *       options: [{ value: '1', label: 'Cybex' }, ...],
 *       selectedValue: '1',
 *       onChange: (value) => { ... },
 *   });
 */
class CustomSelect {
    /**
     * @param {HTMLElement} container — the wrapper element to mount into
     * @param {Object} config
     * @param {string} config.placeholder
     * @param {Array<{value: string, label: string, isAction?: boolean}>} config.options
     * @param {string} [config.selectedValue]
     * @param {string} [config.id] — unique id for the component
     * @param {function(string): void} config.onChange
     */
    constructor(container, config) {
        this.container = container;
        this.config = config;
        this.isOpen = false;
        this.selectedValue = config.selectedValue || "";
        this.options = config.options || [];
        this.activeIndex = -1;
        this.uid = config.id || `cs-${CustomSelect._seq++}`;
        this.render();
        CustomSelect._register(this);
    }

    render() {
        this.container.innerHTML = "";
        this.container.classList.add("custom-select");
        if (this.config.id) {
            this.container.id = this.config.id;
        }

        const listboxId = `${this.uid}-listbox`;

        // Trigger
        const trigger = document.createElement("div");
        trigger.className = "custom-select-trigger";
        trigger.setAttribute("role", "combobox");
        trigger.setAttribute("tabindex", "0");
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-controls", listboxId);

        const labelSpan = document.createElement("span");
        labelSpan.className = "label";
        trigger.appendChild(labelSpan);

        const arrow = document.createElement("span");
        arrow.className = "arrow";
        trigger.appendChild(arrow);

        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            this.toggle();
        });
        trigger.addEventListener("keydown", (e) => this._onKeyDown(e));

        this.triggerEl = trigger;
        this.labelEl = labelSpan;

        // Options panel
        const optionsPanel = document.createElement("div");
        optionsPanel.className = "custom-select-options";
        optionsPanel.setAttribute("role", "listbox");
        optionsPanel.id = listboxId;

        this.options.forEach((opt, i) => {
            const item = document.createElement("div");
            item.className = "custom-select-option";
            item.setAttribute("role", "option");
            item.id = `${this.uid}-opt-${i}`;
            if (opt.isAction) {
                item.classList.add("action-option");
            }
            const isSelected = opt.value === this.selectedValue && !opt.isAction;
            item.classList.toggle("selected", isSelected);
            item.setAttribute("aria-selected", String(isSelected));
            item.textContent = opt.label;
            item.dataset.value = opt.value;

            item.addEventListener("click", (e) => {
                e.stopPropagation();
                this.select(opt.value);
            });
            item.addEventListener("mousemove", () => this._setActive(i));

            optionsPanel.appendChild(item);
        });

        this.optionsPanelEl = optionsPanel;

        this.container.appendChild(trigger);
        this.container.appendChild(optionsPanel);

        this._syncLabel();
    }

    _syncLabel() {
        const selected = this.options.find(
            (o) => o.value === this.selectedValue && !o.isAction
        );
        if (selected) {
            this.labelEl.textContent = selected.label;
            this.labelEl.className = "label";
        } else {
            this.labelEl.textContent = this.config.placeholder || "Select...";
            this.labelEl.className = "label placeholder";
        }
    }

    _optionEls() {
        return Array.from(
            this.optionsPanelEl.querySelectorAll(".custom-select-option")
        );
    }

    _setActive(index) {
        const els = this._optionEls();
        if (!els.length) return;
        this.activeIndex = (index + els.length) % els.length;
        els.forEach((el, i) => el.classList.toggle("active", i === this.activeIndex));
        const active = els[this.activeIndex];
        if (active) {
            this.triggerEl.setAttribute("aria-activedescendant", active.id);
            active.scrollIntoView({ block: "nearest" });
        }
    }

    _onKeyDown(e) {
        switch (e.key) {
            case "Enter":
            case " ":
                e.preventDefault();
                if (this.isOpen && this.activeIndex >= 0) {
                    this.select(this.options[this.activeIndex].value);
                } else {
                    this.toggle();
                }
                break;
            case "ArrowDown":
                e.preventDefault();
                if (!this.isOpen) {
                    this.open();
                    this._setActive(0);
                } else {
                    this._setActive(this.activeIndex + 1);
                }
                break;
            case "ArrowUp":
                e.preventDefault();
                if (!this.isOpen) {
                    this.open();
                    this._setActive(this.options.length - 1);
                } else {
                    this._setActive(this.activeIndex - 1);
                }
                break;
            case "Home":
                if (this.isOpen) {
                    e.preventDefault();
                    this._setActive(0);
                }
                break;
            case "End":
                if (this.isOpen) {
                    e.preventDefault();
                    this._setActive(this.options.length - 1);
                }
                break;
            case "Escape":
                if (this.isOpen) {
                    e.preventDefault();
                    this.close();
                }
                break;
            case "Tab":
                this.close();
                break;
            default:
                break;
        }
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        CustomSelect._closeAllExcept(this);
        this.isOpen = true;
        this.container.classList.add("open");
        this.triggerEl.setAttribute("aria-expanded", "true");
        const current = this.options.findIndex(
            (o) => o.value === this.selectedValue && !o.isAction
        );
        this._setActive(current >= 0 ? current : 0);
    }

    close() {
        this.isOpen = false;
        this.activeIndex = -1;
        this.container.classList.remove("open");
        this.triggerEl.setAttribute("aria-expanded", "false");
        this.triggerEl.removeAttribute("aria-activedescendant");
        this._optionEls().forEach((el) => el.classList.remove("active"));
    }

    select(value) {
        this.selectedValue = value;
        this.close();
        this._syncLabel();

        this._optionEls().forEach((el) => {
            const isSelected =
                el.dataset.value === value &&
                !el.classList.contains("action-option");
            el.classList.toggle("selected", isSelected);
            el.setAttribute("aria-selected", String(isSelected));
        });

        if (this.config.onChange) {
            this.config.onChange(value);
        }
    }

    /** Set value without triggering onChange */
    setValue(value) {
        this.selectedValue = value;
        this._syncLabel();
        this._optionEls().forEach((el) => {
            const isSelected =
                el.dataset.value === value &&
                !el.classList.contains("action-option");
            el.classList.toggle("selected", isSelected);
            el.setAttribute("aria-selected", String(isSelected));
        });
    }

    /** Add a new option before any trailing action item */
    addOption(value, label) {
        const newOpt = { value, label };
        const actionIdx = this.options.findIndex((o) => o.isAction);
        if (actionIdx >= 0) {
            this.options.splice(actionIdx, 0, newOpt);
        } else {
            this.options.push(newOpt);
        }
        this.render();
    }

    /** Focus the trigger (used after inline instance creation) */
    focus() {
        this.triggerEl.focus();
    }

    /**
     * Detach this dropdown. A container that gets re-rendered leaves its old
     * instance in the registry holding a detached `labelEl`, so it keeps being
     * iterated by the shared click handler and still answers to setValue() —
     * updating nothing the user can see. Anything that remounts a dropdown into
     * a container it has used before must destroy the previous one.
     */
    destroy() {
        this.close();
        CustomSelect._unregister(this);
    }

    // -- instance registry: one document listener for all dropdowns, not one each --

    static _unregister(instance) {
        const i = CustomSelect._instances.indexOf(instance);
        if (i >= 0) {
            CustomSelect._instances.splice(i, 1);
        }
    }

    static _register(instance) {
        CustomSelect._instances.push(instance);
        if (!CustomSelect._listenerBound) {
            document.addEventListener("click", () => {
                CustomSelect._closeAllExcept(null);
            });
            CustomSelect._listenerBound = true;
        }
    }

    static _closeAllExcept(keep) {
        for (const inst of CustomSelect._instances) {
            if (inst !== keep && inst.isOpen) {
                inst.close();
            }
        }
    }
}

CustomSelect._instances = [];
CustomSelect._listenerBound = false;
CustomSelect._seq = 0;

