import { CONFIG } from "../../shared/config";
import type { Notice, Settings } from "../../shared/types";
import { toastFor, visibleToasts } from "../notify";
import { el } from "./dom";

/** A stack of short in-game toasts over the stage. Each dismisses itself after CONFIG.client.toastMs; clicking one runs `onClick`. */
export function mount(root: HTMLElement): { show(n: Notice, settings: Settings, onClick: () => void): void } {
  return {
    show(n, settings, onClick) {
      const text = toastFor(n, settings);
      if (text === null) return;
      const t = el("button", { type: "button", class: `toast ${n.kind}`, title: "Show this character" }, text);   // text node, never HTML
      const remove = (): void => { clearTimeout(timer); t.remove(); };
      const timer = setTimeout(remove, CONFIG.client.toastMs);
      t.addEventListener("click", () => { onClick(); remove(); });
      root.append(t);
      const shown = visibleToasts([...root.children]);
      for (const old of [...root.children]) if (!shown.includes(old)) old.remove();
    },
  };
}
