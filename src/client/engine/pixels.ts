import type { Ctx } from "./theme";

/** Fills an integer-aligned rectangle. */
export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A filled pixel ellipse centred on (cx, cy). */
export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
    if (half > 0) ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2, 1);
  }
}

/** A deterministic 0..1 hash of an integer pair, for stable pseudo-random detail in art. */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes two #rrggbb colours; `t` 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = parse(a), cb = parse(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i]! - v) * t));
  return `#${((1 << 24) | (c[0]! << 16) | (c[1]! << 8) | c[2]!).toString(16).slice(1)}`;
}

/** Darkens (negative `amt`) or lightens (positive) a #rrggbb colour. */
export function shade(hex: string, amt: number): string {
  return amt < 0 ? mix(hex, "#000000", -amt) : mix(hex, "#ffffff", amt);
}

/** A tiny paletted canvas: compose a sprite pixel by pixel, outline it, then draw it as merged runs. */
export class PixelGrid {
  readonly px: (string | null)[];
  constructor(readonly w: number, readonly h: number, readonly ox = 0, readonly oy = 0) {
    this.px = new Array<string | null>(w * h).fill(null);
  }

  /** Sets one pixel; coordinates are local (offset by ox, oy); out-of-range pixels are dropped. */
  set(x: number, y: number, c: string): void {
    const gx = x + this.ox, gy = y + this.oy;
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return;
    this.px[gy * this.w + gx] = c;
  }

  clear(x: number, y: number): void {
    const gx = x + this.ox, gy = y + this.oy;
    if (gx >= 0 && gy >= 0 && gx < this.w && gy < this.h) this.px[gy * this.w + gx] = null;
  }

  get(x: number, y: number): string | null {
    const gx = x + this.ox, gy = y + this.oy;
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return null;
    return this.px[gy * this.w + gx] ?? null;
  }

  /** Fills the inclusive box x0..x1, y0..y1. */
  fill(x0: number, y0: number, x1: number, y1: number, c: string): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }

  /** Marks every empty pixel that touches a filled one (4-neighbourhood) with `c`. */
  outline(c: string): void {
    const filled = this.px.map(p => p !== null);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = y * this.w + x;
      if (filled[i]) continue;
      if ((x > 0 && filled[i - 1]) || (x < this.w - 1 && filled[i + 1]) || (y > 0 && filled[i - this.w]) || (y < this.h - 1 && filled[i + this.w])) {
        this.px[i] = c;
      }
    }
  }

  /** A copy turned a quarter, clockwise (top to the right) or anticlockwise; the copy's origin is its top-left. */
  turned(clockwise: boolean): PixelGrid {
    const out = new PixelGrid(this.h, this.w);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.px[y * this.w + x] ?? null;
      if (c === null) continue;
      const [nx, ny] = clockwise ? [this.h - 1 - y, x] : [y, this.w - 1 - x];
      out.px[ny * out.w + nx] = c;
    }
    return out;
  }

  /** Draws with local (0, 0) at (x, y). */
  blit(ctx: Ctx, x: number, y: number): void {
    const bx = Math.round(x) - this.ox, by = Math.round(y) - this.oy;
    for (let gy = 0; gy < this.h; gy++) {
      let gx = 0;
      while (gx < this.w) {
        const c = this.px[gy * this.w + gx];
        if (c === null || c === undefined) { gx++; continue; }
        let end = gx + 1;
        while (end < this.w && this.px[gy * this.w + end] === c) end++;
        ctx.fillStyle = c;
        ctx.fillRect(bx + gx, by + gy, end - gx, 1);
        gx = end;
      }
    }
  }
}
