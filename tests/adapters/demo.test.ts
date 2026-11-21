import { expect, test } from "vitest";
import { toolKindFor } from "../../src/adapters/claudeCode";
import { createDemo } from "../../src/adapters/demo";
import { mulberry32 } from "../../src/shared/rng";
import type { AgentEvent } from "../../src/shared/types";
import { newWorld } from "../helpers/events";

test("simulator drives a world for an hour without breaking it", () => {
  let t = 0; const seen = new Set<string>(); const tiers = new Set<number>(); const efforts = new Set<string>();
  const w = newWorld(); const live = () => w.snapshot(t, false).sessions.length;
  const demo = createDemo({ rng: mulberry32(7), now: () => t, emit: e => { seen.add(e.kind); if (e.tier) tiers.add(e.tier); if (e.effort) efforts.add(e.effort); w.apply(e); } });
  for (let i = 0; i < 3600; i++) { t = i * 1000; demo.step(); if (i > 60) { expect(live()).toBeGreaterThanOrEqual(3); expect(live()).toBeLessThanOrEqual(6); } }
  expect([...seen].sort()).toEqual(["context","model_change","needs_input","prompt","session_end","session_start","sub_end","sub_start","task_done","tool"]);
  expect(tiers.size).toBe(4); expect(efforts.size).toBe(5);
  expect(w.snapshot(t, false).repos.length).toBe(4);
});

test("demo simulates sidekicks, every tool kind, failures, and a context that climbs and compacts", () => {
  let t = 0; const evs: AgentEvent[] = [];
  const demo = createDemo({ rng: mulberry32(7), now: () => t, emit: e => evs.push(e) });
  for (let i = 0; i < 600; i++) { t = i * 1000; demo.step(); }

  const open = new Set<string>(); let paired = false;
  for (const e of evs) {
    const key = `${e.sessionId}/${e.detail?.agentId}`;
    if (e.kind === "sub_start") open.add(key);
    if (e.kind === "sub_end") { expect(open.has(key)).toBe(true); open.delete(key); paired = true; }
    if (e.kind === "tool" && e.detail?.agentId) expect(e.detail.agentType).toBeTruthy();
  }
  expect(paired).toBe(true);

  const tools = evs.filter(e => e.kind === "tool");
  expect(new Set(tools.map(e => e.detail?.toolKind))).toEqual(new Set(["edit", "shell", "read", "web", "delegate", "other"]));
  expect(tools.some(e => e.failed === true)).toBe(true);

  const bySession = new Map<string, AgentEvent[]>();
  for (const e of evs.filter(x => x.kind === "context")) bySession.set(e.sessionId, [...(bySession.get(e.sessionId) ?? []), e]);
  let compacted = false;
  for (const list of bySession.values()) {
    expect(list[0]!.boundaries).toEqual([]);
    const high = list.findIndex(e => e.contextTokens! >= 0.85 * 200_000);
    if (high < 0) continue;
    const later = list.slice(high + 1).find(e => e.boundaries!.length > 0);
    if (!later) continue;
    const b = later.boundaries![later.boundaries!.length - 1]!;
    expect(b.trigger).toBe("auto"); expect(b.postTokens).toBeLessThan(0.25 * 200_000);
    expect(later.contextTokens).toBe(b.postTokens);
    for (let i = 1; i < list.length; i++) expect(list[i]!.boundaries!.length).toBeGreaterThanOrEqual(list[i - 1]!.boundaries!.length);
    compacted = true;
  }
  expect(compacted).toBe(true);
});

test("every demo tool carries the kind the Claude Code adapter gives that tool (Glob is read)", () => {
  let t = 0; const tools: AgentEvent[] = [];
  const demo = createDemo({ rng: mulberry32(7), now: () => t, emit: e => { if (e.kind === "tool") tools.push(e); } });
  for (let i = 0; i < 1800; i++) { t = i * 1000; demo.step(); }
  expect(tools.some(e => e.detail?.tool === "Glob")).toBe(true);
  for (const e of tools) expect(e.detail?.toolKind).toBe(toolKindFor(e.detail!.tool!));
});
