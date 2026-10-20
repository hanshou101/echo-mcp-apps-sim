import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the test-only fixture App into one self-contained HTML file, because
// the App HTML is written into the sandbox with document.write() and may not
// load scripts from another origin.
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname, "test/fixtures/app"),
  plugins: [viteSingleFile()],
  build: {
    outDir: resolve(__dirname, "test/fixtures/dist"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "test/fixtures/app/index.html"),
    },
  },
});
