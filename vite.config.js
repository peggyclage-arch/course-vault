import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Renderer build. `base: './'` so the built files load from the Tauri
// webview as well as from the Vite dev server.
export default defineConfig({
  plugins: [vue()],
  base: './',
  // Tauri dev server: fixed port 1420, strict, so the Rust side can find it.
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2021'
  }
})
