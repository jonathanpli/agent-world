import type { FocusPrecision, Notice, Settings } from "../../shared/types";
import { toastFor, toastRemoveAt, visibleToasts } from "../notify";
import { el, isJumping, jumpTo } from "./dom";
import { jumpButton } from "./inspector";

type Toasts = {
  /** `precision` is the session's focus precision; a needs_input toast gets a Jump button when it is set. */
  show(n: Notice, settings: Settings, onClick: () => void, precision?: FocusPrecision): void;
  /** A plain text toast (no notice behind it). */
  showText(text: string, onClick: () => void): void;
};

/**
 * A stack of short in-game toasts over the stage. Each dismisses itself after CONFIG.client.toastMs (later while its Jump
 * is pending, and until a jump's note has been up that long: `toastRemoveAt`); clicking one runs `onClick`.
 */
export function mount(root: HTMLElement): Toasts {
  function push(text: string, cls: string, title: string, onClick: () => void, jump?: { precision: FocusPrecision; key: string }): void {
    let t: HTMLElement;
    const life = { shownAt: Date.now(), jumpPending: false, noteAt: null as number | null };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remove = (): void => { clearTimeout(timer); t.remove(); };
    /** (Re)arms the self-removal for the toast's current state; a pending jump arms nothing until it settles. */
    const schedule = (): void => {
      clearTimeout(timer);
      const at = toastRemoveAt(life);
      if (at !== null) timer = setTimeout(remove, Math.max(0, at - Date.now()));
    };
    schedule();
    if (jump === undefined) {
      t = el("button", { type: "button", class: `toast ${cls}`, title }, text);   // text node, never HTML
      t.addEventListener("click", () => { onClick(); remove(); });
    } else {
      // A button cannot hold a button: the toast is a box with the select button and the jump button side by side.
      const main = el("button", { type: "button", class: "toast-main", title }, text);
      const go = el("button", { type: "button", class: "jump" });
      const draw = (): void => {
        const b = jumpButton(jump.precision, isJumping(jump.key));
        if (b === null) return;
        go.textContent = b.label;
        go.disabled = b.disabled;
      };
      draw();
      const note = el("span", { class: "toast-note" });
      main.addEventListener("click", () => { onClick(); remove(); });
      go.addEventListener("click", () => {
        if (isJumping(jump.key)) return;
        life.jumpPending = true;
        schedule();
        void jumpTo(jump.key, msg => { note.textContent = msg; if (msg !== "") life.noteAt = Date.now(); }, draw)
          .finally(() => { life.jumpPending = false; schedule(); });
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
      const jump = n.kind === "needs_input" && n.sessionKey !== null && precision !== undefined ? { precision, key: n.sessionKey } : undefined;
      push(text, n.kind, "Show this character", onClick, jump);
    },
    showText(text, onClick) { push(text, "info", "Open the recap", onClick); },
  };
}
