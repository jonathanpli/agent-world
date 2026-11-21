import { levelForXp } from "../../core/levels";
import type { CharState, ContextInfo, Tier } from "../../shared/types";
import { unboundLabel, type ClientState } from "../state";
import { contextLevel, contextPct } from "./inspector";
import { el, STATE_ICON, STATE_TEXT } from "./dom";

/** `tier` is null for an arrival still waiting for its tier. */
export type RosterRow = { id: string; name: string; tier: Tier | null; level: number | null; state: CharState; attention: boolean; temp: boolean; context: { pct: number; level: "calm" | "warm" | "hot" } | null };

const contextOf = (c: ContextInfo | null, warnPct: number): RosterRow["context"] =>
  c === null ? null : { pct: contextPct(c), level: contextLevel(c, warnPct) };

const rank = (r: RosterRow): number => (r.attention ? 0 : r.state !== "off_duty" ? 1 : 2);

/**
 * One row per non-retired character, plus one per unbound session (a temp, or an arrival waiting for its tier).
 * Ids are actor ids: the character id, or the session key for an unbound session. Sorted attention first, then live,
 * then off duty; within a group characters come before unbound sessions, then by name.
 */
export function rosterRows(s: ClientState): RosterRow[] {
  const rows: RosterRow[] = [];
  const live = new Map<string, { state: CharState; attention: boolean; tier: Tier; context: ContextInfo | null }>();
  for (const x of s.sessions.values()) {
    if (x.characterId !== null) { live.set(x.characterId, x); continue; }
    rows.push({ id: x.key, name: unboundLabel(x), tier: x.tierKnown ? x.tier : null, level: null, state: x.state, attention: x.attention, temp: true, context: contextOf(x.context, s.settings.contextWarnPct) });
  }
  for (const c of s.characters.values()) {
    if (c.retired) continue;
    const x = live.get(c.id);
    rows.push({ id: c.id, name: c.name, tier: c.tier, level: levelForXp(c.xp), state: x?.state ?? "off_duty", attention: x?.attention ?? false, temp: false, context: contextOf(x?.context ?? null, s.settings.contextWarnPct) });
  }
  return rows.sort((a, b) =>
    rank(a) - rank(b) || Number(a.temp) - Number(b.temp) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What the rendered rows show; the list is rebuilt only when this changes, so a click is not lost to a rebuild. */
export function rosterKey(rows: RosterRow[], selected: string | null, tierTitle: (t: Tier) => string): string {
  return JSON.stringify([selected, rows.map(r => [r.id, r.name, r.tier === null ? null : tierTitle(r.tier), r.level, r.state, r.attention, r.context?.pct ?? null, r.context?.level ?? null])]);
}

/** The row's sub-line: "Senior · working", or just the state for an arrival, which has no tier title yet. */
export function rosterSub(r: RosterRow, tierTitle: (t: Tier) => string): string {
  return r.tier === null ? STATE_TEXT[r.state] : `${tierTitle(r.tier)} · ${STATE_TEXT[r.state]}`;
}

function contextBar(c: NonNullable<RosterRow["context"]>): HTMLElement {
  const fill = el("span", { class: "ctx-fill" });
  fill.style.width = `${c.pct}%`;
  const bar = el("span", { class: `ctx ctx-${c.level}`, title: `Context ${c.pct}% full` }, fill);
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `Context ${c.pct}% full`);
  return bar;
}

export type RosterDeps = { state: ClientState; selected(): string | null; select(id: string): void; tierTitle(t: Tier): string };

export function mount(root: HTMLElement, deps: RosterDeps): { render(): void } {
  const list = el("ul", { class: "roster-list" });
  root.replaceChildren(el("h2", {}, "Roster"), list);
  list.addEventListener("click", e => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (row !== null) deps.select(row.dataset.id!);
  });

  let shown = "";
  return {
    render() {
      const sel = deps.selected();
      const rows = rosterRows(deps.state);
      const key = rosterKey(rows, sel, deps.tierTitle);
      if (key === shown) return;
      shown = key;
      list.replaceChildren(...rows.map(r => {
        const button = el("button", { type: "button", class: `row state-${r.state}${r.attention ? " attention" : ""}`, "data-id": r.id },
          el("span", { class: "icon", title: STATE_TEXT[r.state] }, r.attention ? (r.state === "done" ? "✓" : "!") : STATE_ICON[r.state]),
          el("span", { class: "who" },
            el("span", { class: "name" }, r.name),
            el("span", { class: "sub" }, rosterSub(r, deps.tierTitle)),
            r.context === null ? null : contextBar(r.context)),
          r.level === null ? null : el("span", { class: "lv" }, `L${r.level}`));
        if (r.id === sel) button.setAttribute("aria-current", "true");
        return el("li", {}, button);
      }));
    },
  };
}
