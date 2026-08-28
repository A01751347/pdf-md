import type { PDFDocumentProxy } from 'pdfjs-dist'
import { extractPage, loadPdf } from './extract'
import { analyzePage, bodyMargins, marginsByColumn, type PageContext } from './blocks'
import { buildPageLines, computeBodySize, findRunningHeads, headingScale, isPageNumber, lineKey, typicalLeading } from './layout'
import { emitMarkdown } from './emit'
import { blobToDataUrl, cropToPng, renderPage, renderThumbnail, type RenderedPage } from './render'
import { ocrCanvas } from './ocr'
import { DEFAULT_OPTIONS, parsePageRange, type ConvertOptions } from './options'
import type { ConversionResult, DocumentMeta, ImageRef, Line, MdNode, Progress, RawPage } from './types'
import { clamp, yieldToUI } from './util'

const OCR_SCALE = 2.6

function parsePdfDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value.trim())
  if (!m) return value.trim() || undefined
  const [, y, mo = '01', d = '01', h, mi] = m
  const date = `${y}-${mo}-${d}`
  return h ? `${date} ${h}:${mi ?? '00'}` : date
}

function releaseCanvas(rendered: RenderedPage | null) {
  if (!rendered) return
  rendered.canvas.width = 0
  rendered.canvas.height = 0
}

/**
 * Une listas consecutivas del mismo tipo: un salto de bloque dentro de una
 * enumeración no debe reiniciar la numeración.
 */
function mergeAdjacentLists(nodes: MdNode[]): MdNode[] {
  const out: MdNode[] = []
  for (const node of nodes) {
    const prev = out[out.length - 1]
    if (node.type === 'list' && prev?.type === 'list' && prev.ordered === node.ordered && prev.page === node.page) {
      prev.items.push(...node.items)
      continue
    }
    out.push(node)
  }
  return out
}

/** Normaliza los niveles de título para que la jerarquía sea contigua. */
function normalizeHeadings(nodes: MdNode[]) {
  const headings = nodes.filter((n): n is Extract<MdNode, { type: 'heading' }> => n.type === 'heading')
  if (!headings.length) return
  const used = [...new Set(headings.map((h) => h.level))].sort((a, b) => a - b)
  const remap = new Map(used.map((lvl, i) => [lvl, i + 1]))
  let previous = 0
  for (const heading of headings) {
    let level = remap.get(heading.level) ?? heading.level
    if (previous === 0) level = 1
    else if (level > previous + 1) level = previous + 1
    heading.level = clamp(level, 1, 6)
    previous = heading.level
  }
}

/** Sustituye las llamadas voladas por referencias Markdown de nota al pie. */
function linkFootnotes(nodes: MdNode[], map: Map<string, string>) {
  if (!map.size) return
  const re = /<sup>\\?\[?(\d{1,3})\\?\]?<\/sup>/g
  for (const node of nodes) {
    if (node.type === 'paragraph' || node.type === 'quote' || node.type === 'caption') {
      node.md = node.md.replace(re, (full, n: string) => (map.has(n) ? `[^${map.get(n)}]` : full))
    } else if (node.type === 'list') {
      for (const item of node.items) item.md = item.md.replace(re, (full, n: string) => (map.has(n) ? `[^${map.get(n)}]` : full))
    } else if (node.type === 'table') {
      node.rows = node.rows.map((row) => row.map((cell) => cell.replace(re, (full, n: string) => (map.has(n) ? `[^${map.get(n)}]` : full))))
    }
  }
}

function stripMd(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/<\/?su[bp]>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Toma el pie de figura contiguo como texto alternativo de la imagen. */
function attachCaptions(nodes: MdNode[]) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.type !== 'image') continue
    const after = nodes[i + 1]
    const before = nodes[i - 1]
    const source = after?.type === 'caption' ? after : before?.type === 'caption' ? before : null
    if (source) node.ref.alt = stripMd(source.md).slice(0, 180)
  }
}

export interface ConvertHooks {
  onProgress?: (progress: Progress) => void
  signal?: AbortSignal
}

export class PdfSession {
  private constructor(
    readonly doc: PDFDocumentProxy,
    readonly meta: DocumentMeta,
  ) {}

  static async open(file: File, password?: string): Promise<PdfSession> {
    const buffer = await file.arrayBuffer()
    const { doc, info } = await loadPdf(buffer, password)
    const meta: DocumentMeta = {
      title: (info.Title as string) || undefined,
      author: (info.Author as string) || undefined,
      subject: (info.Subject as string) || undefined,
      keywords: (info.Keywords as string) || undefined,
      creator: (info.Creator as string) || undefined,
      producer: (info.Producer as string) || undefined,
      creationDate: parsePdfDate(info.CreationDate),
      modificationDate: parsePdfDate(info.ModDate),
      pages: doc.numPages,
      fileName: file.name,
      fileSize: file.size,
    }
    return new PdfSession(doc, meta)
  }

  async thumbnail(pageNumber: number, maxWidth = 240): Promise<string> {
    const page = await this.doc.getPage(pageNumber)
    const url = await renderThumbnail(page, maxWidth)
    page.cleanup()
    return url
  }

  destroy() {
    this.doc.destroy().catch(() => undefined)
  }

  async convert(options: Partial<ConvertOptions> = {}, hooks: ConvertHooks = {}): Promise<ConversionResult> {
    const opts: ConvertOptions = { ...DEFAULT_OPTIONS, ...options }
    const started = performance.now()
    const warnings: string[] = []
    const pageNumbers = parsePageRange(opts.pageRange, this.doc.numPages)
    const report = (stage: Progress['stage'], page: number, detail: string, ratio: number) =>
      hooks.onProgress?.({ stage, page, pages: pageNumbers.length, detail, ratio: clamp(ratio, 0, 1) })

    const abort = () => {
      if (hooks.signal?.aborted) throw new DOMException('Conversión cancelada', 'AbortError')
    }

    report('loading', 0, 'Preparando documento', 0.02)

    const raws: RawPage[] = []
    let ocrPages = 0
    let scannedPages = 0

    for (let i = 0; i < pageNumbers.length; i++) {
      abort()
      const pageNumber = pageNumbers[i]
      const ratio = 0.05 + (i / pageNumbers.length) * 0.55
      report('extracting', pageNumber, `Analizando página ${pageNumber}`, ratio)

      const page = await this.doc.getPage(pageNumber)
      const raw = await extractPage(page, opts)
      if (raw.scanned) scannedPages++

      const needsOcr = opts.ocr === 'force' || (opts.ocr === 'auto' && raw.scanned)
      const needsRender = opts.images !== 'skip' && raw.images.length > 0

      let rendered: RenderedPage | null = null
      try {
        if (needsOcr) {
          report('ocr', pageNumber, `Reconociendo texto de la página ${pageNumber}`, ratio)
          rendered = await renderPage(page, OCR_SCALE)
          const spans = await ocrCanvas(rendered.canvas, OCR_SCALE, opts.ocrLanguage, (p, status) => {
            if (status === 'recognizing text') report('ocr', pageNumber, `OCR página ${pageNumber} · ${Math.round(p * 100)}%`, ratio)
          })
          if (spans.length) {
            raw.spans = spans
            raw.charCount = spans.reduce((n, s) => n + s.str.length, 0)
            ocrPages++
          } else {
            warnings.push(`El OCR no encontró texto en la página ${pageNumber}.`)
          }
        }

        if (needsRender) {
          report('rendering', pageNumber, `Extrayendo imágenes de la página ${pageNumber}`, ratio)
          if (!rendered || rendered.scale !== opts.imageScale) {
            releaseCanvas(rendered)
            rendered = await renderPage(page, opts.imageScale)
          }
          for (const image of raw.images) {
            const cropped = await cropToPng(rendered, image.rect)
            if (!cropped) continue
            image.blob = cropped.blob
            image.width = cropped.width
            image.height = cropped.height
            if (opts.images === 'embed') image.dataUrl = await blobToDataUrl(cropped.blob)
          }
          raw.images = raw.images.filter((img) => img.blob)
        }
      } catch (error) {
        warnings.push(`No se pudo rasterizar la página ${pageNumber}: ${(error as Error).message}`)
      } finally {
        releaseCanvas(rendered)
        page.cleanup()
      }

      raws.push(raw)
      await yieldToUI()
    }

    abort()
    report('layout', 0, 'Reconstruyendo la maquetación', 0.68)

    const bodySize = computeBodySize(raws) || 10
    const headingSizes = headingScale(raws, bodySize)

    const pageLines: Line[][] = []
    let columnsDetected = 1
    for (const raw of raws) {
      const { lines, columns } = buildPageLines(raw, bodySize, opts.detectColumns)
      columnsDetected = Math.max(columnsDetected, columns)
      pageLines.push(lines)
    }

    const dropKeys = opts.removeRepeatedHeaders ? findRunningHeads(pageLines, raws.map((r) => r.geometry)) : new Set<string>()

    report('emitting', 0, 'Generando Markdown', 0.82)

    const nodes: MdNode[] = []
    const footnotes: { label: string; md: string }[] = []
    let headings = 0
    let tables = 0
    let lists = 0
    let codeBlocks = 0
    const images: ImageRef[] = []

    for (let i = 0; i < raws.length; i++) {
      abort()
      const raw = raws[i]
      let lines = pageLines[i]
      if (dropKeys.size) lines = lines.filter((l) => !dropKeys.has(lineKey(l)))
      if (opts.removePageNumbers) lines = lines.filter((l) => !isPageNumber(l, raw.geometry))
      lines = lines.filter((l) => l.text.trim().length > 0)

      const margins = bodyMargins(lines, raw.geometry, bodySize)
      const ctx: PageContext = {
        opts,
        bodySize,
        headingSizes,
        leading: typicalLeading(lines) || bodySize * 1.2,
        geometry: raw.geometry,
        links: raw.links,
        rules: raw.rules,
        images: raw.images,
        pageIndex: raw.index,
        bodyLeft: margins.left,
        bodyRight: margins.right,
        columnMargins: marginsByColumn(lines, raw.geometry, bodySize),
      }

      const analysis = analyzePage(lines, ctx)
      linkFootnotes(analysis.nodes, new Map(analysis.footnotes.map((f) => [f.number, f.label])))
      attachCaptions(analysis.nodes)

      if (opts.pageSeparators !== 'none' && nodes.length) nodes.push({ type: 'pagebreak', page: raw.index })
      nodes.push(...analysis.nodes)
      footnotes.push(...analysis.footnotes.map((f) => ({ label: f.label, md: f.md })))
      images.push(...raw.images.filter((img) => img.blob))

      headings += analysis.headings
      tables += analysis.tables
      lists += analysis.lists
      codeBlocks += analysis.codeBlocks

      if (i % 8 === 7) await yieldToUI()
    }

    const merged = mergeAdjacentLists(nodes)
    nodes.length = 0
    nodes.push(...merged)
    if (opts.normalizeHeadingLevels) normalizeHeadings(nodes)

    const meta: DocumentMeta = { ...this.meta, pages: pageNumbers.length }
    if (!meta.title) {
      const firstHeading = nodes.find((n) => n.type === 'heading') as Extract<MdNode, { type: 'heading' }> | undefined
      if (firstHeading) meta.title = stripMd(firstHeading.text)
    }

    const markdown = emitMarkdown({ nodes, meta, options: opts, footnotes })

    if (scannedPages && opts.ocr === 'off') {
      warnings.push(`${scannedPages} página(s) parecen escaneadas; activa el OCR para recuperar su texto.`)
    }
    if (columnsDetected > 1) warnings.push(`Se detectó una maquetación de ${columnsDetected} columnas y se respetó el orden de lectura.`)
    if (!nodes.length) warnings.push('No se extrajo contenido. Prueba a activar el OCR o revisa el rango de páginas.')

    report('done', 0, 'Listo', 1)

    return {
      markdown,
      nodes,
      meta,
      images,
      warnings,
      outline: nodes
        .filter((n): n is Extract<MdNode, { type: 'heading' }> => n.type === 'heading')
        .map((h) => ({ level: h.level, text: stripMd(h.text), page: h.page })),
      stats: {
        pages: pageNumbers.length,
        scannedPages,
        ocrPages,
        headings,
        tables,
        lists,
        images: images.length,
        codeBlocks,
        footnotes: footnotes.length,
        words: markdown.split(/\s+/).filter(Boolean).length,
        characters: markdown.length,
        durationMs: Math.round(performance.now() - started),
        bodyFontSize: Math.round(bodySize * 10) / 10,
        columnsDetected,
      },
    }
  }
}
