import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../shared/config";
import { serverEnv } from "./env";
import { truncateLog } from "./logTruncate";
import { nodeVersionProblem } from "./nodeVersion";

// None of the static imports above need Node 22; node:sqlite is only loaded by the dynamic imports below, after this.
const versionProblem = nodeVersionProblem(process.version);
if (versionProblem !== null) {
  console.error(versionProblem);
  process.exit(1);
}

// node:sqlite prints an ExperimentalWarning when first loaded. Wrap Node's own warning listeners so they skip only that
// warning (keeping --no-warnings and --trace-warnings behaviour), before the store is loaded (hence the dynamic imports
// below: static imports would run first).
const warningListeners = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", w => {
  if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message)) return;
  for (const l of warningListeners) l(w);
});

const { openStore } = await import("./store");
const { createApp } = await import("./app");
const { createDemo } = await import("../adapters/demo");

const demo = process.argv.includes("--demo");
const { port, home, warnings } = serverEnv(process.env, demo, homedir());
truncateLog(join(home, "server.log"), 5_000_000);
for (const w of warnings) console.warn(w);
const clientDir = fileURLToPath(new URL("../../dist/client", import.meta.url));

const store = openStore(join(home, demo ? "demo.db" : "world.db"));
const app = createApp({ store, demo, ...(existsSync(clientDir) && { staticDir: clientDir }) });
const server = createServer(app.handler);

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") console.error(`Agent World is already running on port ${port}`);
  else console.error(e);
  store.close();
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Agent World${demo ? " (demo)" : ""} running at http://127.0.0.1:${port}`);
  const ticker = setInterval(() => {
    try { app.tick(); } catch (e) { console.error("agent-world: tick failed", e); }
  }, CONFIG.tickMs);
  const simulator = demo
    ? createDemo({ emit: ev => { app.inject(ev).catch(e => console.error("agent-world: demo inject failed", e)); }, rng: Math.random, now: Date.now })
    : null;
  const simTimer = simulator === null ? null : setInterval(() => {
    try { simulator.step(); } catch (e) { console.error("agent-world: demo step failed", e); }
  }, CONFIG.demo.stepMs);
  const shutdown = (): void => {
    clearInterval(ticker);
    if (simTimer !== null) clearInterval(simTimer);
    app.close();
    server.close();
    server.closeAllConnections();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
