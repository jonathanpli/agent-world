import { startEngine } from "./engine/loop";
import { CONFIG } from "../shared/config";
import { getTheme, safeDraw, THEMES } from "./engine/theme";
import { api, connect } from "./net";
import { attentionCount, deliver, tabTitle } from "./notify";
import { applyDeltas, applySnapshot, emptyState } from "./state";
import { mount as mountInspector } from "./ui/inspector";
import { localDay, mount as mountRecap, nudgeText, shouldNudge } from "./ui/recap";
import { mount as mountRoster } from "./ui/roster";
import { mount as mountSettings } from "./ui/settings";
import { mount as mountTicker } from "./ui/ticker";
import { mount as mountToasts } from "./ui/toasts";
import type { Tier } from "../shared/types";

const state = emptyState();
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("world");
const themeSelect = $<HTMLSelectElement>("theme");
const reconnecting = $("reconnecting");
const demoBadge = $("demo");
const attention = $("attention");
const inspectorRoot = $("inspector");
const settingsDialog = $<HTMLDialogElement>("settings");
const recapDialog = $<HTMLDialogElement>("recap");

const engine = startEngine(canvas, state);
let selected: string | null = null;
const select = (id: string | null): void => engine.select(id);
const tierTitle = (t: Tier): string => getTheme(state.settings.theme).tierTitles[t];

const roster = mountRoster($("roster"), { state, selected: () => selected, select, tierTitle });
const inspector = mountInspector(inspectorRoot, { state, selected: () => selected, select, tierTitle, theme: () => getTheme(state.settings.theme) });
const ticker = mountTicker($("ticker"), { state });
const settings = mountSettings(settingsDialog, { state });
const toasts = mountToasts($("toasts"));

/** Draws a character's sprite onto a small canvas, as the inspector's Look tab does; does nothing for one this browser has no data on. */
function drawSprite(cv: HTMLCanvasElement, characterId: string): void {
  const c = state.characters.get(characterId);
  if (c === undefined) return;
  cv.width = 32; cv.height = 40;
  cv.style.width = `${cv.width * CONFIG.client.previewScale}px`;
  cv.style.height = `${cv.height * CONFIG.client.previewScale}px`;
  const ctx = cv.getContext("2d");
  if (ctx === null) return;
  ctx.imageSmoothingEnabled = false;
  safeDraw(getTheme(state.settings.theme), THEMES[0]!, t => t.drawCharacter(ctx, { x: 16, y: 36 }, c.look, c.tier, "off_duty", "medium", 0, 1, false), ctx);
}
const recap = mountRecap(recapDialog, { state, drawSprite });
const NUDGE_KEY = "agent-world:recap-nudge";

/** Once per local day, a toast about yesterday that opens the recap card. No system notification. */
async function morningNudge(): Promise<void> {
  const today = localDay();
  let last: string | null = null;
  try { last = localStorage.getItem(NUDGE_KEY); } catch { /* storage unavailable */ }
  if (!shouldNudge(today, last)) return;
  const yesterday = localDay(new Date(), 1);
  const r = await api.recap(yesterday);
  try { localStorage.setItem(NUDGE_KEY, today); } catch { /* storage unavailable */ }
  const text = nudgeText(r);
  if (text !== null) toasts.showText(text, () => recap.open(yesterday));
}

for (const t of THEMES) themeSelect.add(new Option(t.name, t.id));
let appliedTheme: string | null = null;
let instantTheme = true;                 // until the first snapshot is shown, the theme applies without the fade
const showAppliedTheme = (): void => {
  themeSelect.value = THEMES.some(t => t.id === appliedTheme) ? appliedTheme! : THEMES[0]!.id;
};

themeSelect.addEventListener("change", () => {
  api.putSettings({ theme: themeSelect.value }).catch(e => {
    console.error("agent-world: could not save theme", e);
    showAppliedTheme();                  // put the select back to the theme actually in use
  });
});

$("open-recap").addEventListener("click", () => recap.open());
$("open-settings").addEventListener("click", () => {
  settings.render();
  settingsDialog.showModal();
});

/** Docks the inspector on the side of the stage away from the selected character, so it does not cover them. */
function dockInspector(): void {
  const x = selected === null ? null : engine.screenX(selected);
  inspectorRoot.classList.toggle("dock-left", x !== null && x > 0.5);
}

/** Brings the top bar, panels and tab title in line with the state. */
function sync(): void {
  reconnecting.hidden = state.connected;
  demoBadge.hidden = !state.demo;
  if (state.settings.theme !== appliedTheme) {
    appliedTheme = state.settings.theme;
    engine.setTheme(appliedTheme, { instant: instantTheme });
    showAppliedTheme();
  }
  const count = attentionCount(state);
  attention.textContent = count === 0 ? "" : `🔔 ${count} ${count === 1 ? "needs" : "need"} you`;
  document.title = tabTitle(count);
  roster.render();
  inspector.render();
  ticker.render();
  settings.render();
  dockInspector();
}

engine.onSelect(id => {
  selected = id;
  roster.render();
  inspector.render(true);              // an explicit selection: acknowledges the shown session if it has attention
  dockInspector();
});

connect({
  onSnapshot(snap) {
    applySnapshot(state, snap);
    sync();
    instantTheme = false;
  },
  onDeltas(deltas) {
    const before = new Map([...state.sessions.values()].map(s => [s.key, s.state]));
    const notices = applyDeltas(state, deltas);
    const cheered = new Set<string>();
    for (const d of deltas) {
      if (d.type !== "session" || d.session.state !== "done" || before.get(d.session.key) === "done" || cheered.has(d.session.key)) continue;
      cheered.add(d.session.key);
      engine.burst("celebrate", d.session.characterId ?? d.session.key);
    }
    for (const n of notices) {
      const actorId = n.characterId ?? n.sessionKey;
      const show = (): void => { if (actorId !== null) select(actorId); };
      deliver(n, state.settings, show);
      toasts.show(n, state.settings, show);
      if (n.kind === "level_up" && n.characterId !== null) engine.burst("levelUp", n.characterId);
      if ((n.kind === "done" || n.kind === "level_up") && actorId !== null) engine.react(actorId);
    }
    sync();
  },
  onStatus(connected) {
    state.connected = connected;
    sync();
  },
});
sync();
morningNudge().catch(e => console.error("agent-world: recap nudge failed", e));
