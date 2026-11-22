import { expect, test } from "vitest";
import { buildPlist, parsePrint, readPlistInfo, SERVICE_LABEL } from "../../src/installer/launchd";

const base = { nodePath: "/opt/node/bin/node", tsxCli: "/repo/node_modules/tsx/dist/cli.mjs", repoDir: "/repo", logPath: "/home/.agent-world/server.log", env: {} };

/** Minimal well-formedness: balanced tags, and no raw & or < inside text. */
function wellFormed(xml: string): boolean {
  const body = xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/, "");
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z]+)([^<>]*?)(\/?)>|([^<]+)/g;
  for (const m of body.matchAll(re)) {
    if (m[5] !== undefined) {
      if (/&(?!(amp|lt|gt|quot|apos);)/.test(m[5])) return false;
    } else if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else if (!m[4]) stack.push(m[2]!);
  }
  return stack.length === 0 && !/<(?![/A-Za-z?!])/.test(body);
}

test("plist has label, keep-alive, ordered arguments, working directory and both logs", () => {
  const p = buildPlist(base);
  expect(p).toContain(`<string>${SERVICE_LABEL}</string>`);
  expect(SERVICE_LABEL).toBe("com.agent-world.server");
  expect(p).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  expect(p).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  const order = ["/opt/node/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "src/server/main.ts"].map(s => p.indexOf(`<string>${s}</string>`));
  expect(order.every(i => i > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(p).toMatch(/<key>WorkingDirectory<\/key>\s*<string>\/repo<\/string>/);
  expect(p).toMatch(/<key>StandardOutPath<\/key>\s*<string>\/home\/.agent-world\/server.log<\/string>/);
  expect(p).toMatch(/<key>StandardErrorPath<\/key>\s*<string>\/home\/.agent-world\/server.log<\/string>/);
  expect(p).not.toContain("EnvironmentVariables");
  expect(wellFormed(p)).toBe(true);
});

test("only the given environment variables are written", () => {
  const p = buildPlist({ ...base, env: { AGENT_WORLD_PORT: "4400" } });
  expect(p).toMatch(/<key>AGENT_WORLD_PORT<\/key>\s*<string>4400<\/string>/);
  expect(p).not.toContain("AGENT_WORLD_HOME");
});

test("paths with a space, &, < and \" are escaped", () => {
  const p = buildPlist({ ...base, nodePath: "/a b/n&n/<x>/\"q\"/node", env: { AGENT_WORLD_HOME: "/h&<\"" } });
  expect(p).toContain("<string>/a b/n&amp;n/&lt;x&gt;/&quot;q&quot;/node</string>");
  expect(p).toContain("<string>/h&amp;&lt;&quot;</string>");
  expect(wellFormed(p)).toBe(true);
  expect(readPlistInfo(p).nodePath).toBe("/a b/n&n/<x>/\"q\"/node");
});

test("parsePrint", () => {
  expect(parsePrint("gui/501/x = {\n\tstate = running\n\tpid = 1922\n\tforks = 0\n}")).toEqual({ running: true, pid: 1922 });
  expect(parsePrint("gui/501/x = {\n\tstate = not running\n\truns = 3\n\tlast exit code = 1\n}")).toEqual({ running: false, pid: null });
  expect(parsePrint("")).toEqual({ running: false, pid: null });
});

test("readPlistInfo reads the node path and port", () => {
  const p = buildPlist({ ...base, env: { AGENT_WORLD_PORT: "4400" } });
  expect(readPlistInfo(p)).toEqual({ nodePath: "/opt/node/bin/node", port: "4400", path: null });
  const q = buildPlist({ ...base, env: { PATH: "/a&b:/usr/bin" } });
  expect(q).toContain("<string>/a&amp;b:/usr/bin</string>");
  expect(readPlistInfo(q).path).toBe("/a&b:/usr/bin");
  expect(readPlistInfo(buildPlist(base)).port).toBeNull();
});
