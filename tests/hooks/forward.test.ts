import { spawn, spawnSync } from "node:child_process";
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
