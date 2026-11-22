import { CONFIG } from "../shared/config";
import type { ShopState } from "../shared/shop";
import type { Character, Delta, FocusResult, Recap, Settings, Snapshot } from "../shared/types";

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

/** Every write carries this header: the server refuses API writes without it, so another page cannot send one. */
const WRITE_HEADER = { "x-agent-world": "1" };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = method === "GET" ? {} : { ...WRITE_HEADER };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
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
  dismiss: (key: string): Promise<void> => call("POST", `/api/sessions/${encodeURIComponent(key)}/dismiss`),
  focus: (key: string): Promise<FocusResult> => call("POST", `/api/sessions/${encodeURIComponent(key)}/focus`),
  recap: (day?: string): Promise<Recap> => call("GET", day === undefined ? "/api/recap" : `/api/recap?day=${encodeURIComponent(day)}`),
  buy: (id: string): Promise<ShopState> => call("POST", "/api/shop/buy", { id }),
  putSettings: (patch: Partial<Settings>): Promise<Settings> => call("PUT", "/api/settings", patch),
};
