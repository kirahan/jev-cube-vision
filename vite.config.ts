import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    extensions: [".mjs", ".js", ".ts", ".tsx", ".json"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        vl: resolve(__dirname, "vl.html"),
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8765,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
