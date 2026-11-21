import { CONFIG } from "../../shared/config";

/** Opacity of the black overlay `elapsedMs` into a theme fade: 0 → 1 at the midpoint → 0. */
export function fadeAlpha(elapsedMs: number, durationMs: number = CONFIG.client.fadeMs): number {
  if (elapsedMs <= 0 || elapsedMs >= durationMs) return 0;
  const half = durationMs / 2;
  return elapsedMs < half ? elapsedMs / half : (durationMs - elapsedMs) / half;
}

export type Fader = {
  /** Fades to `target`. Before the midpoint it retargets the running fade; after it, it turns round from the current darkness. */
  start(target: string, nowMs: number): void;
  /** The overlay alpha now, and the theme to swap to: exactly once per fade, on the first step at or past the midpoint. */
  step(nowMs: number): { alpha: number; swap: string | null };
  busy(): boolean;
  /** Drops any running fade, without a swap. */
  cancel(): void;
};

export function createFader(durationMs: number = CONFIG.client.fadeMs): Fader {
  let fade: { startMs: number; target: string; swapped: boolean } | null = null;
  const half = durationMs / 2;
  return {
    start(target, nowMs) {
      // a fade past its end counts as over even if no step has cleared it yet (frames stop in a hidden tab)
      const elapsed = fade === null ? durationMs : Math.max(0, nowMs - fade.startMs);
      if (fade === null || elapsed >= durationMs) fade = { startMs: nowMs, target, swapped: false };
      else if (!fade.swapped) fade.target = target;
      else fade = { startMs: nowMs - (durationMs - elapsed), target, swapped: false };
    },
    step(nowMs) {
      if (fade === null) return { alpha: 0, swap: null };
      const elapsed = Math.max(0, nowMs - fade.startMs);
      let swap: string | null = null;
      if (!fade.swapped && elapsed >= half) { fade.swapped = true; swap = fade.target; }
      if (elapsed >= durationMs) fade = null;
      return { alpha: fadeAlpha(elapsed, durationMs), swap };
    },
    busy: () => fade !== null,
    cancel: () => { fade = null; },
  };
}
