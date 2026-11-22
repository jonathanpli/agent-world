import { open, stat } from "node:fs/promises";
import { CONFIG } from "../shared/config";
import type { UsageDelta } from "../shared/types";

/** Where the next read starts, and the newest counted message ids (at most CONFIG.usage.idsMax). Server-side only. */
export type UsageCursor = { offset: number; ids: string[] };
/** The summed usage of the newly counted messages of one model and one side of the long-prompt mark. */
export type UsageBatch = { model: string; longPrompt: boolean; usage: UsageDelta };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Non-numeric or negative → 0. */
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
/** Placeholders such as "<synthetic>" are not real model ids. */
const realModel = (m: unknown): m is string => typeof m === "string" && m !== "" && !m.startsWith("<");

/** The counted message an entry is, or null when it is not one (cacheWrite1h from the breakdown; cacheWrite the rest). */
function asMessage(entry: unknown): { id: string; model: string; usage: UsageDelta; prompt: number } | null {
  if (!isRecord(entry) || entry.type !== "assistant" || entry.isSidechain === true || !isRecord(entry.message)) return null;
  const { id, model, usage: u } = entry.message;
  if (typeof id !== "string" || !realModel(model) || !isRecord(u)) return null;
  const created = count(u.cache_creation_input_tokens);
  const cacheWrite1h = isRecord(u.cache_creation) ? count(u.cache_creation.ephemeral_1h_input_tokens) : 0;
  const usage: UsageDelta = {
    input: count(u.input_tokens), output: count(u.output_tokens), cacheRead: count(u.cache_read_input_tokens),
    cacheWrite: Math.max(0, created - cacheWrite1h), cacheWrite1h,
  };
  if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite + usage.cacheWrite1h === 0) return null;
  return { id, model, usage, prompt: usage.input + usage.cacheRead + created };
}

/**
 * One incremental read of a Claude Code transcript for token usage. `null` is first sight: the cursor is set to the end
 * of the file (to 0 when there is no file yet) and nothing is counted. Otherwise complete lines from the offset are read,
 * at most CONFIG.usage.readMaxBytes, and each main-thread assistant message with a real model, a string id not counted
 * before and non-zero usage is counted once; a file shorter than the offset moves the offset to its size. A single line
 * longer than the cap is skipped. Anything unreadable leaves the cursor as it was. Never rejects.
 */
export async function readUsage(path: string, cursor: UsageCursor | null): Promise<{ cursor: UsageCursor; batches: UsageBatch[] }> {
  const unchanged = { cursor: cursor ?? { offset: 0, ids: [] }, batches: [] };
  try {
    if (!(await stat(path)).isFile()) return unchanged;   // a directory or FIFO would fail or block forever
    const fh = await open(path, "r");
    try {
      const { size } = await fh.stat();
      if (cursor === null) return { cursor: { offset: size, ids: [] }, batches: [] };
      if (size < cursor.offset) return { cursor: { offset: size, ids: cursor.ids }, batches: [] };
      const length = Math.min(size - cursor.offset, CONFIG.usage.readMaxBytes);
      if (length === 0) return unchanged;
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, cursor.offset);
      const end = buf.subarray(0, bytesRead).lastIndexOf(0x0a);
      if (end < 0) {
        // no complete line yet; a full read without one is a line longer than the cap: skip past it (its tail fails to parse)
        return bytesRead === CONFIG.usage.readMaxBytes ? { cursor: { offset: cursor.offset + bytesRead, ids: cursor.ids }, batches: [] } : unchanged;
      }
      const seen = new Set(cursor.ids);
      const ids = [...cursor.ids];
      const batches = new Map<string, UsageBatch>();
      for (const raw of buf.subarray(0, end).toString("utf8").split("\n")) {
        let entry: unknown;
        try { entry = JSON.parse(raw); } catch { continue; }
        const m = asMessage(entry);
        if (m === null || seen.has(m.id)) continue;
        seen.add(m.id); ids.push(m.id);
        const longPrompt = m.prompt > CONFIG.usage.longPromptTokens;
        const key = `${longPrompt ? 1 : 0}${m.model}`;
        const b = batches.get(key);
        if (b === undefined) { batches.set(key, { model: m.model, longPrompt, usage: m.usage }); continue; }
        for (const k of Object.keys(b.usage) as (keyof UsageDelta)[]) b.usage[k] += m.usage[k];
      }
      return { cursor: { offset: cursor.offset + end + 1, ids: ids.slice(-CONFIG.usage.idsMax) }, batches: [...batches.values()] };
    } finally {
      await fh.close();
    }
  } catch {
    return unchanged;
  }
}
