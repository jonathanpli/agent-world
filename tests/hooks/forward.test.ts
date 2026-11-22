import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";

/** The script under test; AW_FORWARD_SCRIPT points the suite at a candidate before it replaces the live hook. */
const SCRIPT = process.env.AW_FORWARD_SCRIPT ?? "hooks/forward.sh";

let server: Server | undefined;
afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections(); });
});

test("exits 0 silently and fast when nothing is listening", () => {
  const t0 = performance.now();
  const r = spawnSync("sh", [SCRIPT], { input: "{}\n", env: { ...process.env, AGENT_WORLD_PORT: "1" }, encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe("");
  expect(performance.now() - t0).toBeLessThan(500);
});

test("delivers the payload when a server is listening", async () => {
  const bodies: { url?: string; method?: string; type?: string; body: string }[] = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => { bodies.push({ url: req.url, method: req.method, type: req.headers["content-type"], body }); res.end("ok"); });
  });
  await new Promise<void>(r => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const payload = '{"hook_event_name":"Stop","session_id":"s1"}';
  const child = spawn("sh", [SCRIPT], { env: { ...process.env, AGENT_WORLD_PORT: String(port) }, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(payload);
  const deadline = Date.now() + 2000;
  while (bodies.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toEqual({ url: "/ingest/claude-code", method: "POST", type: "application/json", body: payload });
});

test("ignores proxy environment variables: payload goes to the target, nothing to a proxy", async () => {
  let proxyHits = 0;
  const proxy = createServer((_q, res) => { proxyHits++; res.end(); });
  proxy.on("connection", () => { proxyHits++; });
  await new Promise<void>(r => proxy.listen(0, "127.0.0.1", r));
  const bodies: string[] = [];
  server = createServer((req, res) => {
    let b = "";
    req.on("data", c => (b += c));
    req.on("end", () => { bodies.push(b); res.end("ok"); });
  });
  await new Promise<void>(r => server!.listen(0, "127.0.0.1", r));
  try {
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const env = { ...process.env, AGENT_WORLD_PORT: String((server.address() as AddressInfo).port), http_proxy: proxyUrl, HTTP_PROXY: proxyUrl, ALL_PROXY: proxyUrl, all_proxy: proxyUrl, NO_PROXY: "", no_proxy: "" };
    const child = spawn("sh", [SCRIPT], { env, stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.end("{}");
    const deadline = Date.now() + 2000;
    while (bodies.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    expect(bodies).toEqual(["{}"]);
    expect(proxyHits).toBe(0);
  } finally {
    await new Promise<void>(r => { proxy.close(() => r()); proxy.closeAllConnections(); });
  }
});

test("ignores ~/.curlrc and stays executable", async () => {
  expect(statSync(SCRIPT).mode & 0o111).toBe(0o111);
  const headers: Record<string, string | string[] | undefined>[] = [];
  server = createServer((req, res) => { headers.push(req.headers); req.resume(); req.on("end", () => res.end("ok")); });
  await new Promise<void>(r => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const home = mkdtempSync(join(tmpdir(), "aw-curlrc-"));
  writeFileSync(join(home, ".curlrc"), 'header = "X-From-Curlrc: yes"\n');
  // curl looks for .curlrc in CURL_HOME and XDG_CONFIG_HOME before HOME: clear them so the planted file is the one it would read
  const { CURL_HOME: _c, XDG_CONFIG_HOME: _x, ...env } = process.env;
  const child = spawn("sh", [SCRIPT], { env: { ...env, HOME: home, AGENT_WORLD_PORT: String(port) }, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end("{}");
  const deadline = Date.now() + 2000;
  while (headers.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  expect(headers).toHaveLength(1);
  expect(headers[0]!["x-from-curlrc"]).toBeUndefined();
});

const TERMINAL_ENV = {
  __CFBundleIdentifier: "com.mitchellh.ghostty", TERM_PROGRAM: "iTerm.app", ITERM_SESSION_ID: "w0t1p0:6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C",
  TMUX_PANE: "%12", TMUX: "/private/tmp/tmux-501/default,4242,0",
  CMUX_WORKSPACE_ID: "ws-0a1b2c", CMUX_SURFACE_ID: "sf-3d4e5f", CMUX_PANEL_ID: "pn-6a7b8c", CMUX_SOCKET_PATH: "/Users/test/Library/Application Support/cmux/cmux.sock",
};

/** A bin directory holding `cat`, `curl` and, unless `ps` is null, a fake `ps` with that body; nothing else is on PATH. */
function bin(ps: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-bin-"));
  for (const tool of ["cat", "curl"]) {
    const found = spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    symlinkSync(found, join(dir, tool));
  }
  if (ps !== null) { writeFileSync(join(dir, "ps"), `#!/bin/sh\n${ps}\n`); chmodSync(join(dir, "ps"), 0o755); }
  return dir;
}

/** Runs the forwarder with exactly `env` (plus PATH and the port) and returns the headers of the one request it makes. */
async function headersFor(env: Record<string, string>, path: string, cwd?: string): Promise<{ headers: Record<string, string | string[] | undefined>; status: number | null; out: string }> {
  const got: Record<string, string | string[] | undefined>[] = [];
  server = createServer((req, res) => { req.resume(); req.on("end", () => { got.push(req.headers); res.end("ok"); }); });
  await new Promise<void>(r => server!.listen(0, "127.0.0.1", r));
  const child = spawn("/bin/sh", [resolve(SCRIPT)], {
    env: { ...env, PATH: path, AGENT_WORLD_PORT: String((server.address() as AddressInfo).port) }, cwd, stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", c => (out += c)); child.stderr.on("data", c => (out += c));
  const status = new Promise<number | null>(r => child.on("close", r));
  child.stdin.end("{}");
  const deadline = Date.now() + 2000;
  while (got.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  expect(got).toHaveLength(1);
  return { headers: got[0]!, status: await status, out };
}
const awHeaders = (h: Record<string, unknown>) => Object.fromEntries(Object.entries(h).filter(([k]) => k.startsWith("x-aw-")));

test("reports every terminal variable as its header", async () => {
  const { headers, status, out } = await headersFor(TERMINAL_ENV, bin("printf ' ttys012  \\n'"));
  expect(status).toBe(0);
  expect(out).toBe("");
  expect(awHeaders(headers)).toEqual({
    "x-aw-bundle-id": "com.mitchellh.ghostty", "x-aw-term-program": "iTerm.app", "x-aw-iterm-session": "w0t1p0:6B29A1C4-0D2E-4F3A-9B8C-7D6E5F4A3B2C",
    "x-aw-tty": "ttys012", "x-aw-tmux-pane": "%12", "x-aw-tmux-socket": "/private/tmp/tmux-501/default",
    "x-aw-cmux-workspace": "ws-0a1b2c", "x-aw-cmux-surface": "sf-3d4e5f", "x-aw-cmux-panel": "pn-6a7b8c",
  });   // the cmux socket path has a space: outside the pattern, so not sent
});

test("sends no X-AW header when no variable is set and there is no tty", async () => {
  const { headers, status } = await headersFor({}, bin("printf '??\\n'"));
  expect(status).toBe(0);
  expect(awHeaders(headers)).toEqual({});
});

test("a missing or failing ps means no tty header, and the payload still goes", async () => {
  for (const ps of [null, "echo ttys001; exit 1", "sleep 0; echo 'ttys1 ttys2'", "echo pts/3"]) {
    const { headers, status, out } = await headersFor({ TERM_PROGRAM: "vscode" }, bin(ps));
    expect(status).toBe(0);
    expect(out).toBe("");
    expect(awHeaders(headers)).toEqual({ "x-aw-term-program": "vscode" });
  }
});

test("hostile values cannot break the request or run anything (Review Focus 2)", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "aw-hostile-"));
  mkdirSync(join(cwd, "sub"));
  const hostile = ["has space", 'quo"te', "new\nline", "$(touch x)", "`touch y`", "a".repeat(10_000), "relative/sock", "x\r\nX-Injected: 1"];
  for (const value of hostile) {
    const env = Object.fromEntries(Object.keys(TERMINAL_ENV).map(k => [k, value]));
    const ttyFile = join(mkdtempSync(join(tmpdir(), "aw-tty-")), "tty");
    writeFileSync(ttyFile, `ttys1${value}\n`);
    const { headers, status, out } = await headersFor(env, bin(`cat '${ttyFile}'`), cwd);
    expect(status).toBe(0);
    expect(out).toBe("");
    expect(awHeaders(headers)).toEqual({});
    expect(headers["x-injected"]).toBeUndefined();
    await new Promise<void>(r => { server!.close(() => r()); server!.closeAllConnections(); });
    server = undefined;
  }
  expect(readdirSync(cwd)).toEqual(["sub"]);
  expect(existsSync(join(process.cwd(), "x")) || existsSync(join(process.cwd(), "y"))).toBe(false);
});

test("with every variable set it still exits 0 silently when nothing is listening", () => {
  const r = spawnSync("sh", [SCRIPT], { input: "{}\n", env: { ...process.env, ...TERMINAL_ENV, AGENT_WORLD_PORT: "1" }, encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe("");
});
