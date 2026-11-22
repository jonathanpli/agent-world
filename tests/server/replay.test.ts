import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { createApp, type App } from "../../src/server/app";
import { openStore, type Store } from "../../src/server/store";
import type { Delta, Recap, Snapshot } from "../../src/shared/types";
import type { UsageBatch, UsageCursor } from "../../src/server/usageReader";

/** The captured Claude Code payloads, replayed in the order a real turn with a subagent and a failing command produces them. */
const fx = (name: string): string => readFileSync(`tests/fixtures/claude-code/${name}.json`, "utf8");
const flush = () => new Promise(r => setImmediate(r));

let open: { app: App; store: Store; server: Server } | null = null;
afterEach(async () => {
  if (!open) return;
  open.app.close();
  open.server.closeAllConnections();
  await new Promise(res => open!.server.close(res));
  open.store.close();
  open = null;
});

test("replaying captured hooks: one sidekick comes and goes, a failure is marked, the recap adds up", async () => {
  const store = openStore(":memory:");
  // The model is reported by the transcript, so the session binds and its work is credited at once.
  // a fixed midday clock: the events and the recap's "today" can never straddle a local midnight
  const NOW = new Date(2026, 5, 10, 12).getTime();
  const app = createApp({
    store, demo: false, resolveRepo: async p => p, now: () => NOW,
    readTranscript: async () => ({ model: "claude-opus-5-5", contextTokens: null, boundaries: [] }),
  });
  const server = createServer(app.handler);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  open = { app, store, server };
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const ingest = async (name: string) => { expect((await fetch(`${base}/ingest/claude-code`, { method: "POST", body: fx(name) })).status).toBe(204); await flush(); };
  const session = async () => (await ((await fetch(`${base}/api/snapshot`)).json() as Promise<Snapshot>)).sessions[0]!;

  await ingest("SessionStart");
  await ingest("UserPromptSubmit");
  await ingest("SubagentStart");
  expect((await session()).sidekicks).toHaveLength(1);
  await ingest("PostToolUse.subagent");
  expect((await session()).sidekicks).toHaveLength(1);
  await ingest("SubagentStop");
  expect((await session()).sidekicks).toEqual([]);
  await ingest("PostToolUseFailure.bash");
  expect((await session()).lastTool?.failed).toBe(true);
  await ingest("Stop");

  const recap = await ((await fetch(`${base}/api/recap`)).json() as Promise<Recap>);
  expect(recap.day).toBe("2026-06-10");
  expect(recap.totals).toMatchObject({ sidekicks: 1, failures: 1, tasks: 1 });
});

test("replaying a working session: a commit, token usage, an iTerm jump and a purchase all add up", async () => {
  const store = openStore(":memory:");
  let t = new Date(2026, 5, 10, 12).getTime();
  const reads: (UsageCursor | null)[] = [];
  const batch: UsageBatch = { model: "claude-sonnet-4-5", longPrompt: false, usage: { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, cacheWrite1h: 0 } };
  const calls: { file: string; args: string[] }[] = [];
  const app = createApp({
    store, demo: false, resolveRepo: async p => p, now: () => t, platform: "darwin",
    readTranscript: async () => ({ model: "claude-opus-5-5", contextTokens: null, boundaries: [] }),
    // the first read finds nothing; the second returns one batch
    readUsage: async (_path, cursor) => {
      reads.push(cursor);
      return { cursor: { offset: reads.length * 100, ids: [`m${reads.length}`] }, batches: reads.length === 2 ? [batch] : [] };
    },
    run: async (file, args) => { calls.push({ file, args }); return { code: 0, stdout: "ok\n", stderr: "" }; },
  });
  const server = createServer(app.handler);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  open = { app, store, server };
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // the notices and deltas the browser would see
  const seen: Delta[] = [];
  const stream = await fetch(`${base}/events`);
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const [ev, data] = buf.slice(0, i).split("\n");
        buf = buf.slice(i + 2);
        if (ev === "event: delta" && data?.startsWith("data: ")) seen.push(...(JSON.parse(data.slice(6)) as Delta[]));
      }
    }
  })();

  const iterm = {
    "X-AW-Bundle-Id": "com.googlecode.iterm2", "X-AW-Term-Program": "iTerm.app",
    "X-AW-Iterm-Session": "w0t0p0:8D6F3C1A-1B2C-4D5E-8F90-123456789ABC",
  };
  const post = async (body: string) => {
    expect((await fetch(`${base}/ingest/claude-code`, { method: "POST", body, headers: iterm })).status).toBe(204);
    await flush();
  };
  const snapshot = async () => (await fetch(`${base}/api/snapshot`)).json() as Promise<Snapshot>;

  await post(fx("SessionStart"));
  const key = (await snapshot()).sessions[0]!.key;

  // the terminal: exact focus in the snapshot, and the jump runs osascript with the session's UUID
  expect((await snapshot()).focus).toEqual({ [key]: "exact" });
  const jump = await fetch(`${base}/api/sessions/${encodeURIComponent(key)}/focus`, { method: "POST" });
  expect(jump.status).toBe(200);
  expect(await jump.json()).toEqual({ precision: "exact" });
  const script = calls.find(c => c.file === "/usr/bin/osascript");
  expect(script?.args.at(-1)).toBe("8D6F3C1A-1B2C-4D5E-8F90-123456789ABC");

  // usage: the second transcript read, two seconds on, returns a batch
  t += 2_500;
  const commit = JSON.parse(fx("PostToolUse")) as { tool_input: { command: string }; tool_response: { stdout: string } };
  commit.tool_input.command = 'git commit -m "fix the gauge"';
  commit.tool_response.stdout = "[main 1a2b3c4] fix the gauge\n 1 file changed";
  await post(JSON.stringify(commit));
  await flush();
  expect(reads).toHaveLength(2);
  const used = (await snapshot()).sessions[0]!.usage;
  expect(used).toMatchObject({ input: 1000, output: 500, cacheRead: 2000 });
  expect(used.costMicros).toBe(1000 * 3 + 500 * 15 + 2000 * 0.3);   // Sonnet 4: $3 in, $15 out, $0.30 cached per million

  // the commit: a moment notice on the stream and a line in the recap
  const moment = seen.find(d => d.type === "notice" && d.notice.kind === "moment");
  expect(moment?.type === "notice" && moment.notice).toMatchObject({ moment: "commit", text: expect.stringContaining("fix the gauge") });
  const recap = await ((await fetch(`${base}/api/recap`)).json() as Promise<Recap>);
  expect(recap.totals).toMatchObject({ commits: 1, input: 1000, output: 500, cacheRead: 2000, costMicros: used.costMicros });

  // the shop: earn the price of the desk plants, buy them, and the wallet drops by that price
  for (let i = 0; i < 4; i++) { await post(fx("UserPromptSubmit")); await post(fx("Stop")); }
  const before = (await snapshot()).shop;
  expect(before.coins).toBeGreaterThanOrEqual(100);
  const bought = await fetch(`${base}/api/shop/buy`, { method: "POST", body: JSON.stringify({ id: "office.desk-plants" }) });
  expect(bought.status).toBe(200);
  expect((await snapshot()).shop).toEqual({ coins: before.coins - 100, owned: ["office.desk-plants"] });
  await reader.cancel();
});
