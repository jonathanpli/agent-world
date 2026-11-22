import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runService, type ServiceDeps } from "../../src/installer/service";

let dir: string;
let agents: string;
let calls: string[];
let out: string[];
let portBusy: boolean;
let buildStatus: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aw-service-"));
  agents = join(dir, "LaunchAgents");
  mkdirSync(join(dir, "repo/node_modules/tsx/dist"), { recursive: true });
  writeFileSync(join(dir, "repo/node_modules/tsx/dist/cli.mjs"), "");
  calls = []; out = []; portBusy = false; buildStatus = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const plist = (): string => join(agents, "com.agent-world.server.plist");
function deps(over: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    platform: "darwin", nodeVersion: "v22.13.0", execPath: process.execPath, repoDir: join(dir, "repo"), agentsDir: agents,
    homeDir: join(dir, "home"), uid: 501, env: {},
    run: async (file, args) => { calls.push([file, ...args].join(" ")); return { status: file === "npm" ? buildStatus : 0, stdout: "", stderr: "" }; },
    portInUse: async () => portBusy,
    readFile: p => readFileSync(p, "utf8"),
    writeFile: (p, t, mode) => writeFileSync(p, t, { mode }),
    mkdir: p => { mkdirSync(p, { recursive: true }); },
    unlink: unlinkSync, exists: existsSync, log: l => out.push(l), ...over,
  };
}
const text = (): string => out.join("\n");

test("non-darwin is refused with no writes", async () => {
  expect(await runService(["install"], deps({ platform: "linux" }))).toBe(1);
  expect(text()).toContain("macOS");
  expect(existsSync(agents)).toBe(false);
  expect(calls).toEqual([]);
});

test("node 22.12.0 is refused", async () => {
  expect(await runService(["install"], deps({ nodeVersion: "v22.12.0" }))).toBe(1);
  expect(text()).toContain("22.13");
  expect(calls).toEqual([]);
});

test("missing tsx is refused clearly", async () => {
  rmSync(join(dir, "repo/node_modules"), { recursive: true });
  expect(await runService(["install"], deps())).toBe(1);
  expect(text()).toContain("cli.mjs");
  expect(calls).toEqual([]);
});

test("port in use is refused: no plist, no launchctl, no build", async () => {
  portBusy = true;
  expect(await runService(["install"], deps())).toBe(1);
  expect(text()).toContain("4317");
  expect(existsSync(agents)).toBe(false);
  expect(calls).toEqual([]);
});

test("the port checked is the one the service will use", async () => {
  const seen: number[] = [];
  await runService(["install"], deps({ env: { AGENT_WORLD_PORT: "4400" }, portInUse: async p => { seen.push(p); return false; } }));
  expect(seen).toEqual([4400]);
});

test("install builds, writes the plist (0644) then boots out and bootstraps", async () => {
  expect(await runService(["install"], deps({ env: { AGENT_WORLD_HOME: join(dir, "aw") } }))).toBe(0);
  expect(calls).toEqual([
    `npm --prefix ${join(dir, "repo")} run build`,
    "launchctl bootout gui/501/com.agent-world.server",
    `launchctl bootstrap gui/501 ${plist()}`,
  ]);
  expect(statSync(plist()).mode & 0o777).toBe(0o644);
  const p = readFileSync(plist(), "utf8");
  expect(p).toContain(process.execPath);
  expect(p).toContain(join(dir, "aw", "server.log"));
  expect(existsSync(join(dir, "aw"))).toBe(true);
});

test("second install overwrites and repeats", async () => {
  await runService(["install"], deps());
  await runService(["install"], deps({ env: { AGENT_WORLD_PORT: "4400" } }));
  expect(calls.filter(c => c.includes("bootstrap"))).toHaveLength(2);
  expect(readdirSync(agents)).toEqual(["com.agent-world.server.plist"]);
  expect(readFileSync(plist(), "utf8")).toContain("4400");
});

test("a failed build writes nothing", async () => {
  buildStatus = 1;
  expect(await runService(["install"], deps())).toBe(1);
  expect(existsSync(agents)).toBe(false);
});

test("uninstall boots out and removes the plist; nothing installed is fine", async () => {
  expect(await runService(["uninstall"], deps())).toBe(0);
  expect(text()).toContain("not installed");
  await runService(["install"], deps());
  calls = [];
  expect(await runService(["uninstall"], deps())).toBe(0);
  expect(calls).toEqual(["launchctl bootout gui/501/com.agent-world.server"]);
  expect(existsSync(plist())).toBe(false);
});

test("status with no plist says not installed", async () => {
  expect(await runService(["status"], deps())).toBe(0);
  expect(text()).toBe("service: not installed");
  expect(calls).toEqual([]);
});

test("status shows running pid, port, node path and last 5 log lines", async () => {
  const env = { AGENT_WORLD_HOME: join(dir, "aw") };
  await runService(["install"], deps({ env }));
  writeFileSync(join(dir, "aw", "server.log"), "1\n2\n3\n4\n5\n6\n7\n");
  out = [];
  const d = deps({ env, run: async () => ({ status: 0, stdout: "\tstate = running\n\tpid = 4242\n", stderr: "" }) });
  expect(await runService(["status"], d)).toBe(0);
  expect(text()).toContain("running: yes (pid 4242)");
  expect(text()).toContain("port: 4317");
  expect(text()).toContain(`node: ${process.execPath} (exists)`);
  expect(text()).not.toContain("  2\n");
  expect(out.slice(-5)).toEqual(["  3", "  4", "  5", "  6", "  7"]);
});

test("status when launchctl does not know the service", async () => {
  await runService(["install"], deps());
  out = [];
  await runService(["status"], deps({ run: async () => ({ status: 113, stdout: "", stderr: "" }) }));
  expect(text()).toContain("running: no");
});

test("--dry-run writes nothing and runs nothing", async () => {
  expect(await runService(["install", "--dry-run"], deps())).toBe(0);
  expect(calls).toEqual([]);
  expect(existsSync(agents)).toBe(false);
  expect(text()).toContain("<plist");
  expect(text()).toContain("would run: launchctl bootstrap gui/501");
  expect(await runService(["uninstall", "--dry-run"], deps())).toBe(0);
  expect(calls).toEqual([]);
});

test("--agents-dir overrides the agents directory; bad arguments print usage", async () => {
  const other = join(dir, "other");
  await runService(["install", "--agents-dir", other], deps());
  expect(existsSync(join(other, "com.agent-world.server.plist"))).toBe(true);
  expect(await runService(["bogus"], deps())).toBe(1);
  expect(await runService(["install", "--agents-dir"], deps())).toBe(1);
});
