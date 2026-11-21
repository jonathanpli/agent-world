import { CONFIG } from "../shared/config";
import type { Character, Delta, Settings, Snapshot } from "../shared/types";

type Handlers = { onSnapshot(s: Snapshot): void; onDeltas(d: Delta[]): void; onStatus(connected: boolean): void };

/** Opens the SSE stream on /events. On error it closes the stream and retries every CONFIG.client.reconnectMs. */
export function connect(handlers: Handlers): void {
  const open = (): void => {
    const es = new EventSource("/events");
    es.addEventListener("snapshot", e => {
      handlers.onSnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot);
      handlers.onStatus(true);
    });
    es.addEventListener("delta", e => handlers.onDeltas(JSON.parse((e as MessageEvent<string>).data) as Delta[]));
    es.onerror = () => {
      es.close();
      handlers.onStatus(false);
      setTimeout(open, CONFIG.client.reconnectMs);
    };
  };
  open();
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${method} ${path} failed (${res.status})`;
    try {
      const err = (await res.json()) as { error?: unknown };
      if (typeof err.error === "string") message = err.error;
    } catch { /* no JSON body */ }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  patchCharacter: (id: string, patch: object): Promise<Character> => call("PATCH", `/api/characters/${encodeURIComponent(id)}`, patch),
  ack: (key: string): Promise<void> => call("POST", `/api/sessions/${encodeURIComponent(key)}/ack`),
  putSettings: (patch: Partial<Settings>): Promise<Settings> => call("PUT", "/api/settings", patch),
};
