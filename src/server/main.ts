import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../shared/config";
import { serverEnv } from "./env";

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

const demo = process.argv.includes("--demo");
const { port, home, warnings } = serverEnv(process.env, demo, homedir());
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
  const shutdown = (): void => {
    clearInterval(ticker);
    app.close();
    server.close();
    server.closeAllConnections();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
