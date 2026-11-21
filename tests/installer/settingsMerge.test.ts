import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { HOOK_EVENTS, mergeHooks, removeHooks } from "../../src/installer/settingsMerge";

const S = "/x/hooks/forward.sh";
const fx = (n: string): any => JSON.parse(readFileSync(`tests/fixtures/settings/${n}.json`, "utf8"));

test("adds all seven events to empty settings", () => {
  const out = mergeHooks({}, S) as any;
  expect(Object.keys(out.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
  expect(out.hooks.Stop[0].hooks[0]).toEqual({ type: "command", command: S, timeout: 5 });
});

test("keeps existing hooks and other keys (the owner's real shape)", () => {
  const before = fx("existing-hooks");
  const out = mergeHooks(before, S) as any;
  expect(out.hooks.PreToolUse).toEqual(before.hooks.PreToolUse);
  expect(out.hooks.PostToolUse[0]).toEqual(before.hooks.PostToolUse[0]);
  expect(out.hooks.PostToolUse).toHaveLength(2);
  expect(out.permissions).toEqual(before.permissions);
  expect(out.model).toBe(before.model);
});

test("idempotent", () => {
  const once = mergeHooks(fx("existing-hooks"), S);
  expect(mergeHooks(once, S)).toEqual(once);
});

test("already-installed fixture is a fixed point", () => {
  const a = fx("already-installed");
  expect(mergeHooks(a, S)).toEqual(a);
});

test("does not mutate its input", () => {
  const a = fx("existing-hooks");
  const copy = structuredClone(a);
  mergeHooks(a, S);
  expect(a).toEqual(copy);
  const m = mergeHooks(a, S);
  const mcopy = structuredClone(m);
  removeHooks(m, S);
  expect(m).toEqual(mcopy);
});

test("uninstall restores the original exactly", () => {
  for (const n of ["empty", "existing-hooks", "no-hooks-key"]) expect(removeHooks(mergeHooks(fx(n), S), S)).toEqual(fx(n));
});

test("uninstall leaves a different checkout's entries alone", () => {
  const other = "/other/forward.sh";
  const both = mergeHooks(mergeHooks({}, S), other) as any;
  const out = removeHooks(both, S) as any;
  expect(out).toEqual(mergeHooks({}, other));
  expect(out.hooks.Stop[0].hooks[0].command).toBe(other);
});

test("uninstall removes only our hook from a group that shares it with others", () => {
  const s = { hooks: { Stop: [{ hooks: [{ type: "command", command: "keep" }, { type: "command", command: S }] }] } };
  expect(removeHooks(s, S)).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: "keep" }] }] } });
});

test("throws on a hooks value that is not an object", () => {
  expect(() => mergeHooks(fx("hooks-not-object"), S)).toThrow(/hooks/);
  expect(() => removeHooks(fx("hooks-not-object"), S)).toThrow(/hooks/);
});

test("throws on an event value that is not an array", () => {
  expect(() => mergeHooks(fx("event-not-array"), S)).toThrow(/hooks\.Stop/);
  expect(() => removeHooks(fx("event-not-array"), S)).toThrow(/hooks\.Stop/);
});
