import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vitest stubs every CSS import empty unless it processes CSS, `?raw`
  // included — and chromeLayers.test.tsx reads index.css as text to check that
  // the named layers are ordered. Nothing else in the suite imports CSS.
  test: { css: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3177',
    },
  },
})
