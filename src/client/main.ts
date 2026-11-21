import { startEngine } from "./engine/loop";
import { getTheme, THEMES } from "./engine/theme";
import { api, connect } from "./net";
import { attentionCount, deliver, tabTitle } from "./notify";
import { applyDeltas, applySnapshot, emptyState } from "./state";
import { mount as mountInspector } from "./ui/inspector";
import { mount as mountRoster } from "./ui/roster";
import { mount as mountSettings } from "./ui/settings";
import { mount as mountTicker } from "./ui/ticker";
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

const engine = startEngine(canvas, state);
let selected: string | null = null;
const select = (id: string | null): void => engine.select(id);
const tierTitle = (t: Tier): string => getTheme(state.settings.theme).tierTitles[t];

const roster = mountRoster($("roster"), { state, selected: () => selected, select, tierTitle });
const inspector = mountInspector(inspectorRoot, { state, selected: () => selected, select, tierTitle, theme: () => getTheme(state.settings.theme) });
const ticker = mountTicker($("ticker"), { state });
const settings = mountSettings(settingsDialog, { state });

for (const t of THEMES) themeSelect.add(new Option(t.name, t.id));
let appliedTheme: string | null = null;
const showAppliedTheme = (): void => {
  themeSelect.value = THEMES.some(t => t.id === appliedTheme) ? appliedTheme! : THEMES[0]!.id;
};

themeSelect.addEventListener("change", () => {
  api.putSettings({ theme: themeSelect.value }).catch(e => {
    console.error("agent-world: could not save theme", e);
    showAppliedTheme();                  // put the select back to the theme actually in use
  });
});

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
    engine.setTheme(appliedTheme);
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
  inspector.render();
  dockInspector();
});

connect({
  onSnapshot(snap) {
    applySnapshot(state, snap);
    sync();
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
      deliver(n, state.settings, () => { if (actorId !== null) select(actorId); });
      if (n.kind === "level_up" && n.characterId !== null) engine.burst("levelUp", n.characterId);
    }
    sync();
  },
  onStatus(connected) {
    state.connected = connected;
    sync();
  },
});
sync();
