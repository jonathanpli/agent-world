import { CONFIG } from "../../shared/config";
import type { Notice, Settings } from "../../shared/types";
import { toastFor, visibleToasts } from "../notify";
import { el } from "./dom";

type Toasts = {
  show(n: Notice, settings: Settings, onClick: () => void): void;
  /** A plain text toast (no notice behind it). */
  showText(text: string, onClick: () => void): void;
};

/** A stack of short in-game toasts over the stage. Each dismisses itself after CONFIG.client.toastMs; clicking one runs `onClick`. */
export function mount(root: HTMLElement): Toasts {
  function push(text: string, cls: string, title: string, onClick: () => void): void {
    const t = el("button", { type: "button", class: `toast ${cls}`, title }, text);   // text node, never HTML
    const remove = (): void => { clearTimeout(timer); t.remove(); };
    const timer = setTimeout(remove, CONFIG.client.toastMs);
    t.addEventListener("click", () => { onClick(); remove(); });
    root.append(t);
    const shown = visibleToasts([...root.children]);
    for (const old of [...root.children]) if (!shown.includes(old)) old.remove();
  }
  return {
    show(n, settings, onClick) {
      const text = toastFor(n, settings);
      if (text !== null) push(text, n.kind, "Show this character", onClick);
    },
    showText(text, onClick) { push(text, "info", "Open the recap", onClick); },
  };
}
