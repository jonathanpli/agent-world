import { expect, test } from "vitest";
import { CONFIG } from "../../src/shared/config";
import { serverEnv } from "../../src/server/env";

test("defaults: port by mode, home under the user's home dir", () => {
  expect(serverEnv({}, false, "/u")).toEqual({ port: CONFIG.port, home: "/u/.agent-world", warnings: [] });
  expect(serverEnv({}, true, "/u")).toEqual({ port: CONFIG.demoPort, home: "/u/.agent-world", warnings: [] });
});

test("valid overrides are used", () => {
  expect(serverEnv({ AGENT_WORLD_PORT: "5000", AGENT_WORLD_HOME: "/tmp/aw" }, true, "/u")).toEqual({ port: 5000, home: "/tmp/aw", warnings: [] });
});

test("an empty, non-numeric, zero or out-of-range port falls back with one warning", () => {
  for (const p of ["", "  ", "abc", "0", "65536", "-1", "12.5", "80x"]) {
    const e = serverEnv({ AGENT_WORLD_PORT: p }, false, "/u");
    expect(e.port).toBe(CONFIG.port);
    expect(e.warnings).toHaveLength(1);
    expect(e.warnings[0]).toContain("AGENT_WORLD_PORT");
  }
  expect(serverEnv({ AGENT_WORLD_PORT: "nope" }, true, "/u").port).toBe(CONFIG.demoPort);
});

test("an empty home falls back to ~/.agent-world", () => {
  expect(serverEnv({ AGENT_WORLD_HOME: "" }, false, "/u").home).toBe("/u/.agent-world");
  expect(serverEnv({ AGENT_WORLD_HOME: "   " }, false, "/u").home).toBe("/u/.agent-world");
});
