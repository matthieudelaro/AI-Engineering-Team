import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const uiRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: uiRoot,
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
      },
      "/_gateway": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
      },
    },
  },
});
