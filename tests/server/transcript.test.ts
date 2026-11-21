import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import { readTranscript } from "../../src/server/transcript";

const file = (name: string, content: string): string => {
  const p = join(mkdtempSync(join(tmpdir(), "aw-tr-")), name);
  writeFileSync(p, content);
  return p;
};
const line = (o: unknown) => JSON.stringify(o) + "\n";
const modelFromTranscript = async (p: string) => (await readTranscript(p)).model;
const NOTHING = { model: null, contextTokens: null, boundaries: [] };
const usage = (input: number, creation: number, read: number, over: Record<string, unknown> = {}) =>
  line({ type: "assistant", isSidechain: false, message: { model: "claude-opus-5-5", usage: { input_tokens: input, cache_creation_input_tokens: creation, cache_read_input_tokens: read, output_tokens: 1134 } }, ...over });
const boundary = (uuid: string, preTokens: number, postTokens: number, trigger = "auto") =>
  line({ type: "system", subtype: "compact_boundary", uuid, compactMetadata: { trigger, preTokens, postTokens } });

test("finds the most recent assistant model", async () => {
  const p = file("t.jsonl",
    line({ type: "assistant", message: { model: "A" } }) +
    line({ type: "user", message: { content: "hi" } }) +
    line({ type: "assistant", message: { model: "B" } }));
  expect(await modelFromTranscript(p)).toBe("B");
});

test("a user line after the last assistant line does not hide it", async () => {
  const p = file("t.jsonl", line({ type: "assistant", message: { model: "A" } }) + line({ type: "user", message: { model: "U" } }));
  expect(await modelFromTranscript(p)).toBe("A");
});

test("only the tail of a large file is read", async () => {
  const filler = line({ type: "user", message: { content: "x".repeat(1000) } }).repeat(Math.ceil(CONFIG.transcriptTailBytes / 1000) + 10);
  expect(await modelFromTranscript(file("big.jsonl", line({ type: "assistant", message: { model: "old" } }) + filler))).toBeNull();
  expect(await modelFromTranscript(file("big2.jsonl", filler + line({ type: "assistant", message: { model: "new" } })))).toBe("new");
});

test("missing file, empty file, junk lines → null", async () => {
  expect(await modelFromTranscript("/no/such/file.jsonl")).toBeNull();
  expect(await modelFromTranscript(file("empty.jsonl", ""))).toBeNull();
  expect(await modelFromTranscript(file("junk.jsonl", "not json\n{bad\n" + line({ type: "assistant", message: { model: 7 } }) + line({ type: "assistant" }) + "\n"))).toBeNull();
});

test("placeholder models such as <synthetic> are skipped", async () => {
  expect(await modelFromTranscript(file("s.jsonl",
    line({ type: "assistant", message: { model: "claude-opus-5-5" } }) +
    line({ type: "assistant", message: { model: "<synthetic>" } })))).toBe("claude-opus-5-5");
  expect(await modelFromTranscript(file("only.jsonl", line({ type: "assistant", message: { model: "<synthetic>" } })))).toBeNull();
  expect(await modelFromTranscript(file("blank.jsonl", line({ type: "assistant", message: { model: "" } })))).toBeNull();
});

test("a directory or a FIFO → null promptly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-tr-"));
  const sub = join(dir, "d.jsonl"); mkdirSync(sub);
  expect(await modelFromTranscript(sub)).toBeNull();
  if (process.platform !== "win32") {
    const fifo = join(dir, "f.jsonl");
    execFileSync("mkfifo", [fifo]);
    const t0 = Date.now();
    expect(await modelFromTranscript(fifo)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  }
});

test("sidechain (subagent) entries are skipped", async () => {
  const p = file("t.jsonl",
    line({ type: "assistant", isSidechain: true, message: { model: "claude-haiku-5-5" } }) +
    line({ type: "assistant", isSidechain: false, message: { model: "claude-opus-5-5" } }) +
    line({ type: "assistant", isSidechain: true, message: { model: "claude-haiku-5-5" } }));
  expect(await modelFromTranscript(p)).toBe("claude-opus-5-5");
});

test("context tokens are the input, cache-creation and cache-read sum of the last main-thread assistant entry", async () => {
  const p = file("t.jsonl", usage(5, 5, 5) + usage(2, 700, 90_160) + line({ type: "user", message: { content: "hi" } }));
  expect(await readTranscript(p)).toEqual({ model: "claude-opus-5-5", contextTokens: 90_862, boundaries: [] });
});

test("sidechain, <synthetic> and zero-usage entries are skipped for the reading", async () => {
  const p = file("t.jsonl",
    usage(1, 0, 40_000) +
    usage(1, 0, 99_000, { isSidechain: true }) +
    line({ type: "assistant", message: { model: "<synthetic>", usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 77_000 } } }) +
    line({ type: "assistant", message: { model: "claude-opus-5-5", usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }));
  expect((await readTranscript(p)).contextTokens).toBe(40_001);
});

test("a boundary after the last usage entry gives the reading; one before it does not", async () => {
  const after = file("a.jsonl", usage(1, 0, 180_000) + boundary("u1", 180_001, 35_119));
  expect(await readTranscript(after)).toEqual({
    model: "claude-opus-5-5", contextTokens: 35_119, boundaries: [{ uuid: "u1", trigger: "auto", preTokens: 180_001, postTokens: 35_119 }],
  });
  const before = file("b.jsonl", boundary("u1", 180_001, 35_119) + usage(1, 0, 40_000));
  expect((await readTranscript(before)).contextTokens).toBe(40_001);
});

test("two boundaries are returned oldest first; with no usage entry the last one gives the reading", async () => {
  const p = file("t.jsonl", boundary("u1", 150_000, 30_000) + boundary("u2", 160_000, 25_000, "manual"));
  expect(await readTranscript(p)).toEqual({
    model: null, contextTokens: 25_000,
    boundaries: [
      { uuid: "u1", trigger: "auto", preTokens: 150_000, postTokens: 30_000 },
      { uuid: "u2", trigger: "manual", preTokens: 160_000, postTokens: 25_000 },
    ],
  });
});

test("malformed boundaries are skipped", async () => {
  const bad = [
    { type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 1, postTokens: 1 } },
    { type: "system", subtype: "compact_boundary", uuid: 7, compactMetadata: { trigger: "auto", preTokens: 1, postTokens: 1 } },
    { type: "system", subtype: "compact_boundary", uuid: "x" },
    { type: "system", subtype: "compact_boundary", uuid: "x", compactMetadata: { trigger: "sometimes", preTokens: 1, postTokens: 1 } },
    { type: "system", subtype: "compact_boundary", uuid: "x", compactMetadata: { trigger: "auto", preTokens: "1", postTokens: 1 } },
    { type: "system", subtype: "compact_boundary", uuid: "x", compactMetadata: { trigger: "auto", preTokens: 1 } },
    { type: "system", subtype: "other", uuid: "x", compactMetadata: { trigger: "auto", preTokens: 1, postTokens: 1 } },
  ];
  const p = file("t.jsonl", usage(1, 0, 40_000) + bad.map(line).join(""));
  expect(await readTranscript(p)).toEqual({ model: "claude-opus-5-5", contextTokens: 40_001, boundaries: [] });
});

test("a first line cut mid-JSON is tolerated", async () => {
  const p = file("t.jsonl", usage(1, 0, 40_000).slice(30) + usage(1, 0, 50_000));
  expect((await readTranscript(p)).contextTokens).toBe(50_001);
  const tail = line({ type: "user", message: { content: "x".repeat(1000) } }).repeat(Math.ceil(CONFIG.transcriptTailBytes / 1000) + 10);
  expect((await readTranscript(file("big.jsonl", tail + usage(1, 0, 60_000)))).contextTokens).toBe(60_001);
});

test("no assistant entries → contextTokens null", async () => {
  expect(await readTranscript(file("t.jsonl", line({ type: "user", message: { content: "hi" } })))).toEqual(NOTHING);
});

test("a directory or a missing path → nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aw-tr-"));
  expect(await readTranscript(dir)).toEqual(NOTHING);
  expect(await readTranscript(join(dir, "missing.jsonl"))).toEqual(NOTHING);
});
