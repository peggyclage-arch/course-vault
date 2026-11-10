import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Renderer build. `base: './'` so the built files load from file://
// inside Electron as well as from the Vite dev server.
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
