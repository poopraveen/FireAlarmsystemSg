import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Single-file build: dist/index.html contains all JS and CSS, so the same file
// can be served by the gateway or published as a stand-alone demo page.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: { proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } } },
})
