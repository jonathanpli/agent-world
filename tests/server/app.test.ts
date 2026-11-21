import { readFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import { createApp, type App, type AppOptions } from "../../src/server/app";
import { openStore, type Store } from "../../src/server/store";
import type { TranscriptInfo } from "../../src/server/transcript";
import { CONFIG } from "../../src/shared/config";
import type { AgentEvent, Delta, Snapshot } from "../../src/shared/types";

/** A transcript reader that knows only the model, as the model-fallback tests need. */
const byModel = (read: (path: string) => Promise<string | null>) => async (path: string): Promise<TranscriptInfo> =>
  ({ model: await read(path), contextTokens: null, boundaries: [] });
const fx = (name: string): string => readFileSync(`tests/fixtures/claude-code/${name}.json`, "utf8");
const SESSION_KEY = `claude-code:${JSON.parse(fx("SessionStart")).session_id}`;

type Running = { base: string; app: App; store: Store; server: Server };
const running: Running[] = [];
const aborts: AbortController[] = [];

async function start(opts: Partial<AppOptions> = {}): Promise<Running> {
  const store = opts.store ?? openStore(":memory:");
  const app = createApp({ demo: false, resolveRepo: async p => p, readTranscript: byModel(async () => null), ...opts, store });
  const server = createServer(app.handler);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const r = { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, app, store, server };
  running.push(r);
  return r;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const a of aborts.splice(0)) a.abort();
  for (const r of running.splice(0)) {
    r.app.close();
    r.server.closeAllConnections();
    await new Promise(res => r.server.close(res));
    r.store.close();
  }
  vi.useRealTimers();
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
  const { base } = await start({ readTranscript: byModel(async () => "claude-sonnet-4-5") });
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
  const { base } = await start({ readTranscript: byModel(async p => { paths.push(p); return "claude-opus-5-5"; }) });
  expect(JSON.parse(fx("SessionStart")).transcript_path).toBeTruthy();
  await ingest(base, fx("SessionStart"));
  const [s] = (await snapshot(base)).sessions;
  expect(s).toMatchObject({ model: "claude-opus-5-5", tier: 3 });
  expect(paths.length).toBeGreaterThan(0);                  // the model read; the context read shares the reader
  expect(new Set(paths)).toEqual(new Set([JSON.parse(fx("SessionStart")).transcript_path]));
});

test("model fallback retries at most once per interval while the model is unknown", async () => {
  // the reader is shared with the context reads, so these model-fallback tests check what the session picks up, not call counts
  let t = 1_000_000; let answer: string | null = null;
  const { base } = await start({ now: () => t, readTranscript: byModel(async () => answer) });
  await ingest(base, fx("SessionStart"));
  answer = "claude-haiku-4-5";
  t += CONFIG.modelRetryMs - 1; await ingest(base, fx("UserPromptSubmit"));      // inside the interval: not read for the model
  expect((await snapshot(base)).sessions[0]).toMatchObject({ model: null, tierKnown: false });
  t += 1; await ingest(base, fx("PostToolUse"));
  expect((await snapshot(base)).sessions[0]).toMatchObject({ model: "claude-haiku-4-5", tier: 1 });
  answer = "claude-opus-5-5";                                                    // known now: the fallback is not consulted again
  t += 60_000; await ingest(base, fx("PostToolUse"));
  expect((await snapshot(base)).sessions[0]).toMatchObject({ model: "claude-haiku-4-5", tier: 1 });
});

test("model fallback reaches a short session whose transcript appears after SessionStart (live run timing)", async () => {
  let t = 1_000_000; let answer: string | null = null;
  const { base } = await start({ now: () => t, readTranscript: byModel(async () => answer) });
  await ingest(base, fx("SessionStart"));
  t += 1_300; await ingest(base, fx("UserPromptSubmit"));
  t += 4_000; answer = "claude-opus-5-5";   // the first assistant message is on disk by the first tool call
  await ingest(base, fx("PostToolUse"));
  expect((await snapshot(base)).sessions[0]).toMatchObject({ model: "claude-opus-5-5", tier: 3 });
});

test("a session waits for its model before joining the roster: one character for the real fixture replay", async () => {
  let t = 1_000_000; let answer: string | null = null;
  const { base } = await start({ now: () => t, readTranscript: byModel(async () => answer) });
  const next = await openStream(base);
  await next();                                             // the snapshot
  const deltas: Delta[] = [];
  await ingest(base, fx("SessionStart")); deltas.push(...((await next()).data as Delta[]));
  t += 1_300; await ingest(base, fx("UserPromptSubmit")); deltas.push(...((await next()).data as Delta[]));
  let s = await snapshot(base);
  expect(s.characters).toEqual([]);
  expect(s.sessions[0]).toMatchObject({ characterId: null, tierKnown: false, pendingXp: CONFIG.xp.prompt });
  t += 4_000; answer = "claude-opus-5-5";
  await ingest(base, fx("PostToolUse")); deltas.push(...((await next()).data as Delta[]));
  t += 2_000; await ingest(base, fx("Stop")); deltas.push(...((await next()).data as Delta[]));
  s = await snapshot(base);
  expect(s.characters).toHaveLength(1);
  expect(s.characters[0]).toMatchObject({ tier: 3, xp: CONFIG.xp.prompt + CONFIG.xp.tool + CONFIG.xp.taskDone, stats: { tasks: 1, tools: 1 } });
  expect(new Set(deltas.flatMap(d => (d.type === "character" ? [d.character.id] : []))).size).toBe(1);
  expect(deltas.every(d => d.type !== "character" || d.character.tier === 3)).toBe(true);
  expect(s.sessions[0]).toMatchObject({ characterId: s.characters[0]!.id, tier: 3, tierKnown: true, pendingXp: 0, state: "done" });
});

test("a session that never resolves its model joins at the default tier when it ends", async () => {
  const { base } = await start();
  for (const name of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]) await ingest(base, fx(name));
  expect((await snapshot(base)).characters).toEqual([]);
  await ingest(base, fx("SessionEnd"));
  const s = await snapshot(base);
  expect(s.sessions).toEqual([]);
  expect(s.characters).toHaveLength(1);
  expect(s.characters[0]).toMatchObject({ tier: CONFIG.defaultTier, xp: CONFIG.xp.prompt + CONFIG.xp.tool + CONFIG.xp.taskDone });
});

test("model fallback stops once the tier is known, even if the model never resolved", async () => {
  let t = 1_000_000; let answer: string | null = null;
  const { base } = await start({ now: () => t, readTranscript: byModel(async () => answer) });
  await ingest(base, fx("SessionStart"));
  t += CONFIG.modelRetryMs; await ingest(base, fx("UserPromptSubmit"));
  t += CONFIG.modelGraceMs + 1; await ingest(base, fx("PostToolUse"));      // the grace period ends: joins at the default tier
  expect((await snapshot(base)).sessions[0]).toMatchObject({ tierKnown: true, tier: CONFIG.defaultTier, model: null });
  answer = "claude-opus-5-5";
  for (let i = 0; i < 3; i++) { t += CONFIG.modelRetryMs; await ingest(base, fx("PostToolUse")); }
  expect((await snapshot(base)).sessions[0]).toMatchObject({ tier: CONFIG.defaultTier, model: null });
});

test("model fallback gives up after CONFIG.modelRetryMax reads for a session that never yields a model", async () => {
  /** SessionStart, then Notifications 2 s apart until `reads` model reads have come back empty; then the model appears. */
  async function run(reads: number): Promise<Snapshot["sessions"][number]> {
    let t = 1_000_000; let answer: string | null = null;
    const { base } = await start({ now: () => t, readTranscript: byModel(async () => answer) });
    await ingest(base, fx("SessionStart")); t += CONFIG.modelRetryMs;       // no prompt follows, so the grace clock never starts
    for (let i = 1; i < reads; i++) { await ingest(base, fx("Notification.synthetic")); t += CONFIG.modelRetryMs; }
    answer = "claude-opus-5-5";
    for (let i = 0; i < 5; i++) { await ingest(base, fx("Notification.synthetic")); t += CONFIG.modelRetryMs; }
    return (await snapshot(base)).sessions[0]!;
  }
  expect(await run(CONFIG.modelRetryMax - 1)).toMatchObject({ model: "claude-opus-5-5", tier: 3 });   // the last allowed read finds it
  expect(await run(CONFIG.modelRetryMax)).toMatchObject({ model: null, tierKnown: false, characterId: null });   // no prompt yet: still arriving
});

test("interactive start: first prompt 20 s after SessionStart, model on the first tool: one character", async () => {
  let t = 1_000_000; let answer: string | null = null;
  const { base } = await start({ now: () => t, readTranscript: byModel(async () => answer) });
  await ingest(base, fx("SessionStart"));
  t += 20_000; await ingest(base, fx("UserPromptSubmit"));
  expect((await snapshot(base)).characters).toEqual([]);
  t += 3_000; answer = "claude-opus-5-5"; await ingest(base, fx("PostToolUse"));
  const s = await snapshot(base);
  expect(s.characters).toHaveLength(1);
  expect(s.characters[0]).toMatchObject({ tier: 3, xp: CONFIG.xp.prompt + CONFIG.xp.tool });
});

test("an arrival that quits at once leaves no character", async () => {
  const { base } = await start();
  await ingest(base, fx("SessionStart"));
  await ingest(base, fx("SessionEnd"));
  const s = await snapshot(base);
  expect(s.sessions).toEqual([]);
  expect(s.characters).toEqual([]);
});

test("PATCH character", async () => {
  const { base } = await start({ readTranscript: byModel(async () => "claude-sonnet-4-5") });
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

test("PUT settings treats learnedLimits as the unknown key it is", async () => {
  const { base, store } = await start();
  for (const body of [{ bogus: 1 }, { learnedLimits: { "claude-opus-5-5": 1 } }]) {
    const res = await send(base, "PUT", "/api/settings", body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CONFIG.defaultSettings);
  }
  expect(store.load().learnedLimits).toEqual({});
  expect(store.load().settings).toEqual(CONFIG.defaultSettings);
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

test("malformed URL escapes: 400 on the API, 204 on ingest", async () => {
  const { base } = await start();
  const ack = await send(base, "POST", "/api/sessions/%E0%A4%A/ack");
  expect(ack.status).toBe(400);
  expect(typeof ((await ack.json()) as { error: unknown }).error).toBe("string");
  const patch = await send(base, "PATCH", "/api/characters/%E0%A4%A", { name: "Q" });
  expect(patch.status).toBe(400);
  expect(typeof ((await patch.json()) as { error: unknown }).error).toBe("string");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect((await ingest(base, fx("SessionStart"), "%E0%A4%A")).status).toBe(204);
  expect(warn).toHaveBeenCalledTimes(1);
  expect((await snapshot(base)).sessions).toHaveLength(0);
});

/** Raw request with full control over headers (fetch does not let a test set Host). */
function raw(base: string, method: string, path: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(base);
  return new Promise((res, rej) => {
    const req = request({ hostname, port, method, path, headers }, r => {
      let data = ""; r.setEncoding("utf8");
      r.on("data", c => { data += c; });
      r.on("end", () => res({ status: r.statusCode!, body: data }));
    });
    req.on("error", rej);
    req.end(body);
  });
}

test("a foreign Host header is refused (DNS rebinding)", async () => {
  const { base } = await start();
  for (const path of ["/api/snapshot", "/events"]) {
    expect((await raw(base, "GET", path, { host: "evil.example:4317" })).status).toBe(403);
  }
  expect((await raw(base, "GET", "/api/snapshot", { host: "localhost:5173" })).status).toBe(200);
  expect((await raw(base, "GET", "/api/snapshot", { host: "[::1]:4317" })).status).toBe(200);
});

test("a missing Host header is refused", async () => {
  const { app } = await start();
  const res = fakeRes();
  app.handler(fakeReq({ remoteAddress: "127.0.0.1", headers: {} }), res);
  await res.done;
  expect(res.status).toBe(403);
});

test("a foreign browser Origin is refused on writes, and its ingest is discarded", async () => {
  const { base } = await start({ readTranscript: byModel(async () => "claude-sonnet-4-5") });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const evil = { origin: "https://evil.example", "content-type": "application/json" };
  expect((await raw(base, "POST", "/ingest/claude-code", { origin: "https://evil.example" }, fx("SessionStart"))).status).toBe(204);
  expect((await snapshot(base)).sessions).toHaveLength(0);
  expect((await raw(base, "POST", "/ingest/claude-code", {}, fx("Stop"))).status).toBe(204);    // like the hook's curl
  const s = await snapshot(base);
  expect(s.sessions).toHaveLength(1);
  expect(s.sessions[0]!.attention).toBe(true);
  expect((await raw(base, "POST", `/api/sessions/${encodeURIComponent(SESSION_KEY)}/ack`, evil)).status).toBe(403);
  expect((await snapshot(base)).sessions[0]!.attention).toBe(true);
  const id = s.characters[0]!.id;
  expect((await raw(base, "PATCH", `/api/characters/${id}`, evil, JSON.stringify({ name: "Pwned" }))).status).toBe(403);
  expect((await snapshot(base)).characters[0]!.name).not.toBe("Pwned");
  const local = await raw(base, "PUT", "/api/settings", { origin: "http://localhost:5173", "content-type": "application/json" }, JSON.stringify({ theme: "space" }));
  expect(local.status).toBe(200);
  expect((await snapshot(base)).settings.theme).toBe("space");
});

type FakeRes = ServerResponse & { status: number | undefined; done: Promise<void> };
function fakeReq(o: { remoteAddress: string; headers: Record<string, string> }): IncomingMessage {
  return { socket: { remoteAddress: o.remoteAddress }, method: "GET", url: "/api/snapshot", headers: o.headers } as unknown as IncomingMessage;
}
function fakeRes(): FakeRes {
  let finish!: () => void;
  const r = {
    status: undefined as number | undefined, headersSent: false, done: new Promise<void>(f => { finish = f; }),
    writeHead(code: number) { r.status = code; r.headersSent = true; return r; },
    end() { finish(); return r; },
  };
  return r as unknown as FakeRes;
}

test("a non-loopback peer is refused", async () => {
  const { app } = await start();
  for (const remoteAddress of ["10.0.0.5", "192.168.1.2", "::ffff:10.0.0.5"]) {
    const res = fakeRes();
    app.handler(fakeReq({ remoteAddress, headers: { host: "127.0.0.1:4317" } }), res);
    await res.done;
    expect(res.status).toBe(403);
  }
  const ok = fakeRes();
  app.handler(fakeReq({ remoteAddress: "::1", headers: { host: "127.0.0.1:4317" } }), ok);
  await ok.done;
  expect(ok.status).toBe(200);
});

test("a transcript read that never finishes does not stall the queue", async () => {
  const { base } = await start({ readTranscript: byModel(() => new Promise<string | null>(() => {})) });
  const t0 = Date.now();
  expect((await ingest(base, fx("SessionStart"))).status).toBe(204);
  expect((await ingest(base, fx("Stop"))).status).toBe(204);
  const s = await snapshot(base);
  expect(s.sessions).toHaveLength(1);
  expect(s.sessions[0]!.state).toBe("done");
  expect(Date.now() - t0).toBeLessThan(CONFIG.modelReadTimeoutMs * 3);
});

test("a repo resolution that never finishes falls back to the cwd", async () => {
  const { base } = await start({ resolveRepo: () => new Promise<string>(() => {}) });
  await ingest(base, fx("SessionStart"));
  const s = await snapshot(base);
  expect(s.sessions).toHaveLength(1);
  expect(s.repos[0]!.path).toBe(JSON.parse(fx("SessionStart")).cwd);
}, CONFIG.repoResolveTimeoutMs * 3);

test("prototype keys are unknown sources, not adapters", async () => {
  const { base } = await start();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const source of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    expect((await ingest(base, fx("SessionStart"), source)).status).toBe(204);
  }
  expect(warn).toHaveBeenCalledTimes(4);
  expect(warn.mock.calls.every(c => String(c[0]).includes("unknown source"))).toBe(true);
  expect(error).not.toHaveBeenCalled();
  expect((await snapshot(base)).sessions).toHaveLength(0);
});

test("dismiss ends a session through the end path; unknown keys 404; foreign origins 403", async () => {
  const { base, store } = await start({ readTranscript: byModel(async () => "claude-sonnet-4-5") });
  const next = await openStream(base);
  await next();                                         // snapshot
  await ingest(base, fx("SessionStart"));
  await next();
  const path = `/api/sessions/${encodeURIComponent(SESSION_KEY)}/dismiss`;
  expect((await raw(base, "POST", path, { origin: "https://evil.example" })).status).toBe(403);
  expect((await snapshot(base)).sessions).toHaveLength(1);
  expect((await send(base, "POST", "/api/sessions/claude-code%3Anope/dismiss")).status).toBe(404);
  expect((await send(base, "POST", "/api/sessions/%E0%A4%A/dismiss")).status).toBe(400);
  expect((await send(base, "POST", path)).status).toBe(204);
  expect((await next()).data).toContainEqual({ type: "session_removed", key: SESSION_KEY });
  const s = await snapshot(base);
  expect(s.sessions).toHaveLength(0);
  expect(s.characters).toHaveLength(1);                 // the character stays, off duty
  expect(store.load().sessions).toHaveLength(0);        // persisted
});

test("starting in demo mode ends the sessions a previous demo run left in the store", async () => {
  const { base, store } = await start({ readTranscript: byModel(async () => "claude-sonnet-4-5") });
  await ingest(base, fx("SessionStart"));
  await ingest(base, fx("UserPromptSubmit"));
  expect(store.load().sessions).toHaveLength(1);
  const demo = createApp({ store, demo: true, resolveRepo: async p => p, readTranscript: byModel(async () => null) });
  expect(store.load().sessions).toHaveLength(0);
  expect(store.load().characters).toHaveLength(1);
  const server = createServer(demo.handler);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    const s = await snapshot(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    expect(s.sessions).toEqual([]);
  } finally {
    demo.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});

test("an unrecognised model id binds at the default tier at once, keeping the model string", async () => {
  const { base } = await start({ readTranscript: byModel(async () => "gpt-9-turbo") });
  await ingest(base, fx("SessionStart"));
  const s = (await snapshot(base)).sessions[0]!;
  expect(s).toMatchObject({ tierKnown: true, tier: CONFIG.defaultTier, model: "gpt-9-turbo" });
  expect(s.characterId).not.toBeNull();
});

test("blocking Stop hook round trip: repeat Stop and idle_prompt go through ingest, SSE and the store without a warning or a second notice", async () => {
  const warn = vi.spyOn(console, "warn");
  const { base, store } = await start({ readTranscript: byModel(async () => "claude-sonnet-4-5") });
  const next = await openStream(base);
  await next();
  const idle = JSON.stringify({ ...JSON.parse(fx("Notification.synthetic")), notification_type: "idle_prompt", message: "Claude is waiting for your input" });
  const deltas: Delta[] = [];
  for (const body of [fx("SessionStart"), fx("Stop"), fx("PostToolUse"), fx("Stop.hookActive.synthetic"), idle]) {
    await ingest(base, body);
    deltas.push(...((await next()).data as Delta[]));
  }
  expect(deltas.flatMap(d => (d.type === "notice" ? [d.notice.kind] : [])).filter(k => k === "done" || k === "needs_input")).toEqual(["done"]);
  expect((await snapshot(base)).sessions[0]).toMatchObject({ state: "done" });
  expect(store.load().sessions[0]).toMatchObject({ state: "done" });
  expect(store.eventCount()).toBe(5);
  expect(warn).not.toHaveBeenCalled();
});

// ---- context reads: throttled transcript reads turned into `context` events ----

const START = JSON.parse(fx("SessionStart")) as { session_id: string; transcript_path: string; cwd: string };
const startWithModel = JSON.stringify({ ...START, model: "claude-opus-5-5" });   // the tier is known: no model-fallback read
const postCompact = JSON.stringify({ session_id: START.session_id, transcript_path: START.transcript_path, cwd: START.cwd, hook_event_name: "PostCompact", trigger: "auto" });
const flush = () => new Promise(r => setImmediate(r));

/** An app on fake timeouts and a hand-moved clock, with a reader that returns `rig.info`, and a store that records what it is given. */
async function contextRig() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const rig = { t: 1_000_000, reads: 0, info: { model: null, contextTokens: null, boundaries: [] } as TranscriptInfo, logged: [] as AgentEvent[], persists: 0 };
  const inner = openStore(":memory:");
  const store: Store = {
    ...inner,
    logEvent: e => { rig.logged.push(structuredClone(e)); inner.logEvent(e); },
    persist: d => { rig.persists++; inner.persist(d); },
  };
  const r = await start({ store, now: () => rig.t, readTranscript: async () => { rig.reads++; return structuredClone(rig.info); } });
  /** Moves the clock and the fake timeouts together. */
  const advance = async (ms: number) => { rig.t += ms; await vi.advanceTimersByTimeAsync(ms); await flush(); };
  const context = async () => (await snapshot(r.base)).sessions[0]?.context ?? null;
  return { ...r, rig, advance, context };
}

test("a hook payload reads the transcript and injects the context reading", async () => {
  const { base, rig, advance, context } = await contextRig();
  await ingest(base, startWithModel); await flush();
  expect(rig.reads).toBe(1);
  expect(await context()).toBeNull();                           // no reading yet: nothing injected
  rig.info = { model: "claude-opus-5-5", contextTokens: 50_000, boundaries: [] };
  await advance(CONFIG.contextReadMs);
  await ingest(base, fx("PostToolUse")); await flush();
  expect(rig.reads).toBe(2);
  expect(await context()).toMatchObject({ tokens: 50_000, limit: 200_000 });
});

test("five payloads inside the throttle window cause exactly two reads: leading and trailing", async () => {
  const { base, rig, advance, context } = await contextRig();
  rig.info = { model: "claude-opus-5-5", contextTokens: 50_000, boundaries: [] };
  await ingest(base, startWithModel); await flush();
  for (let i = 0; i < 4; i++) { await advance(400); await ingest(base, fx("PostToolUse")); await flush(); }
  expect(rig.reads).toBe(1);
  rig.info = { ...rig.info, contextTokens: 60_000 };
  await advance(CONFIG.contextReadMs - 1_600);                    // the 2 000 ms mark: the trailing read
  expect(rig.reads).toBe(2);
  expect(await context()).toMatchObject({ tokens: 60_000 });
  await advance(10_000);
  expect(rig.reads).toBe(2);
});

test("an unchanged reading injects nothing; a new boundary uuid does", async () => {
  const { base, rig, advance, context } = await contextRig();
  rig.info = { model: "claude-opus-5-5", contextTokens: 50_000, boundaries: [] };
  await ingest(base, startWithModel); await flush();
  expect(await context()).toMatchObject({ tokens: 50_000 });
  let before = rig.persists;
  await advance(CONFIG.contextReadMs);
  await ingest(base, fx("PostToolUse")); await flush();
  expect(rig.reads).toBe(2);
  expect(rig.persists).toBe(before + 1);                          // the tool event only
  rig.info = { ...rig.info, boundaries: [{ uuid: "u1", trigger: "manual", preTokens: 90_000, postTokens: 20_000 }] };
  before = rig.persists;
  await advance(CONFIG.contextReadMs);
  await ingest(base, fx("PostToolUse")); await flush();
  expect(rig.persists).toBe(before + 2);                          // the tool event and the reading
});

test("a PostCompact payload triggers a read, logs no event and warns nothing", async () => {
  const { base, rig, advance, context, store } = await contextRig();
  const warn = vi.spyOn(console, "warn");
  await ingest(base, startWithModel); await flush();
  rig.info = { model: "claude-opus-5-5", contextTokens: 35_119, boundaries: [{ uuid: "u1", trigger: "auto", preTokens: 217_132, postTokens: 35_119 }] };
  await advance(CONFIG.contextReadMs);
  expect((await ingest(base, postCompact)).status).toBe(204); await flush();
  expect(rig.reads).toBe(2);
  expect(store.eventCount()).toBe(1);
  expect(warn).not.toHaveBeenCalled();
  expect(await context()).toMatchObject({ tokens: 35_119 });
});

test("context events never reach store.logEvent", async () => {
  const { base, rig, advance, context } = await contextRig();
  rig.info = { model: "claude-opus-5-5", contextTokens: 50_000, boundaries: [] };
  await ingest(base, startWithModel); await flush();
  await advance(CONFIG.contextReadMs);
  rig.info = { ...rig.info, contextTokens: 70_000 };
  await ingest(base, fx("PostToolUse")); await flush();
  expect(await context()).toMatchObject({ tokens: 70_000 });
  expect(rig.logged.map(e => e.kind)).toEqual(["session_start", "tool"]);
});

test("a payload for a session the world does not know injects nothing visible", async () => {
  const { base, rig, advance } = await contextRig();
  rig.info = { model: "claude-opus-5-5", contextTokens: 50_000, boundaries: [] };
  await ingest(base, postCompact); await flush();
  await advance(CONFIG.contextReadMs);
  const s = await snapshot(base);
  expect(s.sessions).toEqual([]);
  expect(s.characters).toEqual([]);
  expect(rig.logged).toEqual([]);
});

test("close() leaves no pending timers", async () => {
  const { app, rig, advance } = await contextRig();
  /** Ingest straight through the handler: fetch keeps timeouts of its own, which would muddle the count. */
  const direct = async (body: string) => {
    const req = Object.assign(Readable.from([Buffer.from(body)]), {
      socket: { remoteAddress: "127.0.0.1" }, method: "POST", url: "/ingest/claude-code", headers: { host: "127.0.0.1:4317" },
    }) as unknown as IncomingMessage;
    const res = fakeRes();
    app.handler(req, res);
    await res.done; await flush();
  };
  await direct(startWithModel);
  await advance(400);
  const others = vi.getTimerCount();                              // fetch from earlier tests may still hold a timeout or two
  await direct(fx("PostToolUse"));                                // inside the window: a trailing read is pending
  expect(vi.getTimerCount()).toBe(others + 1);
  app.close();
  expect(vi.getTimerCount()).toBe(others);
  await advance(CONFIG.contextReadMs);
  expect(rig.reads).toBe(1);
});
