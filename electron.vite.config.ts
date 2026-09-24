import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Bundle pdfjs-dist into the main build (it is ESM-only); native/optional
    // packages stay external and are loaded from node_modules at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['pdfjs-dist'] })],
    build: {
      rollupOptions: {
        input: {
          index: 'src/main/index.ts',
          'extractor-worker': 'src/main/pdf/extractor.worker.ts'
        },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { entryFileNames: 'index.js' } } }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    build: { target: 'chrome120' }
  }
})
