import { CONFIG } from "../shared/config";
import type { AgentEvent, Effort, Tier, ToolKind } from "../shared/types";
import type { Adapter } from "./index";
import { commitSubject, momentFor } from "./moments";

const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];
const NEEDS_INPUT_TYPES: Readonly<Record<string, "idle" | "blocking">> = {
  permission_prompt: "blocking", idle_prompt: "idle", elicitation_dialog: "blocking", agent_needs_input: "blocking",
};
const TIER_MATCHERS: readonly (readonly [string, Tier])[] = [["haiku", 1], ["sonnet", 2], ["opus", 3], ["fable", 4], ["mythos", 4]];

/** The tier for a model id; an id that matches none is the default tier. Missing, empty and placeholder ids such as "<synthetic>" are unknown. */
export function tierForModel(model: string | undefined): Tier | undefined {
  if (typeof model !== "string" || model === "" || model.startsWith("<")) return undefined;
  const m = model.toLowerCase();
  return TIER_MATCHERS.find(([needle]) => m.includes(needle))?.[1] ?? CONFIG.defaultTier;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  Edit: "edit", Write: "edit", NotebookEdit: "edit", Bash: "shell", Read: "read", Grep: "read", Glob: "read",
  WebSearch: "web", WebFetch: "web", Agent: "delegate", Task: "delegate",
};

/** The animation family of a tool; anything unrecognised (MCP tools included) is "other". */
export function toolKindFor(name: string): ToolKind {
  return Object.hasOwn(TOOL_KINDS, name) ? TOOL_KINDS[name] : "other";
}

function toolSummary(name: string, input: unknown): string {
  const i = isRecord(input) ? input : {};
  const arg = str(i.file_path) ?? str(i.command) ?? str(i.pattern) ?? str(i.description) ?? "";
  return `${name} ${arg}`.slice(0, CONFIG.summaryMax);
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** The token totals an Agent tool's response reports for the whole subagent run, or undefined when it reports none. */
function agentUsage(response: unknown): Pick<AgentEvent, "usage" | "usageModel" | "sidekick"> | undefined {
  if (!isRecord(response) || !isRecord(response.usage)) return undefined;
  const u = response.usage;
  const model = str(response.resolvedModel);
  return {
    usage: {
      input: count(u.input_tokens), output: count(u.output_tokens), cacheRead: count(u.cache_read_input_tokens),
      cacheWrite: count(u.cache_creation_input_tokens), cacheWrite1h: isRecord(u.cache_creation) ? count(u.cache_creation.ephemeral_1h_input_tokens) : 0,
    },
    ...(model !== undefined && model !== "" && { usageModel: model }),
    sidekick: true,
  };
}

function parse(raw: unknown, now: number): AgentEvent[] {
  try {
    if (!isRecord(raw)) return [];
    const sessionId = str(raw.session_id);
    const repoPath = str(raw.cwd);
    if (sessionId === undefined || repoPath === undefined) return [];

    const base = { source: "claude-code", sessionId, repoPath, at: now };
    const detail: Record<string, string> = {};
    const transcriptPath = str(raw.transcript_path);
    if (transcriptPath !== undefined) detail.transcriptPath = transcriptPath;
    const level = isRecord(raw.effort) ? str(raw.effort.level) : undefined;
    const effort: Effort | undefined = level !== undefined && EFFORTS.includes(level) ? (level as Effort) : undefined;
    const ev = (kind: AgentEvent["kind"], extra: Partial<AgentEvent> = {}, more: Record<string, string> = {}): AgentEvent[] => [
      { ...base, kind, ...extra, detail: { ...detail, ...more } },
    ];

    switch (raw.hook_event_name) {
      case "SessionStart": {
        const model = str(raw.model);
        const tier = tierForModel(model);
        return ev("session_start", { ...(model !== undefined && { model }), ...(tier !== undefined && { tier }) });
      }
      case "UserPromptSubmit":
        return ev("prompt", {}, { text: (str(raw.prompt) ?? "").slice(0, CONFIG.textMax) });
      case "PostToolUse":
      case "PostToolUseFailure": {
        const failure = raw.hook_event_name === "PostToolUseFailure";
        if (failure && raw.is_interrupt === true) return [];
        const tool = str(raw.tool_name) ?? "";
        const agentId = str(raw.agent_id);
        const agentType = str(raw.agent_type);
        const inSub = agentId !== undefined && agentId !== "" && agentType !== undefined && agentType !== "";
        const command = tool === "Bash" && isRecord(raw.tool_input) ? str(raw.tool_input.command) : undefined;
        const moment = command !== undefined ? momentFor(command, failure) : null;
        const stdout = isRecord(raw.tool_response) ? str(raw.tool_response.stdout) : undefined;
        const subject = moment === "commit" && stdout !== undefined ? commitSubject(stdout) : null;
        const sub = !failure && (tool === "Agent" || tool === "Task") ? agentUsage(raw.tool_response) : undefined;
        return ev("tool", { ...(effort && { effort }), ...(failure && { failed: true as const }), ...(moment !== null && { moment }), ...sub },
          { tool, summary: toolSummary(tool, raw.tool_input), toolKind: toolKindFor(tool), ...(inSub && { agentId, agentType }), ...(subject !== null && { momentText: subject }) });
      }
      case "SubagentStart":
      case "SubagentStop": {
        const agentId = str(raw.agent_id);
        const agentType = str(raw.agent_type);
        if (!agentId || !agentType) return [];
        return ev(raw.hook_event_name === "SubagentStart" ? "sub_start" : "sub_end", {}, { agentId, agentType });
      }
      case "Notification": {
        const type = str(raw.notification_type);
        const inputKind = type !== undefined && Object.hasOwn(NEEDS_INPUT_TYPES, type) ? NEEDS_INPUT_TYPES[type] : undefined;
        if (inputKind === undefined) return [];
        return ev("needs_input", { inputKind }, { reason: str(raw.message) ?? "" });
      }
      case "Stop": {
        // stop_hook_active: the end of a continuation a blocking Stop hook forced; the turn's finish was already counted
        const repeat = raw.stop_hook_active === true;
        const last = str(raw.last_assistant_message);
        return ev("task_done", { ...(effort && { effort }), ...(repeat && { repeat: true as const }) }, last !== undefined ? { summary: last.slice(0, CONFIG.textMax) } : {});
      }
      case "PostModelSwitch": {
        const model = str(raw.to_model);
        const tier = tierForModel(model);
        return ev("model_change", { ...(model !== undefined && { model }), ...(tier !== undefined && { tier }) });
      }
      case "SessionEnd":
        return ev("session_end");
      default:
        return [];
    }
  } catch {
    return [];
  }
}

export const claudeCode: Adapter = { source: "claude-code", parse };
