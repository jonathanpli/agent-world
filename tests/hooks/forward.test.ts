import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";

let server: Server | undefined;
afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>(r => { s.close(() => r()); s.closeAllConnections(); });
});

test("exits 0 silently and fast when nothing is listening", () => {
  const t0 = performance.now();
  const r = spawnSync("sh", ["hooks/forward.sh"], { input: "{}\n", env: { ...process.env, AGENT_WORLD_PORT: "1" }, encoding: "utf8" });
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
  const child = spawn("sh", ["hooks/forward.sh"], { env: { ...process.env, AGENT_WORLD_PORT: String(port) }, stdio: ["pipe", "ignore", "ignore"] });
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
    const child = spawn("sh", ["hooks/forward.sh"], { env, stdio: ["pipe", "ignore", "ignore"] });
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
  expect(statSync("hooks/forward.sh").mode & 0o111).toBe(0o111);
  const headers: Record<string, string | string[] | undefined>[] = [];
  server = createServer((req, res) => { headers.push(req.headers); req.resume(); req.on("end", () => res.end("ok")); });
  await new Promise<void>(r => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const home = mkdtempSync(join(tmpdir(), "aw-curlrc-"));
  writeFileSync(join(home, ".curlrc"), 'header = "X-From-Curlrc: yes"\n');
  const child = spawn("sh", ["hooks/forward.sh"], { env: { ...process.env, HOME: home, AGENT_WORLD_PORT: String(port) }, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end("{}");
  const deadline = Date.now() + 2000;
  while (headers.length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  expect(headers).toHaveLength(1);
  expect(headers[0]!["x-from-curlrc"]).toBeUndefined();
});
