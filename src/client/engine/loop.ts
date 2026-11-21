import { levelForXp } from "../../core/levels";
import { CONFIG } from "../../shared/config";
import type { CharState, Effort, Look, Tier } from "../../shared/types";
import { activeRepos, type ClientState } from "../state";
import { actorAt, computeLayout, sessionsByRepo, stepActors, syncActors, type Actor, type Layout } from "./actors";
import { drawBubble, drawEdgeButtons, drawPlate, drawSelection, edgeButtons, layoutPlates, type PlateText } from "./overlay";
import { drawParticles, stepParticles } from "./particles";
import { getTheme, safeDraw, THEMES, VIEW, type Particle, type Point, type Rect, type Theme } from "./theme";

export type Engine = {
  select(actorId: string | null): void;
  onSelect(cb: (actorId: string | null) => void): void;
  setTheme(id: string): void;
  burst(kind: "celebrate" | "levelUp", actorId: string): void;
};

/** What an actor is right now, resolved from the state each frame. */
type Who = { look: Look; tier: Tier; state: CharState; effort: Effort; since: number; name: string; level: number | null; attention: boolean };

const EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);
const effortOf = (e: string | null): Effort => (e !== null && EFFORTS.has(e) ? (e as Effort) : "medium");

function resolve(state: ClientState): Map<string, Who> {
  const out = new Map<string, Who>();
  for (const s of state.sessions.values()) {
    const c = s.characterId === null ? undefined : state.characters.get(s.characterId);
    const look = c?.look ?? s.tempLook;
    if (look === null || look === undefined) continue;
    out.set(s.characterId ?? s.key, {
      look, tier: s.tier, state: s.state, effort: effortOf(s.effort), since: s.stateSince,
      name: c?.name ?? "Temp", level: c === undefined ? null : levelForXp(c.xp), attention: s.attention,
    });
  }
  for (const c of state.characters.values()) {
    if (c.retired || out.has(c.id)) continue;
    out.set(c.id, { look: c.look, tier: c.tier, state: "off_duty", effort: "medium", since: c.lastActiveAt, name: c.name, level: levelForXp(c.xp), attention: false });
  }
  return out;
}

const inBox = (p: Point, r: Rect | null): boolean => r !== null && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export function startEngine(canvas: HTMLCanvasElement, state: ClientState): Engine {
  const fallback = THEMES[0]!;
  const ctx = canvas.getContext("2d")!;
  canvas.width = VIEW.w;
  canvas.height = VIEW.h;
  ctx.imageSmoothingEnabled = false;

  let theme: Theme = getTheme(state.settings.theme);
  let layout: Layout = computeLayout(theme, []);
  const actors = new Map<string, Actor>();
  const anim = new Map<string, { state: CharState; since: number; frame: number }>();
  let particles: Particle[] = [];
  let selected: string | null = null;
  const listeners: ((id: string | null) => void)[] = [];
  let screen = 0;
  let camX = 0;
  let last = performance.now() / 1000;

  // Crisp scaling: the largest whole number of device pixels per world pixel that fits the container.
  const fit = (): void => {
    const box = (canvas.parentElement ?? document.body).getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.floor(Math.min((box.width * dpr) / VIEW.w, (box.height * dpr) / VIEW.h)));
    canvas.style.width = `${(VIEW.w * scale) / dpr}px`;
    canvas.style.height = `${(VIEW.h * scale) / dpr}px`;
  };
  new ResizeObserver(fit).observe(canvas.parentElement ?? document.body);
  window.addEventListener("resize", fit);
  fit();

  const page = (to: number): void => { screen = Math.max(0, Math.min(layout.screens - 1, to)); };

  const select = (id: string | null): void => {
    selected = id;
    const a = id === null ? undefined : actors.get(id);
    if (a !== undefined) page(Math.floor(a.target.x / VIEW.w));
    for (const cb of listeners) cb(id);
  };

  canvas.addEventListener("click", e => {
    const r = canvas.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) * VIEW.w) / r.width, y: ((e.clientY - r.top) * VIEW.h) / r.height };
    const buttons = edgeButtons(screen, layout.screens);
    if (layout.screens > 1 && inBox(p, buttons.left)) { page(screen - 1); return; }
    if (layout.screens > 1 && inBox(p, buttons.right)) { page(screen + 1); return; }
    select(actorAt(actors, { x: p.x + camX, y: p.y }));
  });

  window.addEventListener("keydown", e => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || layout.screens <= 1) return;
    if (e.key === "ArrowLeft") page(screen - 1);
    else if (e.key === "ArrowRight") page(screen + 1);
  });

  const draw = (fn: (t: Theme) => void): void => safeDraw(theme, fallback, fn);

  function frame(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - last);
    last = now;
    const t = now;
    const wall = Date.now();

    layout = computeLayout(theme, activeRepos(state));
    page(screen);
    syncActors(actors, state, theme, layout, t, Math.random);
    stepActors(actors, dt, theme.movement, t);
    const who = resolve(state);
    if (selected !== null && !actors.has(selected)) select(null);

    // animation frames count from when the state began
    for (const [id, w] of who) {
      const speed = w.state === "working" ? CONFIG.effortSpeed[w.effort] : 1;
      const a = anim.get(id);
      if (a === undefined || a.state !== w.state || a.since !== w.since) {
        anim.set(id, { state: w.state, since: w.since, frame: Math.max(0, (wall - w.since) / 1000) * CONFIG.client.animFps * speed });
      } else a.frame += dt * CONFIG.client.animFps * speed;
    }
    for (const id of anim.keys()) if (!who.has(id)) anim.delete(id);

    const goal = screen * VIEW.w;
    camX += (goal - camX) * Math.min(1, dt * CONFIG.client.cameraLerp);
    if (Math.abs(goal - camX) < 0.5) camX = goal;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, VIEW.w, VIEW.h);
    ctx.save();
    ctx.translate(-Math.round(camX), 0);

    const first = Math.floor(camX / VIEW.w), lastScreen = Math.ceil(camX / VIEW.w);
    for (let s = first; s <= lastScreen; s++) {
      ctx.save(); ctx.translate(s * VIEW.w, 0);
      draw(th => th.drawBackdrop(ctx, t, s));
      ctx.restore();
    }
    draw(th => th.drawAmbient?.(ctx, t));

    const ranked = sessionsByRepo(state);
    for (const [repoId, { screen: s, place }] of layout.places) {
      ctx.save(); ctx.translate(s * VIEW.w, 0);
      draw(th => th.drawPlace(ctx, place, state.repos.get(repoId)?.name ?? "", t));
      const list = ranked.get(repoId) ?? [];
      place.spots.forEach((spot, i) => {
        const occupant = list[i];
        draw(th => th.drawWorkSpot(ctx, spot, occupant?.tier ?? null, occupant?.state ?? null, t));
      });
      ctx.restore();
    }

    const bob = theme.movement === "walk" ? 0 : CONFIG.client.bobPx;
    const drawn: { id: string; at: Point; w: Who }[] = [];
    for (const a of [...actors.values()].sort((p, q) => p.pos.y - q.pos.y)) {
      const w = who.get(a.id);
      if (w === undefined) continue;
      const phase = (a.id.length * 0.7) % (Math.PI * 2);
      const at = { x: Math.round(a.pos.x), y: Math.round(a.pos.y + Math.sin(t * Math.PI * 2 * CONFIG.client.bobHz + phase) * bob) };
      const f = Math.floor(anim.get(a.id)?.frame ?? 0);
      draw(th => th.drawCharacter(ctx, at, w.look, w.tier, w.state, w.effort, f, a.facing, a.moving));
      drawn.push({ id: a.id, at, w });
    }

    particles = stepParticles(particles, dt);
    drawParticles(ctx, particles);

    const plates = drawn.map(d => ({
      at: d.at,
      text: { name: d.w.name, rest: ` · ${theme.tierTitles[d.w.tier]}${d.w.level === null ? "" : ` · Lv ${d.w.level}`}` } satisfies PlateText,
    }));
    layoutPlates(plates).forEach((r, i) => drawPlate(ctx, r, plates[i]!.text));
    for (const d of drawn) if (d.w.attention) drawBubble(ctx, d.at, d.w.state === "needs_input" ? "alert" : "done", t);
    const sel = drawn.find(d => d.id === selected);
    if (sel !== undefined) drawSelection(ctx, sel.at, t, sel.w.attention ? 14 : 0);

    ctx.restore();
    drawEdgeButtons(ctx, screen, layout.screens);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    select,
    onSelect: cb => { listeners.push(cb); },
    setTheme: id => { theme = getTheme(id); },
    burst: (kind, actorId) => {
      const a = actors.get(actorId);
      if (a === undefined) return;
      draw(th => { particles.push(...th.effects[kind]({ ...a.pos }, Math.random)); });
    },
  };
}
