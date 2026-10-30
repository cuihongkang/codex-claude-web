import { defineConfig, loadEnv } from "vite";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readVersion } from "../server/src/version.mjs";

export default defineConfig(({ mode, command }) => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const env = loadEnv(mode, root, "");
  const target = `http://127.0.0.1:${env.PORT || 8766}`;
  const buildInfo = { ...readVersion(root), builtAt: new Date().toISOString() };
  if (command === "build")
    writeFileSync(
      join(root, "build-info.json"),
      JSON.stringify(buildInfo, null, 2) + "\n",
    );
  return {
    define: { __CODEX_WEB_BUILD__: JSON.stringify(buildInfo) },
    server: {
      proxy: {
        "/rpc": { target, ws: true },
        "/claude/rpc": { target, ws: true },
        "/healthz": { target },
        "/api/translate": { target },
        "/api/media": { target },
        "/api/files": { target },
      },
    },
    build: {
      assetsInlineLimit: Infinity,
      rollupOptions: {
        output: {
          entryFileNames: "app.js",
          chunkFileNames: "[name].js",
          assetFileNames: (asset) =>
            asset.names?.some((n) => n.endsWith(".css"))
              ? "style.css"
              : "[name][extname]",
        },
      },
    },
  };
});
