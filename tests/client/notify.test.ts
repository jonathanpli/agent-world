import { afterEach, expect, test, vi } from "vitest";
import { attentionCount, deliver, notificationFor, tabTitle, toastFor, visibleToasts } from "../../src/client/notify";
import { applySnapshot, emptyState } from "../../src/client/state";
import { CONFIG } from "../../src/shared/config";
import type { MomentKind, Notice, NoticeKind, Settings } from "../../src/shared/types";
import { char, repo, session, snap } from "../helpers/clientFixtures";

const on: Settings = { ...CONFIG.defaultSettings, notifyNeedsInput: true, notifyDone: true, sound: false };
const n = (kind: NoticeKind): Notice => ({ id: "1", at: 0, kind, sessionKey: "k", characterId: "c", characterName: "Bo", repoName: "api-server", text: "Bo needs you in api-server" });

afterEach(() => { vi.unstubAllGlobals(); });

test("notificationFor titles needs_input and done, and respects the toggles", () => {
  expect(notificationFor(n("needs_input"), on)).toEqual({ title: "Bo needs you — api-server", body: "Bo needs you in api-server" });
  expect(notificationFor(n("done"), on)!.title).toBe("Bo finished — api-server");
  expect(notificationFor(n("needs_input"), { ...on, notifyNeedsInput: false })).toBeNull();
  expect(notificationFor(n("done"), { ...on, notifyDone: false })).toBeNull();
  expect(notificationFor(n("level_up"), on)).toBeNull();
  expect(notificationFor(n("achievement"), on)).toBeNull();
});

test("notificationFor leaves the repo off when the notice has none", () => {
  expect(notificationFor({ ...n("done"), repoName: null }, on)!.title).toBe("Bo finished");
});

test("tabTitle shows the count only when there is one", () => {
  expect(tabTitle(0)).toBe("Agent World");
  expect(tabTitle(2)).toBe("(2) Agent World");
});

test("attentionCount counts sessions with attention", () => {
  const s = emptyState();
  applySnapshot(s, snap({
    characters: [char("a"), char("b")], repos: [repo("r")],
    sessions: [session("1", "a", "r", { attention: true }), session("2", "b", "r"), session("3", null, "r", { attention: true, state: "done" })],
  }));
  expect(attentionCount(s)).toBe(2);
  expect(attentionCount(emptyState())).toBe(0);
});

test("attentionCount counts every session with attention, whoever it is bound to", () => {
  const s = emptyState();
  applySnapshot(s, snap({
    characters: [char("a"), char("gone", { retired: true })], repos: [repo("r")],
    sessions: [session("1", "a", "r", { attention: true }), session("2", "gone", "r", { attention: true }), session("3", "a", "r")],
  }));
  expect(attentionCount(s)).toBe(2);
});

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static made: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  closed = false;
  constructor(public title: string, public options: NotificationOptions) { FakeNotification.made.push(this); }
  close(): void { this.closed = true; }
}

class FakeAudio {
  static made: FakeAudio[] = [];
  oscillators: { frequency: number; start: number; stop: number }[] = [];
  currentTime = 10;
  state = "running";
  destination = {};
  constructor() { FakeAudio.made.push(this); }
  resume(): Promise<void> { return Promise.resolve(); }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
  }
  createOscillator() {
    const rec = { frequency: 0, start: 0, stop: 0 };
    this.oscillators.push(rec);
    return {
      type: "sine",
      frequency: { set value(v: number) { rec.frequency = v; }, get value() { return rec.frequency; } },
      connect() {}, start(t: number) { rec.start = t; }, stop(t: number) { rec.stop = t; },
    };
  }
}

test("deliver shows a system notification when permission is granted; clicking it focuses and selects", () => {
  FakeNotification.made = [];
  FakeNotification.permission = "granted";
  const focus = vi.fn();
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("focus", focus);
  const onClick = vi.fn();
  deliver(n("needs_input"), on, onClick);
  expect(FakeNotification.made).toHaveLength(1);
  const made = FakeNotification.made[0]!;
  expect(made.title).toBe("Bo needs you — api-server");
  expect(made.options.body).toBe("Bo needs you in api-server");
  made.onclick!();
  expect(focus).toHaveBeenCalled();
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(made.closed).toBe(true);
});

test("deliver shows nothing without permission, for silent kinds, or with the toggle off", () => {
  FakeNotification.made = [];
  vi.stubGlobal("Notification", FakeNotification);
  FakeNotification.permission = "default";
  deliver(n("needs_input"), on, () => {});
  FakeNotification.permission = "granted";
  deliver(n("level_up"), on, () => {});
  deliver(n("done"), { ...on, notifyDone: false }, () => {});
  expect(FakeNotification.made).toHaveLength(0);
});

test("deliver plays two short sine tones only when sound is on", () => {
  FakeAudio.made = [];
  vi.stubGlobal("AudioContext", FakeAudio);
  deliver(n("done"), { ...on, sound: false }, () => {});
  const before = FakeAudio.made.reduce((k, a) => k + a.oscillators.length, 0);
  expect(before).toBe(0);
  deliver(n("done"), { ...on, sound: true }, () => {});
  const oscs = FakeAudio.made.flatMap(a => a.oscillators);
  expect(oscs).toHaveLength(2);
  expect(oscs.map(o => o.frequency)).toEqual([...CONFIG.client.chime.tonesHz]);
  for (const o of oscs) expect(o.stop - o.start).toBeCloseTo(CONFIG.client.chime.toneS);
  expect(oscs[1]!.start).toBeGreaterThan(oscs[0]!.start);
});

test("deliver never throws when Notification and AudioContext are absent or broken", () => {
  vi.stubGlobal("Notification", undefined);
  vi.stubGlobal("AudioContext", undefined);
  expect(() => deliver(n("needs_input"), { ...on, sound: true }, () => {})).not.toThrow();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("Notification", class { static permission = "granted"; constructor() { throw new Error("nope"); } });
  vi.stubGlobal("AudioContext", class { constructor() { throw new Error("nope"); } });
  expect(() => deliver(n("needs_input"), { ...on, sound: true }, () => {})).not.toThrow();
  expect(warn).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});

test("toastFor toasts needs_input and done under their notification toggles, level_up always, achievements never", () => {
  expect(toastFor(n("needs_input"), on)).toBe("Bo needs you in api-server");
  expect(toastFor(n("done"), on)).toBe("Bo needs you in api-server");
  expect(toastFor({ ...n("level_up"), text: "Bo reached level 3" }, on)).toBe("Bo reached level 3");
  expect(toastFor(n("level_up"), { ...on, notifyNeedsInput: false, notifyDone: false })).not.toBeNull();
  expect(toastFor(n("needs_input"), { ...on, notifyNeedsInput: false })).toBeNull();
  expect(toastFor(n("done"), { ...on, notifyDone: false })).toBeNull();
  expect(toastFor(n("achievement"), on)).toBeNull();
});

test("visibleToasts keeps the newest CONFIG.client.toastMax", () => {
  expect(CONFIG.client.toastMax).toBe(3);
  expect(visibleToasts([1, 2, 3, 4, 5])).toEqual([3, 4, 5]);
  expect(visibleToasts([1])).toEqual([1]);
});

test("context_low toasts and notifies only while notifyContext is on", () => {
  const low = { ...n("context_low"), text: "Bo's context is 82% full" };
  expect(toastFor(low, { ...on, notifyContext: true })).toBe("Bo's context is 82% full");
  expect(toastFor(low, { ...on, notifyContext: false })).toBeNull();
  expect(notificationFor(low, { ...on, notifyContext: true })).toEqual({ title: "Bo — context running low", body: "Bo's context is 82% full" });
  expect(notificationFor(low, { ...on, notifyContext: false })).toBeNull();
});

test("attentionCount ignores sessions that are only warned", () => {
  const s = emptyState();
  applySnapshot(s, snap({ characters: [char("a")], repos: [repo("r")], sessions: [
    session("k", "a", "r", { attention: false, context: { tokens: 190_000, peak: 190_000, limit: 200_000, estimated: true, compactions: 0, warned: true, seen: [] } })] }));
  expect(attentionCount(s)).toBe(0);
});

test("moments: only pr_merged toasts, none notify", () => {
  const m = (moment: MomentKind): Notice => ({ ...n("moment"), moment, text: "Bo did a thing" });
  for (const k of ["commit", "push", "pr_opened", "tests_passed", "tests_failed"] as const) expect(toastFor(m(k), on)).toBeNull();
  expect(toastFor(m("pr_merged"), on)).toBe("Bo did a thing");
  for (const k of ["commit", "pr_merged", "tests_failed"] as const) expect(notificationFor(m(k), on)).toBeNull();
});
