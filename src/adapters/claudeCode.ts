import { CONFIG } from "../shared/config";
import type { AgentEvent, Effort, Tier } from "../shared/types";
import type { Adapter } from "./index";

const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];
const NEEDS_INPUT_TYPES: readonly string[] = ["permission_prompt", "idle_prompt", "elicitation_dialog", "agent_needs_input"];
const TIER_MATCHERS: readonly (readonly [string, Tier])[] = [["haiku", 1], ["sonnet", 2], ["opus", 3], ["fable", 4], ["mythos", 4]];

export function tierForModel(model: string | undefined): Tier | undefined {
  if (typeof model !== "string") return undefined;
  const m = model.toLowerCase();
  return TIER_MATCHERS.find(([needle]) => m.includes(needle))?.[1];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function toolSummary(name: string, input: unknown): string {
  const i = isRecord(input) ? input : {};
  const arg = str(i.file_path) ?? str(i.command) ?? str(i.pattern) ?? str(i.description) ?? "";
  return `${name} ${arg}`.slice(0, CONFIG.summaryMax);
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
      case "PostToolUse": {
        const tool = str(raw.tool_name) ?? "";
        return ev("tool", { ...(effort && { effort }) }, { tool, summary: toolSummary(tool, raw.tool_input) });
      }
      case "Notification": {
        const type = str(raw.notification_type);
        if (type === undefined || !NEEDS_INPUT_TYPES.includes(type)) return [];
        return ev("needs_input", {}, { reason: str(raw.message) ?? "" });
      }
      case "Stop": {
        const last = str(raw.last_assistant_message);
        return ev("task_done", { ...(effort && { effort }) }, last !== undefined ? { summary: last.slice(0, CONFIG.textMax) } : {});
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
