import { execFile, type ExecFileException } from "node:child_process";
import { homedir } from "node:os";
import type { FocusResult } from "../shared/types";
import type { TerminalInfo } from "./terminal";

export type { FocusResult };
/** Runs a fixed program with arguments (no shell) and resolves with how it ended. Never rejects. */
export type Run = (file: string, args: string[], opts: { timeoutMs: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
type Result = Awaited<ReturnType<Run>>;

/** Every program the drivers run is given this long (constraints: focus timeout 3 000 ms). */
const TIMEOUT_MS = 3000;
/** Exit codes the default runner reports for a program that is not there and for one that ran out of time (the shell's). */
const NOT_FOUND = 127;
const TIMED_OUT = 124;

/** The default `run`: `execFile` (no shell), killed after `timeoutMs`; a missing program gives 127, a timeout 124. */
export const defaultRun: Run = (file, args, { timeoutMs }) => new Promise(res => {
  try {
    execFile(file, args, { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1 << 20, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err === null) { res({ code: 0, stdout, stderr }); return; }
      const e = err as ExecFileException;
      const code = e.code === "ENOENT" ? NOT_FOUND : e.killed === true ? TIMED_OUT : typeof e.code === "number" ? e.code : 1;
      res({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  } catch (e) {
    res({ code: 1, stdout: "", stderr: String(e) });   // an argument execFile refuses (e.g. a NUL byte)
  }
});

/**
 * Runs through the injected `run`, but never waits much past the timeout and never throws: an injected runner that
 * hangs or rejects counts as a timeout or a failure.
 */
function call(run: Run, file: string, args: string[]): Promise<Result> {
  return new Promise(res => {
    const timer = setTimeout(() => res({ code: TIMED_OUT, stdout: "", stderr: "" }), TIMEOUT_MS + 500);
    const done = (r: Result) => { clearTimeout(timer); res(r); };
    try {
      run(file, args, { timeoutMs: TIMEOUT_MS }).then(done, () => done({ code: 1, stdout: "", stderr: "" }));
    } catch {
      done({ code: 1, stdout: "", stderr: "" });
    }
  });
}

// macOS programs live at fixed paths, so a launchd PATH cannot hide them; tmux and cmux are the owner's installs and are
// found on PATH (cmux also inside its app bundle).
const OSASCRIPT = "/usr/bin/osascript";
const OPEN = "/usr/bin/open";
const MDFIND = "/usr/bin/mdfind";
const ITERM_ID = "com.googlecode.iterm2";
const TERMINAL_ID = "com.apple.Terminal";
const CMUX_ID = "com.cmuxterm.app";
const CMUX_IN_BUNDLE = "Contents/Resources/bin/cmux";

/** A bundle id that cannot be read as an option by `open` or `mdfind` (the stored pattern alone allows a leading '-'). */
const usableBundleId = (id: string | undefined): id is string => id !== undefined && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(id);
/** tmux pane ids are `%<n>` (TMUX_PANE); anything else is not passed to tmux. */
const TMUX_PANE = /^%[0-9]{1,9}$/;

/** AppleScript as fixed `-e` lines; identifiers follow as arguments that the script reads through `on run argv`. */
const osascript = (lines: string[], ...argv: string[]): string[] => [...lines.flatMap(l => ["-e", l]), ...argv];

const ITERM_SCRIPT = [
  "on run argv",
  "set wanted to item 1 of argv",
  `tell application id "${ITERM_ID}"`,
  "repeat with w in windows",
  "repeat with t in tabs of w",
  "repeat with s in sessions of t",
  "if (id of s as text) is wanted then",
  "select w",
  "tell t to select",
  "tell s to select",
  "activate",
  'return "ok"',
  "end if",
  "end repeat",
  "end repeat",
  "end repeat",
  "end tell",
  'return "missing"',
  "end run",
];

const TERMINAL_SCRIPT = [
  "on run argv",
  'set wanted to "/dev/" & item 1 of argv',
  `tell application id "${TERMINAL_ID}"`,
  "repeat with w in windows",
  "repeat with t in tabs of w",
  "if (tty of t) is wanted then",
  "set selected tab of w to t",
  "set index of w to 1",
  "activate",
  'return "ok"',
  "end if",
  "end repeat",
  "end repeat",
  "end tell",
  'return "missing"',
  "end run",
];

const NOTE = {
  timedOut: (app: string) => `${app} did not answer in time, so only its window was brought to the front.`,
  notFound: (app: string) => `${app} has no tab for this session any more, so only its window was brought to the front.`,
  refused: (app: string) => `${app} could not be scripted (macOS may be asking for, or denying, Automation permission), so only its window was brought to the front.`,
  activateFailed: (app: string) => `${app} could not be brought to the front.`,
  notAbsolute: "The session's folder is not known, so only the editor was brought to the front.",
  cmuxMissing: "The cmux command-line tool was not found (on PATH or inside cmux.app), so the tab could not be selected and only cmux was brought to the front. See the README section on jumping to cmux tabs.",
  cmuxTimedOut: "cmux did not answer in time, so the tab could not be selected and only cmux was brought to the front.",
  cmuxRefused: "cmux refused to let Agent World select the tab, so only cmux was brought to the front. Set cmux's automation socket access mode to allow external control, or start the Agent World server with CMUX_SOCKET_PASSWORD in its environment. See the README section on jumping to cmux tabs.",
};

/** Activates an app by bundle id; returns the note for a failure, or undefined. */
async function activate(run: Run, bundleId: string, app: string): Promise<string | undefined> {
  return (await call(run, OPEN, ["-b", bundleId])).code === 0 ? undefined : NOTE.activateFailed(app);
}

/** Runs an AppleScript that answers "ok" once it selected the tab; on anything else, activates the app with a note. */
async function scripted(run: Run, script: string[], arg: string, bundleId: string, app: string): Promise<FocusResult> {
  const r = await call(run, OSASCRIPT, osascript(script, arg));
  if (r.code === 0 && r.stdout.trim() === "ok") return { precision: "exact" };
  const note = r.code === TIMED_OUT ? NOTE.timedOut(app) : r.code === 0 ? NOTE.notFound(app) : NOTE.refused(app);
  return { precision: "app", note: (await activate(run, bundleId, app)) ?? note };
}

/**
 * Where the cmux CLI may be, after PATH: inside each app bundle Spotlight knows by `bundleId`, then the usual install
 * locations. The query is safe to build from `bundleId`: it passed `usableBundleId` (letters, digits, '.', '-' only), so it
 * cannot close the quotes or add a clause, and it is one argument to `mdfind` run without a shell.
 */
async function cmuxCandidates(run: Run, bundleId: string): Promise<string[]> {
  const r = await call(run, MDFIND, [`kMDItemCFBundleIdentifier == '${bundleId}'`]);
  const found = r.code === 0 ? r.stdout.split("\n").map(l => l.trim()).filter(l => l.startsWith("/") && l.endsWith(".app")) : [];
  const bundles = [...found, "/Applications/cmux.app", `${homedir()}/Applications/cmux.app`];
  return [...new Set(bundles.map(b => `${b}/${CMUX_IN_BUNDLE}`))];
}

/** cmux: select the workspace (and panel) through its CLI, then activate the app, which socket commands never do. */
async function focusCmux(t: TerminalInfo & { cmuxWorkspace: string }, run: Run): Promise<FocusResult> {
  const bundleId = usableBundleId(t.bundleId) ? t.bundleId : CMUX_ID;
  // --socket is a global option and must come before the command (cmux docs/cli-contract.md)
  const socket = t.cmuxSocket !== undefined ? ["--socket", t.cmuxSocket] : [];
  const select = [...socket, "select-workspace", "--workspace", t.cmuxWorkspace];
  let r = await call(run, "cmux", select);
  let cli = "cmux";
  if (r.code === NOT_FOUND) {
    for (const candidate of await cmuxCandidates(run, bundleId)) {
      r = await call(run, candidate, select);
      cli = candidate;
      if (r.code !== NOT_FOUND) break;
    }
  }
  if (r.code === 0 && t.cmuxPanel !== undefined) {
    r = await call(run, cli, [...socket, "focus-panel", "--panel", t.cmuxPanel, "--workspace", t.cmuxWorkspace]);
  }
  const failed = await activate(run, bundleId, "cmux");
  if (r.code === 0) return failed === undefined ? { precision: "exact" } : { precision: "app", note: failed };
  // cmux's own error text is not passed on: it can name the socket path, which stays server-side
  const note = r.code === NOT_FOUND ? NOTE.cmuxMissing : r.code === TIMED_OUT ? NOTE.cmuxTimedOut : NOTE.cmuxRefused;
  return { precision: "app", note };
}

type Driver = {
  id: string;
  matches(t: TerminalInfo): boolean;
  precision(t: TerminalInfo): "exact" | "app";
  focus(t: TerminalInfo, repoPath: string, run: Run): Promise<FocusResult>;
};

/** Tried in this order; the first that matches is used (spec §3 "Drivers"). */
const DRIVERS: readonly Driver[] = [
  {
    id: "cmux",
    matches: t => t.cmuxWorkspace !== undefined,
    precision: () => "exact",
    focus: (t, _repo, run) => focusCmux(t as TerminalInfo & { cmuxWorkspace: string }, run),
  },
  {
    id: "iterm2",
    matches: t => t.itermSession !== undefined,
    precision: () => "exact",
    // ITERM_SESSION_ID is `w0t0p0:<UUID>`; AppleScript's `id of session` is the UUID
    focus: (t, _repo, run) => scripted(run, ITERM_SCRIPT, t.itermSession!.slice(t.itermSession!.indexOf(":") + 1), ITERM_ID, "iTerm"),
  },
  {
    id: "terminal-app",
    matches: t => t.bundleId === TERMINAL_ID,
    precision: t => (t.tty !== undefined ? "exact" : "app"),
    focus: async (t, _repo, run) => (t.tty !== undefined
      ? scripted(run, TERMINAL_SCRIPT, t.tty, TERMINAL_ID, "Terminal")
      : { precision: "app", ...noteIf(await activate(run, TERMINAL_ID, "Terminal")) }),
  },
  {
    id: "editor",
    matches: t => t.termProgram === "vscode" && usableBundleId(t.bundleId),
    precision: () => "exact",
    focus: async (t, repoPath, run) => {
      // only an absolute path: anything else could be read by `open` as an option
      if (!repoPath.startsWith("/")) return { precision: "app", note: (await activate(run, t.bundleId!, "The editor")) ?? NOTE.notAbsolute };
      const r = await call(run, OPEN, ["-b", t.bundleId!, repoPath]);
      return r.code === 0 ? { precision: "exact" } : { precision: "app", note: NOTE.activateFailed("The editor") };
    },
  },
  {
    id: "generic",
    matches: t => usableBundleId(t.bundleId),
    precision: () => "app",
    focus: async (t, _repo, run) => ({ precision: "app", ...noteIf(await activate(run, t.bundleId!, "The terminal app")) }),
  },
];

const noteIf = (note: string | undefined): { note?: string } => (note === undefined ? {} : { note });

function driverFor(t: TerminalInfo | null, platform: NodeJS.Platform): Driver | null {
  if (t === null || platform !== "darwin") return null;
  return DRIVERS.find(d => d.matches(t)) ?? null;
}

/** How precisely `t` can be brought to the front on `platform`; null when nothing can. */
export function precisionFor(t: TerminalInfo | null, platform: NodeJS.Platform): "exact" | "app" | null {
  const d = driverFor(t, platform);
  return d === null ? null : d.precision(t!);
}

/**
 * Brings the terminal to the front with the first matching driver, then, when a tmux pane is known, selects its window and
 * pane (a failure there is ignored). Null when no driver matches. Never throws.
 */
export async function focusTerminal(t: TerminalInfo, repoPath: string, run: Run, platform: NodeJS.Platform): Promise<FocusResult | null> {
  const d = driverFor(t, platform);
  if (d === null) return null;
  const result = await d.focus(t, repoPath, run);
  if (t.tmuxPane !== undefined && TMUX_PANE.test(t.tmuxPane)) {
    const socket = t.tmuxSocket !== undefined ? ["-S", t.tmuxSocket] : [];
    await call(run, "tmux", [...socket, "select-window", "-t", t.tmuxPane]);
    await call(run, "tmux", [...socket, "select-pane", "-t", t.tmuxPane]);
  }
  return result;
}
