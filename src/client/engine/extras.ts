import { CONFIG } from "../../shared/config";
import type { ToolKind } from "../../shared/types";
import { COMPACTION_MS, sidekickSlots } from "./actions";
import { drawText, FONT, textWidth } from "./font";
import { rect } from "./pixels";
import { SPRITE } from "./sprite";
import { safeDraw, type Ctx, type Point, type Theme } from "./theme";

const C = {
  ink: "#21182a", paper: "#fffaf0", fail: "#e8443a", puff: "#d8d2e0",
  kind: { edit: "#4a8fe0", shell: "#2fa85a", read: "#c99a1e", web: "#3fb8c9", delegate: "#a066d8", other: "#8f84a0" } as Record<ToolKind, string>,
  gauge: ["#2fa85a", "#7cc04a", "#e8a33a", "#e8573a"], hot: "#e8443a", empty: "#4a3f58",
  sidekick: "#9fc4ec", sidekickD: "#5d88b8",
} as const;

// 5x5 glyphs for the default action icon; "#" is ink.
const ICONS: Record<ToolKind | "failed", string[]> = {
  edit: ["...##", "..###", ".###.", "###..", "##..."],          // pencil
  shell: ["#....", ".#...", "#....", ".....", "..###"],         // >_
  read: ["####.", "#..#.", "####.", "#..#.", "####."],          // page lines
  web: [".###.", "#.#.#", "#####", "#.#.#", ".###."],           // globe
  delegate: ["..#..", "...#.", "#####", "...#.", "..#.."],      // arrow
  other: ["#.#.#", ".....", "#.#.#", ".....", "#.#.#"],         // dots
  failed: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],        // cross
};

function glyph(ctx: Ctx, rows: string[], x: number, y: number, color: string): void {
  rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === "#") rect(ctx, x + c, y + r, 1, 1, color); });
}

/** A small icon in a box above the head, bouncing once as it appears; red with a cross for a failed tool. */
function plainAction(ctx: Ctx, spot: Point, kind: ToolKind, failed: boolean, frame: number): void {
  const lift = frame < 2 ? 2 - Math.floor(frame) : 0;
  const x = Math.round(spot.x) - 3, y = Math.round(spot.y) - SPRITE.h - 11 + lift;
  rect(ctx, x - 1, y - 1, 9, 9, C.ink);
  rect(ctx, x, y, 7, 7, failed ? C.fail : C.kind[kind]);
  glyph(ctx, failed ? ICONS.failed : ICONS[kind], x + 1, y + 1, C.paper);
}

/** A small square figure with two eyes that bobs; it jiggles side to side while busy. */
function plainSidekick(ctx: Ctx, at: Point, frame: number, busy: boolean, t: number): void {
  const bob = Math.round(Math.sin(t * 3 + at.x * 0.37));
  const jiggle = busy ? (frame % 2 === 0 ? -1 : 1) : 0;
  const x = Math.round(at.x) - 3 + jiggle, y = Math.round(at.y) - 8 + bob;
  rect(ctx, x - 1, y - 1, 8, 8, C.ink);
  rect(ctx, x, y, 6, 6, busy ? C.paper : C.sidekick);
  rect(ctx, x, y + 4, 6, 2, C.sidekickD);
  rect(ctx, x + 1, y + 2, 1, 1, C.ink);
  rect(ctx, x + 4, y + 2, 1, 1, C.ink);
}

/** A four-segment upright bar left of the spot, filled bottom up; hot, it blinks slowly in red. */
function plainGauge(ctx: Ctx, spot: Point, step: 0 | 1 | 2 | 3, hot: boolean, t: number): void {
  const x = Math.round(spot.x) - 13, bottom = Math.round(spot.y) - 2;
  rect(ctx, x - 1, bottom - 12, 5, 13, C.ink);
  const blinkOff = hot && Math.floor(t / 0.6) % 2 === 1;
  for (let i = 0; i < 4; i++) {
    const filled = i <= step && !blinkOff;
    rect(ctx, x, bottom - 2 - i * 3, 3, 2, filled ? (hot ? C.hot : C.gauge[step]!) : C.empty);
  }
}

/** A ring of pale specks that spreads from the character's middle and fades out. */
function plainCompaction(ctx: Ctx, spot: Point, frame: number): void {
  const life = (COMPACTION_MS / 1000) * CONFIG.client.animFps;        // the moment's length in frames
  const k = Math.min(1, Math.max(0, frame / life));
  const r = 4 + k * 12;
  ctx.globalAlpha = 1 - k;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + k;
    rect(ctx, Math.round(spot.x + Math.cos(a) * r) - 1, Math.round(spot.y - 12 + Math.sin(a) * r * 0.7) - 1, 2, 2, C.puff);
  }
  ctx.globalAlpha = 1;
}

/** The engine's plain look for every optional extra; a theme that leaves one out gets this. */
export const DEFAULTS: Required<Pick<Theme, "drawAction" | "drawSidekick" | "drawContextGauge" | "drawCompaction">> = {
  drawAction: plainAction, drawSidekick: plainSidekick, drawContextGauge: plainGauge, drawCompaction: plainCompaction,
};

// The loop draws every extra through these: the theme's member or DEFAULTS, under safeDraw with the fallback theme.

export function drawGauge(ctx: Ctx, theme: Theme, fallback: Theme, spot: Point, step: 0 | 1 | 2 | 3, hot: boolean, t: number): void {
  safeDraw(theme, fallback, th => (th.drawContextGauge ?? DEFAULTS.drawContextGauge)(ctx, spot, step, hot, t), ctx);
}

export function drawAction(ctx: Ctx, theme: Theme, fallback: Theme, spot: Point, kind: ToolKind, failed: boolean, frame: number): void {
  safeDraw(theme, fallback, th => (th.drawAction ?? DEFAULTS.drawAction)(ctx, spot, kind, failed, frame), ctx);
}

export function drawCompaction(ctx: Ctx, theme: Theme, fallback: Theme, spot: Point, frame: number): void {
  safeDraw(theme, fallback, th => (th.drawCompaction ?? DEFAULTS.drawCompaction)(ctx, spot, frame), ctx);
}

/**
 * Up to three sidekicks in their slots beside `spot`, then a "+n" tag for the rest. `busyId` names the sidekick whose
 * tool is playing; `now` (epoch ms) gives each its frame count since it arrived. Returns the drawn slots by sidekick id.
 */
export function drawSidekicks(
  ctx: Ctx, theme: Theme, fallback: Theme, spot: Point, sidekicks: readonly { id: string; since: number }[],
  busyId: string | null, now: number, t: number,
): Map<string, Point> {
  const { points, more } = sidekickSlots(spot, sidekicks.length);
  const drawn = new Map<string, Point>();
  points.forEach((at, i) => {
    const s = sidekicks[i]!;
    const frame = Math.max(0, (now - s.since) / 1000) * CONFIG.client.animFps;
    safeDraw(theme, fallback, th => (th.drawSidekick ?? DEFAULTS.drawSidekick)(ctx, at, Math.floor(frame), s.id === busyId, t), ctx);
    drawn.set(s.id, at);
  });
  const lastPt = points.at(-1);
  if (more > 0 && lastPt !== undefined) {
    const text = `+${more}`;
    const w = textWidth(text);
    const dir = points.length > 1 && points[1]!.x < points[0]!.x ? -1 : 1;
    const x = dir > 0 ? lastPt.x + 5 : lastPt.x - 5 - w;
    const y = lastPt.y - FONT.h - 3;
    rect(ctx, x - 1, y - 1, w + 2, FONT.h + 1, C.ink);
    drawText(ctx, text, x, y, C.paper);
  }
  return drawn;
}
