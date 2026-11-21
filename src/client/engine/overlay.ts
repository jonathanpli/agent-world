import { CONFIG } from "../../shared/config";
import { drawText, FONT, textWidth } from "./font";
import { rect } from "./pixels";
import { SPRITE } from "./sprite";
import type { Ctx, Point, Rect } from "./theme";
import { VIEW } from "./view";

const UI = {
  ink: "#21182a", plate: "#21182a", name: "#fffaf0", dim: "#c9bfd6", sep: "#8f84a0",
  bubble: "#fffaf0", alert: "#e8443a", ok: "#2fa85a", ring: "#ffe14d", ringD: "#c99a1e", button: "#21182a", arrow: "#fffaf0",
} as const;

export type PlateText = { name: string; rest: string };   // "Ada" plus " 3" (compact) or " · Senior · Lv 3" (full)
const PLATE_H = FONT.h + 2;

/**
 * Plate text. Compact plates carry the name and level ("Ada 3"); the full one ("Ada · Senior · Lv 3") is for the
 * hovered or selected actor. Temps have no level, so their compact plate is just "Temp".
 */
export function plateText(name: string, level: number | null, tierTitle: string, full: boolean): PlateText {
  if (full) return { name, rest: ` · ${tierTitle}${level === null ? "" : ` · Lv ${level}`}` };
  return { name, rest: level === null ? "" : ` ${level}` };
}

/**
 * Lays plates out under each actor's feet, clamped inside the actor's screen on every side. A plate that would
 * overlap one already placed tries the slots below, then above (up to CONFIG.client.plateStack steps each way),
 * skipping slots outside the view; if none is free it keeps its clamped home slot. `obstacles` (plates already
 * placed, such as the hovered actor's full plate) are avoided the same way.
 */
export function layoutPlates(items: { at: Point; text: PlateText }[], obstacles: Rect[] = []): Rect[] {
  const placed: Rect[] = [...obstacles];
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => a.it.at.y - b.it.at.y || a.it.at.x - b.it.at.x);
  const out = new Array<Rect>(items.length);
  const maxY = VIEW.h - PLATE_H;
  for (const { it, i } of order) {
    const w = textWidth(it.text.name + it.text.rest) + 4;
    const left = Math.floor(it.at.x / VIEW.w) * VIEW.w;          // the actor's screen
    const x = Math.max(left, Math.min(left + VIEW.w - w, Math.round(it.at.x - w / 2)));
    const home = Math.max(0, Math.min(maxY, Math.round(it.at.y + CONFIG.client.plateGap)));
    let r: Rect = { x, y: home, w, h: PLATE_H };
    if (placed.some(p => overlaps(p, r))) {
      for (let n = 1; n <= CONFIG.client.plateStack; n++) {
        const free = [home + n * (PLATE_H + 1), home - n * (PLATE_H + 1)]
          .filter(y => y >= 0 && y <= maxY)
          .map(y => ({ x, y, w, h: PLATE_H }))
          .find(c => !placed.some(p => overlaps(p, c)));
        if (free !== undefined) { r = free; break; }
      }
    }
    placed.push(r);
    out[i] = r;
  }
  return out;
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `solid` plates (the hovered or selected actor's, drawn over the others) hide whatever is beneath them. */
export function drawPlate(ctx: Ctx, r: Rect, text: PlateText, solid = false): void {
  ctx.globalAlpha = solid ? 1 : 0.78;
  rect(ctx, r.x + 1, r.y, r.w - 2, r.h, UI.plate);
  rect(ctx, r.x, r.y + 1, r.w, r.h - 2, UI.plate);
  ctx.globalAlpha = 1;
  const x = drawText(ctx, text.name, r.x + 2, r.y + 1, UI.name);
  drawText(ctx, text.rest, x + FONT.spacing, r.y + 1, UI.dim);
}

/** A speech bubble over the head: "!" when the character needs you, a tick when it has finished. */
export function drawBubble(ctx: Ctx, at: Point, kind: "alert" | "done", t: number): void {
  const bounce = Math.round(Math.abs(Math.sin(t * Math.PI * CONFIG.client.bubbleBounceHz)) * -CONFIG.client.bubbleBouncePx);
  const x = Math.round(at.x) - 4, y = Math.round(at.y) - SPRITE.h - 12 + (kind === "alert" ? bounce : 0);
  rect(ctx, x, y - 1, 9, 11, UI.ink); rect(ctx, x - 1, y, 11, 9, UI.ink);
  rect(ctx, x, y, 9, 9, UI.bubble);
  rect(ctx, x + 3, y + 10, 3, 1, UI.ink); rect(ctx, x + 4, y + 9, 1, 2, UI.bubble); rect(ctx, x + 4, y + 11, 1, 1, UI.ink);
  if (kind === "alert") {
    rect(ctx, x + 4, y + 1, 1, 5, UI.alert); rect(ctx, x + 3, y + 1, 3, 3, UI.alert);
    rect(ctx, x + 4, y + 7, 1, 1, UI.alert);
  } else {
    for (const [dx, dy] of [[1, 4], [2, 5], [3, 6], [4, 5], [5, 4], [6, 3], [7, 2]] as const) rect(ctx, x + dx, y + dy, 1, 2, UI.ok);
  }
}

/** A pulsing ellipse round the feet (its back hidden behind the legs) and a marker `lift` px above the usual spot over the head. */
export function drawSelection(ctx: Ctx, at: Point, t: number, lift: number): void {
  const grow = Math.round((Math.sin(t * 6) + 1) / 2);
  const rx = 9 + grow, ry = 3 + grow;
  const cx = Math.round(at.x), cy = Math.round(at.y);
  for (let a = 0; a < 64; a++) {
    const th = (a / 64) * Math.PI * 2;
    const dx = Math.round(Math.cos(th) * rx), dy = Math.round(Math.sin(th) * ry);
    if (dy < 0 && Math.abs(dx) < 6) continue;
    rect(ctx, cx + dx, cy + dy, 1, 1, dy > 0 ? UI.ring : UI.ringD);
  }
  const ay = cy - SPRITE.h - 6 - lift + Math.round(Math.sin(t * 4));
  rect(ctx, cx - 2, ay, 5, 1, UI.ring); rect(ctx, cx - 1, ay + 1, 3, 1, UI.ring); rect(ctx, cx, ay + 2, 1, 1, UI.ring);
}

/** Screen-space paging buttons; returns their hit boxes. */
export function edgeButtons(screen: number, screens: number): { left: Rect | null; right: Rect | null } {
  const { w, h } = CONFIG.client.edgeButton;
  const y = Math.round(VIEW.h / 2 - h / 2);
  return {
    left: screen > 0 ? { x: 2, y, w, h } : null,
    right: screen < screens - 1 ? { x: VIEW.w - w - 2, y, w, h } : null,
  };
}

export function drawEdgeButtons(ctx: Ctx, screen: number, screens: number): void {
  if (screens <= 1) return;
  const { left, right } = edgeButtons(screen, screens);
  for (const [b, dir] of [[left, -1], [right, 1]] as const) {
    if (b === null) continue;
    ctx.globalAlpha = 0.7;
    rect(ctx, b.x, b.y + 1, b.w, b.h - 2, UI.button); rect(ctx, b.x + 1, b.y, b.w - 2, b.h, UI.button);
    ctx.globalAlpha = 1;
    const cx = b.x + Math.floor(b.w / 2), cy = b.y + Math.floor(b.h / 2);
    for (let i = 0; i < 4; i++) rect(ctx, cx + (dir > 0 ? i - 2 : 1 - i), cy - 3 + i, 1, 7 - i * 2, UI.arrow);
  }
  const dotsW = screens * 6 - 2;
  for (let i = 0; i < screens; i++) {
    const x = Math.round(VIEW.w / 2 - dotsW / 2 + i * 6), y = VIEW.h - 6;
    rect(ctx, x - 1, y - 1, 6, 6, UI.ink);
    rect(ctx, x, y, 4, 4, i === screen ? UI.ring : UI.sep);
  }
}
