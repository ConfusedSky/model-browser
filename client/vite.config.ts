import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The entries below are resolved against this file's own URL: it is ESM
// (`"type": "module"` in package.json), so there is no `__dirname` to join
// them to. The `node:` import costs nothing in a workspace with no
// @types/node because vite.config.ts is outside tsconfig's `include`.

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // Two documents, not one (`landing-page` D2): the app, and the About
      // page as a second entry of the same build. Vite keeps a resolved HTML
      // input's own file name for the emitted asset, so this puts
      // `dist/about.html` beside `dist/index.html` and `createStaticHandler`
      // serves it at `/about.html` with no change to the server.
      //
      // Both names are asserted by client/test/viteEntries.test.ts, which reads
      // this file as text: a dropped entry then fails in CI rather than on the
      // box, where the only symptom is a 404 that the SPA fallback dresses up
      // as the app.
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        about: fileURLToPath(new URL("about.html", import.meta.url)),
      },
    },
  },
  // Vitest stubs every CSS import empty unless it processes CSS, `?raw`
  // included — and chromeLayers.test.tsx reads index.css as text to check that
  // the named layers are ordered. Nothing else in the suite imports CSS.
  test: { css: true },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3177",
    },
  },
});
