import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "client"),
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: resolve(projectRoot, "dist/client"),
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: process.env.WCIB_API_PROXY_TARGET ?? "http://127.0.0.1:5000",
      },
    },
  },
});
