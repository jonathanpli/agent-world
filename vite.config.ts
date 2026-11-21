import { defineConfig } from "vitest/config";
import { CONFIG } from "./src/shared/config";

export default defineConfig(({ mode }) => {
  const port = process.env.AGENT_WORLD_PORT ?? (mode === "demo" ? CONFIG.demoPort : CONFIG.port);
  const target = `http://127.0.0.1:${port}`;
  return {
    root: "src/client",
    build: { outDir: "../../dist/client", emptyOutDir: true },
    server: {
      proxy: { "/api": target, "/ingest": target, "/events": target },
    },
    test: { root: ".", include: ["tests/**/*.test.ts"] },
  };
});
