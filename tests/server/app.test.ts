import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { createApp, type App, type AppOptions } from "../../src/server/app";
import { openStore, type Store } from "../../src/server/store";
import type { AgentEvent, Delta, Snapshot } from "../../src/shared/types";

const fx = (name: string): string => readFileSync(`tests/fixtures/claude-code/${name}.json`, "utf8");
const SESSION_KEY = `claude-code:${JSON.parse(fx("SessionStart")).session_id}`;

type Running = { base: string; app: App; store: Store; server: Server };
const running: Running[] = [];
const aborts: AbortController[] = [];

async function start(opts: Partial<AppOptions> = {}): Promise<Running> {
  const store = opts.store ?? openStore(":memory:");
  const app = createApp({ demo: false, resolveRepo: async p => p, readModel: async () => null, ...opts, store });
  const server = createServer(app.handler);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const r = { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, app, store, server };
  running.push(r);
  return r;
}

afterEach(async () => {
  for (const a of aborts.splice(0)) a.abort();
  for (const r of running.splice(0)) {
    r.app.close();
    r.server.closeAllConnections();
    await new Promise(res => r.server.close(res));
    r.store.close();
  }
});

const ingest = (base: string, body: string, source = "claude-code") => fetch(`${base}/ingest/${source}`, { method: "POST", body });
const snapshot = async (base: string): Promise<Snapshot> => (await fetch(`${base}/api/snapshot`)).json() as Promise<Snapshot>;
const send = (base: string, method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Opens /events and returns a function that resolves with the next SSE message. */
async function openStream(base: string): Promise<() => Promise<{ event: string; data: unknown }>> {
  const ac = new AbortController(); aborts.push(ac);
  const res = await fetch(`${base}/events`, { signal: ac.signal });
  expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  return async () => {
    for (;;) {
      const i = buf.indexOf("\n\n");
      if (i >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const lines = block.split("\n").filter(l => !l.startsWith(":"));
        if (lines.length === 0) continue;
        const event = lines.find(l => l.startsWith("event: "))!.slice(7);
        const data = JSON.parse(lines.filter(l => l.startsWith("data: ")).map(l => l.slice(6)).join("\n"));
        return { event, data };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buf += value;
    }
  };
}

test("hook payload in, delta out on the stream", async () => {
  const { base } = await start();
  const next = await openStream(base);
  const first = await next();
  expect(first.event).toBe("snapshot");
  expect((first.data as Snapshot).sessions).toEqual([]);
  expect((await ingest(base, fx("SessionStart"))).status).toBe(204);
  const msg = await next();
  expect(msg.event).toBe("delta");
  const deltas = msg.data as Delta[];
  const session = deltas.find(d => d.type === "session");
  expect(session?.type === "session" && session.session.state).toBe("idle");
  expect(deltas.some(d => d.type === "character")).toBe(true);
});

test("junk ingest always 204 and changes nothing (Review Focus 2)", async () => {
  const { base, store } = await start();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const body of ["", "not json", "{}", JSON.stringify({ hook_event_name: "Stop" }), "x".repeat(5_000_001)]) {
    expect((await ingest(base, body)).status).toBe(204);
  }
  expect((await ingest(base, fx("SessionStart"), "unknown-source")).status).toBe(204);
  const s = await snapshot(base);
  expect(s.sessions).toHaveLength(0);
  expect(s.characters).toHaveLength(0);
  expect(store.eventCount()).toBe(0);
  expect(warn).toHaveBeenCalledTimes(6);
  warn.mockRestore();
});

test("ingested events are logged without the transcript path", async () => {
  const store = openStore(":memory:");
  const logged: AgentEvent[] = [];
  const { base } = await start({ store: { ...store, logEvent: e => { logged.push(structuredClone(e)); store.logEvent(e); } } });
  await ingest(base, fx("SessionStart"));
  expect(store.eventCount()).toBe(1);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({ source: "claude-code", kind: "session_start" });
  expect(logged[0]!.detail?.transcriptPath).toBeUndefined();
});

test("model fallback fills tier from the transcript", async () => {
  const paths: string[] = [];
  const { base } = await start({ readModel: async p => { paths.push(p); return "claude-opus-5-5"; } });
  expect(JSON.parse(fx("SessionStart")).transcript_path).toBeTruthy();
  await ingest(base, fx("SessionStart"));
  const [s] = (await snapshot(base)).sessions;
  expect(s).toMatchObject({ model: "claude-opus-5-5", tier: 3 });
  expect(paths).toEqual([JSON.parse(fx("SessionStart")).transcript_path]);
});

test("model fallback retries at most once per interval while the model is unknown", async () => {
  let t = 1_000_000; let calls = 0; let answer: string | null = null;
  const { base } = await start({ now: () => t, readModel: async () => { calls++; return answer; } });
  await ingest(base, fx("SessionStart"));
  await ingest(base, fx("UserPromptSubmit"));
  expect(calls).toBe(1);
  t += 30_000; answer = "claude-haiku-4-5";
  await ingest(base, fx("PostToolUse"));
  expect(calls).toBe(2);
  expect((await snapshot(base)).sessions[0]).toMatchObject({ model: "claude-haiku-4-5", tier: 1 });
  t += 60_000;
  await ingest(base, fx("PostToolUse"));
  expect(calls).toBe(2);
});

test("PATCH character", async () => {
  const { base } = await start();
  await ingest(base, fx("SessionStart"));
  const id = (await snapshot(base)).characters[0]!.id;
  const ok = await send(base, "PATCH", `/api/characters/${id}`, { name: "Zed" });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ id, name: "Zed" });
  expect((await snapshot(base)).characters[0]!.name).toBe("Zed");
  const bad = await send(base, "PATCH", `/api/characters/${id}`, { name: "" });
  expect(bad.status).toBe(400);
  expect(typeof ((await bad.json()) as { error: unknown }).error).toBe("string");
  expect((await send(base, "PATCH", "/api/characters/nope", { name: "Q" })).status).toBe(404);
});

test("ack clears attention", async () => {
  const { base } = await start();
  await ingest(base, fx("Stop"));
  expect((await snapshot(base)).sessions[0]!.attention).toBe(true);
  expect((await send(base, "POST", `/api/sessions/${encodeURIComponent(SESSION_KEY)}/ack`)).status).toBe(204);
  expect((await snapshot(base)).sessions[0]!.attention).toBe(false);
});

test("PUT settings", async () => {
  const { base } = await start();
  const ok = await send(base, "PUT", "/api/settings", { theme: "space" });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ theme: "space" });
  expect((await snapshot(base)).settings.theme).toBe("space");
  const bad = await send(base, "PUT", "/api/settings", { rosterCap: 0 });
  expect(bad.status).toBe(400);
  expect(typeof ((await bad.json()) as { error: unknown }).error).toBe("string");
});

test("demo mode discards real ingest", async () => {
  const { base } = await start({ demo: true });
  expect((await ingest(base, fx("SessionStart"))).status).toBe(204);
  const s = await snapshot(base);
  expect(s.sessions).toHaveLength(0);
  expect(s.demo).toBe(true);
});

test("events are applied in arrival order", async () => {
  let first = true;
  const { base } = await start({
    resolveRepo: async p => { if (first) { first = false; await new Promise(r => setTimeout(r, 30)); } return p; },
  });
  const a = ingest(base, fx("SessionStart"));
  const b = ingest(base, fx("Stop"));
  await Promise.all([a, b]);
  expect((await snapshot(base)).sessions[0]!.state).toBe("done");
});

test("inject runs the pipeline and tick prunes and persists", async () => {
  const { base, app, store } = await start({ demo: true });
  await app.inject({ source: "demo", sessionId: "d1", repoPath: "/demo/r", at: 1, kind: "session_start" });
  expect((await snapshot(base)).sessions).toHaveLength(1);
  expect(store.eventCount()).toBe(1);
  app.tick();                               // the event at t=1 is older than 30 days
  expect(store.eventCount()).toBe(0);
  expect(store.load().sessions).toHaveLength(0);  // stale session removed and persisted
});

test("unknown routes and static files", async () => {
  const { base } = await start();
  expect((await fetch(`${base}/`)).status).toBe(404);
  expect((await send(base, "DELETE", "/api/snapshot")).status).toBe(404);
});
