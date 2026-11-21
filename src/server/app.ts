import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { ADAPTERS } from "../adapters";
import { tierForModel } from "../adapters/claudeCode";
import { createWorld } from "../core/world";
import { CONFIG } from "../shared/config";
import type { AgentEvent, Delta, Look, Settings } from "../shared/types";
import { modelFromTranscript } from "./modelFallback";
import { createRepoResolver } from "./repoResolver";
import type { Store } from "./store";

export type AppOptions = {
  store: Store; demo: boolean; now?: () => number; staticDir?: string;
  resolveRepo?: (cwd: string) => Promise<string>; readModel?: (transcriptPath: string) => Promise<string | null>;
};
export type App = {
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  inject(ev: AgentEvent): Promise<void>;     // the same pipeline ingest uses, after parsing; the demo simulator calls this
  tick(): void;
  close(): void;                             // ends all SSE streams
};

const MS_PER_DAY = 86_400_000;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".map": "application/json", ".ico": "image/x-icon",
};

/** Reads the body up to `CONFIG.ingestBodyMax` bytes; past that it drains and discards the rest and resolves null. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise(res => {
    const chunks: Buffer[] = [];
    let size = 0; let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > CONFIG.ingestBodyMax) { over = true; chunks.length = 0; } else chunks.push(c);
    });
    req.on("end", () => res(over ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => res(null));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendStatus(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

/** decodeURIComponent that returns null instead of throwing on a malformed escape. */
function decode(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** True when `value` (a Host header, or an Origin URL with `asUrl`) names this machine. Anything unparsable is foreign. */
function isLocal(value: string | undefined, asUrl: boolean): boolean {
  if (value === undefined || value === "") return false;
  try { return LOCAL_HOSTNAMES.has(new URL(asUrl ? value : `http://${value}`).hostname); } catch { return false; }
}

/** Resolves with `p`, or with `fallback` once `ms` pass first. A rejection also yields `fallback`. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(res => {
    const timer = setTimeout(() => res(fallback), ms);
    p.then(v => { clearTimeout(timer); res(v); }, () => { clearTimeout(timer); res(fallback); });
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function createApp(opts: AppOptions): App {
  const { store, demo } = opts;
  const now = opts.now ?? Date.now;
  const resolveRepo = opts.resolveRepo ?? createRepoResolver();
  const readModel = opts.readModel ?? modelFromTranscript;
  const world = createWorld(store.load(), { rng: Math.random, newId: randomUUID });

  /**
   * sessionKey → whether the session still wants its model from the transcript (tier unknown and no model yet),
   * mirrored from session deltas so the pipeline can ask cheaply. A key not in the map is a new session: it does.
   */
  const wantsModel = (s: { tierKnown: boolean; model: string | null }): boolean => !s.tierKnown && s.model === null;
  const sessionWantsModel = new Map(world.snapshot(now(), demo).sessions.map(s => [s.key, wantsModel(s)]));
  /** sessionKey → when the transcript was last read for a model, and how many reads so far (capped at CONFIG.modelRetryMax). */
  const modelTries = new Map<string, { at: number; count: number }>();
  const streams = new Set<ServerResponse>();
  let queue: Promise<void> = Promise.resolve();
  let lastPruneAt = -Infinity;

  function commit(deltas: Delta[]): void {
    store.persist(deltas);
    for (const d of deltas) {
      if (d.type === "session") sessionWantsModel.set(d.session.key, wantsModel(d.session));
      else if (d.type === "session_removed") { sessionWantsModel.delete(d.key); modelTries.delete(d.key); }
    }
    if (deltas.length === 0) return;
    const msg = `event: delta\ndata: ${JSON.stringify(deltas)}\n\n`;
    for (const s of streams) s.write(msg);
  }

  // A demo run starts its session ids again from demo-1: whatever the last run left behind would sit frozen forever.
  if (demo) for (const s of world.snapshot(now(), demo).sessions) commit(world.end(s.key, now()));

  async function pipeline(ev: AgentEvent): Promise<void> {
    ev.repoPath = await within(resolveRepo(ev.repoPath), CONFIG.repoResolveTimeoutMs, ev.repoPath);
    const key = `${ev.source}:${ev.sessionId}`;
    const transcriptPath = ev.detail?.transcriptPath;
    if (ev.model === undefined && ev.tier === undefined && (sessionWantsModel.get(key) ?? true) && transcriptPath !== undefined) {
      const t = now();
      const last = modelTries.get(key);
      if (last === undefined || (t - last.at >= CONFIG.modelRetryMs && last.count < CONFIG.modelRetryMax)) {
        modelTries.set(key, { at: t, count: (last?.count ?? 0) + 1 });
        const m = await within(readModel(transcriptPath), CONFIG.modelReadTimeoutMs, null);
        if (m !== null) {
          ev.model = m;
          const tier = tierForModel(m);
          if (tier !== undefined) ev.tier = tier;
        }
      }
    }
    if (ev.detail !== undefined) delete ev.detail.transcriptPath;
    store.logEvent(ev);
    commit(world.apply(ev));
  }

  function inject(ev: AgentEvent): Promise<void> {
    const run = queue.then(() => pipeline(structuredClone(ev))).catch(e => { console.error("agent-world: event pipeline failed", e); });
    queue = run;
    return run;
  }

  function tick(): void {
    const t = now();
    commit(world.tick(t));
    if (t - lastPruneAt >= CONFIG.pruneIntervalMs) {
      lastPruneAt = t;
      store.pruneEvents(t - CONFIG.eventRetentionDays * MS_PER_DAY);
    }
  }

  async function ingest(req: IncomingMessage, res: ServerResponse, source: string, foreignOrigin: boolean): Promise<void> {
    const body = await readBody(req);
    try {
      if (demo) return;
      if (foreignOrigin) { console.warn("agent-world: ingest from a browser origin discarded"); return; }
      const adapter = Object.hasOwn(ADAPTERS, source) ? ADAPTERS[source] : undefined;
      if (adapter === undefined) { console.warn(`agent-world: ingest from unknown source "${source}"`); return; }
      if (body === null) { console.warn("agent-world: ingest body unreadable or too large"); return; }
      let raw: unknown;
      try { raw = JSON.parse(body); } catch { console.warn("agent-world: ingest body is not JSON"); return; }
      const events = adapter.parse(raw, now());
      if (events.length === 0) { console.warn(`agent-world: ingest payload from "${source}" not recognized`); return; }
      await Promise.all(events.map(inject));
    } finally {
      sendStatus(res, 204);
    }
  }

  function openStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`event: snapshot\ndata: ${JSON.stringify(world.snapshot(now(), demo))}\n\n`);
    streams.add(res);
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), CONFIG.sseKeepAliveMs);
    keepAlive.unref();
    res.on("close", () => { clearInterval(keepAlive); streams.delete(res); });
  }

  /** Parses a JSON object body; answers 400 itself and returns null when that fails. */
  async function jsonBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
    const body = await readBody(req);
    let parsed: unknown;
    try { parsed = JSON.parse(body ?? ""); } catch { parsed = undefined; }
    if (!isRecord(parsed)) { sendJson(res, 400, { error: "body must be a JSON object" }); return null; }
    return parsed;
  }

  async function patchCharacter(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const body = await jsonBody(req, res);
    if (body === null) return;
    if (!world.snapshot(now(), demo).characters.some(c => c.id === id)) { sendJson(res, 404, { error: "unknown character" }); return; }
    const patch: { name?: string; look?: Look; retired?: boolean } = {};
    if ("name" in body) patch.name = body.name as string;
    if ("look" in body) patch.look = body.look as Look;
    if ("retired" in body) patch.retired = body.retired as boolean;
    let deltas: Delta[];
    try { deltas = world.updateCharacter(id, patch); } catch (e) { sendJson(res, 400, { error: (e as Error).message }); return; }
    commit(deltas);
    const d = deltas.find(x => x.type === "character");
    sendJson(res, 200, d?.type === "character" ? d.character : null);
  }

  async function putSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await jsonBody(req, res);
    if (body === null) return;
    let deltas: Delta[];
    try { deltas = world.updateSettings(body as Partial<Settings>); } catch (e) { sendJson(res, 400, { error: (e as Error).message }); return; }
    commit(deltas);
    const d = deltas.find(x => x.type === "settings");
    sendJson(res, 200, d?.type === "settings" ? d.settings : null);
  }

  async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
    if (opts.staticDir === undefined) { sendStatus(res, 404); return; }
    const root = resolve(opts.staticDir);
    const tryFile = async (p: string): Promise<Buffer | null> => {
      if (p !== root && !p.startsWith(root + sep)) return null;
      try { return (await stat(p)).isFile() ? await readFile(p) : null; } catch { return null; }
    };
    let file = resolve(join(root, pathname));
    let data = await tryFile(file);
    if (data === null) { file = join(root, "index.html"); data = await tryFile(file); }
    if (data === null) { sendStatus(res, 404); return; }
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Loopback peer and a local Host header (defeats DNS rebinding); every non-GET from a foreign browser Origin is refused.
    if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) { sendStatus(res, 403); return; }
    if (!isLocal(req.headers.host, false)) { sendStatus(res, 403); return; }
    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const origin = req.headers.origin;
    const foreignOrigin = method !== "GET" && origin !== undefined && !isLocal(origin, true);
    let m: RegExpMatchArray | null;

    if (method === "POST" && (m = path.match(/^\/ingest\/([^/]+)$/))) return ingest(req, res, decode(m[1]!) ?? m[1]!, foreignOrigin);
    if (foreignOrigin) { sendStatus(res, 403); return; }

    const badEscape = (): void => sendJson(res, 400, { error: "malformed URL escape" });

    if (method === "GET" && path === "/events") return openStream(req, res);
    if (method === "GET" && path === "/api/snapshot") return sendJson(res, 200, world.snapshot(now(), demo));
    if (method === "PATCH" && (m = path.match(/^\/api\/characters\/([^/]+)$/))) {
      const id = decode(m[1]!);
      return id === null ? badEscape() : patchCharacter(req, res, id);
    }
    if (method === "POST" && (m = path.match(/^\/api\/sessions\/([^/]+)\/ack$/))) {
      const key = decode(m[1]!);
      if (key === null) return badEscape();
      commit(world.ack(key));
      return sendStatus(res, 204);
    }
    if (method === "POST" && (m = path.match(/^\/api\/sessions\/([^/]+)\/dismiss$/))) {
      const key = decode(m[1]!);
      if (key === null) return badEscape();
      const deltas = world.end(key, now());
      if (deltas.length === 0) return sendJson(res, 404, { error: "unknown session" });
      commit(deltas);
      return sendStatus(res, 204);
    }
    if (method === "PUT" && path === "/api/settings") return putSettings(req, res);
    if (method === "GET") return serveStatic(res, path);
    sendStatus(res, 404);
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    route(req, res).catch(e => {
      console.error("agent-world: request failed", e);
      if (!res.headersSent) sendStatus(res, req.url?.startsWith("/ingest/") ? 204 : 500);
      else res.end();
    });
  }

  function close(): void {
    for (const s of streams) s.end();
    streams.clear();
  }

  return { handler, inject, tick, close };
}
