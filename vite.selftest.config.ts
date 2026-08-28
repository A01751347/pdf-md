import { defineConfig } from 'vite'

export default defineConfig({
  logLevel: 'warn',
  resolve: { alias: { 'pdfjs-dist': 'pdfjs-dist/legacy/build/pdf.mjs' } },
  build: {
    ssr: process.env.ENTRY ?? 'scripts/selftest.ts',
    outDir: 'node_modules/.selftest',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { external: ['tesseract.js', 'jszip', 'canvas', /^node:/] },
  },
})
