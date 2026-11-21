import type { Frame } from "./sprite";

/** Hair styles 0..5: short, spiky, bob, long, bun, curly. Front views leave the face clear; back views cover the head. */
export function drawHair(f: Frame, style: number): void {
  const { g, p, hy, back } = f;
  const H = p.hair, S = p.hairS, L = p.hairL;
  const cap = (): void => { g.fill(5, hy - 1, 10, hy - 1, H); g.fill(4, hy, 11, hy + 1, H); g.set(6, hy - 1, L); g.set(7, hy, L); };
  switch (style) {
    case 0: // short
      cap();
      if (back) { g.fill(4, hy + 2, 11, hy + 5, H); g.fill(4, hy + 5, 11, hy + 5, S); break; }
      g.fill(4, hy + 2, 4, hy + 3, H); g.fill(11, hy + 2, 11, hy + 3, H);
      g.fill(5, hy + 2, 7, hy + 2, H);
      break;
    case 1: // spiky
      cap();
      for (const [x, y] of [[4, -1], [5, -2], [7, -2], [7, -3], [9, -2], [10, -3], [11, -1]] as const) g.set(x, hy + y, H);
      g.set(7, hy - 1, L);
      if (back) { g.fill(4, hy + 2, 11, hy + 5, H); g.fill(4, hy + 5, 11, hy + 5, S); break; }
      g.fill(4, hy + 2, 4, hy + 3, H); g.fill(11, hy + 2, 11, hy + 3, H);
      for (const x of [5, 7, 9, 10]) g.set(x, hy + 2, H);
      break;
    case 2: // bob
      g.fill(5, hy - 1, 10, hy - 1, H); g.fill(3, hy, 12, hy + 1, H);
      g.fill(3, hy + 2, 4, hy + 7, H); g.fill(11, hy + 2, 12, hy + 7, H);
      g.fill(3, hy + 7, 4, hy + 7, S); g.fill(11, hy + 7, 12, hy + 7, S);
      g.set(6, hy - 1, L); g.set(5, hy, L);
      if (back) { g.fill(4, hy + 2, 11, hy + 7, H); g.fill(4, hy + 7, 11, hy + 7, S); break; }
      g.fill(5, hy + 2, 10, hy + 2, H); g.set(8, hy + 2, S);
      break;
    case 3: // long
      g.fill(5, hy - 1, 10, hy - 1, H); g.fill(3, hy, 12, hy + 1, H);
      g.fill(3, hy + 2, 4, hy + 12, H); g.fill(11, hy + 2, 12, hy + 12, H);
      g.fill(3, hy + 12, 3, hy + 12, S); g.fill(12, hy + 12, 12, hy + 12, S);
      g.set(9, hy - 1, L); g.set(10, hy, L);
      if (back) { g.fill(4, hy + 2, 11, hy + 12, H); g.fill(7, hy + 4, 8, hy + 12, S); break; }
      g.fill(5, hy + 2, 6, hy + 2, H); g.fill(9, hy + 2, 10, hy + 2, H); g.set(5, hy + 3, H); g.set(10, hy + 3, H);
      break;
    case 4: // bun
      cap();
      g.fill(6, hy - 4, 9, hy - 2, H); g.clear(6, hy - 4); g.clear(9, hy - 4);
      g.fill(6, hy - 2, 9, hy - 2, S);
      g.set(7, hy - 4, L);
      if (back) { g.fill(4, hy + 2, 11, hy + 5, H); break; }
      g.fill(4, hy + 2, 4, hy + 4, H); g.fill(11, hy + 2, 11, hy + 4, H);
      g.fill(8, hy + 2, 10, hy + 2, H);
      break;
    default: // curly
      g.fill(4, hy - 3, 11, hy - 3, H); g.fill(3, hy - 2, 12, hy - 2, H); g.fill(2, hy - 1, 13, hy + 1, H);
      g.fill(2, hy + 2, 3, hy + 5, H); g.fill(12, hy + 2, 13, hy + 5, H);
      for (const [x, y] of [[4, -2], [7, -2], [10, -2], [3, 0], [6, -1], [9, 0], [12, -1], [2, 3], [13, 4]] as const) g.set(x, hy + y, S);
      g.set(6, hy - 3, L); g.set(5, hy - 2, L);
      if (back) { g.fill(4, hy + 2, 11, hy + 6, H); g.set(6, hy + 3, S); g.set(9, hy + 5, S); break; }
      g.fill(4, hy + 2, 11, hy + 2, H); g.set(6, hy + 2, S); g.set(9, hy + 2, S);
      break;
  }
}

const HAT = {
  cap: { c: "#d9473b", s: "#a8302a" }, beanie: { c: "#2f9184", s: "#6cc4b6" }, headband: { c: "#f3f0e8", s: "#e24a4a" },
  cowboy: { c: "#a26a36", s: "#5a351a" }, wizard: { c: "#5b40b8", s: "#ffd94a" }, crown: { c: "#f2c230", s: "#c08a1a" },
} as const;

export function drawHat(f: Frame, hat: string): void {
  const { g, hy, back, facing } = f;
  switch (hat) {
    case "cap": {
      const { c, s } = HAT.cap;
      g.fill(5, hy - 2, 10, hy - 2, c); g.fill(4, hy - 1, 11, hy + 1, c); g.set(7, hy - 3, s);
      if (back) { g.fill(6, hy + 1, 9, hy + 1, s); break; }
      if (facing > 0) g.fill(6, hy + 1, 14, hy + 1, s); else g.fill(1, hy + 1, 9, hy + 1, s);
      g.set(8, hy, "#ffffff");
      break;
    }
    case "beanie": {
      const { c, s } = HAT.beanie;
      g.fill(5, hy - 3, 10, hy - 3, c); g.fill(4, hy - 2, 11, hy, c);
      g.fill(3, hy + 1, 12, hy + 2, s);
      for (let x = 4; x <= 11; x += 2) g.set(x, hy + 1, c);
      g.fill(7, hy - 5, 8, hy - 4, "#f4efe4");
      break;
    }
    case "headband": {
      const { c, s } = HAT.headband;
      g.fill(4, hy + 1, 11, hy + 1, c); g.fill(4, hy + 2, 11, hy + 2, s);
      if (back) { g.fill(7, hy + 3, 8, hy + 5, s); break; }
      const tx = facing > 0 ? 3 : 12;
      g.set(tx, hy + 2, s); g.set(tx + (facing > 0 ? -1 : 1), hy + 3, s); g.set(tx + (facing > 0 ? -1 : 1), hy + 4, c);
      break;
    }
    case "cowboy": {
      const { c, s } = HAT.cowboy;
      g.fill(5, hy - 4, 10, hy - 1, c); g.clear(7, hy - 4); g.clear(8, hy - 4); g.set(7, hy - 3, s);
      g.fill(5, hy - 1, 10, hy - 1, s);
      g.fill(1, hy, 14, hy, c); g.set(0, hy - 1, c); g.set(15, hy - 1, c);
      g.fill(2, hy + 1, 13, hy + 1, s);
      break;
    }
    case "wizard": {
      const { c, s } = HAT.wizard;
      const lean = facing > 0 ? -1 : 1;
      const rows: [number, number, number][] = [[-9, 8, 8], [-8, 8, 9], [-7, 7, 9], [-6, 7, 10], [-5, 6, 10], [-4, 6, 11], [-3, 5, 11], [-2, 5, 11], [-1, 4, 11]];
      for (const [y, x0, x1] of rows) g.fill(x0 + (y < -6 ? lean : 0), hy + y, x1 + (y < -6 ? lean : 0), hy + y, c);
      g.fill(2, hy, 13, hy, c); g.fill(3, hy + 1, 12, hy + 1, "#3f2a8c");
      g.set(8, hy - 5, s); g.set(7, hy - 2, s); g.set(10, hy - 3, s); g.set(8 + lean, hy - 9, s);
      break;
    }
    case "crown": {
      const { c, s } = HAT.crown;
      g.fill(5, hy - 2, 10, hy, c); g.fill(5, hy, 10, hy, s);
      for (const x of [5, 10]) g.fill(x, hy - 4, x, hy - 3, c);
      g.fill(7, hy - 4, 8, hy - 3, c); g.set(7, hy - 5, c);
      if (!back) { g.fill(7, hy - 2, 8, hy - 1, "#e03b5a"); g.set(5, hy - 1, "#4ec3e0"); g.set(10, hy - 1, "#4ec3e0"); }
      break;
    }
  }
}

export function drawAccessory(f: Frame, acc: string): void {
  const { g, hy, by, back, facing, pose, step } = f;
  const d = pose === "walk" || pose === "stand" ? (facing > 0 ? 1 : -1) : 0;
  const ex = 6 + d;
  const ring = (x: number, c: string): void => {
    g.fill(x - 1, hy + 2, x + 1, hy + 2, c); g.fill(x - 1, hy + 5, x + 1, hy + 5, c);
    g.fill(x - 1, hy + 3, x - 1, hy + 4, c); g.fill(x + 1, hy + 3, x + 1, hy + 4, c);
  };
  switch (acc) {
    case "glasses":
      if (back) { g.set(3, hy + 3, "#1d1a22"); g.set(12, hy + 3, "#1d1a22"); break; }
      ring(ex, "#1d1a22"); ring(ex + 3, "#1d1a22");
      g.set(ex, hy + 5, "#9fd3ff"); g.set(ex + 3, hy + 5, "#9fd3ff");
      break;
    case "monocle":
      if (back) break;
      ring(ex + 3, "#e8c547"); g.set(ex + 3, hy + 5, "#fff6c8");
      g.set(ex + 4, hy + 6, "#e8c547"); g.set(ex + 4, hy + 8, "#e8c547"); g.set(ex + 5, hy + 9, "#e8c547");
      break;
    case "scarf": {
      const c = "#e8463c", s = "#f6efe2";
      g.fill(4, by, 11, by + 1, c);
      for (let x = 5; x <= 11; x += 3) g.fill(x, by, x, by + 1, s);
      if (back) { g.fill(5, by + 2, 6, by + 3, c); break; }
      g.fill(9, by + 2, 10, by + 4, c); g.fill(9, by + 3, 10, by + 3, s); g.set(9, by + 5, c);
      break;
    }
    case "headphones": {
      const band = "#353a4d", glow = "#ff6b6b";
      g.fill(5, hy - 2, 10, hy - 2, band); g.set(4, hy - 1, band); g.set(11, hy - 1, band);
      g.fill(3, hy, 3, hy + 2, band); g.fill(12, hy, 12, hy + 2, band);
      g.fill(2, hy + 3, 3, hy + 5, band); g.fill(12, hy + 3, 13, hy + 5, band);
      g.set(2, hy + 4, glow); g.set(13, hy + 4, glow);
      break;
    }
    case "cape": {
      const c = "#a3243c", s = "#781a2c";
      const flutter = pose === "walk" ? (step === 0 ? 1 : -1) : 0;
      if (back) { g.fill(4, by, 11, by + 5, c); g.fill(7, by + 1, 8, by + 5, s); g.fill(4, by, 11, by, "#e0b440"); break; }
      g.fill(3, by, 12, by + 7, c);
      g.fill(2 + Math.min(0, flutter), by + 5, 13 + Math.max(0, flutter), by + 8, s);
      g.set(5, by, "#e0b440"); g.set(10, by, "#e0b440");
      break;
    }
    case "badge":
      if (back) break;
      g.set(9, by + 1, "#f4c542"); g.fill(8, by + 2, 10, by + 2, "#f4c542"); g.set(8, by + 3, "#f4c542"); g.set(10, by + 3, "#f4c542");
      g.set(9, by + 2, "#fff1a8");
      break;
  }
}
