import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { createApp, type App } from "../../src/server/app";
import { openStore, type Store } from "../../src/server/store";
import type { Recap, Snapshot } from "../../src/shared/types";

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
  const app = createApp({
    store, demo: false, resolveRepo: async p => p,
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
  expect(recap.totals).toMatchObject({ sidekicks: 1, failures: 1, tasks: 1 });
});
