import { CONFIG } from "../../shared/config";
import type { Notice } from "../../shared/types";
import type { ClientState } from "../state";
import { el } from "./dom";

/** The last CONFIG.client.tickerMax texts, newest first: notices plus client-only notes, merged by time. Both lists are oldest first. */
export function tickerItems(notices: Notice[], notes: { at: number; text: string }[] = []): string[] {
  const all = [...notices, ...notes].map((x, i) => ({ at: x.at, text: x.text, i }));
  all.sort((a, b) => a.at - b.at || a.i - b.i);
  return all.slice(-CONFIG.client.tickerMax).reverse().map(x => x.text);
}

export function mount(root: HTMLElement, deps: { state: ClientState }): { render(): void } {
  return {
    render() {
      const items = tickerItems(deps.state.notices, deps.state.notes);
      root.replaceChildren(...(items.length === 0
        ? [el("span", { class: "quiet" }, "Nothing yet. Events show up here.")]
        : items.map((t, i) => el("span", { class: i === 0 ? "item newest" : "item" }, t))));
    },
  };
}
