import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { HOOK_EVENTS, mergeHooks, removeHooks } from "../src/installer/settingsMerge";

const USAGE = "usage: hooks.ts install|uninstall [--settings <path>]";
const SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../hooks/forward.sh");

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv: string[]): { command: "install" | "uninstall"; settings: string } {
  const [command, ...rest] = argv;
  if (command !== "install" && command !== "uninstall") fail(USAGE);
  let settings = join(homedir(), ".claude", "settings.json");
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== "--settings") fail(USAGE);
    const value = rest[++i];
    if (!value) fail(USAGE);
    settings = resolve(value);
  }
  return { command, settings };
}

const pad = (n: number): string => String(n).padStart(2, "0");
function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function readSettings(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("settings file is not valid JSON; nothing was changed");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail("settings file is not a JSON object; nothing was changed");
  return parsed as Record<string, unknown>;
}

function writeAtomic(path: string, text: string, mode: number | undefined): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.aw-tmp-${process.pid}`);
  try {
    writeFileSync(tmp, text, { mode: mode ?? 0o644 });
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* temp file may not exist */ }
    throw e;
  }
}

function main(): void {
  const { command, settings: path } = parseArgs(process.argv.slice(2));
  const current = readSettings(path);
  let next: Record<string, unknown>;
  try {
    next = (command === "install" ? mergeHooks : removeHooks)(current ?? {}, SCRIPT_PATH);
  } catch (e) {
    fail(`${(e as Error).message}; nothing was changed`);
  }
  if (current !== null && isDeepStrictEqual(current, next)) {
    console.log(command === "install" ? "already installed; nothing was changed" : "not installed; nothing was changed");
    return;
  }
  if (current === null && command === "uninstall") {
    console.log("not installed; nothing was changed");
    return;
  }
  let backup: string | undefined;
  let mode: number | undefined;
  if (current !== null) {
    mode = statSync(path).mode & 0o777;
    backup = `${path}.agent-world-backup-${stamp(new Date())}`;
    copyFileSync(path, backup);
  }
  writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`, mode);
  console.log(command === "install" ? `installed ${HOOK_EVENTS.length} hooks pointing at ${SCRIPT_PATH}` : `removed Agent World hooks (${SCRIPT_PATH})`);
  console.log(`settings: ${path}`);
  console.log(backup ? `backup: ${backup}` : "no backup needed (file did not exist)");
}

main();
