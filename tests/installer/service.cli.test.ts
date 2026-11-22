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
let loaded: boolean;
let bootstrapFails: number;
let sleeps: number[];
let probes: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aw-service-"));
  agents = join(dir, "LaunchAgents");
  mkdirSync(join(dir, "repo/node_modules/tsx/dist"), { recursive: true });
  writeFileSync(join(dir, "repo/node_modules/tsx/dist/cli.mjs"), "");
  calls = []; out = []; portBusy = false; buildStatus = 0; loaded = false; bootstrapFails = 0; sleeps = []; probes = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const plist = (): string => join(agents, "com.agent-world.server.plist");
function deps(over: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    platform: "darwin", nodeVersion: "v22.13.0", execPath: process.execPath, repoDir: join(dir, "repo"), agentsDir: agents,
    homeDir: join(dir, "home"), cwd: join(dir, "cwd"), uid: 501, env: {},
    run: async (file, args) => {
      calls.push([file, ...args].join(" "));
      if (file === "npm") return { status: buildStatus, stdout: "", stderr: "" };
      if (args[0] === "print") return { status: loaded ? 0 : 113, stdout: "", stderr: "" };
      if (args[0] === "bootout") { loaded = false; return { status: 0, stdout: "", stderr: "" }; }
      if (args[0] === "bootstrap") {
        if (bootstrapFails > 0) { bootstrapFails--; return { status: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" }; }
        loaded = true;
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    portInUse: async () => { probes++; return portBusy; },
    sleep: async ms => { sleeps.push(ms); },
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
  expect(calls).toEqual(["launchctl print gui/501/com.agent-world.server"]);
});

test("the port checked is the one the service will use", async () => {
  const seen: number[] = [];
  await runService(["install"], deps({ env: { AGENT_WORLD_PORT: "4400" }, portInUse: async p => { seen.push(p); return false; } }));
  expect(seen).toEqual([4400]);
});

test("install builds, writes the plist (0644) then boots out and bootstraps", async () => {
  expect(await runService(["install"], deps({ env: { AGENT_WORLD_HOME: join(dir, "aw") } }))).toBe(0);
  expect(calls).toEqual([
    "launchctl print gui/501/com.agent-world.server",
    `npm --prefix ${join(dir, "repo")} run build`,
    "launchctl bootout gui/501/com.agent-world.server",
    `launchctl bootstrap gui/501 ${plist()}`,
  ]);
  expect(statSync(plist()).mode & 0o777).toBe(0o644);
  const p = readFileSync(plist(), "utf8");
  expect(p).toContain(process.execPath);
  expect(p).toContain(join(dir, "aw", "server.log"));
  expect(p).toMatch(/<key>PATH<\/key>\s*<string>\/usr\/bin:\/bin:\/usr\/sbin:\/sbin<\/string>/);
  expect(existsSync(join(dir, "aw"))).toBe(true);
});

test("second install overwrites and repeats", async () => {
  await runService(["install"], deps());
  await runService(["install"], deps({ env: { AGENT_WORLD_PORT: "4400" } }));
  expect(calls.filter(c => c.includes("bootstrap"))).toHaveLength(2);
  expect(calls.filter(c => c.includes("bootout"))).toHaveLength(2);
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
  portBusy = true;
  expect(await runService(["install", "--dry-run"], deps())).toBe(0);
  expect(calls).toEqual([]);
  expect(probes).toBe(0);
  expect(existsSync(agents)).toBe(false);
  expect(text()).toContain("<plist");
  const lines = out.filter(l => l.startsWith("would "));
  expect(lines.map(l => l.replace(/ \(.*$/, ""))).toEqual([
    `would run: npm --prefix ${join(dir, "repo")} run build`,
    "would run: launchctl bootout gui/501/com.agent-world.server",
    `would write: ${plist()}`,
    `would run: launchctl bootstrap gui/501 ${plist()}`,
  ]);
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

test("PATH from the installer is written; empty PATH falls back", async () => {
  await runService(["install"], deps({ env: { PATH: "/opt/homebrew/bin:/usr/bin" } }));
  expect(readFileSync(plist(), "utf8")).toMatch(/<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin<\/string>/);
  await runService(["install"], deps({ env: { PATH: "  " } }));
  expect(readFileSync(plist(), "utf8")).toContain("<string>/usr/bin:/bin:/usr/sbin:/sbin</string>");
  out = [];
  await runService(["status"], deps({ env: { PATH: "x" } }));
  expect(text()).toContain("PATH: /usr/bin:/bin:/usr/sbin:/sbin");
});

test("re-install while the service holds the port: boots out first, then the port is free", async () => {
  await runService(["install"], deps());
  loaded = true;
  const held = () => loaded;
  const d = deps();
  d.portInUse = async () => { probes++; return held(); };
  calls = [];
  expect(await runService(["install"], d)).toBe(0);
  expect(calls.indexOf("launchctl bootout gui/501/com.agent-world.server")).toBeLessThan(calls.findIndex(c => c.includes("bootstrap")));
});

test("the old process releases the port slowly: probe is polled with sleeps", async () => {
  await runService(["install"], deps());
  let busyFor = 3;
  const d = deps();
  d.portInUse = async () => busyFor-- > 0;
  expect(await runService(["install"], d)).toBe(0);
  expect(sleeps).toEqual([300, 300, 300]);
});

test("a foreign process after boot-out: old service stopped, nothing new installed, exit 1", async () => {
  await runService(["install"], deps());
  const before = readFileSync(plist(), "utf8");
  portBusy = true;
  sleeps = [];
  calls = [];
  expect(await runService(["install", "--agents-dir", agents], deps({ env: { AGENT_WORLD_PORT: "4400" } }))).toBe(1);
  expect(text()).toContain("older Agent World service was stopped");
  expect(text()).toContain("nothing new was installed");
  expect(sleeps).toHaveLength(9);
  expect(calls.some(c => c.includes("bootstrap"))).toBe(false);
  expect(readFileSync(plist(), "utf8")).toBe(before);
});

test("bootstrap is retried: two failures then success", async () => {
  bootstrapFails = 2;
  expect(await runService(["install"], deps())).toBe(0);
  expect(calls.filter(c => c.includes("bootstrap"))).toHaveLength(3);
  expect(sleeps).toEqual([500, 500]);
});

test("bootstrap failing five times exits 1 and shows launchctl's error", async () => {
  bootstrapFails = 99;
  expect(await runService(["install"], deps())).toBe(1);
  expect(calls.filter(c => c.includes("bootstrap"))).toHaveLength(5);
  expect(text()).toContain("Input/output error");
});

test("a relative AGENT_WORLD_HOME is made absolute (from the installer's folder) before it goes into the plist and the log path", async () => {
  expect(await runService(["install"], deps({ env: { AGENT_WORLD_HOME: "rel/aw" } }))).toBe(0);
  const abs = join(dir, "cwd", "rel", "aw");
  const p = readFileSync(plist(), "utf8");
  expect(p).toMatch(new RegExp(`<key>AGENT_WORLD_HOME</key>\\s*<string>${abs}</string>`));
  expect(p).toContain(`<string>${join(abs, "server.log")}</string>`);
  expect(p).not.toMatch(/<string>rel\//);
  expect(existsSync(abs)).toBe(true);                       // the log folder was made there
  expect(text()).toContain(`Log: ${join(abs, "server.log")}`);
  out = [];
  await runService(["status"], deps({ env: { AGENT_WORLD_HOME: "rel/aw" } }));
  expect(text()).toContain(`log: ${join(abs, "server.log")}`);
});

test("a stale plist with no service loaded and the port busy: refused without claiming an older service was stopped", async () => {
  await runService(["install"], deps());
  const before = readFileSync(plist(), "utf8");
  loaded = false;                                           // launchd no longer knows it (e.g. after a manual bootout)
  portBusy = true;
  calls = []; out = [];
  expect(await runService(["install"], deps())).toBe(1);
  expect(text()).not.toMatch(/stopped/i);
  expect(text()).toContain("4317");
  expect(text()).toContain("nothing was changed");
  expect(calls).toEqual(["launchctl print gui/501/com.agent-world.server"]);   // no build, no bootout, no bootstrap
  expect(readFileSync(plist(), "utf8")).toBe(before);
});
