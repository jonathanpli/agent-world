import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const TSX = resolve("node_modules/.bin/tsx");
const SCRIPT = resolve("scripts/hooks.ts");
const FORWARD = resolve("hooks/forward.sh");
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aw-hooks-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// HOME is a temp dir so a bug in argument parsing can never reach the real settings file.
const run = (cmd: string, file: string) =>
  spawnSync(process.execPath, [TSX, SCRIPT, cmd, "--settings", file], { env: { ...process.env, HOME: dir }, encoding: "utf8" });
const copyFx = (name: string): string => { const f = join(dir, "settings.json"); copyFileSync(`tests/fixtures/settings/${name}.json`, f); return f; };
const backups = (): string[] => readdirSync(dir).filter(n => n.includes(".agent-world-backup-"));

test("missing file is created", () => {
  const f = join(dir, "settings.json");
  const r = run("install", f);
  expect(r.status).toBe(0);
  expect(Object.keys(JSON.parse(readFileSync(f, "utf8")).hooks)).toHaveLength(7);
  expect(readFileSync(f, "utf8").endsWith("}\n")).toBe(true);
  expect(readFileSync(f, "utf8")).toContain(FORWARD);
  expect(backups()).toEqual([]);
});

test("invalid JSON aborts without writing", () => {
  const f = copyFx("invalid");
  const before = readFileSync(f);
  const r = run("install", f);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toContain("settings file is not valid JSON; nothing was changed");
  expect(readFileSync(f).equals(before)).toBe(true);
  expect(backups()).toEqual([]);
});

test.each(["hooks-not-object", "event-not-array"])("%s aborts without writing", name => {
  const f = copyFx(name);
  const before = readFileSync(f);
  const r = run("install", f);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toContain("nothing was changed");
  expect(readFileSync(f).equals(before)).toBe(true);
  expect(backups()).toEqual([]);
  expect(run("uninstall", f).status).toBe(1);
  expect(readFileSync(f).equals(before)).toBe(true);
});

test("install writes a backup identical to the original", () => {
  const f = copyFx("existing-hooks");
  const before = readFileSync(f);
  const r = run("install", f);
  expect(r.status).toBe(0);
  expect(backups()).toHaveLength(1);
  expect(readFileSync(join(dir, backups()[0]!)).equals(before)).toBe(true);
  expect(r.stdout).toContain(backups()[0]!);
  const after = JSON.parse(readFileSync(f, "utf8"));
  expect(after.hooks.PreToolUse).toEqual(JSON.parse(before.toString()).hooks.PreToolUse);
  expect(after.hooks.Stop[0].hooks[0].command).toBe(FORWARD);
});

test("second install changes nothing and makes no second backup", () => {
  const f = copyFx("existing-hooks");
  run("install", f);
  const once = readFileSync(f);
  const mtime = statSync(f).mtimeMs;
  const r = run("install", f);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("already installed");
  expect(readFileSync(f).equals(once)).toBe(true);
  expect(statSync(f).mtimeMs).toBe(mtime);
  expect(backups()).toHaveLength(1);
});

test("already-correct file with odd formatting is left byte-for-byte alone", () => {
  const f = join(dir, "settings.json");
  const compact = JSON.stringify(JSON.parse(readFileSync("tests/fixtures/settings/already-installed.json", "utf8")).hooks);
  const text = `{"hooks":${compact.replaceAll("/x/hooks/forward.sh", FORWARD)}}`; // no newline, compact
  writeFileSync(f, text);
  const r = run("install", f);
  expect(r.status).toBe(0);
  expect(readFileSync(f, "utf8")).toBe(text);
  expect(backups()).toEqual([]);
});

test("install then uninstall restores the original content and keeps the file mode", () => {
  const f = copyFx("existing-hooks");
  chmodSync(f, 0o600);
  const original = JSON.parse(readFileSync(f, "utf8"));
  run("install", f);
  expect(statSync(f).mode & 0o777).toBe(0o600);
  const r = run("uninstall", f);
  expect(r.status).toBe(0);
  expect(JSON.parse(readFileSync(f, "utf8"))).toEqual(original);
  expect(statSync(f).mode & 0o777).toBe(0o600);
  expect(readdirSync(dir).filter(n => n.endsWith(".tmp") || n.includes(".aw-tmp"))).toEqual([]);
});

test("uninstall when nothing is installed writes nothing", () => {
  const f = copyFx("existing-hooks");
  const r = run("uninstall", f);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("not installed");
  expect(backups()).toEqual([]);
  expect(existsSync(f)).toBe(true);
});

test("unknown command or missing --settings value exits 1 without touching anything", () => {
  expect(spawnSync(process.execPath, [TSX, SCRIPT, "bogus", "--settings", join(dir, "s.json")], { env: { ...process.env, HOME: dir }, encoding: "utf8" }).status).toBe(1);
  expect(spawnSync(process.execPath, [TSX, SCRIPT, "install", "--settings"], { env: { ...process.env, HOME: dir }, encoding: "utf8" }).status).toBe(1);
  expect(readdirSync(dir)).toEqual([]);
});
