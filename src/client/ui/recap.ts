import type { Recap } from "../../shared/types";
import { api } from "../net";
import type { ClientState } from "../state";
import { attempt, el } from "./dom";

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The headline totals, always all four. */
export function recapHeadline(r: Recap): string[] {
  const t = r.totals;
  return [count(t.tasks, "task finished", "tasks finished"), count(t.tools, "tool used", "tools used"),
    `${t.xp} XP earned`, count(t.levels, "level gained", "levels gained")];
}

/** Secondary totals; zero ones are left out. */
export function recapExtras(r: Recap): string[] {
  const t = r.totals, out: string[] = [];
  if (t.compactions > 0) out.push(count(t.compactions, "compaction", "compactions"));
  if (t.sidekicks > 0) out.push(count(t.sidekicks, "sidekick", "sidekicks"));
  if (t.failures > 0) out.push(count(t.failures, "failed tool", "failed tools"));
  return out;
}

export function streakText(n: number): string | null {
  return n <= 0 ? null : count(n, "day running", "days running");
}

/** The morning toast text, or null when yesterday had no finished tasks. */
export function nudgeText(yesterday: Recap): string | null {
  const t = yesterday.totals;
  if (t.tasks === 0) return null;
  const parts = [count(t.tasks, "task", "tasks"), ...(t.levels > 0 ? [count(t.levels, "level", "levels")] : [])];
  return `Yesterday: ${parts.join(", ")}. See recap`;
}

/** Whether the morning nudge is due: not yet shown for `today`. */
export function shouldNudge(today: string, lastShown: string | null): boolean {
  return lastShown !== today;
}

/** A local calendar day as YYYY-MM-DD, `back` days before `from`. */
export function localDay(from: Date = new Date(), back = 0): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - back);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when the day has nothing at all to show: every total is zero. */
export const recapIsEmpty = (r: Recap): boolean => Object.values(r.totals).every(n => n === 0);

/** The smallest box holding every pixel with any alpha, or null when the image is blank. Used to crop the MVP sprite. */
export function spriteBounds(img: { width: number; height: number; data: ArrayLike<number> }): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const hasActivity = (t: Recap["repos"][number]): boolean => t.tasks > 0 || t.tools > 0 || t.xp > 0;

/** The recap dialog. `open(day)` shows that day (default today) and fetches it each time. */
export function mount(root: HTMLDialogElement, deps: { state: ClientState; drawSprite(canvas: HTMLCanvasElement, characterId: string): void }): { open(day?: string): void } {
  const title = el("h2", {}, "Recap");
  const prev = el("button", { type: "button", title: "Previous day" }, "◀");
  const next = el("button", { type: "button", title: "Next day" }, "▶");
  prev.setAttribute("aria-label", "Previous day");
  next.setAttribute("aria-label", "Next day");
  const dayLabel = el("span", { class: "recap-day" });
  const body = el("div", { class: "recap-body" });
  const error = el("p", { class: "error" });
  error.setAttribute("role", "alert");
  const closeBtn = el("button", { type: "button", class: "primary" }, "Close");
  root.replaceChildren(el("div", { class: "recap-card" },
    title,
    el("div", { class: "recap-nav" }, prev, dayLabel, next),
    body, error,
    el("div", { class: "actions" }, closeBtn)));
  closeBtn.addEventListener("click", () => root.close());

  let current = "";
  let token = 0;                                  // a late reply for a day the reader already left is dropped
  prev.disabled = true;
  next.disabled = true;

  function show(r: Recap): void {
    dayLabel.textContent = r.day === r.today ? `Today, ${r.day}` : r.day;
    prev.disabled = r.prevDay === null;
    next.disabled = r.nextDay === null;
    prev.dataset["day"] = r.prevDay ?? "";
    next.dataset["day"] = r.nextDay ?? "";
    if (recapIsEmpty(r)) {
      body.replaceChildren(el("p", { class: "dim" }, r.day === r.today ? "Nothing yet today" : "Nothing that day"));
      return;
    }
    const rows: (Node | null)[] = [el("ul", { class: "recap-headline" }, ...recapHeadline(r).map(t => el("li", {}, t)))];
    if (r.mvpCharacterId !== null) {
      const mvp = r.characters.find(c => c.characterId === r.mvpCharacterId);
      const cv = el("canvas", { class: "recap-sprite" });
      cv.width = 0; cv.height = 0;
      deps.drawSprite(cv, r.mvpCharacterId);
      rows.push(el("div", { class: "recap-mvp" }, el("span", { class: "dim" }, "MVP"), cv.width > 0 ? cv : null,
        el("strong", {}, mvp?.name ?? deps.state.characters.get(r.mvpCharacterId)?.name ?? "Unknown")));
    }
    const repo = r.repos[0];
    if (repo !== undefined && hasActivity(repo)) {
      rows.push(el("p", {}, el("span", { class: "dim" }, "Busiest repo "), el("strong", {}, repo.name)));
    }
    const extras = recapExtras(r);
    if (extras.length > 0) rows.push(el("p", { class: "dim" }, extras.join(" · ")));
    const streak = streakText(r.streak);
    if (streak !== null) rows.push(el("p", { class: "recap-streak" }, streak));
    body.replaceChildren(...rows.filter((x): x is Node => x !== null));
  }

  function load(day?: string): void {
    const mine = ++token;
    current = day ?? "";
    void attempt(api.recap(day).then(r => { if (mine === token) show(r); }), msg => { if (mine === token) error.textContent = msg; })
      .then(ok => { if (!ok && mine === token) body.replaceChildren(el("p", { class: "dim" }, "Could not load")); });
  }

  prev.addEventListener("click", () => { if (prev.dataset["day"]) load(prev.dataset["day"]); });
  next.addEventListener("click", () => { if (next.dataset["day"]) load(next.dataset["day"]); });
  return {
    open(day) {
      if (current !== (day ?? "") || body.childElementCount === 0) body.replaceChildren(el("p", { class: "dim" }, "Loading…"));
      load(day);
      if (!root.open) root.showModal();
    },
  };
}
