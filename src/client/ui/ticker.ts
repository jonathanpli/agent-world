import { CONFIG } from "../../shared/config";
import type { Notice } from "../../shared/types";
import type { ClientState } from "../state";
import { el } from "./dom";

/** The last CONFIG.client.tickerMax notice texts, newest first. `notices` is oldest first. */
export function tickerItems(notices: Notice[]): string[] {
  return notices.slice(-CONFIG.client.tickerMax).reverse().map(n => n.text);
}

export function mount(root: HTMLElement, deps: { state: ClientState }): { render(): void } {
  return {
    render() {
      const items = tickerItems(deps.state.notices);
      root.replaceChildren(...(items.length === 0
        ? [el("span", { class: "quiet" }, "Nothing yet. Events show up here.")]
        : items.map((t, i) => el("span", { class: i === 0 ? "item newest" : "item" }, t))));
    },
  };
}
