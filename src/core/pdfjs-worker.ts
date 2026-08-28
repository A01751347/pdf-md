import { GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** Efecto secundario: enlaza el worker de pdf.js empaquetado por Vite. */
GlobalWorkerOptions.workerSrc = workerUrl
