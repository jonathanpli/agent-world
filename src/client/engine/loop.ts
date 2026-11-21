import { levelForXp } from "../../core/levels";
import { CONFIG } from "../../shared/config";
import { mulberry32 } from "../../shared/rng";
import type { CharState, Effort, Look, Session, Tier } from "../../shared/types";
import { activeRepos, unboundLabel, type ClientState } from "../state";
import { contextUsePct, extrasFor, gaugeStep, nextAction, nextCompaction, type ActiveAction, type CompactionWatch, type Extras } from "./actions";
import { actorAt, safeLayout, sessionsByActor, sessionsByRepo, stepActors, syncActors, type Actor, type Layout } from "./actors";
import { drawAction, drawCompaction, drawGauge, drawSidekicks } from "./extras";
import { drawBubble, drawChatBubble, drawEdgeButtons, drawPlate, drawSelection, edgeButtons, layoutPlates, plateText } from "./overlay";
import { createFader } from "./fade";
import { drawParticles, stepParticles } from "./particles";
import { rect } from "./pixels";
import { createSelection } from "./selection";
import { CHAT_ICONS, createSocial, eligibleForChat, reactionFor, socialSpotsOf, speaker, type Chat } from "./social";
import { getTheme, safeDraw, THEMES, VIEW, type Particle, type Point, type Rect, type Theme } from "./theme";

export type Engine = {
  select(actorId: string | null): void;
  onSelect(cb: (actorId: string | null) => void): void;
  /** Switches theme with a short fade to black and back; `instant` skips the fade (the first theme the server sends). */
  setTheme(id: string, opts?: { instant?: boolean }): void;
  burst(kind: "celebrate" | "levelUp", actorId: string): void;
  /** Others in the same repo place as `actorId` react to it finishing or levelling up: a cheer, a glance if working, nothing if it needs you. */
  react(actorId: string): void;
  /** Where an actor stands across its screen, 0 (left edge) to 1 (right edge); null if it has no actor. */
  screenX(actorId: string): number | null;
};

/** What an actor is right now, resolved from the state each frame. */
/** `titleTier` is null for an arrival: drawn at the default tier, but its plate names no seniority. */
type Who = { look: Look; tier: Tier; titleTier: Tier | null; state: CharState; effort: Effort; since: number; name: string; level: number | null; attention: boolean };

const EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);
const effortOf = (e: string | null): Effort => (e !== null && EFFORTS.has(e) ? (e as Effort) : "medium");

function resolve(state: ClientState): Map<string, Who> {
  const out = new Map<string, Who>();
  for (const s of state.sessions.values()) {
    const c = s.characterId === null ? undefined : state.characters.get(s.characterId);
    const look = c?.look ?? s.tempLook;
    if (look === null || look === undefined) continue;
    out.set(s.characterId ?? s.key, {
      look, tier: s.tier, titleTier: s.tierKnown ? s.tier : null, state: s.state, effort: effortOf(s.effort), since: s.stateSince,
      name: c?.name ?? unboundLabel(s), level: c === undefined ? null : levelForXp(c.xp), attention: s.attention,
    });
  }
  for (const c of state.characters.values()) {
    if (c.retired || out.has(c.id)) continue;
    out.set(c.id, { look: c.look, tier: c.tier, titleTier: c.tier, state: "off_duty", effort: "medium", since: c.lastActiveAt, name: c.name, level: levelForXp(c.xp), attention: false });
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
  let layout: Layout = { screens: 1, places: new Map() };
  const actors = new Map<string, Actor>();
  const anim = new Map<string, { state: CharState; since: number; frame: number }>();
  const actions = new Map<string, ActiveAction>();          // by actor id: the tool action playing
  const compactions = new Map<string, CompactionWatch>();   // by actor id: compactions seen, and the moment playing
  let social = createSocial();                              // idle chats and reactions; reset on a theme swap
  const socialRng = mulberry32(0x50c1a1);                   // seeded, so chats are reproducible
  const glances = new Map<string, { toward: string; at: number }>();   // by reacting actor id: whom it reacts to, and when
  let particles: Particle[] = [];
  let hovered: string | null = null;
  let screen = 0;
  let camX = 0;
  let last = performance.now() / 1000;
  const fader = createFader();

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

  const selection = createSelection(actors, a => page(Math.floor(a.target.x / VIEW.w)));
  const select = selection.select;

  const toView = (e: MouseEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * VIEW.w) / r.width, y: ((e.clientY - r.top) * VIEW.h) / r.height };
  };
  canvas.addEventListener("mousemove", e => {
    const p = toView(e);
    hovered = actorAt(actors, { x: p.x + camX, y: p.y });
  });
  canvas.addEventListener("mouseleave", () => { hovered = null; });
  canvas.addEventListener("click", e => {
    const p = toView(e);
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

  const draw = (fn: (t: Theme) => void): void => safeDraw(theme, fallback, fn, ctx);
  let loopFailed = false;

  function frame(): void {
    requestAnimationFrame(frame);           // scheduled first, so nothing below can stop the loop
    try {
      render();
    } catch (e) {
      if (!loopFailed) { loopFailed = true; console.error("agent-world: frame failed", e); }
    }
  }

  function render(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - last);
    last = now;
    const t = now;
    const wall = Date.now();
    const fade = fader.step(now * 1000);
    if (fade.swap !== null) { theme = getTheme(fade.swap); social = createSocial(); }   // at the midpoint, under full black

    const laid = safeLayout(theme, fallback, activeRepos(state));
    layout = laid.layout;
    const active = laid.theme;           // the theme whose layout and lounge are in use
    page(screen);
    syncActors(actors, state, active, layout, t, Math.random);
    const workSpots = new Map<string, Point>();            // session-bound actors' work spots, before a chat moves them
    for (const id of sessionsByActor(state).keys()) {
      const a = actors.get(id);
      if (a !== undefined) workSpots.set(id, { x: Math.round(a.target.x), y: Math.round(a.target.y) });
    }
    const who = resolve(state);
    selection.afterSync();
    const selected = selection.selected();

    // idle characters chat in the lounge (on screen 0, so only those working there join in); one that stops being
    // eligible breaks off this frame, its partner with it, and (no longer overridden) heads back to its spot
    const nearLounge = (id: string): boolean => (workSpots.get(id)?.x ?? 0) < VIEW.w;
    const eligible = [...who]
      .filter(([id, w]) => actors.has(id) && nearLounge(id) && eligibleForChat(w.state, w.attention, id === selected))
      .map(([id]) => id);
    social.step(t, eligible, socialRng, socialSpotsOf(active));
    for (const c of social.chats()) for (const id of [c.a, c.b]) {
      const a = actors.get(id), to = social.targetFor(id);
      if (a !== undefined && to !== null) a.target = to;
    }
    for (const [id] of glances) if (!social.reacting(id, t)) glances.delete(id);

    if (fade.swap !== null) {
      // everyone appears at their place in the new world, and the camera with them
      for (const a of actors.values()) { a.pos = { ...a.target }; a.moving = false; }
      camX = screen * VIEW.w;
    }
    stepActors(actors, dt, active.movement, t);
    const standing = (a: Actor): boolean => !a.moving && a.pos.x === a.target.x && a.pos.y === a.target.y;
    const talking: Chat[] = [];                             // chats whose pair has arrived: they face each other and talk
    for (const c of social.chats()) {
      const pa = actors.get(c.a), pb = actors.get(c.b);
      if (pa === undefined || pb === undefined || !standing(pa) || !standing(pb)) continue;
      pa.facing = pb.pos.x >= pa.pos.x ? 1 : -1;
      pb.facing = pa.facing === 1 ? -1 : 1;
      social.arrived(c, t);                                 // the talking time starts now, not when the chat began
      talking.push(c);
    }

    // animation frames count from when the state began
    for (const [id, w] of who) {
      const speed = w.state === "working" ? CONFIG.effortSpeed[w.effort] : 1;
      const a = anim.get(id);
      if (a === undefined || a.state !== w.state || a.since !== w.since) {
        anim.set(id, { state: w.state, since: w.since, frame: Math.max(0, (wall - w.since) / 1000) * CONFIG.client.animFps * speed });
      } else a.frame += dt * CONFIG.client.animFps * speed;
    }
    for (const id of anim.keys()) if (!who.has(id)) anim.delete(id);

    // per session-bound actor: its work spot, the tool action and compaction moment it is playing, and what of that
    // to draw (nothing until it has arrived at the spot)
    const bound = new Map<string, { spot: Point; session: Session; extras: Extras }>();
    for (const [id, session] of sessionsByActor(state)) {
      const a = actors.get(id), spot = workSpots.get(id);
      if (a === undefined || spot === undefined || !who.has(id)) continue;
      const act = nextAction(actions.get(id) ?? null, session.lastTool, wall);
      if (act === null) actions.delete(id); else actions.set(id, act);
      if (session.context !== null) compactions.set(id, nextCompaction(compactions.get(id), session.context.compactions, wall));
      const arrived = !a.moving && Math.round(a.pos.x) === spot.x && Math.round(a.pos.y) === spot.y;
      const compacting = (compactions.get(id)?.startedAt ?? null) !== null;
      bound.set(id, { spot, session, extras: extrasFor(session, arrived, act, compacting) });
    }
    for (const id of actions.keys()) if (!bound.has(id)) actions.delete(id);
    for (const id of compactions.keys()) if (!bound.has(id)) compactions.delete(id);
    const frameSince = (ms: number): number => Math.floor(Math.max(0, (wall - ms) / 1000) * CONFIG.client.animFps);

    const goal = screen * VIEW.w;
    camX += (goal - camX) * Math.min(1, dt * CONFIG.client.cameraLerp);
    if (Math.abs(goal - camX) < 0.5) camX = goal;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, VIEW.w, VIEW.h);
    ctx.save();
    try {
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

      for (const { spot, session, extras } of bound.values()) {
        const c = session.context;
        if (extras.gauge && c !== null) drawGauge(ctx, theme, spot, gaugeStep(c), contextUsePct(c) >= state.settings.contextWarnPct, t);
      }

      const bob = CONFIG.client.bob[active.movement];
      const drawn: { id: string; at: Point; w: Who }[] = [];
      for (const a of [...actors.values()].sort((p, q) => p.pos.y - q.pos.y)) {
        const w = who.get(a.id);
        if (w === undefined) continue;
        const phase = (a.id.length * 0.7) % (Math.PI * 2);
        const at = { x: Math.round(a.pos.x), y: Math.round(a.pos.y + Math.sin(t * Math.PI * 2 * bob.hz + phase) * bob.px) };
        // a reaction: a working actor glances toward the one it reacts to; one that needs you keeps its pose;
        // anyone else standing still cheers
        let pose = w.state, f = Math.floor(anim.get(a.id)?.frame ?? 0), facing = a.facing;
        const glance = glances.get(a.id);
        const how = glance === undefined ? "none" : reactionFor(w.state);
        if (glance !== undefined && how === "glance") {
          const to = actors.get(glance.toward);
          if (to !== undefined && to.pos.x !== a.pos.x) facing = to.pos.x > a.pos.x ? 1 : -1;
        } else if (glance !== undefined && how === "cheer" && !a.moving) {
          pose = "done";
          f = Math.floor(Math.max(0, t - glance.at) * CONFIG.client.animFps);
        }
        draw(th => th.drawCharacter(ctx, at, w.look, w.tier, pose, w.effort, f, facing, a.moving));
        drawn.push({ id: a.id, at, w });
        const b = bound.get(a.id);
        if (b !== undefined && b.extras.sidekicks) drawSidekicks(ctx, theme, b.spot, b.session.sidekicks, b.extras.busySidekick, wall, t);
      }

      // the main agent's tool action plays at the work spot; a drawn sidekick's own tool only makes it busy (above)
      for (const [id, { spot, extras }] of bound) {
        if (extras.action !== null) drawAction(ctx, theme, spot, extras.action.kind, extras.action.failed, frameSince(extras.action.startedAt));
        const started = compactions.get(id)?.startedAt ?? null;
        if (extras.compaction && started !== null) drawCompaction(ctx, theme, spot, frameSince(started));
      }

      particles = stepParticles(particles, dt);
      drawParticles(ctx, particles);

      // compact plates for everyone; the hovered and selected actors get the full plate, drawn last so it sits on top
      const title = (tier: Tier | null): string | null => (tier === null ? null : active.tierTitles[tier] ?? fallback.tierTitles[tier]);
      const focus = (id: string): boolean => id === hovered || id === selected;
      const full = drawn.filter(d => focus(d.id)).map(d => ({ at: d.at, text: plateText(d.w.name, d.w.level, title(d.w.titleTier), true) }));
      const fullRects = layoutPlates(full);
      const compact = drawn.filter(d => !focus(d.id)).map(d => ({ at: d.at, text: plateText(d.w.name, d.w.level, title(d.w.titleTier), false) }));
      layoutPlates(compact, fullRects).forEach((r, i) => drawPlate(ctx, r, compact[i]!.text));
      for (const d of drawn) if (d.w.attention) drawBubble(ctx, d.at, d.w.state === "needs_input" ? "alert" : "done", t);
      for (const c of talking) {
        const { id, icon } = speaker(c, t);
        const d = drawn.find(x => x.id === id);
        if (d !== undefined) drawChatBubble(ctx, d.at, CHAT_ICONS[icon] ?? CHAT_ICONS[0]!);
      }
      const sel = drawn.find(d => d.id === selected);
      if (sel !== undefined) drawSelection(ctx, sel.at, t, sel.w.attention ? 14 : 0);
      fullRects.forEach((r, i) => drawPlate(ctx, r, full[i]!.text, true));
    } finally {
      ctx.restore();
    }
    drawEdgeButtons(ctx, screen, layout.screens);
    if (fade.alpha > 0) {
      ctx.globalAlpha = fade.alpha;
      rect(ctx, 0, 0, VIEW.w, VIEW.h, "#000000");
      ctx.globalAlpha = 1;
    }
  }
  requestAnimationFrame(frame);

  return {
    select,
    onSelect: selection.onSelect,
    setTheme: (id, opts) => {
      if (opts?.instant === true) { fader.cancel(); theme = getTheme(id); return; }
      if (!fader.busy() && getTheme(id) === theme) return;
      fader.start(id, performance.now());
    },
    burst: (kind, actorId) => {
      const a = actors.get(actorId);
      if (a === undefined) return;
      draw(th => { particles.push(...th.effects[kind]({ ...a.pos }, Math.random)); });
    },
    react: actorId => {
      const finisher = sessionsByActor(state).get(actorId);
      if (finisher === undefined) return;
      const at = performance.now() / 1000;
      const peers = [...sessionsByActor(state)]
        .filter(([id, s]) => id !== actorId && s.repoId === finisher.repoId && actors.has(id) && social.targetFor(id) === null)
        .map(([id]) => id);
      for (const id of peers) glances.set(id, { toward: actorId, at });
      social.react(peers, at);
    },
    screenX: actorId => {
      const a = actors.get(actorId);
      if (a === undefined) return null;
      const x = a.target.x / VIEW.w;
      return x - Math.floor(x);
    },
  };
}
