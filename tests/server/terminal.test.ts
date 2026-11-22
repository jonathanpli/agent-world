import { expect, test } from "vitest";
import { asTerminalInfo, mergeTerminal, terminalFromHeaders } from "../../src/server/terminal";

const VALID = {
  "x-aw-bundle-id": "com.googlecode.iterm2", "x-aw-term-program": "iTerm.app", "x-aw-iterm-session": "w0t1p0:6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C",
  "x-aw-tty": "ttys012", "x-aw-tmux-pane": "%12", "x-aw-tmux-socket": "/private/tmp/tmux-501/default",
  "x-aw-cmux-workspace": "ws_0a1b2c", "x-aw-cmux-surface": "sf.3d4e5f", "x-aw-cmux-panel": "pn-6a7b8c", "x-aw-cmux-socket": "/tmp/cmux.sock",
};
const FULL = {
  bundleId: "com.googlecode.iterm2", termProgram: "iTerm.app", itermSession: "w0t1p0:6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C",
  tty: "ttys012", tmuxPane: "%12", tmuxSocket: "/private/tmp/tmux-501/default",
  cmuxWorkspace: "ws_0a1b2c", cmuxSurface: "sf.3d4e5f", cmuxPanel: "pn-6a7b8c", cmuxSocket: "/tmp/cmux.sock",
};
const FIELD: Record<string, keyof typeof FULL> = {
  "x-aw-bundle-id": "bundleId", "x-aw-term-program": "termProgram", "x-aw-iterm-session": "itermSession", "x-aw-tty": "tty",
  "x-aw-tmux-pane": "tmuxPane", "x-aw-tmux-socket": "tmuxSocket", "x-aw-cmux-workspace": "cmuxWorkspace",
  "x-aw-cmux-surface": "cmuxSurface", "x-aw-cmux-panel": "cmuxPanel", "x-aw-cmux-socket": "cmuxSocket",
};
/** Review Focus 2, plus values that are fine for one field but not another. */
const HOSTILE = ["", "has space", 'quo"te', "new\nline", "$(touch x)", "`touch x`", "a".repeat(10_000), "relative/sock", "semi;colon", "ünï"];

test("valid values are kept, unknown headers ignored", () => {
  expect(terminalFromHeaders({ ...VALID, host: "127.0.0.1:4317", "x-aw-other": "zzz" })).toEqual(FULL);
  expect(terminalFromHeaders({ "x-aw-term-program": "vscode" })).toEqual({ termProgram: "vscode" });
});

test("each hostile value is dropped field by field (Review Focus 2)", () => {
  for (const header of Object.keys(VALID)) {
    for (const bad of HOSTILE) {
      const { [FIELD[header]!]: _dropped, ...rest } = FULL;
      expect(terminalFromHeaders({ ...VALID, [header]: bad }), `${header}=${JSON.stringify(bad.slice(0, 20))}`).toEqual(rest);
    }
  }
});

test("patterns at their edges", () => {
  const one = (h: string, v: string) => terminalFromHeaders({ [h]: v });
  expect(one("x-aw-tmux-pane", "a".repeat(80))).toEqual({ tmuxPane: "a".repeat(80) });
  expect(one("x-aw-tmux-pane", "a".repeat(81))).toBeNull();
  expect(one("x-aw-tmux-pane", "A.z:9_%-")).toEqual({ tmuxPane: "A.z:9_%-" });
  expect(one("x-aw-bundle-id", "com.apple.Terminal")).toEqual({ bundleId: "com.apple.Terminal" });
  expect(one("x-aw-bundle-id", "com.apple:Terminal")).toBeNull();          // ':' is an id character, not a bundle id one
  expect(one("x-aw-bundle-id", "com_apple")).toBeNull();
  expect(one("x-aw-tmux-socket", `/${"a".repeat(199)}`)).toEqual({ tmuxSocket: `/${"a".repeat(199)}` });
  expect(one("x-aw-tmux-socket", `/${"a".repeat(200)}`)).toBeNull();
  expect(one("x-aw-tmux-socket", "/")).toBeNull();
  expect(one("x-aw-tmux-socket", "/tmp/../etc")).toEqual({ tmuxSocket: "/tmp/../etc" });   // only characters are checked
  expect(one("x-aw-tty", "ttys0")).toEqual({ tty: "ttys0" });
  expect(one("x-aw-tty", "ttys0000")).toEqual({ tty: "ttys0000" });
  expect(one("x-aw-tty", "ttys00000")).toBeNull();
  expect(one("x-aw-tty", "ttys")).toBeNull();
  expect(one("x-aw-tty", "/dev/ttys001")).toBeNull();
  expect(one("x-aw-tty", "ttys001\n")).toBeNull();
});

test("a repeated header (an array) is ignored", () => {
  expect(terminalFromHeaders({ ...VALID, "x-aw-tty": ["ttys001", "ttys002"] })).toEqual({ ...FULL, tty: undefined });
  expect(terminalFromHeaders({ "x-aw-tty": ["ttys001"] })).toBeNull();
  // Node joins most repeated headers into one comma-separated string: that never matches a pattern either
  expect(terminalFromHeaders({ ...VALID, "x-aw-tty": "ttys001, ttys002" })).toEqual({ ...FULL, tty: undefined });
  expect(terminalFromHeaders({ "x-aw-tty": "ttys001, ttys002" })).toBeNull();
  expect(terminalFromHeaders({ "x-aw-bundle-id": "com.apple.Terminal, com.googlecode.iterm2" })).toBeNull();
});

test("nothing valid gives null", () => {
  expect(terminalFromHeaders({})).toBeNull();
  expect(terminalFromHeaders({ host: "localhost", "content-type": "application/json" })).toBeNull();
  expect(terminalFromHeaders(Object.fromEntries(Object.keys(VALID).map(h => [h, "$(touch x)"])))).toBeNull();
  expect(terminalFromHeaders({ "x-aw-tty": undefined })).toBeNull();
});

test("a stored terminal is validated again when read back", () => {
  expect(asTerminalInfo(FULL)).toEqual(FULL);
  expect(asTerminalInfo({ ...FULL, tty: "$(x)", extra: "y", tmuxPane: 7 })).toEqual({ ...FULL, tty: undefined, tmuxPane: undefined });
  for (const v of [null, undefined, "ttys001", 42, [], [FULL], {}]) expect(asTerminalInfo(v)).toBeNull();
});

test("mergeTerminal: the same bundle id (or none in both) merges field-wise; new fields win, missing ones keep", () => {
  const stored = { bundleId: "com.apple.Terminal", tty: "ttys004", tmuxPane: "%1" };
  expect(mergeTerminal(stored, { bundleId: "com.apple.Terminal", tmuxPane: "%2" })).toEqual({ bundleId: "com.apple.Terminal", tty: "ttys004", tmuxPane: "%2" });
  expect(mergeTerminal({ tty: "ttys004" }, { cmuxWorkspace: "ws_1" })).toEqual({ tty: "ttys004", cmuxWorkspace: "ws_1" });
  expect(mergeTerminal(undefined, { tty: "ttys004" })).toEqual({ tty: "ttys004" });
  expect(stored).toEqual({ bundleId: "com.apple.Terminal", tty: "ttys004", tmuxPane: "%1" });   // inputs are not changed
});

test("mergeTerminal: a different bundle id (or one side without it) replaces wholesale", () => {
  const stored = { bundleId: "com.apple.Terminal", tty: "ttys004" };
  expect(mergeTerminal(stored, { bundleId: "com.googlecode.iterm2", itermSession: "w0t0p0:A" })).toEqual({ bundleId: "com.googlecode.iterm2", itermSession: "w0t0p0:A" });
  expect(mergeTerminal(stored, { tmuxPane: "%1" })).toEqual({ tmuxPane: "%1" });
  expect(mergeTerminal({ tty: "ttys004" }, { bundleId: "com.apple.Terminal" })).toEqual({ bundleId: "com.apple.Terminal" });
});
