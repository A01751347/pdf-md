import { createReadStream, cpSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const require_ = createRequire(import.meta.url)
const PDFJS_ROOT = path.dirname(require_.resolve('pdfjs-dist/package.json'))
const ASSET_DIRS = ['cmaps', 'standard_fonts'] as const

/**
 * pdf.js necesita las tablas CMap (PDF con CJK) y las fuentes base-14 para los
 * documentos sin fuentes incrustadas. Se sirven en desarrollo y se copian al
 * `dist` en producción para que la aplicación sea autónoma.
 */
function pdfjsAssets(): Plugin {
  let outDir = 'dist'
  return {
    name: 'pdfjs-assets',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        const match = /^\/pdf-assets\/(cmaps|standard_fonts)\/(.+)$/.exec(url)
        if (!match) return next()
        const safe = path.normalize(match[2]).replace(/^(\.\.(\/|\\|$))+/, '')
        const file = path.join(PDFJS_ROOT, match[1], safe)
        if (!file.startsWith(PDFJS_ROOT) || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Cache-Control', 'max-age=31536000, immutable')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      for (const dir of ASSET_DIRS) {
        const from = path.join(PDFJS_ROOT, dir)
        if (existsSync(from)) cpSync(from, path.resolve(outDir, 'pdf-assets', dir), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs'
          if (id.includes('tesseract')) return 'ocr'
          if (id.includes('jszip')) return 'zip'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
