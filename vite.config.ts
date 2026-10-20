import { defineConfig } from "vite";

// Builds the simulator page and the sandbox proxy page as two HTML entries.
// The sandbox entry must be served from its own origin (see server.ts).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: "index.html",
        sandbox: "sandbox.html",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8180",
    },
  },
});
