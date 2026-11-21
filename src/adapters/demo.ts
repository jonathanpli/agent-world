import { CONFIG } from "../shared/config";
import type { AgentEvent, Effort, Tier } from "../shared/types";

export type Demo = { step(): void };     // call once per simulated second

const REPOS = ["/demo/storefront", "/demo/api-server", "/demo/mobile-app", "/demo/infra"];
const MODELS: Record<Tier, string> = { 1: "claude-haiku-5-5", 2: "claude-sonnet-5-5", 3: "claude-opus-5-5", 4: "claude-fable-5-2" };
const TIERS: Tier[] = [1, 2, 3, 4];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const PROMPTS = [
  "Fix the flaky checkout test", "Add pagination to the orders endpoint", "Refactor the auth middleware",
  "Write migration for user preferences", "Speed up the product search query", "Add dark mode to the settings screen",
  "Upgrade the Terraform modules", "Handle offline mode in the sync service",
];
const TOOLS = [
  "Read src/index.ts", "Edit src/routes/orders.ts", "Bash npm test", "Grep for TODO", "Read package.json",
  "Edit src/components/Cart.tsx", "Bash git diff", "Write tests/checkout.test.ts", "Bash npm run build", "Glob **/*.yaml",
];
const SUMMARIES = ["Done, tests pass", "Implemented and verified", "Fixed, added a regression test", "Refactor complete"];
const INPUT_REASONS = ["Permission needed to run a command", "Which approach do you prefer?", "Confirm before deleting files"];

type Phase = "prompt" | "tool" | "resolve" | "finish" | "pause" | "end";
type Sim = { id: string; repoPath: string; tier: Tier; effort: Effort; phase: Phase; nextAt: number; toolsLeft: number; changeModel: boolean };

export function createDemo(opts: { emit: (ev: AgentEvent) => void; rng: () => number; now: () => number }): Demo {
  const { emit, rng, now } = opts;
  const cfg = CONFIG.demo;
  const sims: Sim[] = [];
  const spawnAt: number[] = [];
  let seq = 0;
  let started = false;

  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const between = (r: readonly [number, number]): number => r[0] + rng() * (r[1] - r[0]);
  const int = (r: readonly [number, number]): number => Math.floor(between([r[0], r[1] + 1]));
  const send = (s: Sim, kind: AgentEvent["kind"], extra: Partial<AgentEvent> = {}): void =>
    emit({ source: "demo", sessionId: s.id, repoPath: s.repoPath, at: now(), kind, ...extra });

  function spawn(t: number): void {
    const s: Sim = {
      id: `demo-${++seq}`, repoPath: pick(REPOS), tier: pick(TIERS), effort: pick(EFFORTS),
      phase: "prompt", nextAt: t + between(cfg.toolGapMs), toolsLeft: 0, changeModel: false,
    };
    sims.push(s);
    send(s, "session_start", { model: MODELS[s.tier], tier: s.tier, effort: s.effort });
  }

  function advance(s: Sim, t: number): void {
    switch (s.phase) {
      case "prompt":
        send(s, "prompt", { detail: { text: pick(PROMPTS) } });
        s.toolsLeft = int(cfg.toolsPerTask); s.phase = "tool"; s.nextAt = t + between(cfg.toolGapMs);
        break;
      case "tool":
        send(s, "tool", { detail: { text: pick(TOOLS) } });
        if (--s.toolsLeft > 0) { s.nextAt = t + between(cfg.toolGapMs); break; }
        if (rng() < cfg.needsInputChance) {
          send(s, "needs_input", { detail: { reason: pick(INPUT_REASONS) } });
          s.phase = "resolve"; s.nextAt = t + between(cfg.needsInputWaitMs);
        } else { s.phase = "finish"; s.nextAt = t + between(cfg.toolGapMs); }
        break;
      case "resolve":
        send(s, "tool", { detail: { text: pick(TOOLS) } });
        s.phase = "finish"; s.nextAt = t + between(cfg.toolGapMs);
        break;
      case "finish": {
        send(s, "task_done", { detail: { summary: pick(SUMMARIES) } });
        const leaving = sims.filter(x => x.phase === "end").length;
        if (sims.length - leaving > cfg.sessionsMin && rng() < cfg.endChance) {
          s.phase = "end"; s.nextAt = t + between(cfg.endDelayMs);
        } else {
          s.changeModel = rng() < cfg.modelChangeChance;
          s.phase = "pause"; s.nextAt = t + between(cfg.pauseMs);
        }
        break;
      }
      case "pause":
        if (s.changeModel) {
          s.tier = pick(TIERS); s.effort = pick(EFFORTS); s.changeModel = false;
          send(s, "model_change", { model: MODELS[s.tier], tier: s.tier, effort: s.effort });
        }
        s.phase = "prompt"; advance(s, t);
        break;
      case "end":
        send(s, "session_end");
        sims.splice(sims.indexOf(s), 1);
        spawnAt.push(t + rng() * cfg.respawnMaxMs);
        break;
    }
  }

  return {
    step(): void {
      const t = now();
      if (!started) {
        started = true;
        for (let n = cfg.sessionsStart; n > 0; n--) spawn(t);
      }
      for (const s of [...sims]) if (s.nextAt <= t) advance(s, t);
      for (let i = spawnAt.length - 1; i >= 0; i--) {
        if (spawnAt[i]! <= t) { spawnAt.splice(i, 1); spawn(t); }
      }
    },
  };
}
