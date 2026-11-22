import { homedir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import { defaultRun, focusTerminal, precisionFor, type Run } from "../../src/server/focus";
import type { TerminalInfo } from "../../src/server/terminal";

type Call = { file: string; args: string[]; timeoutMs: number };
type Reply = { code: number; stdout?: string; stderr?: string };

/** A recording `run`: answers each call with `answer(file, args)` (default: success) and keeps every call. */
function recorder(answer: (file: string, args: string[]) => Reply | Promise<Reply> = () => ({ code: 0 })): { run: Run; calls: Call[] } {
  const calls: Call[] = [];
  const run: Run = async (file, args, opts) => {
    calls.push({ file, args: [...args], timeoutMs: opts.timeoutMs });
    const r = await answer(file, args);
    return { code: r.code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}
const pairs = (calls: Call[]) => calls.map(c => [c.file, c.args]);
/** The non-flag arguments after the AppleScript (`-e <line>` pairs): what `on run argv` receives. */
const argvOf = (c: Call): string[] => { const a = [...c.args]; const out: string[] = []; while (a.length) { const x = a.shift()!; if (x === "-e") a.shift(); else out.push(x); } return out; };
const scriptOf = (c: Call): string => c.args.filter((_, i) => c.args[i - 1] === "-e").join("\n");

afterEach(() => { vi.useRealTimers(); });

const ITERM: TerminalInfo = { bundleId: "com.googlecode.iterm2", termProgram: "iTerm.app", itermSession: "w0t1p0:6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C", tty: "ttys012" };
const TERMINAL_APP: TerminalInfo = { bundleId: "com.apple.Terminal", termProgram: "Apple_Terminal", tty: "ttys004" };
const CMUX: TerminalInfo = { bundleId: "com.cmuxterm.app", cmuxWorkspace: "ws_0a1b2c", cmuxSurface: "sf.3d4e5f", cmuxPanel: "pn-6a7b8c", cmuxSocket: "/tmp/cmux.sock" };
const VSCODE: TerminalInfo = { bundleId: "com.microsoft.VSCode", termProgram: "vscode" };
const GHOSTTY: TerminalInfo = { bundleId: "com.mitchellh.ghostty", termProgram: "ghostty" };
const TMUX = { tmuxPane: "%12", tmuxSocket: "/private/tmp/tmux-501/default" };

test("precisionFor picks the first matching driver's precision", () => {
  const table: [TerminalInfo | null, "exact" | "app" | null][] = [
    [{ ...CMUX, ...TMUX }, "exact"],                                  // cmux inside tmux
    [{ cmuxWorkspace: "ws_1" }, "exact"],                             // a cmux workspace alone is enough
    [ITERM, "exact"],
    [{ itermSession: "w0t0p0:6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C" }, "exact"],
    [{ itermSession: "6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C" }, "exact"],
    [{ itermSession: "w0t0p0:ABC" }, null],                           // not a UUID: the iTerm driver does not match
    [{ itermSession: "-equit" }, null],
    [{ itermSession: "w0t0p0:-i" }, null],
    [{ bundleId: "com.googlecode.iterm2", itermSession: "-equit" }, "app"],   // falls through to the generic driver
    [{ cmuxWorkspace: "-x" }, null],
    [{ cmuxWorkspace: "ws_1", cmuxPanel: "-x", bundleId: "com.cmuxterm.app" }, "app"],
    [{ bundleId: "com.apple.Terminal", tty: "-x" }, "app"],           // Terminal driver refuses it; the generic one activates the app
    [TERMINAL_APP, "exact"],
    [{ bundleId: "com.apple.Terminal" }, "app"],                      // no tty: only the app
    [VSCODE, "exact"],
    [{ termProgram: "vscode" }, null],                                // nothing to open the folder with
    [GHOSTTY, "app"],
    [{ bundleId: "com.example.term" }, "app"],
    [{ bundleId: "-a" }, null],                                       // would read as an option of `open`
    [{ ...TMUX }, null],                                              // tmux is a layer, not a driver
    [{ tty: "ttys001" }, null],
    [{}, null],
    [null, null],
  ];
  for (const [t, want] of table) expect([t, precisionFor(t, "darwin")]).toEqual([t, want]);
  for (const [t] of table) expect(precisionFor(t, "linux")).toBeNull();
  expect(precisionFor(ITERM, "win32")).toBeNull();
});

test("iTerm2: fixed AppleScript with the session UUID as its only argument, nothing else run", async () => {
  const { run, calls } = recorder(() => ({ code: 0, stdout: "ok\n" }));
  expect(await focusTerminal(ITERM, "/repo", run, "darwin")).toEqual({ precision: "exact" });
  expect(calls).toHaveLength(1);
  const [c] = calls;
  expect(c!.file).toBe("/usr/bin/osascript");
  expect(c!.timeoutMs).toBe(3000);
  expect(argvOf(c!)).toEqual(["6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C"]);   // the UUID part after the colon
  expect(scriptOf(c!)).toContain("on run argv");
  expect(scriptOf(c!)).toContain('application id "com.googlecode.iterm2"');
  expect(scriptOf(c!)).not.toContain("6B29A1C4");
  expect(scriptOf(c!)).not.toContain("w0t1p0");
});

test("iTerm2: an id without a colon is passed whole when it is a UUID", async () => {
  const { run, calls } = recorder(() => ({ code: 0, stdout: "ok\n" }));
  await focusTerminal({ itermSession: "6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C" }, "/repo", run, "darwin");
  expect(argvOf(calls[0]!)).toEqual(["6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C"]);
});

test("iTerm2: an id osascript could read as an option never reaches it (review finding)", async () => {
  for (const itermSession of ["-equit", "w0t0p0:-i", "w:-ebeep", "w0t0p0:6B29A1C4"]) {
    const { run, calls } = recorder(() => ({ code: 0, stdout: "ok\n" }));
    expect(await focusTerminal({ itermSession }, "/repo", run, "darwin")).toBeNull();
    expect(await focusTerminal({ itermSession, bundleId: "com.googlecode.iterm2" }, "/repo", run, "darwin")).toEqual({ precision: "app" });
    expect(pairs(calls)).toEqual([["/usr/bin/open", ["-b", "com.googlecode.iterm2"]]]);
  }
});

test("an identifier with a leading '-' never reaches run, in any field or argument position", async () => {
  const BAD = "-zqbad";
  const bases: TerminalInfo[] = [ITERM, TERMINAL_APP, { ...CMUX, ...TMUX }, VSCODE, GHOSTTY, { ...ITERM, ...CMUX, ...TMUX }];
  const fields: (keyof TerminalInfo)[] = ["itermSession", "tty", "bundleId", "cmuxWorkspace", "cmuxSurface", "cmuxPanel", "tmuxPane"];
  for (const base of bases) {
    for (const field of fields) {
      const t = { ...base, [field]: BAD };
      const { run, calls } = recorder(() => ({ code: 0, stdout: "ok\n" }));
      const r = await focusTerminal(t, "/repo", run, "darwin");
      expect(r === null ? null : r.precision).toBe(precisionFor(t, "darwin"));
      for (const c of calls) {
        expect(c.file).not.toContain("zqbad");
        for (const a of c.args) expect(a, `${field} in ${JSON.stringify(base)}`).not.toContain("zqbad");
      }
    }
  }
});

test("iTerm2: a session that is gone, or a refused script, brings iTerm to the front with a note", async () => {
  for (const reply of [{ code: 0, stdout: "missing\n" }, { code: 1, stderr: "Not authorised to send Apple events" }]) {
    const { run, calls } = recorder(file => (file === "/usr/bin/osascript" ? reply : { code: 0 }));
    const r = await focusTerminal(ITERM, "/repo", run, "darwin");
    expect(r?.precision).toBe("app");
    expect(r?.note).toBeTruthy();
    expect(pairs(calls).at(-1)).toEqual(["/usr/bin/open", ["-b", "com.googlecode.iterm2"]]);
  }
});

test("Terminal.app: fixed AppleScript selecting the tab by tty", async () => {
  const { run, calls } = recorder(() => ({ code: 0, stdout: "ok\n" }));
  expect(await focusTerminal(TERMINAL_APP, "/repo", run, "darwin")).toEqual({ precision: "exact" });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.file).toBe("/usr/bin/osascript");
  expect(argvOf(calls[0]!)).toEqual(["ttys004"]);
  expect(scriptOf(calls[0]!)).toContain("on run argv");
  expect(scriptOf(calls[0]!)).toContain('application id "com.apple.Terminal"');
  expect(scriptOf(calls[0]!)).not.toContain("ttys004");
});

test("Terminal.app without a tty only activates the app", async () => {
  const { run, calls } = recorder();
  expect(await focusTerminal({ bundleId: "com.apple.Terminal" }, "/repo", run, "darwin")).toEqual({ precision: "app" });
  expect(pairs(calls)).toEqual([["/usr/bin/open", ["-b", "com.apple.Terminal"]]]);
});

test("Terminal.app: no tab with that tty brings Terminal to the front with a note", async () => {
  const { run, calls } = recorder(file => (file === "/usr/bin/osascript" ? { code: 0, stdout: "missing\n" } : { code: 0 }));
  const r = await focusTerminal(TERMINAL_APP, "/repo", run, "darwin");
  expect(r).toMatchObject({ precision: "app" });
  expect(r?.note).toBeTruthy();
  expect(pairs(calls).at(-1)).toEqual(["/usr/bin/open", ["-b", "com.apple.Terminal"]]);
});

test("editor: opens the repo folder with the editor's bundle id", async () => {
  const { run, calls } = recorder();
  expect(await focusTerminal(VSCODE, "/Users/me/proj", run, "darwin")).toEqual({ precision: "exact" });
  expect(pairs(calls)).toEqual([["/usr/bin/open", ["-b", "com.microsoft.VSCode", "/Users/me/proj"]]]);
});

test("editor: a repo path that is not absolute is never passed; the editor is only activated", async () => {
  for (const repo of ["", "-a", "relative/dir"]) {
    const { run, calls } = recorder();
    const r = await focusTerminal(VSCODE, repo, run, "darwin");
    expect(r?.precision).toBe("app");
    expect(r?.note).toBeTruthy();
    expect(pairs(calls)).toEqual([["/usr/bin/open", ["-b", "com.microsoft.VSCode"]]]);
  }
});

test("generic: activates the app by bundle id", async () => {
  const { run, calls } = recorder();
  expect(await focusTerminal(GHOSTTY, "/repo", run, "darwin")).toEqual({ precision: "app" });
  expect(pairs(calls)).toEqual([["/usr/bin/open", ["-b", "com.mitchellh.ghostty"]]]);
});

test("generic: an app that cannot be activated gives a note", async () => {
  const { run } = recorder(() => ({ code: 1, stderr: "Unable to find application" }));
  const r = await focusTerminal(GHOSTTY, "/repo", run, "darwin");
  expect(r?.precision).toBe("app");
  expect(r?.note).toBeTruthy();
});

test("cmux: CLI on PATH selects the workspace, then the panel, with --socket before the command; then activates cmux", async () => {
  const { run, calls } = recorder();
  expect(await focusTerminal(CMUX, "/repo", run, "darwin")).toEqual({ precision: "exact" });
  expect(pairs(calls)).toEqual([
    ["cmux", ["--socket", "/tmp/cmux.sock", "select-workspace", "--workspace", "ws_0a1b2c"]],
    ["cmux", ["--socket", "/tmp/cmux.sock", "focus-panel", "--panel", "pn-6a7b8c", "--workspace", "ws_0a1b2c"]],
    ["/usr/bin/open", ["-b", "com.cmuxterm.app"]],
  ]);
  expect(calls.every(c => c.timeoutMs === 3000)).toBe(true);
});

test("cmux: no socket and no panel known → just select-workspace; no bundle id → cmux's own id is activated", async () => {
  const { run, calls } = recorder();
  expect(await focusTerminal({ cmuxWorkspace: "ws_1" }, "/repo", run, "darwin")).toEqual({ precision: "exact" });
  expect(pairs(calls)).toEqual([
    ["cmux", ["select-workspace", "--workspace", "ws_1"]],
    ["/usr/bin/open", ["-b", "com.cmuxterm.app"]],
  ]);
});

test("cmux: CLI missing on PATH → the app bundle found by bundle id is used", async () => {
  const bundled = "/Volumes/Apps/cmux.app/Contents/Resources/bin/cmux";
  const { run, calls } = recorder(file => {
    if (file === "cmux") return { code: 127 };
    if (file === "/usr/bin/mdfind") return { code: 0, stdout: "/Volumes/Apps/cmux.app\n" };
    return { code: 0 };
  });
  expect(await focusTerminal(CMUX, "/repo", run, "darwin")).toEqual({ precision: "exact" });
  expect(pairs(calls)).toEqual([
    ["cmux", ["--socket", "/tmp/cmux.sock", "select-workspace", "--workspace", "ws_0a1b2c"]],
    ["/usr/bin/mdfind", ["kMDItemCFBundleIdentifier == 'com.cmuxterm.app'"]],
    [bundled, ["--socket", "/tmp/cmux.sock", "select-workspace", "--workspace", "ws_0a1b2c"]],
    [bundled, ["--socket", "/tmp/cmux.sock", "focus-panel", "--panel", "pn-6a7b8c", "--workspace", "ws_0a1b2c"]],
    ["/usr/bin/open", ["-b", "com.cmuxterm.app"]],
  ]);
});

test("cmux: CLI missing everywhere → the app is activated and the note says so", async () => {
  const { run, calls } = recorder(file => {
    if (file === "/usr/bin/open") return { code: 0 };
    if (file === "/usr/bin/mdfind") return { code: 0, stdout: "" };
    return { code: 127 };
  });
  const r = await focusTerminal(CMUX, "/repo", run, "darwin");
  expect(r?.precision).toBe("app");
  expect(r?.note).toMatch(/cmux/);
  expect(r?.note).not.toContain("/tmp/cmux.sock");
  expect(pairs(calls)).toEqual([
    ["cmux", ["--socket", "/tmp/cmux.sock", "select-workspace", "--workspace", "ws_0a1b2c"]],
    ["/usr/bin/mdfind", ["kMDItemCFBundleIdentifier == 'com.cmuxterm.app'"]],
    ["/Applications/cmux.app/Contents/Resources/bin/cmux", ["--socket", "/tmp/cmux.sock", "select-workspace", "--workspace", "ws_0a1b2c"]],
    [`${homedir()}/Applications/cmux.app/Contents/Resources/bin/cmux`, ["--socket", "/tmp/cmux.sock", "select-workspace", "--workspace", "ws_0a1b2c"]],
    ["/usr/bin/open", ["-b", "com.cmuxterm.app"]],
  ]);
});

test("cmux: the bundle is searched for the CLI only for cmux's own bundle ids (nightly included)", async () => {
  const { run, calls } = recorder(file => (file === "/usr/bin/open" ? { code: 0 } : file === "/usr/bin/mdfind" ? { code: 0, stdout: "" } : { code: 127 }));
  await focusTerminal({ ...CMUX, bundleId: "com.cmuxterm.app.nightly" }, "/repo", run, "darwin");
  expect(pairs(calls)[1]).toEqual(["/usr/bin/mdfind", ["kMDItemCFBundleIdentifier == 'com.cmuxterm.app.nightly'"]]);
  expect(pairs(calls).at(-1)).toEqual(["/usr/bin/open", ["-b", "com.cmuxterm.app.nightly"]]);
});

test("cmux ids under another app: cmux on PATH only; missing → that app is activated with a note", async () => {
  const t = { ...CMUX, bundleId: "com.mitchellh.ghostty" };
  const missing = recorder(file => (file === "cmux" ? { code: 127 } : { code: 0 }));
  const r = await focusTerminal(t, "/repo", missing.run, "darwin");
  expect(r?.precision).toBe("app");
  expect(r?.note).toMatch(/not found on PATH/);
  expect(pairs(missing.calls)).toEqual([
    ["cmux", ["--socket", "/tmp/cmux.sock", "select-workspace", "--workspace", "ws_0a1b2c"]],
    ["/usr/bin/open", ["-b", "com.mitchellh.ghostty"]],
  ]);
  const found = recorder();
  expect(await focusTerminal(t, "/repo", found.run, "darwin")).toEqual({ precision: "exact" });
  expect(pairs(found.calls).map(([f]) => f)).toEqual(["cmux", "cmux", "/usr/bin/open"]);
});

test("cmux: the workspace selected but the panel not → a note saying so", async () => {
  const { run, calls } = recorder((file, args) => (file === "cmux" && args.includes("focus-panel") ? { code: 1 } : { code: 0 }));
  const r = await focusTerminal(CMUX, "/repo", run, "darwin");
  expect(r?.precision).toBe("app");
  expect(r?.note).toMatch(/selected the workspace but could not focus the panel/);
  expect(pairs(calls).at(-1)).toEqual(["/usr/bin/open", ["-b", "com.cmuxterm.app"]]);
});

test("cmux notes tell a missing program from a refusal", async () => {
  const missing = await focusTerminal(CMUX, "/repo", recorder(f => (f === "/usr/bin/open" ? { code: 0 } : { code: 127 })).run, "darwin");
  const refused = await focusTerminal(CMUX, "/repo", recorder(f => (f === "cmux" ? { code: 1 } : { code: 0 })).run, "darwin");
  expect(missing?.note).toMatch(/not found/);
  expect(missing?.note).not.toMatch(/refused/);
  expect(refused?.note).toMatch(/refused the request or the command failed/);
  expect(refused?.note).not.toMatch(/not found/);
});

test("the whole chain starts no program after 8 000 ms: later steps are skipped, the result says so", async () => {
  let clock = 50_000;
  const { run, calls } = recorder(() => { clock += 3000; return { code: 0 }; });
  const r = await focusTerminal({ ...CMUX, ...TMUX }, "/repo", run, "darwin", { now: () => clock });
  expect(pairs(calls).map(([f]) => f)).toEqual(["cmux", "cmux", "/usr/bin/open"]);   // started at 0, 3 000 and 6 000 ms
  expect(r?.precision).toBe("app");
  expect(r?.note).toMatch(/stopped part-way/);
});

test("a chain within the budget has no part-way note", async () => {
  let clock = 0;
  const { run, calls } = recorder(() => { clock += 1000; return { code: 0 }; });
  expect(await focusTerminal({ ...CMUX, ...TMUX }, "/repo", run, "darwin", { now: () => clock })).toEqual({ precision: "exact" });
  expect(calls).toHaveLength(5);
});

test("cmux: a refused socket → the app is activated and the note points at cmux's access setting, never at cmux's own words", async () => {
  const { run, calls } = recorder(file => (file === "cmux"
    ? { code: 1, stderr: "Error: Access denied - only processes started inside cmux can connect (/tmp/cmux.sock)" } : { code: 0 }));
  const r = await focusTerminal(CMUX, "/repo", run, "darwin");
  expect(r?.precision).toBe("app");
  expect(r?.note).toMatch(/access/i);
  expect(r?.note).toContain("CMUX_SOCKET_PASSWORD");
  expect(r?.note).not.toContain("/tmp/cmux.sock");
  expect(pairs(calls)).toEqual([
    ["cmux", ["--socket", "/tmp/cmux.sock", "select-workspace", "--workspace", "ws_0a1b2c"]],
    ["/usr/bin/open", ["-b", "com.cmuxterm.app"]],
  ]);
});

test("ids only ever appear as whole arguments", async () => {
  const all: TerminalInfo[] = [ITERM, TERMINAL_APP, { ...CMUX, ...TMUX }, VSCODE, GHOSTTY];
  const ids = ["6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C", "ttys004", "ws_0a1b2c", "pn-6a7b8c", "/tmp/cmux.sock", "%12", "/private/tmp/tmux-501/default"];
  for (const t of all) {
    const { run, calls } = recorder(() => ({ code: 0, stdout: "ok\n" }));
    await focusTerminal(t, "/repo", run, "darwin");
    for (const c of calls) for (const a of c.args) for (const id of ids) if (a !== id) expect(a).not.toContain(id);
  }
});

test("tmux layer runs after the driver, with -S <socket>", async () => {
  const { run, calls } = recorder(() => ({ code: 0, stdout: "ok\n" }));
  expect(await focusTerminal({ ...ITERM, ...TMUX }, "/repo", run, "darwin")).toEqual({ precision: "exact" });
  expect(calls[0]!.file).toBe("/usr/bin/osascript");
  expect(pairs(calls).slice(1)).toEqual([
    ["tmux", ["-S", "/private/tmp/tmux-501/default", "select-window", "-t", "%12"]],
    ["tmux", ["-S", "/private/tmp/tmux-501/default", "select-pane", "-t", "%12"]],
  ]);
});

test("tmux layer without a socket uses tmux's default server; a failure does not change the result", async () => {
  const { run, calls } = recorder(file => (file === "tmux" ? { code: 127 } : { code: 0 }));
  expect(await focusTerminal({ ...GHOSTTY, tmuxPane: "%3" }, "/repo", run, "darwin")).toEqual({ precision: "app" });
  expect(pairs(calls)).toEqual([
    ["/usr/bin/open", ["-b", "com.mitchellh.ghostty"]],
    ["tmux", ["select-window", "-t", "%3"]],
    ["tmux", ["select-pane", "-t", "%3"]],
  ]);
});

test("tmux layer with cmux: after the cmux calls", async () => {
  const { run, calls } = recorder();
  await focusTerminal({ ...CMUX, ...TMUX }, "/repo", run, "darwin");
  expect(pairs(calls).map(([f]) => f)).toEqual(["cmux", "cmux", "/usr/bin/open", "tmux", "tmux"]);
});

test("a tmux pane that is not %<n> is not passed to tmux", async () => {
  const { run, calls } = recorder();
  await focusTerminal({ ...GHOSTTY, tmuxPane: "-x" }, "/repo", run, "darwin");
  expect(calls.map(c => c.file)).toEqual(["/usr/bin/open"]);
});

test("nothing to focus, or not macOS: null and nothing run", async () => {
  const { run, calls } = recorder();
  expect(await focusTerminal({ ...TMUX }, "/repo", run, "darwin")).toBeNull();
  expect(await focusTerminal({}, "/repo", run, "darwin")).toBeNull();
  expect(await focusTerminal(ITERM, "/repo", run, "linux")).toBeNull();
  expect(calls).toEqual([]);
});

test("a run that reports a timeout gives a result with a note", async () => {
  const { run } = recorder(file => (file === "/usr/bin/osascript" ? { code: 124 } : { code: 0 }));
  const r = await focusTerminal(ITERM, "/repo", run, "darwin");
  expect(r?.precision).toBe("app");
  expect(r?.note).toBeTruthy();
});

test("a run that never answers is cut off: a result with a note, no throw", async () => {
  vi.useFakeTimers();
  const { run } = recorder(file => (file === "/usr/bin/osascript" ? new Promise<Reply>(() => {}) : { code: 0 }));
  const p = focusTerminal(ITERM, "/repo", run, "darwin");
  await vi.advanceTimersByTimeAsync(10_000);
  const r = await p;
  expect(r?.precision).toBe("app");
  expect(r?.note).toBeTruthy();
});

test("a run that rejects anyway is treated as a failure, no throw", async () => {
  const run: Run = async file => { if (file === "cmux") throw new Error("boom"); return { code: 0, stdout: "", stderr: "" }; };
  const r = await focusTerminal(CMUX, "/repo", run, "darwin");
  expect(r?.precision).toBe("app");
  expect(r?.note).toBeTruthy();
});

// The default runner, exercised with node itself (never osascript, open, tmux or cmux).
test("defaultRun: exit code, output, missing program, timeout; never rejects", async () => {
  expect(await defaultRun(process.execPath, ["-e", "process.stdout.write('hi'); process.stderr.write('err'); process.exit(3)"], { timeoutMs: 3000 }))
    .toEqual({ code: 3, stdout: "hi", stderr: "err" });
  expect(await defaultRun(process.execPath, ["-e", "process.stdout.write('ok')"], { timeoutMs: 3000 })).toEqual({ code: 0, stdout: "ok", stderr: "" });
  expect((await defaultRun("/nonexistent/aw-no-such-program", [], { timeoutMs: 3000 })).code).toBe(127);
  expect((await defaultRun(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 200 })).code).toBe(124);
  expect((await defaultRun(process.execPath, ["-e", "1", "a\0b"], { timeoutMs: 3000 })).code).not.toBe(0);   // a bad argument: no throw
});
