import { open, stat } from "node:fs/promises";
import { CONFIG } from "../shared/config";
import type { Compaction } from "../shared/types";

/** What the tail of a transcript says: the latest main-thread model, the context in use, and the compactions in the tail. */
export type TranscriptInfo = { model: string | null; contextTokens: number | null; boundaries: Compaction[] };

const NOTHING = (): TranscriptInfo => ({ model: null, contextTokens: null, boundaries: [] });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** Placeholders such as "<synthetic>" are not real model ids. */
const realModel = (m: unknown): m is string => typeof m === "string" && m !== "" && !m.startsWith("<");

/** Reads at most `CONFIG.transcriptTailBytes` from the end of a regular file; null for anything else. */
async function tail(path: string): Promise<string | null> {
  if (!(await stat(path)).isFile()) return null;   // a directory or FIFO would fail or block forever
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const length = Math.min(size, CONFIG.transcriptTailBytes);
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, size - length);
    const text = buf.toString("utf8");
    // a tail that starts mid-file starts mid-line: drop the fragment rather than trust whatever it parses as
    return length < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    await fh.close();
  }
}

const validTokens = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

function asBoundary(e: Record<string, unknown>): Compaction | null {
  if (e.type !== "system" || e.subtype !== "compact_boundary" || typeof e.uuid !== "string" || !isRecord(e.compactMetadata)) return null;
  const { trigger, preTokens, postTokens } = e.compactMetadata;
  if ((trigger !== "auto" && trigger !== "manual") || !validTokens(preTokens) || !validTokens(postTokens)) return null;
  return { uuid: e.uuid, trigger, preTokens, postTokens };
}

/**
 * One bounded tail read of a Claude Code transcript. Sidechain (subagent) entries are skipped throughout. The model is the
 * most recent real main-thread assistant `message.model`; the context reading is the input + cache-creation + cache-read
 * usage of the last such entry with a non-zero sum, unless a compaction boundary follows it (or there is none), in which
 * case the last boundary's `postTokens`. Only numbers and model ids are taken. Never rejects.
 */
export async function readTranscript(path: string): Promise<TranscriptInfo> {
  try {
    const text = await tail(path);
    if (text === null) return NOTHING();
    const info = NOTHING();
    let usageTokens: number | null = null;   // the last usage reading seen so far, reading forwards
    let afterUsage: Compaction | null = null; // the last boundary after it
    for (const raw of text.split("\n")) {
      let entry: unknown;
      try { entry = JSON.parse(raw); } catch { continue; }
      if (!isRecord(entry) || entry.isSidechain === true) continue;
      const b = asBoundary(entry);
      if (b !== null) { info.boundaries.push(b); afterUsage = b; continue; }
      if (entry.type !== "assistant" || !isRecord(entry.message) || !realModel(entry.message.model)) continue;
      info.model = entry.message.model;
      const u = isRecord(entry.message.usage) ? entry.message.usage : {};
      const sum = count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens);
      if (sum > 0) { usageTokens = sum; afterUsage = null; }
    }
    // a boundary reporting 0 tokens after compaction is no reading
    info.contextTokens = afterUsage !== null && afterUsage.postTokens > 0 ? afterUsage.postTokens : afterUsage !== null ? null : usageTokens;
    return info;
  } catch {
    return NOTHING();
  }
}
