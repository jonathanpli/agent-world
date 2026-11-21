import { CONFIG } from "../shared/config";
import type { Notice, Settings } from "../shared/types";
import type { ClientState } from "./state";

const APP_TITLE = "Agent World";

/** The system notification for a notice, or null when its kind is silent or its toggle is off. */
export function notificationFor(n: Notice, settings: Settings): { title: string; body: string } | null {
  let verb: string;
  if (n.kind === "needs_input" && settings.notifyNeedsInput) verb = "needs you";
  else if (n.kind === "done" && settings.notifyDone) verb = "finished";
  else if (n.kind === "context_low" && settings.notifyContext) return { title: `${n.characterName} — context running low`, body: n.text };
  else return null;
  const where = n.repoName === null ? "" : ` — ${n.repoName}`;
  return { title: `${n.characterName} ${verb}${where}`, body: n.text };
}

/** The in-game toast text for a notice: needs_input, done and context_low under the same toggles as `notificationFor`, level_up always, else null. */
export function toastFor(n: Notice, settings: Settings): string | null {
  if (n.kind === "level_up") return n.text;
  return notificationFor(n, settings) === null ? null : n.text;
}

/** The toasts to keep on screen: the newest CONFIG.client.toastMax of `all` (oldest first). */
export function visibleToasts<T>(all: T[]): T[] {
  return all.slice(-CONFIG.client.toastMax);
}

/** Sessions with attention. */
export function attentionCount(s: ClientState): number {
  let k = 0;
  for (const x of s.sessions.values()) if (x.attention) k++;
  return k;
}

export function tabTitle(count: number): string {
  return count > 0 ? `(${count}) ${APP_TITLE}` : APP_TITLE;
}

type AudioCtor = new () => AudioContext;
let audio: AudioContext | null = null;

/** Two short sine tones. Silently does nothing where WebAudio is missing or refuses to start. */
function chime(): void {
  const Ctor = (globalThis as { AudioContext?: AudioCtor }).AudioContext;
  if (typeof Ctor !== "function") return;
  try {
    if (audio === null || !(audio instanceof Ctor)) audio = new Ctor();
    const ac = audio;
    if (ac.state === "suspended") void ac.resume().catch(() => {});
    const { tonesHz, toneS, gapS, gain } = CONFIG.client.chime;
    tonesHz.forEach((hz, i) => {
      const start = ac.currentTime + i * (toneS + gapS);
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      g.gain.setValueAtTime(gain, start);
      g.gain.exponentialRampToValueAtTime(gain / 100, start + toneS);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(start);
      osc.stop(start + toneS);
    });
  } catch (e) {
    console.warn("agent-world: could not play the chime", e);
  }
}

/**
 * Shows a system notification for `n` when permission has been granted, and plays the chime when `settings.sound`
 * is on. Silent kinds and disabled toggles do neither. Clicking the notification focuses the window and runs `onClick`.
 * Never throws.
 */
export function deliver(n: Notice, settings: Settings, onClick: () => void): void {
  const msg = notificationFor(n, settings);
  if (msg === null) return;
  const N = (globalThis as { Notification?: typeof Notification }).Notification;
  if (typeof N === "function" && N.permission === "granted") {
    try {
      const shown = new N(msg.title, { body: msg.body, tag: n.id });
      shown.onclick = () => {
        (globalThis as { focus?: () => void }).focus?.();
        onClick();
        shown.close();
      };
    } catch (e) {
      console.warn("agent-world: could not show a notification", e);
    }
  }
  if (settings.sound) chime();
}
