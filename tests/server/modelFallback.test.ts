import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import { modelFromTranscript } from "../../src/server/modelFallback";

const file = (name: string, content: string): string => {
  const p = join(mkdtempSync(join(tmpdir(), "aw-tr-")), name);
  writeFileSync(p, content);
  return p;
};
const line = (o: unknown) => JSON.stringify(o) + "\n";

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
