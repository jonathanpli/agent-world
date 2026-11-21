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
