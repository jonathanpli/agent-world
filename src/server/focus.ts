import { execFile, type ExecFileException } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import type { FocusResult } from "../shared/types";
import type { TerminalInfo } from "./terminal";

export type { FocusResult };
/** Runs a fixed program with arguments (no shell) and resolves with how it ended. Never rejects. */
export type Run = (file: string, args: string[], opts: { timeoutMs: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
type Result = Awaited<ReturnType<Run>>;

/** Every program the drivers run is given this long (constraints: focus timeout 3 000 ms). */
const TIMEOUT_MS = 3000;
/** One focus request starts no new program once this long has passed since it began. */
export const FOCUS_BUDGET_MS = 8000;
/** Exit codes the default runner reports for a program that is not there and for one that ran out of time (the shell's). */
const NOT_FOUND = 127;
const TIMED_OUT = 124;
/** What a step reports when it was not started because the request's budget was spent. */
const SKIPPED = -1;

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

/** One focus request: how it runs programs, its clock, when it began, and whether a step was skipped for lack of time. */
type Ctx = { run: Run; now: () => number; startedAt: number; cutShort: boolean };

/**
 * Runs through the injected `run`, but never waits much past the timeout and never throws: an injected runner that
 * hangs or rejects counts as a timeout or a failure. Once the request's budget is spent, nothing new is started.
 */
function call(ctx: Ctx, file: string, args: string[]): Promise<Result> {
  if (ctx.now() - ctx.startedAt >= FOCUS_BUDGET_MS) { ctx.cutShort = true; return Promise.resolve({ code: SKIPPED, stdout: "", stderr: "" }); }
  return new Promise(res => {
    const timer = setTimeout(() => res({ code: TIMED_OUT, stdout: "", stderr: "" }), TIMEOUT_MS + 500);
    const done = (r: Result) => { clearTimeout(timer); res(r); };
    try {
      ctx.run(file, args, { timeoutMs: TIMEOUT_MS }).then(done, () => done({ code: 1, stdout: "", stderr: "" }));
    } catch {
      done({ code: 1, stdout: "", stderr: "" });
    }
  });
}

// macOS programs live at fixed paths, so a launchd PATH cannot hide them; tmux and cmux are the owner's installs and are
// found on PATH (cmux also inside its own app bundle, in /Applications or ~/Applications only).
const OSASCRIPT = "/usr/bin/osascript";
const OPEN = "/usr/bin/open";
const MDFIND = "/usr/bin/mdfind";
const ITERM_ID = "com.googlecode.iterm2";
const TERMINAL_ID = "com.apple.Terminal";
const CMUX_ID = "com.cmuxterm.app";
const CMUX_IN_BUNDLE = "Contents/Resources/bin/cmux";

/**
 * The one rule for every identifier passed to a program: it starts with a letter or digit, so no program (getopt in
 * `osascript`, `open`, `mdfind`, `tmux`, `cmux`) can read it as an option. The stored patterns alone allow a leading '-'.
 * Socket paths start with '/' and tmux panes with '%' (checked where they are used).
 */
const safeArg = (v: string | undefined): v is string => v !== undefined && /^[A-Za-z0-9]/.test(v);
/** An optional identifier: absent, or safe. */
const safeIfPresent = (v: string | undefined): boolean => v === undefined || safeArg(v);
/** tmux pane ids are `%<n>` (TMUX_PANE); anything else is not passed to tmux. */
const TMUX_PANE = /^%[0-9]{1,9}$/;
const UUID = /^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/;
/** ITERM_SESSION_ID is `w0t0p0:<UUID>` and AppleScript's `id of session` is the UUID: the part after the last ':', if a UUID. */
function itermUuid(id: string | undefined): string | null {
  if (id === undefined) return null;
  const u = id.slice(id.lastIndexOf(":") + 1);
  return UUID.test(u) ? u : null;
}
/** The full bundle id pattern, checked again here before an id is placed in the Spotlight query. */
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,79}$/;
/** cmux's own bundle ids: the release build and its variants (nightly, debug). Only these are searched for the CLI. */
const isCmuxBundle = (id: string): boolean => id === CMUX_ID || id.startsWith(`${CMUX_ID}.`);

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

const README = "See the README section on jumping to cmux tabs.";
const NOTE = {
  timedOut: (app: string) => `${app} did not answer in time, so only its window was brought to the front.`,
  notFound: (app: string) => `${app} has no tab for this session any more, so only its window was brought to the front.`,
  refused: (app: string) => `${app} could not be scripted (macOS may be asking for, or denying, Automation permission), so only its window was brought to the front.`,
  activateFailed: (app: string) => `${app} could not be brought to the front.`,
  notAbsolute: "The session's folder is not known, so only the editor was brought to the front.",
  cmuxMissing: `The cmux program was not found (on PATH or inside cmux.app), so the tab could not be selected and only cmux was brought to the front. ${README}`,
  cmuxMissingOnPath: `The cmux program was not found on PATH, so the tab could not be selected and only the terminal app was brought to the front. ${README}`,
  cmuxTimedOut: "cmux did not answer in time, so the tab could not be selected and only cmux was brought to the front.",
  cmuxRefused: `cmux refused the request or the command failed, so the tab could not be selected and only cmux was brought to the front. cmux's automation socket access mode may allow only programs started inside cmux: set it to allow external control, or start the Agent World server with CMUX_SOCKET_PASSWORD in its environment. ${README}`,
  cmuxPanel: "cmux selected the workspace but could not focus the panel, so the right tab may not be in front.",
  cutShort: "Bringing the terminal to the front took too long and stopped part-way.",
};

/** Activates an app by bundle id; returns the note for a failure, or undefined. */
async function activate(ctx: Ctx, bundleId: string, app: string): Promise<string | undefined> {
  return (await call(ctx, OPEN, ["-b", bundleId])).code === 0 ? undefined : NOTE.activateFailed(app);
}

/** Runs an AppleScript that answers "ok" once it selected the tab; on anything else, activates the app with a note. */
async function scripted(ctx: Ctx, script: string[], arg: string, bundleId: string, app: string): Promise<FocusResult> {
  const r = await call(ctx, OSASCRIPT, osascript(script, arg));
  if (r.code === 0 && r.stdout.trim() === "ok") return { precision: "exact" };
  const note = r.code === TIMED_OUT ? NOTE.timedOut(app) : r.code === 0 ? NOTE.notFound(app) : NOTE.refused(app);
  return { precision: "app", note: (await activate(ctx, bundleId, app)) ?? note };
}

/** The only folders an app bundle is run from: /Applications and the owner's ~/Applications. */
const appRoots = (): string[] => ["/Applications", resolve(homedir(), "Applications")];
const inBundle = (bundle: string): string => `${bundle}/${CMUX_IN_BUNDLE}`;

/**
 * The app names Spotlight knows for `bundleId`, kept only for a hit that is an absolute path with no `..` whose bundle sits
 * directly in one of the app roots; anything else (Downloads, a mounted volume, a nested folder) is dropped unseen. The
 * query is built only from an id matching the full pattern, so it cannot close the quotes or add a clause, and it is one
 * argument to `mdfind` run without a shell.
 */
async function spotlightAppNames(ctx: Ctx, bundleId: string): Promise<string[]> {
  if (!BUNDLE_ID.test(bundleId)) return [];
  const r = await call(ctx, MDFIND, [`kMDItemCFBundleIdentifier == '${bundleId}'`]);
  if (r.code !== 0) return [];
  const roots = appRoots();
  const names: string[] = [];
  for (const line of r.stdout.split("\n")) {
    const hit = line.trim();
    if (!hit.startsWith("/") || hit.split("/").includes("..")) continue;
    const bundle = resolve(hit);
    const name = basename(bundle);
    if (!roots.includes(dirname(bundle)) || !name.endsWith(".app") || name.startsWith(".")) continue;
    names.push(name);
  }
  return names;
}

/**
 * Finds the cmux CLI when it is not on PATH: inside cmux.app in each app root first, then inside each app Spotlight names
 * for `bundleId` (in the same two roots only). Returns the result of the first one that is there. Only called for cmux's
 * own bundle ids (`isCmuxBundle`).
 */
async function cmuxFromBundle(ctx: Ctx, bundleId: string, args: string[]): Promise<{ r: Result; cli: string } | null> {
  const tried = new Set<string>();
  const attempt = async (names: string[]): Promise<{ r: Result; cli: string } | null> => {
    for (const name of names) {
      for (const root of appRoots()) {
        const cli = inBundle(`${root}/${name}`);
        if (tried.has(cli)) continue;
        tried.add(cli);
        const r = await call(ctx, cli, args);
        if (r.code !== NOT_FOUND) return { r, cli };
      }
    }
    return null;
  };
  return (await attempt(["cmux.app"])) ?? (await attempt(await spotlightAppNames(ctx, bundleId)));
}

/** cmux: select the workspace (and panel) through its CLI, then activate the app, which socket commands never do. */
async function focusCmux(t: TerminalInfo & { cmuxWorkspace: string }, ctx: Ctx): Promise<FocusResult> {
  const bundleId = t.bundleId ?? CMUX_ID;
  const ownBundle = isCmuxBundle(bundleId);
  // --socket is a global option and must come before the command (cmux docs/cli-contract.md)
  const socket = t.cmuxSocket !== undefined ? ["--socket", t.cmuxSocket] : [];
  const select = [...socket, "select-workspace", "--workspace", t.cmuxWorkspace];
  let r = await call(ctx, "cmux", select);
  let cli = "cmux";
  if (r.code === NOT_FOUND && ownBundle) {
    const found = await cmuxFromBundle(ctx, bundleId, select);
    if (found !== null) ({ r, cli } = found);
  }
  const selected = r.code === 0;
  const panel = selected && t.cmuxPanel !== undefined
    ? await call(ctx, cli, [...socket, "focus-panel", "--panel", t.cmuxPanel, "--workspace", t.cmuxWorkspace]) : null;
  const failed = await activate(ctx, bundleId, ownBundle ? "cmux" : "The terminal app");
  if (selected && (panel === null || panel.code === 0)) return failed === undefined ? { precision: "exact" } : { precision: "app", note: failed };
  // cmux's own error text is not passed on: it can name the socket path, which stays server-side
  const note = selected ? NOTE.cmuxPanel
    : r.code === NOT_FOUND ? (ownBundle ? NOTE.cmuxMissing : NOTE.cmuxMissingOnPath)
    : r.code === TIMED_OUT ? NOTE.cmuxTimedOut : NOTE.cmuxRefused;
  return { precision: "app", note };
}

type Driver = {
  id: string;
  /** True when this driver can work with `t`, every identifier it passes on included (`safeArg`). */
  matches(t: TerminalInfo): boolean;
  precision(t: TerminalInfo): "exact" | "app";
  focus(t: TerminalInfo, repoPath: string, ctx: Ctx): Promise<FocusResult>;
};

const noteIf = (note: string | undefined): { note?: string } => (note === undefined ? {} : { note });

/** Tried in this order; the first that matches is used (spec §3 "Drivers"). */
const DRIVERS: readonly Driver[] = [
  {
    id: "cmux",
    matches: t => safeArg(t.cmuxWorkspace) && safeIfPresent(t.cmuxSurface) && safeIfPresent(t.cmuxPanel) && safeIfPresent(t.bundleId)
      && (t.cmuxSocket === undefined || t.cmuxSocket.startsWith("/")),
    precision: () => "exact",
    focus: (t, _repo, ctx) => focusCmux(t as TerminalInfo & { cmuxWorkspace: string }, ctx),
  },
  {
    id: "iterm2",
    matches: t => itermUuid(t.itermSession) !== null,
    precision: () => "exact",
    focus: (t, _repo, ctx) => scripted(ctx, ITERM_SCRIPT, itermUuid(t.itermSession)!, ITERM_ID, "iTerm"),
  },
  {
    id: "terminal-app",
    matches: t => t.bundleId === TERMINAL_ID && safeIfPresent(t.tty),
    precision: t => (t.tty !== undefined ? "exact" : "app"),
    focus: async (t, _repo, ctx) => (t.tty !== undefined
      ? scripted(ctx, TERMINAL_SCRIPT, t.tty, TERMINAL_ID, "Terminal")
      : { precision: "app", ...noteIf(await activate(ctx, TERMINAL_ID, "Terminal")) }),
  },
  {
    id: "editor",
    matches: t => t.termProgram === "vscode" && safeArg(t.bundleId),
    precision: () => "exact",
    focus: async (t, repoPath, ctx) => {
      // only an absolute path: anything else could be read by `open` as an option
      if (!repoPath.startsWith("/")) return { precision: "app", note: (await activate(ctx, t.bundleId!, "The editor")) ?? NOTE.notAbsolute };
      const r = await call(ctx, OPEN, ["-b", t.bundleId!, repoPath]);
      return r.code === 0 ? { precision: "exact" } : { precision: "app", note: NOTE.activateFailed("The editor") };
    },
  },
  {
    id: "generic",
    matches: t => safeArg(t.bundleId),
    precision: () => "app",
    focus: async (t, _repo, ctx) => ({ precision: "app", ...noteIf(await activate(ctx, t.bundleId!, "The terminal app")) }),
  },
];

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
 * pane (a failure there is ignored). Null when no driver matches. Never throws. No program is started once
 * FOCUS_BUDGET_MS have passed on `opts.now` since the call began; the result then says it stopped part-way.
 */
export async function focusTerminal(
  t: TerminalInfo, repoPath: string, run: Run, platform: NodeJS.Platform, opts: { now?: () => number } = {},
): Promise<FocusResult | null> {
  const d = driverFor(t, platform);
  if (d === null) return null;
  const now = opts.now ?? Date.now;
  const ctx: Ctx = { run, now, startedAt: now(), cutShort: false };
  const result = await d.focus(t, repoPath, ctx);
  if (t.tmuxPane !== undefined && TMUX_PANE.test(t.tmuxPane) && (t.tmuxSocket === undefined || t.tmuxSocket.startsWith("/"))) {
    const socket = t.tmuxSocket !== undefined ? ["-S", t.tmuxSocket] : [];
    await call(ctx, "tmux", [...socket, "select-window", "-t", t.tmuxPane]);
    await call(ctx, "tmux", [...socket, "select-pane", "-t", t.tmuxPane]);
  }
  return ctx.cutShort ? { precision: "app", note: NOTE.cutShort } : result;
}
