import { CONFIG } from "../../shared/config";
import type { Ctx, Particle } from "./theme";

/** Advances particles by `dt` seconds under gravity (scaled per particle: 0 floats, negative rises) and drops the dead ones. */
export function stepParticles(ps: Particle[], dt: number): Particle[] {
  const out: Particle[] = [];
  for (const p of ps) {
    const life = p.life - dt;
    if (life <= 0) continue;
    const vy = p.vy + CONFIG.client.gravity * (p.gravity ?? 1) * dt;
    out.push({ ...p, life, vy, x: p.x + p.vx * dt, y: p.y + vy * dt });
  }
  return out;
}

/** Square pixels that fade out over their last moments. */
export function drawParticles(ctx: Ctx, ps: Particle[]): void {
  for (const p of ps) {
    ctx.globalAlpha = Math.min(1, p.life / CONFIG.client.particleFadeS);
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
