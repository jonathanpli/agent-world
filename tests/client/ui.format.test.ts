import { expect, test } from "vitest";
import { formatDuration, lockLevel, xpProgress } from "../../src/client/ui/inspector";
import { rosterRows } from "../../src/client/ui/roster";
import { tickerItems } from "../../src/client/ui/ticker";
import { applySnapshot, emptyState } from "../../src/client/state";
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
