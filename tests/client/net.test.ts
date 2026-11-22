import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../src/client/net";

afterEach(() => { vi.unstubAllGlobals(); });

test("api.dismiss POSTs to the session's dismiss route with the key escaped, and surfaces the server's error", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await expect(api.dismiss("claude-code:a/b")).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledWith("/api/sessions/claude-code%3Aa%2Fb/dismiss", expect.objectContaining({ method: "POST" }));
  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "unknown session" }), { status: 404 }));
  await expect(api.dismiss("x")).rejects.toThrow("unknown session");
});

test("every write sends X-Agent-World: 1 (the server refuses API writes without it)", async () => {
  const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await api.patchCharacter("c1", { name: "Q" });
  await api.ack("k"); await api.dismiss("k"); await api.focus("k");
  await api.buy("office.wall-art"); await api.putSettings({ theme: "space" });
  expect(fetch).toHaveBeenCalledTimes(6);
  for (const [, init] of fetch.mock.calls) {
    expect(init!.method).not.toBe("GET");
    expect((init!.headers as Record<string, string>)["x-agent-world"]).toBe("1");
  }
  const withBody = fetch.mock.calls.find(([p]) => p === "/api/shop/buy")![1]!;
  expect((withBody.headers as Record<string, string>)["content-type"]).toBe("application/json");
});
