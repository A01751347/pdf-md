import type { Block, Line as OcrLine, Word, Worker } from 'tesseract.js'
import type { Span } from './types'
import { profileFont } from './fonts'
import { median, normalizeGlyphs } from './util'

let workerPromise: Promise<Worker> | null = null
let workerLang = ''

/** Crea (o reutiliza) el worker de Tesseract para el idioma indicado. */
async function getWorker(lang: string, onLog?: (progress: number, status: string) => void): Promise<Worker> {
  if (workerPromise && workerLang === lang) return workerPromise
  if (workerPromise) {
    const previous = await workerPromise.catch(() => null)
    await previous?.terminate().catch(() => undefined)
  }
  workerLang = lang
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js')
    return createWorker(lang, 1, {
      logger: (message: { status: string; progress: number }) => onLog?.(message.progress, message.status),
    })
  })()
  return workerPromise
}

export async function terminateOcr() {
  if (!workerPromise) return
  const worker = await workerPromise.catch(() => null)
  await worker?.terminate().catch(() => undefined)
  workerPromise = null
  workerLang = ''
}

/** Altura de cuerpo estimada de una línea reconocida. */
function lineFontSize(line: OcrLine, words: Word[], scale: number): number {
  const rowHeight = line.rowAttributes?.row_height
  if (rowHeight && rowHeight > 2) return (rowHeight / scale) * 1.02
  return Math.max(4, median(words.map((w) => (w.bbox.y1 - w.bbox.y0) / scale)) * 1.18)
}

/** Línea base real cuando Tesseract la calcula; si no, el borde inferior. */
function lineBaseline(line: OcrLine, words: Word[], scale: number, size: number): number {
  if (line.baseline?.has_baseline) {
    const y = (line.baseline.y0 + line.baseline.y1) / 2
    if (Number.isFinite(y) && y > 0) return y / scale
  }
  return Math.max(...words.map((w) => w.bbox.y1)) / scale - size * 0.08
}

function scriptOf(word: Word): Span['script'] {
  const symbols = word.symbols ?? []
  if (!symbols.length) return 'normal'
  if (symbols.every((s) => s.is_superscript)) return 'sup'
  if (symbols.every((s) => s.is_subscript)) return 'sub'
  return 'normal'
}

/**
 * Reconoce el texto de un lienzo y devuelve spans en puntos PDF, listos para
 * pasar por el mismo análisis de maquetación que el texto nativo.
 */
export async function ocrCanvas(
  canvas: HTMLCanvasElement,
  scale: number,
  lang: string,
  onLog?: (progress: number, status: string) => void,
): Promise<Span[]> {
  const worker = await getWorker(lang, onLog)
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true })
  const spans: Span[] = []

  for (const block of (data.blocks ?? []) as Block[]) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words = (line.words ?? []).filter((w) => w.text?.trim() && w.confidence > 35)
        if (!words.length) continue
        const size = lineFontSize(line, words, scale)
        const baseline = lineBaseline(line, words, scale, size)

        for (const word of words) {
          const profile = profileFont(word.font_name ?? '')
          spans.push({
            str: normalizeGlyphs(word.text),
            x: word.bbox.x0 / scale,
            y: baseline,
            w: (word.bbox.x1 - word.bbox.x0) / scale,
            size,
            font: word.font_name || 'ocr',
            bold: profile.bold,
            italic: profile.italic,
            mono: profile.mono,
            serif: profile.serif,
            math: false,
            angle: 0,
            script: scriptOf(word),
          })
        }
      }
    }
  }

  return spans
}
