import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer-only Vite config. The Electron main/preload are compiled separately
// by tsconfig.electron.json. `base: './'` so the built index.html loads its
// assets over file:// in production.
export default defineConfig({
  root: 'renderer',
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: '../dist/renderer', emptyOutDir: true },
})
