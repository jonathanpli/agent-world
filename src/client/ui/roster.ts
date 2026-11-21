import { levelForXp } from "../../core/levels";
import type { CharState, Tier } from "../../shared/types";
import type { ClientState } from "../state";
import { el, STATE_ICON, STATE_TEXT } from "./dom";

export type RosterRow = { id: string; name: string; tier: Tier; level: number | null; state: CharState; attention: boolean; temp: boolean };

const rank = (r: RosterRow): number => (r.attention ? 0 : r.state !== "off_duty" ? 1 : 2);

/**
 * One row per non-retired character, plus one per temp session; ids are actor ids (character id, or session key for
 * a temp). Sorted attention first, then live, then off duty; within a group characters come before temps, then by name.
 */
export function rosterRows(s: ClientState): RosterRow[] {
  const rows: RosterRow[] = [];
  const live = new Map<string, { state: CharState; attention: boolean; tier: Tier }>();
  for (const x of s.sessions.values()) {
    if (x.characterId !== null) { live.set(x.characterId, x); continue; }
    rows.push({ id: x.key, name: "Temp", tier: x.tier, level: null, state: x.state, attention: x.attention, temp: true });
  }
  for (const c of s.characters.values()) {
    if (c.retired) continue;
    const x = live.get(c.id);
    rows.push({ id: c.id, name: c.name, tier: c.tier, level: levelForXp(c.xp), state: x?.state ?? "off_duty", attention: x?.attention ?? false, temp: false });
  }
  return rows.sort((a, b) =>
    rank(a) - rank(b) || Number(a.temp) - Number(b.temp) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type RosterDeps = { state: ClientState; selected(): string | null; select(id: string): void; tierTitle(t: Tier): string };

export function mount(root: HTMLElement, deps: RosterDeps): { render(): void } {
  const list = el("ul", { class: "roster-list" });
  root.replaceChildren(el("h2", {}, "Roster"), list);
  list.addEventListener("click", e => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (row !== null) deps.select(row.dataset.id!);
  });

  return {
    render() {
      const sel = deps.selected();
      list.replaceChildren(...rosterRows(deps.state).map(r => {
        const button = el("button", { type: "button", class: `row state-${r.state}${r.attention ? " attention" : ""}`, "data-id": r.id },
          el("span", { class: "icon", title: STATE_TEXT[r.state] }, r.attention ? (r.state === "done" ? "✓" : "!") : STATE_ICON[r.state]),
          el("span", { class: "who" },
            el("span", { class: "name" }, r.name),
            el("span", { class: "sub" }, `${deps.tierTitle(r.tier)} · ${STATE_TEXT[r.state]}`)),
          r.level === null ? null : el("span", { class: "lv" }, `L${r.level}`));
        if (r.id === sel) button.setAttribute("aria-current", "true");
        return el("li", {}, button);
      }));
    },
  };
}
