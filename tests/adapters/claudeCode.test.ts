import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { claudeCode, tierForModel, toolKindFor } from "../../src/adapters/claudeCode";
import { ADAPTERS } from "../../src/adapters";

const fx = (name: string) => JSON.parse(readFileSync(`tests/fixtures/claude-code/${name}.json`, "utf8"));

describe("claudeCode adapter", () => {
  test("registry", () => { expect(Object.keys(ADAPTERS)).toEqual(["claude-code"]); expect(ADAPTERS["claude-code"]).toBe(claudeCode); });
  test("SessionStart", () => { const [e] = claudeCode.parse(fx("SessionStart"), 5); expect(e).toMatchObject({ source: "claude-code", kind: "session_start", at: 5 }); expect(e.repoPath).toBe(fx("SessionStart").cwd); expect(e.sessionId).toBe(fx("SessionStart").session_id); });
  test("every event carries transcriptPath", () => { expect(claudeCode.parse(fx("SessionStart"), 0)[0].detail!.transcriptPath).toBe(fx("SessionStart").transcript_path); const { transcript_path, ...rest } = fx("Stop"); expect(claudeCode.parse(rest, 0)[0].detail?.transcriptPath).toBeUndefined(); });
  test("SessionStart with a model sets tier", () => { expect(claudeCode.parse({ ...fx("SessionStart"), model: "claude-opus-5-5" }, 0)[0]).toMatchObject({ model: "claude-opus-5-5", tier: 3 }); });
  test("UserPromptSubmit truncates to 500", () => { const [e] = claudeCode.parse({ ...fx("UserPromptSubmit"), prompt: "x".repeat(900) }, 0); expect(e.kind).toBe("prompt"); expect(e.detail!.text).toHaveLength(500); });
  test("PostToolUse summary and effort", () => {
    const [e] = claudeCode.parse({ ...fx("PostToolUse"), tool_name: "Edit", tool_input: { file_path: "/a/b.ts" }, effort: { level: "high" } }, 0);
    expect(e).toMatchObject({ kind: "tool", effort: "high", detail: { tool: "Edit", summary: "Edit /a/b.ts" } });
    expect(claudeCode.parse({ ...fx("PostToolUse"), tool_name: "Bash", tool_input: { command: "y".repeat(200) } }, 0)[0].detail!.summary).toHaveLength(80);
  });
  test("PostToolUse real fixture", () => { expect(claudeCode.parse(fx("PostToolUse"), 0)[0]).toMatchObject({ kind: "tool", effort: "medium", detail: { tool: "Bash", summary: "Bash echo hi" } }); });
  test("tool summary fallbacks", () => {
    const s = (tool_input: unknown, tool_name = "T") => claudeCode.parse({ ...fx("PostToolUse"), tool_name, tool_input }, 0)[0].detail!.summary;
    expect(s({ pattern: "foo", description: "d" }, "Grep")).toBe("Grep foo");
    expect(s({ description: "d" })).toBe("T d");
    expect(s({})).toBe("T ");
    expect(s(undefined)).toBe("T ");
  });
  test("effort ignored when not a known level", () => { expect(claudeCode.parse({ ...fx("PostToolUse"), effort: { level: "ludicrous" } }, 0)[0].effort).toBeUndefined(); });
  test("Notification types", () => {
    const base = fx("Notification.synthetic");
    for (const [t, inputKind] of [["permission_prompt", "blocking"], ["idle_prompt", "idle"], ["elicitation_dialog", "blocking"], ["agent_needs_input", "blocking"]]) {
      expect(claudeCode.parse({ ...base, notification_type: t }, 0)[0]).toMatchObject({ kind: "needs_input", inputKind });
    }
    for (const t of ["auth_success", "agent_completed", undefined]) expect(claudeCode.parse({ ...base, notification_type: t }, 0)).toEqual([]);
    expect(claudeCode.parse(base, 0)[0].detail).toMatchObject({ reason: base.message });
  });
  test("Stop carries the last message", () => { expect(claudeCode.parse({ ...fx("Stop"), last_assistant_message: "Done." }, 0)[0]).toMatchObject({ kind: "task_done", effort: "medium", detail: { summary: "Done." } }); expect(claudeCode.parse({ ...fx("Stop"), last_assistant_message: "z".repeat(900) }, 0)[0].detail!.summary).toHaveLength(500); });
  test("PostModelSwitch", () => { expect(claudeCode.parse({ ...fx("PostModelSwitch.synthetic"), to_model: "claude-haiku-5-5" }, 0)[0]).toMatchObject({ kind: "model_change", model: "claude-haiku-5-5", tier: 1 }); });
  test("SessionEnd", () => { expect(claudeCode.parse(fx("SessionEnd"), 0)[0].kind).toBe("session_end"); });
  test("git moments and subagent token totals", () => {
    const bash = (command: string, stdout?: string) => claudeCode.parse({ ...fx("PostToolUse"), tool_input: { command }, tool_response: { stdout } }, 0)[0];
    const commit = bash('git commit -m "fix"', "[main 1a2b3c4] fix\n 1 file changed");
    expect(commit.moment).toBe("commit");
    expect(commit.detail!.momentText).toBe("fix");
    expect(bash("git push").detail!.momentText).toBeUndefined();
    expect(bash("echo hi").moment).toBeUndefined();
    const failed = claudeCode.parse({ ...fx("PostToolUseFailure.bash"), tool_input: { command: "npm test" } }, 0)[0];
    expect(failed).toMatchObject({ moment: "tests_failed", failed: true });
    expect(claudeCode.parse({ ...fx("PostToolUse"), tool_name: "Edit", tool_input: { command: "git commit -m x" } }, 0)[0].moment).toBeUndefined();
    const agent = claudeCode.parse(fx("PostToolUse.agentTool"), 0)[0];
    expect(agent).toMatchObject({ usage: { input: 2, output: 145, cacheRead: 30058, cacheWrite: 4890, cacheWrite1h: 0 }, usageModel: "claude-haiku-5-5", sidekick: true });
    const { usage, ...noUsage } = fx("PostToolUse.agentTool").tool_response;
    const bare = claudeCode.parse({ ...fx("PostToolUse.agentTool"), tool_response: noUsage }, 0)[0];
    expect(bare.usage).toBeUndefined(); expect(bare.usageModel).toBeUndefined(); expect(bare.sidekick).toBeUndefined();
  });
  test("junk never throws", () => { for (const j of [null, 1, "x", [], {}, { hook_event_name: "Stop" }, { hook_event_name: "Nope", session_id: "s", cwd: "/" }]) expect(claudeCode.parse(j, 0)).toEqual([]); });
  test("tierForModel: an unrecognised id is the default tier; missing, empty and placeholders stay unknown", () => {
    expect(["claude-haiku-5-5","claude-sonnet-5-5","claude-opus-5-5","claude-fable-5-2","claude-mythos-5-2","gpt-x",undefined,"","<synthetic>"].map(tierForModel))
      .toEqual([1,2,3,4,4,2,undefined,undefined,undefined]);
  });
  test("SessionStart with an unrecognised model binds at the default tier", () => { expect(claudeCode.parse({ ...fx("SessionStart"), model: "gpt-x" }, 0)[0]).toMatchObject({ model: "gpt-x", tier: 2 }); });
  test("a Stop after a blocking Stop hook's continuation (stop_hook_active) is a repeat task_done", () => {
    expect(fx("Stop.hookActive.synthetic").stop_hook_active).toBe(true);
    const [again] = claudeCode.parse(fx("Stop.hookActive.synthetic"), 0);
    expect(again).toMatchObject({ kind: "task_done", repeat: true, detail: { summary: fx("Stop.hookActive.synthetic").last_assistant_message } });
    const [first] = claudeCode.parse({ ...fx("Stop"), stop_hook_active: false }, 0);
    expect(first!.kind).toBe("task_done");
    expect(first!.repeat).toBeUndefined();
  });

  test("SubagentStart and SubagentStop", () => {
    for (const [name, kind] of [["SubagentStart", "sub_start"], ["SubagentStop", "sub_end"]] as const) {
      const f = fx(name);
      const out = claudeCode.parse(f, 0);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ kind, sessionId: f.session_id, detail: { agentId: "a5b204f6cefc0d539", agentType: "general-purpose" } });
      expect(claudeCode.parse({ ...f, agent_type: "" }, 0)).toEqual([]);
      const { agent_id, ...noId } = f;
      expect(claudeCode.parse(noId, 0)).toEqual([]);
    }
  });
  test("tools inside a subagent carry its ids; the Agent tool is a delegate", () => {
    const sub = claudeCode.parse(fx("PostToolUse.subagent"), 0)[0];
    expect(sub).toMatchObject({ kind: "tool", detail: { toolKind: "shell", agentId: "a5b204f6cefc0d539", agentType: "general-purpose" } });
    expect(sub.failed).toBeUndefined();
    const del = claudeCode.parse(fx("PostToolUse.agentTool"), 0)[0];
    expect(del.detail!.toolKind).toBe("delegate");
    expect(del.detail!.agentId).toBeUndefined();
  });
  test("PostToolUseFailure is a failed tool unless interrupted", () => {
    for (const [name, toolKind] of [["PostToolUseFailure.bash", "shell"], ["PostToolUseFailure.read", "read"]]) {
      const f = fx(name);
      const [e] = claudeCode.parse(f, 0);
      expect(e).toMatchObject({ kind: "tool", failed: true, detail: { toolKind } });
      expect(e.detail!.summary).toBe(claudeCode.parse({ ...f, hook_event_name: "PostToolUse" }, 0)[0].detail!.summary);
      expect(claudeCode.parse({ ...f, is_interrupt: true }, 0)).toEqual([]);
    }
  });
  test("PreCompact and PostCompact are read triggers only", () => {
    for (const hook_event_name of ["PreCompact", "PostCompact"]) expect(claudeCode.parse({ hook_event_name, session_id: "s", cwd: "/r" }, 0)).toEqual([]);
  });
  test("toolKindFor", () => {
    const k: [string, string][] = [["Edit", "edit"], ["Write", "edit"], ["NotebookEdit", "edit"], ["Bash", "shell"], ["Read", "read"], ["Grep", "read"], ["Glob", "read"],
      ["WebSearch", "web"], ["WebFetch", "web"], ["Agent", "delegate"], ["Task", "delegate"], ["mcp__x__y", "other"], ["SubagentHandback", "other"], ["", "other"]];
    for (const [n, kind] of k) expect(toolKindFor(n)).toBe(kind);
  });
});
