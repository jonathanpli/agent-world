import { CONFIG } from "../shared/config";
import type { AgentEvent, Compaction, Effort, MomentKind, Tier, ToolKind, UsageDelta } from "../shared/types";

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
type DemoTool = { tool: string; summary: string; toolKind: ToolKind };
const TOOLS: DemoTool[] = [
  { tool: "Read", summary: "Read src/index.ts", toolKind: "read" },
  { tool: "Edit", summary: "Edit src/routes/orders.ts", toolKind: "edit" },
  { tool: "Bash", summary: "Bash npm test", toolKind: "shell" },
  { tool: "Grep", summary: "Grep for TODO", toolKind: "read" },
  { tool: "WebFetch", summary: "Fetch the framework migration guide", toolKind: "web" },
  { tool: "Edit", summary: "Edit src/components/Cart.tsx", toolKind: "edit" },
  { tool: "Bash", summary: "Bash git diff", toolKind: "shell" },
  { tool: "Task", summary: "Delegate a codebase search", toolKind: "delegate" },
  { tool: "Write", summary: "Write tests/checkout.test.ts", toolKind: "edit" },
  { tool: "Glob", summary: "Glob **/*.yaml", toolKind: "read" },
  { tool: "WebSearch", summary: "Search for the library changelog", toolKind: "web" },
  { tool: "TodoWrite", summary: "Update the task list", toolKind: "other" },
];
/** Shell commands that make a git or test moment; weight sets how often each is drawn. */
type DemoMoment = { moment: MomentKind; weight: number; commands: string[]; subjects?: string[] };
const MOMENTS: DemoMoment[] = [
  { moment: "commit", weight: 4, commands: ["git commit -m"], subjects: ["Fix flaky checkout test", "Add pagination to orders endpoint", "Refactor auth middleware", "Add user preferences migration", "Handle offline mode in sync service"] },
  { moment: "tests_passed", weight: 4, commands: ["npm test", "npx vitest run", "pytest -q"] },
  { moment: "tests_failed", weight: 3, commands: ["npm test", "npx vitest run", "pytest -q"] },
  { moment: "push", weight: 2, commands: ["git push origin HEAD"] },
  { moment: "pr_opened", weight: 1, commands: ["gh pr create --fill"] },
  { moment: "pr_merged", weight: 1, commands: ["gh pr merge 12 --squash"] },
];
const SIDEKICK_TOOLS = TOOLS.filter(t => t.toolKind === "read" || t.toolKind === "web" || t.toolKind === "other");
const SUMMARIES = ["Done, tests pass", "Implemented and verified", "Fixed, added a regression test", "Refactor complete"];
const INPUT_REASONS = ["Permission needed to run a command", "Which approach do you prefer?", "Confirm before deleting files"];

type Phase = "prompt" | "tool" | "resolve" | "finish" | "pause" | "end";
type Sidekick = { id: string; type: string; nextAt: number; toolsLeft: number };
type Sim = {
  id: string; repoPath: string; tier: Tier; effort: Effort; phase: Phase; nextAt: number; toolsLeft: number; changeModel: boolean;
  tokens: number; boundaries: Compaction[]; compactNext: boolean; sidekicks: Sidekick[];
};

export function createDemo(opts: { emit: (ev: AgentEvent) => void; rng: () => number; now: () => number }): Demo {
  const { emit, rng, now } = opts;
  const cfg = CONFIG.demo;
  const sims: Sim[] = [];
  const spawnAt: number[] = [];
  let seq = 0;
  let subSeq = 0;
  let boundarySeq = 0;
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
      tokens: int(cfg.contextStartTokens), boundaries: [], compactNext: false, sidekicks: [],
    };
    sims.push(s);
    send(s, "session_start", { model: MODELS[s.tier], tier: s.tier, effort: s.effort });
  }

  const sendTool = (s: Sim, t: DemoTool, agent?: Sidekick): void => {
    const detail: Record<string, string> = { tool: t.tool, summary: t.summary, toolKind: t.toolKind };
    if (agent) { detail.agentId = agent.id; detail.agentType = agent.type; }
    const extra: Partial<AgentEvent> = rng() < cfg.toolFailChance ? { detail, failed: true } : { detail };
    if (t.toolKind === "delegate" && !agent) {            // the Agent tool's own event carries the subagent's totals
      extra.usage = { input: int(cfg.subagentInput), output: int(cfg.subagentOutput), cacheRead: int(cfg.subagentCacheRead), cacheWrite: int(cfg.subagentCacheWrite), cacheWrite1h: 0 };
      extra.usageModel = cfg.subagentModel; extra.sidekick = true;
    }
    send(s, "tool", extra);
  };

  function pickWeighted(xs: DemoMoment[]): DemoMoment {
    let r = rng() * xs.reduce((n, x) => n + x.weight, 0);
    for (const x of xs) { if ((r -= x.weight) < 0) return x; }
    return xs[xs.length - 1]!;
  }

  // occasionally a main-thread tool is a git or test command instead; tests_failed is the only moment on a failed event
  function sendMoment(s: Sim): void {
    const m = pickWeighted(MOMENTS);
    const command = pick(m.commands);
    const detail: Record<string, string> = { tool: "Bash", toolKind: "shell", summary: `Bash ${command}` };
    if (m.subjects) {
      const subject = pick(m.subjects);
      detail.summary = `Bash ${command} "${subject}"`; detail.momentText = subject.slice(0, 80);
    }
    send(s, "tool", m.moment === "tests_failed" ? { detail, moment: m.moment, failed: true } : { detail, moment: m.moment });
  }
  const sendMainTool = (s: Sim): void => { if (rng() < cfg.momentChance) sendMoment(s); else sendTool(s, pick(TOOLS)); };

  // one usage event per main-thread turn: the prompt is mostly cache reads of the current context
  function sendUsage(s: Sim): void {
    const usage: UsageDelta = { input: int(cfg.turnInput), output: int(cfg.turnOutput), cacheRead: s.tokens, cacheWrite: 0, cacheWrite1h: int(cfg.turnCacheWrite1h) };
    const extra: Partial<AgentEvent> = { usage, usageModel: MODELS[s.tier] };
    if (s.tier === 1 && usage.input + usage.cacheRead + usage.cacheWrite + usage.cacheWrite1h > CONFIG.usage.longPromptTokens) extra.longPrompt = true;
    send(s, "usage", extra);
  }

  // every context event lists all boundaries so far; the first one (empty list) is the session's history
  function sendContext(s: Sim): void {
    const limit = CONFIG.context.defaultLimit;
    if (s.compactNext) {
      const preTokens = s.tokens, postTokens = int(cfg.compactToTokens);
      s.boundaries.push({ uuid: `${s.id}-compact-${++boundarySeq}`, trigger: "auto", preTokens, postTokens });
      s.tokens = postTokens; s.compactNext = false;
    } else {
      s.tokens += int(cfg.contextGrowTokens);
      if (s.tokens >= limit * cfg.compactAtFraction) s.compactNext = true;
    }
    send(s, "context", { contextTokens: s.tokens, boundaries: s.boundaries.map(b => ({ ...b })) });
  }

  function startSidekick(s: Sim, t: number): void {
    const k: Sidekick = { id: `demo-agent-${++subSeq}`, type: pick(cfg.sidekickTypes), nextAt: t + between(cfg.sidekickGapMs), toolsLeft: int(cfg.sidekickTools) };
    s.sidekicks.push(k);
    send(s, "sub_start", { detail: { agentId: k.id, agentType: k.type } });
  }

  function stepSidekicks(s: Sim, t: number): void {
    for (const k of [...s.sidekicks]) {
      if (k.nextAt > t) continue;
      if (k.toolsLeft-- > 0) { sendTool(s, pick(SIDEKICK_TOOLS), k); k.nextAt = t + between(cfg.sidekickGapMs); continue; }
      send(s, "sub_end", { detail: { agentId: k.id, agentType: k.type } });
      s.sidekicks.splice(s.sidekicks.indexOf(k), 1);
    }
  }

  function advance(s: Sim, t: number): void {
    switch (s.phase) {
      case "prompt":
        send(s, "prompt", { detail: { text: pick(PROMPTS) } });
        s.toolsLeft = int(cfg.toolsPerTask); s.phase = "tool"; s.nextAt = t + between(cfg.toolGapMs);
        break;
      case "tool":
        sendMainTool(s);
        sendContext(s);
        sendUsage(s);
        if (s.sidekicks.length < cfg.sidekickMax && rng() < cfg.sidekickChance) startSidekick(s, t);
        if (--s.toolsLeft > 0) { s.nextAt = t + between(cfg.toolGapMs); break; }
        if (rng() < cfg.needsInputChance) {
          send(s, "needs_input", { detail: { reason: pick(INPUT_REASONS) } });
          s.phase = "resolve"; s.nextAt = t + between(cfg.needsInputWaitMs);
        } else { s.phase = "finish"; s.nextAt = t + between(cfg.toolGapMs); }
        break;
      case "resolve":
        sendMainTool(s);
        sendContext(s);
        sendUsage(s);
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
        for (const k of s.sidekicks) send(s, "sub_end", { detail: { agentId: k.id, agentType: k.type } });
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
      for (const s of [...sims]) { stepSidekicks(s, t); if (s.nextAt <= t) advance(s, t); }
      for (let i = spawnAt.length - 1; i >= 0; i--) {
        if (spawnAt[i]! <= t) { spawnAt.splice(i, 1); spawn(t); }
      }
    },
  };
}
