import { expect, test } from "vitest";
import { ackEpisode, contextLevel, contextLine, formatTokens, sidekickLine, formatDuration, lockLevel, renameTo, shouldAck, xpProgress } from "../../src/client/ui/inspector";
import { rosterKey, rosterRows, rosterSub } from "../../src/client/ui/roster";
import { tickerItems } from "../../src/client/ui/ticker";
import { applySnapshot, emptyState, tierTitleOf, unboundLabel } from "../../src/client/state";
import { plateText } from "../../src/client/engine/overlay";
import { HATS, unlocked } from "../../src/shared/cosmetics";
import { CONFIG } from "../../src/shared/config";
import type { ContextInfo } from "../../src/shared/types";
import { applyDeltas } from "../../src/client/state";
import { char, notice, repo, session, snap } from "../helpers/clientFixtures";

test("formatDuration", () => {
  expect(formatDuration(45_000)).toBe("45s");
  expect(formatDuration(12 * 60_000)).toBe("12m");
  expect(formatDuration(3 * 3_600_000 + 5 * 60_000)).toBe("3h 05m");
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(-5_000)).toBe("0s");
});

test("xpProgress", () => {
  expect(xpProgress(0)).toEqual({ level: 1, into: 0, span: 152 });
  expect(xpProgress(200)).toEqual({ level: 2, into: 48, span: 138 });
});

test("lockLevel is the first level at which unlocked() includes the item", () => {
  HATS.forEach((h, i) => {
    const lv = lockLevel(i);
    expect(unlocked(lv).hats).toContain(h);
    expect(unlocked(lv - 1).hats).not.toContain(h);
  });
});

test("roster: attention first, then live, then off duty; temps after characters within a group; retired left out", () => {
  const s = emptyState();
  applySnapshot(s, snap({
    characters: [
      char("off", { name: "Off" }), char("gone", { name: "Gone", retired: true }),
      char("work", { name: "Work" }), char("ask", { name: "Ask" }), char("idle", { name: "Abe" }),
    ],
    repos: [repo("r")],
    sessions: [
      session("s1", "work", "r"), session("s2", "ask", "r", { state: "needs_input", attention: true }),
      session("s3", "idle", "r", { state: "idle" }), session("t1", null, "r"), session("t2", null, "r", { state: "done", attention: true }),
    ],
  }));
  const rows = rosterRows(s);
  expect(rows.map(r => r.id)).toEqual(["ask", "t2", "idle", "work", "t1", "off"]);
  expect(rows.find(r => r.id === "off")!.state).toBe("off_duty");
  expect(rows.find(r => r.id === "t1")!.temp).toBe(true);
  expect(rows.find(r => r.id === "t1")!.level).toBeNull();
});

test("ticker: the last N notice texts, newest first", () => {
  const ns = Array.from({ length: 12 }, (_, i) => notice(String(i)));
  const items = tickerItems(ns);
  expect(items).toHaveLength(CONFIG.client.tickerMax);
  expect(items[0]).toBe("notice 11");
  expect(items.at(-1)).toBe(`notice ${12 - CONFIG.client.tickerMax}`);
  expect(tickerItems([])).toEqual([]);
});

test("shouldAck: an explicit selection acks a session with attention, once per attention episode", () => {
  const s = session("k", "c", "r", { attention: true, state: "done", stateSince: 5, lastEventAt: 5 });
  expect(shouldAck(s, true, null)).toBe(true);                      // selected, never acked
  expect(shouldAck(s, false, null)).toBe(false);                    // a delta arriving while open is not a selection
  expect(shouldAck(s, true, ackEpisode(s))).toBe(false);            // already acked this episode
  expect(shouldAck({ ...s, attention: false }, true, null)).toBe(false);
  expect(shouldAck(undefined, true, null)).toBe(false);             // off duty: nothing to ack
  const again = { ...s, state: "needs_input" as const, stateSince: 9, lastEventAt: 9 };
  expect(shouldAck(again, true, ackEpisode(s))).toBe(true);         // a new episode on the same session
  const doneAgain = { ...s, lastEventAt: 12 };                      // a second task_done keeps state and stateSince
  expect(shouldAck(doneAgain, true, ackEpisode(s))).toBe(true);
});

test("rosterKey changes only when what the rows show changes", () => {
  const s = emptyState();
  applySnapshot(s, snap({ characters: [char("a"), char("b")], repos: [repo("r")], sessions: [session("1", "a", "r")] }));
  const title = (t: number): string => `T${t}`;
  const k = rosterKey(rosterRows(s), null, title);
  s.sessions.set("1", { ...s.sessions.get("1")!, lastEventAt: 99, activity: [{ at: 99, kind: "tool", text: "x" }] });
  expect(rosterKey(rosterRows(s), null, title)).toBe(k);           // an activity-only delta: same rows
  expect(rosterKey(rosterRows(s), "a", title)).not.toBe(k);        // selection
  expect(rosterKey(rosterRows(s), null, t => `U${t}`)).not.toBe(k); // theme titles
  s.sessions.set("1", { ...s.sessions.get("1")!, attention: true, state: "needs_input" });
  expect(rosterKey(rosterRows(s), null, title)).not.toBe(k);
});

test("renameTo: the trimmed name to send, or null to cancel (empty or unchanged)", () => {
  expect(renameTo("  Ada  ", "Bo")).toBe("Ada");
  expect(renameTo("   ", "Bo")).toBeNull();
  expect(renameTo("", "Bo")).toBeNull();
  expect(renameTo(" Bo ", "Bo")).toBeNull();
});

test("roster and plate labels: an unknown-tier session is Arriving, a real temp is Temp", () => {
  const arriving = session("a1", null, "r", { tierKnown: false });
  const temp = session("t1", null, "r");
  expect(unboundLabel(arriving)).toBe("Arriving");
  expect(unboundLabel(temp)).toBe("Temp");
  const s = emptyState();
  applySnapshot(s, snap({ repos: [repo("r")], sessions: [arriving, temp] }));
  const rows = rosterRows(s);
  expect(rows.find(r => r.id === "a1")).toMatchObject({ name: "Arriving", level: null, temp: true });
  expect(rows.find(r => r.id === "t1")).toMatchObject({ name: "Temp", level: null, temp: true });
  expect(plateText(unboundLabel(arriving), null, "Engineer", false)).toEqual({ name: "Arriving", rest: "" });
});

test("an arrival has no tier title: plate, roster sub-line and inspector title leave it out", () => {
  const title = (t: number) => `T${t}`;
  const arriving = session("a1", null, "r", { tierKnown: false, tier: 2 });
  const temp = session("t1", null, "r", { tier: 3 });
  expect(tierTitleOf(arriving, title)).toBeNull();
  expect(tierTitleOf(temp, title)).toBe("T3");
  expect(plateText("Arriving", null, null, true)).toEqual({ name: "Arriving", rest: "" });
  expect(plateText("Arriving", null, null, false)).toEqual({ name: "Arriving", rest: "" });
  const s = emptyState();
  applySnapshot(s, snap({ repos: [repo("r")], sessions: [arriving, temp] }));
  const rows = rosterRows(s);
  const a = rows.find(r => r.id === "a1")!, t = rows.find(r => r.id === "t1")!;
  expect(a.tier).toBeNull();
  expect(rosterSub(a, title)).toBe("working");
  expect(rosterSub(t, title)).toBe("T3 · working");
  expect(rosterKey(rows, null, title)).not.toContain("T2");
});

const ctx = (over: Partial<ContextInfo> = {}): ContextInfo =>
  ({ tokens: 143_000, peak: 143_000, limit: 200_000, estimated: true, compactions: 0, warned: false, seen: [], ...over });

test("formatTokens", () => {
  expect(formatTokens(950)).toBe("950");
  expect(formatTokens(143_200)).toBe("143k");
  expect(formatTokens(1_200_000)).toBe("1.2M");
  expect(formatTokens(200_000)).toBe("200k");
  expect(formatTokens(1_000_000)).toBe("1M");
});

test("contextLevel is calm under 60%, warm from 60%, hot from the warn threshold", () => {
  expect(contextLevel(ctx({ tokens: 119_999 }), 80)).toBe("calm");
  expect(contextLevel(ctx({ tokens: 120_000 }), 80)).toBe("warm");
  expect(contextLevel(ctx({ tokens: 160_000 }), 80)).toBe("hot");
  expect(contextLevel(ctx({ tokens: 130_000 }), 65)).toBe("hot");
});

test("contextLine rounds down, caps at 100, pluralises and drops 'estimated' with an override", () => {
  expect(contextLine(ctx({ compactions: 2 }))).toBe("Context 143k of 200k (71%, estimated) · 2 compactions this session");
  expect(contextLine(ctx({ tokens: 144_000, compactions: 1 }))).toBe("Context 144k of 200k (72%, estimated) · 1 compaction this session");
  expect(contextLine(ctx({ estimated: false }))).toBe("Context 143k of 200k (71%)");
  expect(contextLine(ctx({ tokens: 250_000 }))).toContain("(100%, estimated)");
});

test("sidekickLine lists types with ages, cuts types to 24 characters, and is null with none", () => {
  const now = 1_000_000;
  expect(sidekickLine([], now)).toBeNull();
  expect(sidekickLine([
    { id: "a", type: "Explore", since: now - 130_000, lastAt: now },
    { id: "b", type: "general-purpose", since: now - 40_000, lastAt: now },
  ], now)).toBe("Sidekicks: Explore (2 min), general-purpose (40 s)");
  expect(sidekickLine([{ id: "a", type: "x".repeat(40), since: now, lastAt: now }], now)).toBe(`Sidekicks: ${"x".repeat(24)} (0 s)`);
});

test("rosterRows carries context and a hot gauge does not change the order", () => {
  const s = emptyState();
  applySnapshot(s, snap({
    characters: [char("a"), char("b")], repos: [repo("r")],
    sessions: [session("ka", "a", "r", { context: ctx({ tokens: 190_000 }) }), session("kb", "b", "r")],
  }));
  const rows = rosterRows(s);
  expect(rows.map(r => r.id)).toEqual(["a", "b"]);
  expect(rows[0]!.context).toEqual({ pct: 95, level: "hot" });
  expect(rows[1]!.context).toBeNull();
  const before = rosterKey(rows, null, () => "T");
  s.sessions.get("ka")!.context = ctx({ tokens: 100_000 });
  expect(rosterKey(rosterRows(s), null, () => "T")).not.toBe(before);
});

test("applyDeltas ignores credit and learned_limit deltas", () => {
  const s = emptyState();
  applySnapshot(s, snap({ characters: [char("a")], repos: [repo("r")], sessions: [session("ka", "a", "r")] }));
  const before = JSON.stringify([...s.sessions], null, 0) + JSON.stringify([...s.characters]);
  expect(applyDeltas(s, [
    { type: "credit", at: 0, characterId: "a", repoId: "r", tasks: 1, tools: 1, failures: 0, xp: 5, levels: 0, compactions: 0, sidekicks: 0 },
    { type: "learned_limit", model: "m", limit: 500_000 },
  ])).toEqual([]);
  expect(JSON.stringify([...s.sessions]) + JSON.stringify([...s.characters])).toBe(before);
  expect(s.notices).toEqual([]);
});

test("tickerItems includes context_low notices", () => {
  const low = { ...notice("1"), kind: "context_low" as const, text: "Bo's context is 82% full" };
  expect(tickerItems([low])).toEqual(["Bo's context is 82% full"]);
});
