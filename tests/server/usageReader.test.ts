import { appendFileSync, mkdtempSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readUsage, type UsageBatch, type UsageCursor } from "../../src/server/usageReader";
import { CONFIG } from "../../src/shared/config";

type Line = { id?: unknown; model?: unknown; sidechain?: boolean; input?: number; output?: number; read?: number; create?: number; oneHour?: number; pad?: string };

/** One transcript line: an assistant entry with the given usage (defaults: a small Opus message). */
function line(o: Line = {}): string {
  const usage: Record<string, unknown> = {
    input_tokens: o.input ?? 2, cache_creation_input_tokens: o.create ?? 0, cache_read_input_tokens: o.read ?? 0, output_tokens: o.output ?? 10,
  };
  if (o.oneHour !== undefined) usage.cache_creation = { ephemeral_5m_input_tokens: (o.create ?? 0) - o.oneHour, ephemeral_1h_input_tokens: o.oneHour };
  return JSON.stringify({
    type: "assistant", isSidechain: o.sidechain ?? false,
    message: { id: "id" in o ? o.id : "msg_1", model: "model" in o ? o.model : "claude-opus-5-5", usage, ...(o.pad !== undefined && { pad: o.pad }) },
  }) + "\n";
}

const dir = () => mkdtempSync(join(tmpdir(), "aw-usage-"));
function file(content = ""): string { const p = join(dir(), "t.jsonl"); writeFileSync(p, content); return p; }
const size = (p: string) => statSync(p).size;
const sum = (bs: UsageBatch[], k: keyof UsageBatch["usage"]) => bs.reduce((n, b) => n + b.usage[k], 0);
const at = (offset: number, ids: string[] = []): UsageCursor => ({ offset, ids });

test("first sight starts counting at the end of the file", async () => {
  const p = file(line({ id: "a" }) + line({ id: "b" }));
  expect(await readUsage(p, null)).toEqual({ cursor: at(size(p)), batches: [] });
});

test("growth by two messages yields their sums and moves the offset to the end", async () => {
  const p = file(line({ id: "old" }));
  const { cursor } = await readUsage(p, null);
  appendFileSync(p, line({ id: "a", input: 3, output: 40, read: 1_000, create: 50 }) + line({ id: "b", input: 1, output: 5, read: 2_000 }));
  const r = await readUsage(p, cursor);
  expect(r.batches).toEqual([{ model: "claude-opus-5-5", longPrompt: false, usage: { input: 4, output: 45, cacheRead: 3_000, cacheWrite: 50, cacheWrite1h: 0 } }]);
  expect(r.cursor).toEqual(at(size(p), ["a", "b"]));
  expect(await readUsage(p, r.cursor)).toEqual({ cursor: r.cursor, batches: [] });
});

test("a message streamed on three lines counts once", async () => {
  const p = file(line({ id: "a", output: 7 }).repeat(3));
  const r = await readUsage(p, at(0));
  expect(sum(r.batches, "output")).toBe(7);
  expect(r.cursor.ids).toEqual(["a"]);
});

test("an id counted in an earlier read is not counted again", async () => {
  const p = file(line({ id: "a", output: 7 }));
  const first = await readUsage(p, at(0));
  appendFileSync(p, line({ id: "a", output: 7 }) + line({ id: "b", output: 3 }));
  const r = await readUsage(p, first.cursor);
  expect(sum(r.batches, "output")).toBe(3);
  expect(r.cursor.ids).toEqual(["a", "b"]);
});

test("sidechain, placeholder-model, model-less, id-less, zero-usage and non-assistant entries are skipped", async () => {
  const p = file([
    line({ id: "s", sidechain: true }), line({ id: "syn", model: "<synthetic>" }), line({ id: "nm", model: undefined }),
    line({ id: 5 }), line({ id: undefined }), line({ id: "z", input: 0, output: 0 }),
    JSON.stringify({ type: "user", message: { id: "u", model: "claude-opus-5-5", usage: { input_tokens: 9 } } }) + "\n",
    "not json\n", line({ id: "ok", input: 1, output: 1 }),
  ].join(""));
  const r = await readUsage(p, at(0));
  expect(r.batches).toEqual([{ model: "claude-opus-5-5", longPrompt: false, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } }]);
  expect(r.cursor.ids).toEqual(["ok"]);
});

test("a partial last line is left for the next read and counted once it is complete", async () => {
  const whole = line({ id: "a", output: 4 });
  const p = file(whole + line({ id: "b", output: 6 }).slice(0, 30));
  const r1 = await readUsage(p, at(0));
  expect(r1.cursor.offset).toBe(Buffer.byteLength(whole));
  expect(sum(r1.batches, "output")).toBe(4);
  appendFileSync(p, line({ id: "b", output: 6 }).slice(30));
  const r2 = await readUsage(p, r1.cursor);
  expect(sum(r2.batches, "output")).toBe(6);
  expect(r2.cursor.offset).toBe(size(p));
});

test("a file shorter than the offset moves the offset to its size and counts nothing", async () => {
  const p = file(line({ id: "a" }) + line({ id: "b" }));
  const end = size(p);
  truncateSync(p, 10);
  expect(await readUsage(p, at(end, ["a"]))).toEqual({ cursor: at(10, ["a"]), batches: [] });
});

test("a 9 MB backlog is read in three capped reads with nothing lost or doubled", async () => {
  const pad = "x".repeat(900);
  const n = 10_000;
  let text = "";
  for (let i = 0; i < n; i++) text += line({ id: `m${i}`, input: 1, output: 2, pad });
  const p = file(text);
  expect(size(p)).toBeGreaterThan(9_000_000);
  let cursor = at(0); let input = 0; let output = 0;
  const offsets: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await readUsage(p, cursor);
    expect(r.cursor.offset - cursor.offset).toBeLessThanOrEqual(CONFIG.usage.readMaxBytes);
    input += sum(r.batches, "input"); output += sum(r.batches, "output");
    cursor = r.cursor; offsets.push(cursor.offset);
  }
  expect(offsets[1]).toBeLessThan(size(p));
  expect(cursor.offset).toBe(size(p));
  expect([input, output]).toEqual([n, 2 * n]);
  expect(cursor.ids).toHaveLength(CONFIG.usage.idsMax);
  expect(cursor.ids.at(-1)).toBe(`m${n - 1}`);
});

test("a line longer than the read cap is skipped instead of stalling the reader", async () => {
  const p = file(line({ id: "big", pad: "x".repeat(CONFIG.usage.readMaxBytes + 10) }) + line({ id: "after", output: 9 }));
  let cursor = at(0); let output = 0;
  for (let i = 0; i < 3; i++) { const r = await readUsage(p, cursor); output += sum(r.batches, "output"); cursor = r.cursor; }
  expect(cursor.offset).toBe(size(p));
  expect(output).toBe(9);
});

test("a 1-hour cache breakdown splits cache writes; without one all cache writes are 5-minute", async () => {
  const p = file(line({ id: "a", create: 700, oneHour: 700 }) + line({ id: "b", create: 300, oneHour: 100 }) + line({ id: "c", create: 50 }));
  const r = await readUsage(p, at(0));
  expect(r.batches[0]!.usage).toMatchObject({ cacheWrite: 250, cacheWrite1h: 800 });
});

test("two models and a long/short prompt mix produce separate batches in first-seen order", async () => {
  const p = file([
    line({ id: "1", model: "claude-haiku-5", input: 10, read: 50_000 }),
    line({ id: "2", model: "claude-haiku-5", input: 10, read: 99_990, create: 1 }),     // 100 001: long
    line({ id: "3", model: "claude-opus-5-5", input: 10 }),
    line({ id: "4", model: "claude-haiku-5", input: 10, read: 100_000 }),                // 100 010: long
    line({ id: "5", model: "claude-haiku-5", input: 0, read: 100_000 }),                 // exactly 100 000: short
  ].join(""));
  const r = await readUsage(p, at(0));
  expect(r.batches.map(b => [b.model, b.longPrompt, b.usage.input, b.usage.cacheRead])).toEqual([
    ["claude-haiku-5", false, 10, 150_000],
    ["claude-haiku-5", true, 20, 199_990],
    ["claude-opus-5-5", false, 10, 0],
  ]);
});

test("ids never grow past the limit and keep the newest", async () => {
  const p = file(Array.from({ length: 60 }, (_, i) => line({ id: `m${i}` })).join(""));
  const r = await readUsage(p, at(0, Array.from({ length: 50 }, (_, i) => `old${i}`)));
  expect(r.cursor.ids).toEqual(Array.from({ length: 50 }, (_, i) => `m${i + 10}`));
});

test("non-numeric or negative usage numbers count as 0", async () => {
  const p = file(JSON.stringify({ type: "assistant", message: { id: "a", model: "claude-opus-5-5",
    usage: { input_tokens: "5", output_tokens: -3, cache_read_input_tokens: 4, cache_creation_input_tokens: null, cache_creation: { ephemeral_1h_input_tokens: "x" } } } }) + "\n");
  const r = await readUsage(p, at(0));
  expect(r.batches[0]!.usage).toEqual({ input: 0, output: 0, cacheRead: 4, cacheWrite: 0, cacheWrite1h: 0 });
});

test("a directory or a missing path leaves the cursor unchanged and counts nothing", async () => {
  const c = at(123, ["a"]);
  expect(await readUsage(dir(), c)).toEqual({ cursor: c, batches: [] });
  expect(await readUsage(join(dir(), "missing.jsonl"), c)).toEqual({ cursor: c, batches: [] });
});

test("a transcript not written yet at first sight counts from its start once it appears", async () => {
  const p = join(dir(), "later.jsonl");
  const first = await readUsage(p, null);
  expect(first).toEqual({ cursor: at(0), batches: [] });
  writeFileSync(p, line({ id: "a", output: 8 }));
  expect(sum((await readUsage(p, first.cursor)).batches, "output")).toBe(8);
});
