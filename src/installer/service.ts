import { dirname, join } from "node:path";
import { buildPlist, parsePrint, readPlistInfo, SERVICE_LABEL } from "./launchd";
import { serverEnv } from "../server/env";
import { nodeVersionProblem } from "../server/nodeVersion";

export type RunResult = { status: number; stdout: string; stderr: string };

export type ServiceDeps = {
  platform: string;
  nodeVersion: string;
  execPath: string;
  repoDir: string;
  agentsDir: string;
  homeDir: string;
  uid: number;
  env: Record<string, string | undefined>;
  run: (file: string, args: string[]) => Promise<RunResult>;
  portInUse: (port: number) => Promise<boolean>;
  readFile: (path: string) => string;
  writeFile: (path: string, text: string, mode: number) => void;
  mkdir: (path: string) => void;
  unlink: (path: string) => void;
  exists: (path: string) => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

const DEFAULT_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const PORT_POLLS = 10;
const PORT_POLL_MS = 300;
const BOOTSTRAP_TRIES = 5;
const BOOTSTRAP_RETRY_MS = 500;

const USAGE = "usage: service.ts install|uninstall|status [--agents-dir <dir>] [--dry-run]";

/** Parses the CLI arguments; agentsDir is the default unless --agents-dir is given. */
function parse(argv: string[], defaultAgentsDir: string): { command: string; agentsDir: string; dryRun: boolean } | null {
  const [command, ...rest] = argv;
  if (command !== "install" && command !== "uninstall" && command !== "status") return null;
  let agentsDir = defaultAgentsDir;
  let dryRun = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--dry-run") dryRun = true;
    else if (rest[i] === "--agents-dir") {
      const v = rest[++i];
      if (!v) return null;
      agentsDir = v;
    } else return null;
  }
  return { command, agentsDir, dryRun };
}

/** Runs one service command and returns the process exit code. Every side effect goes through deps. */
export async function runService(argv: string[], deps: ServiceDeps): Promise<number> {
  const args = parse(argv, deps.agentsDir);
  if (args === null) { deps.log(USAGE); return 1; }
  const { agentsDir, dryRun } = args;
  const plistPath = join(agentsDir, `${SERVICE_LABEL}.plist`);
  const target = `gui/${deps.uid}/${SERVICE_LABEL}`;
  const { port, home } = serverEnv(deps.env, false, deps.homeDir);
  const logPath = join(home, "server.log");

  if (args.command === "status") return status(deps, plistPath, target, port, logPath);
  if (deps.platform !== "darwin") { deps.log("The background service uses launchd, so it only works on macOS."); return 1; }

  if (args.command === "uninstall") {
    const cmd = ["bootout", target];
    if (dryRun) { deps.log(`would run: launchctl ${cmd.join(" ")}`); deps.log(`would delete: ${plistPath}`); return 0; }
    await deps.run("launchctl", cmd); // fails harmlessly when it is not loaded
    if (deps.exists(plistPath)) { deps.unlink(plistPath); deps.log(`removed ${plistPath}`); }
    else deps.log("not installed; nothing was changed");
    return 0;
  }

  const problem = nodeVersionProblem(deps.nodeVersion);
  if (problem !== null) { deps.log(problem); return 1; }
  const tsxCli = join(deps.repoDir, "node_modules", "tsx", "dist", "cli.mjs");
  if (!deps.exists(tsxCli)) { deps.log(`${tsxCli} is missing. Run \`npm install\` in ${deps.repoDir} first.`); return 1; }
  const env: Record<string, string> = { PATH: deps.env.PATH?.trim() ? deps.env.PATH : DEFAULT_PATH };
  for (const k of ["AGENT_WORLD_PORT", "AGENT_WORLD_HOME"]) {
    const v = deps.env[k];
    if (v !== undefined && v.trim() !== "") env[k] = v;
  }
  const plist = buildPlist({ nodePath: deps.execPath, tsxCli, repoDir: deps.repoDir, logPath, env });
  const build = ["--prefix", deps.repoDir, "run", "build"];
  const bootout = ["bootout", target];
  const bootstrap = ["bootstrap", `gui/${deps.uid}`, plistPath];
  if (dryRun) {
    // No side effects at all: not even the port probe or `launchctl print`.
    deps.log(plist);
    deps.log("If an older copy is installed, it is stopped first and the port is checked afterwards; a port still busy then belongs to another process and install stops.");
    deps.log(`would run: npm ${build.join(" ")}`);
    deps.log(`would run: launchctl ${bootout.join(" ")}`);
    deps.log(`would write: ${plistPath}`);
    deps.log(`would run: launchctl ${bootstrap.join(" ")} (up to ${BOOTSTRAP_TRIES} tries)`);
    return 0;
  }

  // An older copy holds the port itself (KeepAlive), so it has to be stopped before the port can be judged.
  const printed = await deps.run("launchctl", ["print", target]);
  const older = deps.exists(plistPath) || printed.status === 0;
  if (!older && (await deps.portInUse(port))) { deps.log(portBusy(port, false)); return 1; }

  const built = await deps.run("npm", build);
  if (built.status !== 0) { deps.log(`npm run build failed:\n${built.stderr || built.stdout}`); return 1; }
  await deps.run("launchctl", bootout); // fails harmlessly when nothing is loaded
  if (older && !(await portFree(deps, port))) { deps.log(portBusy(port, true)); return 1; }
  deps.mkdir(agentsDir);
  deps.mkdir(dirname(logPath)); // launchd cannot open a log file in a missing folder
  deps.writeFile(plistPath, plist, 0o644);
  let loaded = await deps.run("launchctl", bootstrap);
  // Right after bootout the old agent may still be tearing down, which makes bootstrap fail with an I/O error.
  for (let i = 1; loaded.status !== 0 && i < BOOTSTRAP_TRIES; i++) {
    await deps.sleep(BOOTSTRAP_RETRY_MS);
    loaded = await deps.run("launchctl", bootstrap);
  }
  if (loaded.status !== 0) { deps.log(`launchctl bootstrap failed after ${BOOTSTRAP_TRIES} tries:\n${loaded.stderr || loaded.stdout}`); return 1; }
  deps.log(`installed ${plistPath}`);
  deps.log(`Agent World will run at http://127.0.0.1:${port} and start at login. Log: ${logPath}`);
  return 0;
}

function portBusy(port: number, stoppedOld: boolean): string {
  return stoppedOld
    ? `The older Agent World service was stopped, but port ${port} is still in use by another process, so nothing new was installed. Free the port and run install again.`
    : `Port ${port} is already in use (maybe a server you started by hand). Stop it yourself and run install again; nothing was changed.`;
}

/** Polls (up to 10 times, 300 ms apart) because a stopped process can take a moment to release its port. */
async function portFree(deps: ServiceDeps, port: number): Promise<boolean> {
  for (let i = 0; i < PORT_POLLS; i++) {
    if (!(await deps.portInUse(port))) return true;
    if (i < PORT_POLLS - 1) await deps.sleep(PORT_POLL_MS);
  }
  return false;
}

async function status(deps: ServiceDeps, plistPath: string, target: string, port: number, logPath: string): Promise<number> {
  if (!deps.exists(plistPath)) { deps.log("service: not installed"); return 0; }
  const info = readPlistInfo(deps.readFile(plistPath));
  const printed = await deps.run("launchctl", ["print", target]);
  const { running, pid } = printed.status === 0 ? parsePrint(printed.stdout) : { running: false, pid: null };
  deps.log("service: installed");
  deps.log(`running: ${running ? `yes (pid ${pid ?? "unknown"})` : "no"}`);
  deps.log(`port: ${info.port ?? port}`);
  deps.log(`PATH: ${info.path ?? "unknown"}`);
  deps.log(info.nodePath === null ? "node: unknown" : `node: ${info.nodePath} (${deps.exists(info.nodePath) ? "exists" : "MISSING, re-run install"})`);
  deps.log(`log: ${logPath}`);
  if (deps.exists(logPath)) {
    const lines = deps.readFile(logPath).split("\n").filter(l => l !== "").slice(-5);
    for (const l of lines) deps.log(`  ${l}`);
  }
  return 0;
}
