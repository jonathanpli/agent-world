import { CONFIG } from "../../shared/config";
import type { FocusPrecision, Notice, Settings } from "../../shared/types";
import { toastFor, visibleToasts } from "../notify";
import { el, jumpTo } from "./dom";
import { jumpLabel } from "./inspector";

type Toasts = {
  /** `precision` is the session's focus precision; a needs_input toast gets a Jump button when it is set. */
  show(n: Notice, settings: Settings, onClick: () => void, precision?: FocusPrecision): void;
  /** A plain text toast (no notice behind it). */
  showText(text: string, onClick: () => void): void;
};

/** A stack of short in-game toasts over the stage. Each dismisses itself after CONFIG.client.toastMs; clicking one runs `onClick`. */
export function mount(root: HTMLElement): Toasts {
  function push(text: string, cls: string, title: string, onClick: () => void, jump?: { label: string; key: string }): void {
    let t: HTMLElement;
    const remove = (): void => { clearTimeout(timer); t.remove(); };
    const timer = setTimeout(remove, CONFIG.client.toastMs);
    if (jump === undefined) {
      t = el("button", { type: "button", class: `toast ${cls}`, title }, text);   // text node, never HTML
      t.addEventListener("click", () => { onClick(); remove(); });
    } else {
      // A button cannot hold a button: the toast is a box with the select button and the jump button side by side.
      const main = el("button", { type: "button", class: "toast-main", title }, text);
      const go = el("button", { type: "button", class: "jump" }, jump.label);
      const note = el("span", { class: "toast-note" });
      main.addEventListener("click", () => { onClick(); remove(); });
      go.addEventListener("click", () => {
        go.disabled = true;
        void jumpTo(jump.key, msg => { note.textContent = msg; }).then(() => { go.disabled = false; });
      });
      t = el("div", { class: `toast ${cls}` }, el("div", { class: "toast-row" }, main, go), note);
    }
    root.append(t);
    const shown = visibleToasts([...root.children]);
    for (const old of [...root.children]) if (!shown.includes(old)) old.remove();
  }
  return {
    show(n, settings, onClick, precision) {
      const text = toastFor(n, settings);
      if (text === null) return;
      const label = n.kind === "needs_input" && n.sessionKey !== null ? jumpLabel(precision) : null;
      push(text, n.kind, "Show this character", onClick, label === null ? undefined : { label, key: n.sessionKey! });
    },
    showText(text, onClick) { push(text, "info", "Open the recap", onClick); },
  };
}
