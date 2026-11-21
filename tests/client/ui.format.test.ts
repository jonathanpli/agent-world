import { expect, test } from "vitest";
import { ackEpisode, formatDuration, lockLevel, renameTo, shouldAck, xpProgress } from "../../src/client/ui/inspector";
import { rosterKey, rosterRows } from "../../src/client/ui/roster";
import { tickerItems } from "../../src/client/ui/ticker";
import { applySnapshot, emptyState, unboundLabel } from "../../src/client/state";
import { plateText } from "../../src/client/engine/overlay";
import { HATS, unlocked } from "../../src/shared/cosmetics";
import { CONFIG } from "../../src/shared/config";
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
