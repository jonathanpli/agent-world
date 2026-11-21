import { startEngine } from "./engine/loop";
import { THEMES } from "./engine/theme";
import { api, connect } from "./net";
import { applyDeltas, applySnapshot, emptyState } from "./state";

const state = emptyState();
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("world");
const themeSelect = $<HTMLSelectElement>("theme");
const reconnecting = $("reconnecting");
const demoBadge = $("demo");

const engine = startEngine(canvas, state);

for (const t of THEMES) themeSelect.add(new Option(t.name, t.id));
themeSelect.addEventListener("change", () => {
  api.putSettings({ theme: themeSelect.value }).catch(e => console.error("agent-world: could not save theme", e));
});

let appliedTheme: string | null = null;

/** Brings the top-bar badges and theme in line with the state. */
function syncChrome(): void {
  reconnecting.hidden = state.connected;
  demoBadge.hidden = !state.demo;
  if (state.settings.theme !== appliedTheme) {
    appliedTheme = state.settings.theme;
    engine.setTheme(appliedTheme);
    themeSelect.value = THEMES.some(t => t.id === appliedTheme) ? appliedTheme : THEMES[0]!.id;
  }
}

connect({
  onSnapshot(snap) {
    applySnapshot(state, snap);
    syncChrome();
  },
  onDeltas(deltas) {
    const before = new Map([...state.sessions.values()].map(s => [s.key, s.state]));
    applyDeltas(state, deltas);
    const cheered = new Set<string>();
    for (const d of deltas) {
      if (d.type !== "session" || d.session.state !== "done" || before.get(d.session.key) === "done" || cheered.has(d.session.key)) continue;
      cheered.add(d.session.key);
      engine.burst("celebrate", d.session.characterId ?? d.session.key);
    }
    syncChrome();
  },
  onStatus(connected) {
    state.connected = connected;
    syncChrome();
  },
});
syncChrome();
