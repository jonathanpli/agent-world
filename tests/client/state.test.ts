import { expect, test } from "vitest";
import { activeRepos, applyDeltas, applySnapshot, emptyState, sessionOf } from "../../src/client/state";
import { CONFIG } from "../../src/shared/config";
import { char, notice, repo, session, snap } from "../helpers/clientFixtures";

test("snapshot then deltas", () => {
  const s = emptyState();
  applySnapshot(s, snap({ demo: true, characters: [char("a")], repos: [repo("r1")], sessions: [session("k1", "a", "r1")] }));
  expect(s.characters.size).toBe(1);
  expect(s.repos.size).toBe(1);
  expect(s.demo).toBe(true);
  expect(s.sessions.get("k1")?.state).toBe("working");
  const out = applyDeltas(s, [{ type: "session", session: session("k1", "a", "r1", { state: "done" }) }]);
  expect(out).toEqual([]);
  expect(s.sessions.get("k1")?.state).toBe("done");
  expect(sessionOf(s, "a")?.key).toBe("k1");
  expect(sessionOf(s, "nobody")).toBeUndefined();
});

test("character, repo and settings deltas replace their entries", () => {
  const s = emptyState();
  applySnapshot(s, snap({ characters: [char("a")] }));
  applyDeltas(s, [
    { type: "character", character: char("a", { name: "Ada" }) },
    { type: "repo", repo: repo("r9") },
    { type: "settings", settings: { ...CONFIG.defaultSettings, theme: "space" } },
  ]);
  expect(s.characters.get("a")?.name).toBe("Ada");
  expect(s.repos.has("r9")).toBe(true);
  expect(s.settings.theme).toBe("space");
});

test("credit deltas change nothing on the client", () => {
  const s = emptyState();
  applySnapshot(s, snap({ characters: [char("a")], repos: [repo("r1")], sessions: [session("k1", "a", "r1")] }));
  const before = structuredClone(s);
  const out = applyDeltas(s, [{ type: "credit", at: 1, characterId: "a", repoId: "r1", tasks: 1, tools: 2, failures: 0, xp: 30, levels: 0, compactions: 0, sidekicks: 0, commits: 0, prsOpened: 0, prsMerged: 0, testRuns: 0, testFails: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, costMicros: 0 } }]);
  expect(out).toEqual([]);
  expect(s).toEqual(before);
});

test("learned_limit deltas change nothing on the client", () => {
  const s = emptyState();
  applySnapshot(s, snap({ characters: [char("a")], repos: [repo("r1")], sessions: [session("k1", "a", "r1")] }));
  const before = structuredClone(s);
  expect(applyDeltas(s, [{ type: "learned_limit", model: "m", limit: 180_000 }])).toEqual([]);
  expect(s).toEqual(before);
});

test("session_removed and notices", () => {
  const s = emptyState();
  applySnapshot(s, snap({ characters: [char("a")], repos: [repo("r1")], sessions: [session("k1", "a", "r1")] }));
  const out = applyDeltas(s, [{ type: "session_removed", key: "k1" }, { type: "notice", notice: notice("n1") }]);
  expect(s.sessions.has("k1")).toBe(false);
  expect(out.map(n => n.id)).toEqual(["n1"]);
  expect(s.notices.map(n => n.id)).toEqual(["n1"]);
  const many = Array.from({ length: 60 }, (_, i) => ({ type: "notice" as const, notice: notice(`m${i}`) }));
  expect(applyDeltas(s, many)).toHaveLength(60);
  expect(s.notices).toHaveLength(CONFIG.client.noticeMax);
  expect(s.notices.at(-1)?.id).toBe("m59");                  // newest last
  expect(s.notices[0]?.id).toBe("m10");
});

test("re-snapshot replaces, never duplicates (Review Focus 4)", () => {
  const s = emptyState();
  applySnapshot(s, snap({
    characters: [char("a"), char("b")], repos: [repo("r1")],
    sessions: [session("k1", "a", "r1"), session("k2", "b", "r1")],
  }));
  applyDeltas(s, [{ type: "session", session: session("k3", null, "r1") }, { type: "notice", notice: notice("n1") }]);
  applySnapshot(s, snap({ characters: [char("a")], repos: [repo("r1")], sessions: [] }));
  expect(s.characters.size).toBe(1);
  expect(s.sessions.size).toBe(0);
  expect(s.notices.map(n => n.id)).toEqual(["n1"]);
});

test("activeRepos only lists repos with sessions, in stable order", () => {
  const s = emptyState();
  applySnapshot(s, snap({
    repos: [repo("late", 30), repo("idle", 5), repo("b", 10), repo("a", 10)],
    sessions: [session("k1", null, "late"), session("k2", null, "b"), session("k3", null, "a"), session("k4", null, "a")],
  }));
  expect(activeRepos(s).map(r => r.id)).toEqual(["a", "b", "late"]);
  applyDeltas(s, [{ type: "session_removed", key: "k1" }]);
  expect(activeRepos(s).map(r => r.id)).toEqual(["a", "b"]);
});

test("the focus map comes with the snapshot and follows focus deltas", () => {
  const s = emptyState();
  expect(s.focus).toEqual(new Map());
  applySnapshot(s, snap({ focus: { k1: "exact" } }));
  expect(s.focus).toEqual(new Map([["k1", "exact"]]));
  expect(applyDeltas(s, [{ type: "focus", key: "k2", precision: "app" }, { type: "focus", key: "k1", precision: null }])).toEqual([]);
  expect(s.focus).toEqual(new Map([["k2", "app"]]));
  applySnapshot(s, snap());
  expect(s.focus).toEqual(new Map());
});

test("the shop comes with the snapshot and follows shop deltas", () => {
  const s = emptyState();
  applySnapshot(s, snap({ shop: { coins: 7, owned: [] } }));
  expect(s.shop.coins).toBe(7);
  applyDeltas(s, [{ type: "shop", shop: { coins: 3, owned: [] } }]);
  expect(s.shop.coins).toBe(3);
});
