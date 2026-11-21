import type { Place, Point, Rect } from "./theme";

/** How a theme lays its places out: the two spot rows' offsets from the top, size caps and the gap between places. */
export type PlaceGrid = { row0: number; rowH: number; maxW: number; maxH: number; gap: number };

const GRID: Record<number, [number, number]> = { 1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [3, 2], 6: [3, 2] };

/** Places on a grid sized to the count, the last row centred; each has two rows of three spots. */
export function placeOnGrid(area: Rect, cfg: PlaceGrid, index: number, count: number): Place {
  const [cols, rows] = GRID[Math.min(6, Math.max(1, count))]!;
  const row = Math.floor(index / cols);
  const col = index - row * cols;
  const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols;
  const cellW = area.w / cols, cellH = area.h / rows;
  const w = Math.floor(Math.min(cellW - cfg.gap, cfg.maxW));
  const h = Math.floor(Math.min(cellH - cfg.gap, cfg.maxH));
  const x = Math.round(area.x + ((cols - inRow) * cellW) / 2 + col * cellW + (cellW - w) / 2);
  const y = Math.round(area.y + row * cellH + (cellH - h) / 2);
  const spots: Point[] = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    spots.push({ x: Math.round(x + (w * (2 * c + 1)) / 6), y: y + cfg.row0 + r * cfg.rowH });
  }
  return { rect: { x, y, w, h }, spots };
}
