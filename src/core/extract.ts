import { OPS, Util, getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { profileFont } from './fonts'
import { normalizeGlyphs, type Rect, rectArea, rectIntersect } from './util'
import type { ImageRef, LinkArea, RawPage, Rule, Span } from './types'
import type { ConvertOptions } from './options'

/** Base de los recursos auxiliares de pdf.js copiados junto a la aplicación. */
const ASSET_BASE = typeof document === 'undefined' ? '' : new URL('pdf-assets/', document.baseURI).href

/** Operadores de trazado emitidos dentro de `constructPath`. */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const

const PAINT_IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

export interface LoadedPdf {
  doc: PDFDocumentProxy
  info: Record<string, unknown>
}

export async function loadPdf(data: ArrayBuffer, password?: string): Promise<LoadedPdf> {
  const task = getDocument({
    data: new Uint8Array(data),
    password,
    useSystemFonts: true,
    cMapUrl: ASSET_BASE ? `${ASSET_BASE}cmaps/` : undefined,
    cMapPacked: true,
    standardFontDataUrl: ASSET_BASE ? `${ASSET_BASE}standard_fonts/` : undefined,
  })
  const doc = await task.promise
  const metadata = await doc.getMetadata().catch(() => null)
  return { doc, info: (metadata?.info as Record<string, unknown>) ?? {} }
}

type Matrix = [number, number, number, number, number, number]

interface PathPoint {
  x: number
  y: number
}

/** Recorre el listado de operadores para recoger filetes, imágenes y CTM. */
function walkOperatorList(
  opList: { fnArray: number[]; argsArray: unknown[][] },
  baseTransform: Matrix,
  opts: ConvertOptions,
): { rules: Rule[]; images: { rect: Rect; objId: string | null }[] } {
  const rules: Rule[] = []
  const images: { rect: Rect; objId: string | null }[] = []
  const stack: { ctm: Matrix; lineWidth: number }[] = []
  let ctm: Matrix = [...baseTransform] as Matrix
  let lineWidth = 1

  // `Util.applyTransform` muta el punto recibido, así que aplicamos la matriz aquí.
  const apply = (x: number, y: number): PathPoint => ({
    x: x * ctm[0] + y * ctm[2] + ctm[4],
    y: x * ctm[1] + y * ctm[3] + ctm[5],
  })

  const scaleOf = () => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i]
    const args = opList.argsArray[i] as never[]
    try {
      switch (fn) {
        case OPS.save:
          stack.push({ ctm: [...ctm] as Matrix, lineWidth })
          break
        case OPS.restore: {
          const prev = stack.pop()
          if (prev) {
            ctm = prev.ctm
            lineWidth = prev.lineWidth
          }
          break
        }
        case OPS.transform:
          ctm = Util.transform(ctm, args as unknown as Matrix) as Matrix
          break
        case OPS.setLineWidth:
          lineWidth = Number(args[0]) || lineWidth
          break
        case OPS.paintFormXObjectBegin:
          stack.push({ ctm: [...ctm] as Matrix, lineWidth })
          ctm = Util.transform(ctm, args[0] as unknown as Matrix) as Matrix
          break
        case OPS.paintFormXObjectEnd:
        case OPS.endGroup:
        case OPS.endAnnotation: {
          const prev = stack.pop()
          if (prev) {
            ctm = prev.ctm
            lineWidth = prev.lineWidth
          }
          break
        }
        case OPS.beginGroup:
        case OPS.beginAnnotation:
          stack.push({ ctm: [...ctm] as Matrix, lineWidth })
          break
        case OPS.constructPath: {
          const paintOp = args[0] as unknown as number
          const data = args[1] as unknown as unknown[]
          const path = Array.isArray(data) ? (data[0] as number[]) : null
          if (!Array.isArray(path)) break
          const stroked = paintOp === OPS.stroke || paintOp === OPS.closeStroke || paintOp === OPS.fillStroke || paintOp === OPS.eoFillStroke
          collectRules(path, apply, rules, stroked ? Math.max(0.3, lineWidth * scaleOf()) : 0)
          break
        }
        default:
          if (PAINT_IMAGE_OPS.has(fn)) {
            const corners = [apply(0, 0), apply(1, 0), apply(0, 1), apply(1, 1)]
            const xs = corners.map((c) => c.x)
            const ys = corners.map((c) => c.y)
            const rect: Rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
            const objId = typeof args[0] === 'string' ? (args[0] as string) : null
            if (rect.x1 - rect.x0 >= opts.minImageSize && rect.y1 - rect.y0 >= opts.minImageSize) {
              images.push({ rect, objId })
            }
          }
          break
      }
    } catch {
      // Un operador exótico no debe abortar la extracción de la página.
    }
  }
  return { rules, images }
}

/** Convierte segmentos rectos y rectángulos finos del trazado en filetes. */
function collectRules(path: number[], apply: (x: number, y: number) => PathPoint, out: Rule[], strokeWidth: number) {
  const subpaths: PathPoint[][] = []
  let current: PathPoint[] = []
  for (let i = 0; i < path.length; ) {
    const op = path[i++]
    if (op === DRAW.moveTo) {
      if (current.length > 1) subpaths.push(current)
      current = [apply(path[i++], path[i++])]
    } else if (op === DRAW.lineTo) {
      current.push(apply(path[i++], path[i++]))
    } else if (op === DRAW.curveTo) {
      i += 4
      current.push(apply(path[i++], path[i++]))
    } else if (op === DRAW.quadraticCurveTo) {
      i += 2
      current.push(apply(path[i++], path[i++]))
    } else if (op === DRAW.closePath) {
      if (current.length > 1) {
        current.push(current[0])
        subpaths.push(current)
        current = [current[0]]
      }
    } else {
      break // formato desconocido: abandonamos con lo obtenido
    }
  }
  if (current.length > 1) subpaths.push(current)

  for (const pts of subpaths) {
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const bw = Math.max(...xs) - Math.min(...xs)
    const bh = Math.max(...ys) - Math.min(...ys)

    // Rectángulo relleno muy fino: se comporta como un filete.
    if (!strokeWidth && pts.length >= 4 && ((bh <= 4 && bw >= 8) || (bw <= 4 && bh >= 8))) {
      const horizontal = bh <= bw
      out.push({
        x0: Math.min(...xs),
        y0: horizontal ? (Math.min(...ys) + Math.max(...ys)) / 2 : Math.min(...ys),
        x1: Math.max(...xs),
        y1: horizontal ? (Math.min(...ys) + Math.max(...ys)) / 2 : Math.max(...ys),
        horizontal,
        thickness: horizontal ? bh || 0.6 : bw || 0.6,
      })
      continue
    }
    if (!strokeWidth) continue

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const dx = Math.abs(b.x - a.x)
      const dy = Math.abs(b.y - a.y)
      if (dx >= 8 && dy <= 1.2) {
        out.push({ x0: Math.min(a.x, b.x), y0: (a.y + b.y) / 2, x1: Math.max(a.x, b.x), y1: (a.y + b.y) / 2, horizontal: true, thickness: strokeWidth })
      } else if (dy >= 8 && dx <= 1.2) {
        out.push({ x0: (a.x + b.x) / 2, y0: Math.min(a.y, b.y), x1: (a.x + b.x) / 2, y1: Math.max(a.y, b.y), horizontal: false, thickness: strokeWidth })
      }
    }
  }
}

/** Fusiona filetes colineales y descarta duplicados. */
function mergeRules(rules: Rule[]): Rule[] {
  const horizontal = rules.filter((r) => r.horizontal).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const vertical = rules.filter((r) => !r.horizontal).sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0)
  const out: Rule[] = []

  const fold = (list: Rule[], axis: 'h' | 'v') => {
    let acc: Rule | null = null
    for (const r of list) {
      if (!acc) {
        acc = { ...r }
        continue
      }
      const sameLine = axis === 'h' ? Math.abs(r.y0 - acc.y0) <= 1.5 : Math.abs(r.x0 - acc.x0) <= 1.5
      const touching = axis === 'h' ? r.x0 <= acc.x1 + 3 : r.y0 <= acc.y1 + 3
      if (sameLine && touching) {
        acc.x1 = Math.max(acc.x1, r.x1)
        acc.y1 = Math.max(acc.y1, r.y1)
        acc.thickness = Math.max(acc.thickness, r.thickness)
      } else {
        out.push(acc)
        acc = { ...r }
      }
    }
    if (acc) out.push(acc)
  }

  fold(horizontal, 'h')
  fold(vertical, 'v')
  return out
}

/** Descarta imágenes contenidas en otras y ordena por posición. */
function dedupeImages(list: { rect: Rect; objId: string | null }[]): Rect[] {
  const rects = list.map((i) => i.rect).sort((a, b) => rectArea(b) - rectArea(a))
  const kept: Rect[] = []
  for (const r of rects) {
    const swallowed = kept.some((k) => {
      const inter = rectIntersect(k, r)
      return inter ? rectArea(inter) / Math.max(1, rectArea(r)) > 0.85 : false
    })
    if (!swallowed) kept.push(r)
  }
  // Une mosaicos adyacentes que en realidad son una sola figura troceada.
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        const a = kept[i]
        const b = kept[j]
        const gapX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)
        const gapY = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1)
        if (gapX <= 2 && gapY <= 2) {
          kept[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
          kept.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return kept.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
}

export async function extractPage(page: PDFPageProxy, opts: ConvertOptions): Promise<RawPage> {
  const viewport = page.getViewport({ scale: 1 })
  const base = viewport.transform as Matrix

  let rules: Rule[] = []
  let imageRects: Rect[] = []
  try {
    const opList = await page.getOperatorList()
    const walked = walkOperatorList(opList, base, opts)
    rules = mergeRules(walked.rules)
    imageRects = opts.images === 'skip' ? [] : dedupeImages(walked.images)
  } catch {
    // Sin listado de operadores seguimos con el texto: la conversión no se detiene.
  }

  const textContent = await page.getTextContent({ includeMarkedContent: false })
  const spans: Span[] = []
  let charCount = 0

  for (const raw of textContent.items) {
    if (!('str' in raw)) continue
    const item = raw as { str: string; transform: number[]; width: number; height: number; fontName: string; hasEOL: boolean }
    if (!item.str) continue
    const tx = Util.transform(base, item.transform as Matrix)
    const size = Math.hypot(tx[2], tx[3])
    if (!Number.isFinite(size) || size <= 0) continue
    const angle = Math.atan2(tx[1], tx[0])
    if (opts.dropWatermarks && Math.abs(angle) > 0.12) continue

    let flags: { bold?: boolean; italic?: boolean } | undefined
    try {
      if (page.commonObjs.has(item.fontName)) {
        const f = page.commonObjs.get(item.fontName) as { bold?: boolean; italic?: boolean; name?: string }
        flags = { bold: f?.bold, italic: f?.italic }
      }
    } catch {
      flags = undefined
    }
    const fontName = readFontName(page, item.fontName)
    const profile = profileFont(fontName, flags)
    const str = normalizeGlyphs(item.str)
    if (str.trim()) charCount += str.trim().length

    spans.push({
      str,
      x: tx[4],
      y: tx[5],
      w: Math.abs(item.width) || str.length * size * 0.5,
      size,
      font: fontName,
      bold: profile.bold,
      italic: profile.italic,
      mono: profile.mono,
      serif: profile.serif,
      math: profile.math,
      angle,
      script: 'normal',
    })
  }

  const links: LinkArea[] = []
  if (opts.keepLinks) {
    try {
      const annotations = await page.getAnnotations({ intent: 'display' })
      for (const a of annotations as { subtype?: string; url?: string; rect?: number[] }[]) {
        if (a.subtype !== 'Link' || !a.url || !a.rect) continue
        const [x0, y0, x1, y1] = viewport.convertToViewportRectangle(a.rect)
        links.push({
          url: a.url,
          rect: { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) },
        })
      }
    } catch {
      // Anotaciones opcionales.
    }
  }

  const pageArea = viewport.width * viewport.height
  const fullPageImage = imageRects.some((r) => rectArea(r) / pageArea > 0.85)
  const images: ImageRef[] = imageRects
    .filter((r) => rectArea(r) / pageArea <= 0.92)
    .map((rect, i) => ({
      id: `p${page.pageNumber}-i${i + 1}`,
      page: page.pageNumber,
      rect,
      width: Math.round(rect.x1 - rect.x0),
      height: Math.round(rect.y1 - rect.y0),
      alt: '',
      path: `imagenes/pagina-${String(page.pageNumber).padStart(3, '0')}-${i + 1}.png`,
    }))

  return {
    index: page.pageNumber,
    geometry: { width: viewport.width, height: viewport.height, rotation: viewport.rotation },
    spans,
    rules,
    images,
    links,
    scanned: charCount < 40 && (fullPageImage || imageRects.length > 0 || charCount === 0),
    charCount,
  }
}

function readFontName(page: PDFPageProxy, id: string): string {
  try {
    if (page.commonObjs.has(id)) {
      const f = page.commonObjs.get(id) as { name?: string }
      if (f?.name) return f.name
    }
  } catch {
    /* noop */
  }
  return id
}
