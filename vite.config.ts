import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const target = `http://127.0.0.1:${mode === "demo" ? 4318 : 4317}`;
  return {
    root: "src/client",
    build: { outDir: "../../dist/client", emptyOutDir: true },
    server: {
      proxy: { "/api": target, "/ingest": target, "/events": target },
    },
    test: { root: ".", include: ["tests/**/*.test.ts"] },
  };
});
