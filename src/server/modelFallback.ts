import { open } from "node:fs/promises";
import { CONFIG } from "../shared/config";

/** Reads the tail of a Claude Code transcript and returns the most recent assistant `message.model`. Never rejects. */
export async function modelFromTranscript(path: string): Promise<string | null> {
  try {
    const fh = await open(path, "r");
    let text: string;
    try {
      const { size } = await fh.stat();
      const length = Math.min(size, CONFIG.transcriptTailBytes);
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, size - length);
      text = buf.toString("utf8");
    } finally {
      await fh.close();
    }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: unknown;
      try { entry = JSON.parse(lines[i]!); } catch { continue; }
      if (typeof entry !== "object" || entry === null) continue;
      const { type, message } = entry as { type?: unknown; message?: { model?: unknown } };
      if (type === "assistant" && typeof message?.model === "string") return message.model;
    }
    return null;
  } catch {
    return null;
  }
}
