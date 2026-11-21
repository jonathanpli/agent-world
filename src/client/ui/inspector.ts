import { ACHIEVEMENTS } from "../../core/achievements";
import { levelForXp, repoRank, xpForLevel } from "../../core/levels";
import { CONFIG } from "../../shared/config";
import { ACCESSORIES, BODY_COLORS, HAIR_COLORS, HAIR_STYLES, HATS, SKIN_TONES, unlocked } from "../../shared/cosmetics";
import type { Character, Look, Session, Tier } from "../../shared/types";
import { safeDraw, THEMES, type Theme } from "../engine/theme";
import { api } from "../net";
import { sessionOf, unboundLabel, type ClientState } from "../state";
import { attempt, el, STATE_TEXT } from "./dom";

/** "45s", "12m", "3h 05m". Negative spans count as zero. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The level for `xp`, how far into it, and how much XP the level spans. */
export function xpProgress(xp: number): { level: number; into: number; span: number } {
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  return { level, into: xp - floor, span: xpForLevel(level + 1) - floor };
}

/** The level that unlocks the hat or accessory at `index` in its list (see `unlocked`). */
export function lockLevel(index: number): number {
  return (index + 1) * CONFIG.cosmeticEveryLevels;
}

/** Identifies one attention episode of a session: a new needs_input or task_done starts another. */
export function ackEpisode(s: Session): string {
  return `${s.key}@${s.stateSince}@${s.lastEventAt}`;
}

/**
 * Whether to acknowledge `s`: only on an explicit selection (canvas, roster or notification click) of its actor, while it
 * has attention, and once per attention episode (`lastAcked` is the episode last acked). A delta arriving while the
 * inspector is open never acks.
 */
export function shouldAck(s: Session | undefined, explicit: boolean, lastAcked: string | null): boolean {
  return explicit && s !== undefined && s.attention && ackEpisode(s) !== lastAcked;
}

/** The name a rename should send, or null to cancel: an empty or unchanged name cancels. */
export function renameTo(input: string, current: string): string | null {
  const name = input.trim();
  return name.length === 0 || name === current ? null : name;
}

type Tab = "now" | "look" | "history" | "achievements";
const TABS: { id: Tab; label: string }[] = [
  { id: "now", label: "Now" }, { id: "look", label: "Look" }, { id: "history", label: "History" }, { id: "achievements", label: "Achievements" },
];

export type InspectorDeps = {
  state: ClientState;
  selected(): string | null;
  select(id: string | null): void;
  tierTitle(t: Tier): string;
  theme(): Theme;
};

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const sameLook = (a: Look, b: Look): boolean => JSON.stringify(a) === JSON.stringify(b);

/** `render(true)` is for an explicit selection, which may acknowledge the shown session; plain `render()` never does. */
export function mount(root: HTMLElement, deps: InspectorDeps): { render(explicit?: boolean): void } {
  const { state } = deps;
  let current: string | null = null;
  let tab: Tab = "now";
  let draft: Look | null = null;               // unsaved look edits for the current character
  let confirmRetire = false;
  let renaming = false;
  let bodyKey = "";                            // what the body was last built from; rebuilt only when it changes
  let lastAcked: string | null = null;         // the attention episode last acknowledged

  const close = el("button", { type: "button", class: "close", title: "Close" }, "×");
  close.setAttribute("aria-label", "Close inspector");
  const nameBox = el("div", { class: "name-box" });
  const meta = el("div", { class: "meta" });
  const xpLine = el("div", { class: "xp-line" });
  const xpFill = el("div", { class: "xp-fill" });
  const xpBar = el("div", { class: "xp-bar" }, xpFill);
  const error = el("p", { class: "error" });
  error.setAttribute("role", "alert");
  const tabs = el("nav", { class: "tabs" }, ...TABS.map(t => el("button", { type: "button", "data-tab": t.id }, t.label)));
  const body = el("section", { class: "tab-body" });
  root.replaceChildren(el("header", { class: "insp-head" }, close, nameBox, meta, xpLine, xpBar), error, tabs, body);

  const showError = (msg: string): void => { error.textContent = msg; };
  const call = (p: Promise<unknown>): Promise<boolean> => attempt(p, showError);
  const rebuild = (): void => { bodyKey = ""; render(); };

  close.addEventListener("click", () => deps.select(null));
  tabs.addEventListener("click", e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab as Tab | undefined;
    if (t !== undefined && t !== tab) { tab = t; rebuild(); }
  });

  function resolve(): { c: Character | undefined; s: Session | undefined } | null {
    if (current === null) return null;
    const c = state.characters.get(current);
    if (c !== undefined) return c.retired ? null : { c, s: sessionOf(state, c.id) };
    const s = state.sessions.get(current);
    return s === undefined ? null : { c: undefined, s };
  }

  // ---- header ----
  function startRename(c: Character): void {
    renaming = true;
    const input = el("input", { type: "text", class: "rename" });
    input.value = c.name;
    input.maxLength = CONFIG.nameMax;
    input.setAttribute("aria-label", "Name");
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      renaming = false;
      const name = renameTo(input.value, c.name);
      if (save && name !== null) void call(api.patchCharacter(c.id, { name }));
      render();
    };
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    nameBox.replaceChildren(input);
    input.focus();
    input.select();
  }

  function renderHead(c: Character | undefined, s: Session | undefined): void {
    if (!renaming) {
      if (c === undefined) nameBox.replaceChildren(el("span", { class: "name" }, unboundLabel(s!)));
      else {
        const b = el("button", { type: "button", class: "name", title: "Click to rename" }, c.name);
        b.addEventListener("click", () => startRename(c));
        nameBox.replaceChildren(b);
      }
    }
    const tier = c?.tier ?? s!.tier;
    meta.replaceChildren(
      el("span", { class: "tier" }, deps.tierTitle(tier)),
      el("span", { class: "model", title: "Model" }, s?.model ?? "model unknown"));
    if (c === undefined) {
      xpLine.replaceChildren(el("span", { class: "dim" }, s!.tierKnown ? "Contractor: earns no XP" : "Arriving: XP is held until the model is known"));
      xpBar.hidden = true;
      return;
    }
    const p = xpProgress(c.xp);
    xpLine.replaceChildren(el("span", { class: "lv" }, `Level ${p.level}`), el("span", { class: "dim" }, `${p.into} / ${p.span} XP`));
    xpBar.hidden = false;
    xpFill.style.width = `${Math.min(100, (p.into / Math.max(1, p.span)) * 100)}%`;
  }

  // ---- tabs ----
  const row = (label: string, ...value: (Node | string)[]): HTMLElement[] => [el("dt", {}, label), el("dd", {}, ...value)];
  const since = (at: number): HTMLElement => el("span", { "data-since": String(at) }, formatDuration(Date.now() - at));

  function nowTab(c: Character | undefined, s: Session | undefined): Node[] {
    if (s === undefined) {
      return [el("dl", {}, ...row("State", "off duty"), ...row("Last active", since(c!.lastActiveAt), " ago"))];
    }
    const repo = state.repos.get(s.repoId);
    const where: (Node | string)[] = [repo?.name ?? "unknown repo"];
    if (c !== undefined) where.push(el("span", { class: "dim" }, ` · ${repoRank(c.repoXp[s.repoId] ?? 0)}`));
    const activity = [...s.activity].reverse();
    return [
      el("dl", {},
        ...row("State", STATE_TEXT[s.state], el("span", { class: "dim" }, " for "), since(s.stateSince)),
        ...row("Repo", ...where),
        ...row("Effort", s.effort ?? "unknown"),
        ...row("Task", s.task ?? "none yet"),
        ...row("Last", s.lastSummary ?? "nothing yet"),
        ...row("Session", since(s.startedAt))),
      el("h3", {}, "Activity"),
      activity.length === 0
        ? el("p", { class: "dim" }, "No activity yet.")
        : el("ol", { class: "activity" }, ...activity.map(a => el("li", {}, el("time", {}, clock(a.at)), el("span", {}, a.text)))),
    ];
  }

  function preview(c: Character, look: Look): HTMLCanvasElement {
    const cv = el("canvas", { class: "preview" });
    cv.width = 32; cv.height = 40;
    cv.style.width = `${cv.width * CONFIG.client.previewScale}px`;
    cv.style.height = `${cv.height * CONFIG.client.previewScale}px`;
    const ctx = cv.getContext("2d");
    if (ctx !== null) {
      ctx.imageSmoothingEnabled = false;
      safeDraw(deps.theme(), THEMES[0]!, t => t.drawCharacter(ctx, { x: 16, y: 36 }, look, c.tier, "off_duty", "medium", 0, 1, false), ctx);
    }
    return cv;
  }

  function lookTab(c: Character): Node[] {
    const look = draft ?? c.look;
    const level = levelForXp(c.xp);
    const u = unlocked(level);
    const pick = (field: keyof Look, value: string, label: string, opts: { color?: string; locked?: number } = {}): HTMLButtonElement => {
      const b = el("button", { type: "button", class: opts.color === undefined ? "opt" : "opt swatch", "data-field": field, "data-value": value }, opts.color === undefined ? label : "");
      if (opts.color !== undefined) { b.style.background = opts.color; b.title = label; b.setAttribute("aria-label", label); }
      const cur = look[field] === null ? "" : String(look[field]);
      b.setAttribute("aria-pressed", String(cur === value));
      if (opts.locked !== undefined) {
        b.disabled = true;
        b.title = `Unlocks at level ${opts.locked}`;
        b.append(el("small", {}, ` Lv ${opts.locked}`));
      }
      return b;
    };
    const group = (title: string, ...buttons: HTMLElement[]): HTMLElement => el("fieldset", {}, el("legend", {}, title), ...buttons);
    const items = (field: "hat" | "accessory", list: string[], open: string[]): HTMLElement[] => [
      pick(field, "", "none"),
      ...list.map((x, i) => pick(field, x, x, open.includes(x) ? {} : { locked: lockLevel(i) })),
    ];
    const dirty = !sameLook(look, c.look);
    const save = el("button", { type: "button", class: "primary", "data-action": "save" }, "Save");
    save.disabled = !dirty;
    const reset = el("button", { type: "button", "data-action": "reset" }, "Reset");
    reset.disabled = !dirty;
    const retire = confirmRetire
      ? el("div", { class: "confirm" }, `Retire ${c.name}? They leave the world for good.`,
        el("button", { type: "button", class: "danger", "data-action": "retire-yes" }, "Retire"),
        el("button", { type: "button", "data-action": "retire-no" }, "Keep"))
      : el("button", { type: "button", class: "danger", "data-action": "retire" }, "Retire…");
    return [
      el("div", { class: "preview-box" }, preview(c, look)),
      group("Body", ...BODY_COLORS.map((x, i) => pick("body", x, `colour ${i + 1}`, { color: x }))),
      group("Skin", ...SKIN_TONES.map((x, i) => pick("skin", x, `tone ${i + 1}`, { color: x }))),
      group("Hair", ...Array.from({ length: HAIR_STYLES }, (_, i) => pick("hairStyle", String(i), String(i + 1)))),
      group("Hair colour", ...HAIR_COLORS.map((x, i) => pick("hairColor", x, `colour ${i + 1}`, { color: x }))),
      group("Hat", ...items("hat", HATS, u.hats)),
      group("Accessory", ...items("accessory", ACCESSORIES, u.accessories)),
      el("div", { class: "actions" }, save, reset),
      el("div", { class: "actions retire" }, retire),
    ];
  }

  body.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const found = resolve();
    const c = found?.c;
    if (c === undefined) return;
    const opt = t.closest<HTMLButtonElement>("[data-field]");
    if (opt !== null && !opt.disabled) {
      const field = opt.dataset.field as keyof Look;
      const raw = opt.dataset.value!;
      const value = field === "hairStyle" ? Number(raw) : (field === "hat" || field === "accessory") && raw === "" ? null : raw;
      draft = { ...(draft ?? c.look), [field]: value } as Look;
      rebuild();
      return;
    }
    switch (t.closest<HTMLElement>("[data-action]")?.dataset.action) {
      case "save":
        if (draft !== null) {
          const look = draft;
          void call(api.patchCharacter(c.id, { look })).then(ok => { if (ok && current === c.id) { draft = null; rebuild(); } });
        }
        break;
      case "reset": draft = null; rebuild(); break;
      case "retire": confirmRetire = true; rebuild(); break;
      case "retire-no": confirmRetire = false; rebuild(); break;
      case "retire-yes": confirmRetire = false; void call(api.patchCharacter(c.id, { retired: true })); rebuild(); break;
    }
  });

  function historyTab(c: Character): Node[] {
    const repos = Object.entries(c.repoXp).sort((a, b) => b[1] - a[1]);
    return [
      repos.length === 0
        ? el("p", { class: "dim" }, "No repos yet.")
        : el("table", { class: "history" },
          el("thead", {}, el("tr", {}, el("th", {}, "Repo"), el("th", {}, "XP"), el("th", {}, "Rank"))),
          el("tbody", {}, ...repos.map(([id, xp]) => el("tr", {},
            el("td", {}, state.repos.get(id)?.name ?? "unknown repo"), el("td", { class: "num" }, String(xp)), el("td", {}, repoRank(xp)))))),
      el("h3", {}, "Stats"),
      el("dl", {},
        ...row("Total XP", String(c.xp)),
        ...row("Tasks", String(c.stats.tasks)),
        ...row("Tools", String(c.stats.tools)),
        ...row("Joined", new Date(c.createdAt).toLocaleDateString())),
    ];
  }

  function achievementsTab(c: Character): Node[] {
    return [el("ul", { class: "achievements" }, ...ACHIEVEMENTS.map(a => {
      const at = c.achievements[a.id];
      return el("li", { class: at === undefined ? "locked" : "earned" },
        el("span", { class: "a-title" }, a.title),
        el("span", { class: "a-desc" }, a.description),
        at === undefined ? null : el("time", {}, new Date(at).toLocaleDateString()));
    }))];
  }

  // ---- render ----
  function open(id: string): void {
    current = id;
    tab = "now";
    draft = null;
    confirmRetire = false;
    renaming = false;
    bodyKey = "";
    showError("");
  }

  function render(explicit = false): void {
    const id = deps.selected();
    if (id !== current && id !== null) open(id);
    current = id;
    const found = resolve();
    if (found === null) { root.hidden = true; return; }
    if (shouldAck(found.s, explicit, lastAcked)) {
      lastAcked = ackEpisode(found.s!);
      void call(api.ack(found.s!.key));
    }
    root.hidden = false;
    const { c, s } = found;
    if (c === undefined) tab = "now";
    tabs.hidden = c === undefined;
    for (const b of tabs.querySelectorAll<HTMLElement>("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    renderHead(c, s);

    const key = JSON.stringify([tab, c, tab === "now" ? s : null, draft, confirmRetire, tab === "now" || tab === "history" ? [...state.repos.keys()] : null]);
    if (key === bodyKey) return;
    bodyKey = key;
    body.replaceChildren(...(tab === "now" ? nowTab(c, s) : tab === "look" ? lookTab(c!) : tab === "history" ? historyTab(c!) : achievementsTab(c!)));
  }

  // durations tick without rebuilding the panel
  setInterval(() => {
    if (root.hidden) return;
    for (const e of root.querySelectorAll<HTMLElement>("[data-since]")) e.textContent = formatDuration(Date.now() - Number(e.dataset.since));
  }, CONFIG.client.clockMs);

  return { render };
}
