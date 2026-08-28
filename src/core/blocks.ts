import type { ImageRef, LinkArea, Line, ListItem, MdNode, PageGeometry, Rule, Span } from './types'
import type { ConvertOptions } from './options'
import { mergeAdjacentEmphasis, renderInline, tidySpacing, type InlineContext } from './inline'
import { buildTable, findTableRegions, type TableRegion } from './tables'
import { escapeLineStart, clamp, median, weightedMode } from './util'
import { looksMathematical, unicodeToLatex } from './math'

export interface PageContext {
  opts: ConvertOptions
  bodySize: number
  headingSizes: number[]
  leading: number
  geometry: PageGeometry
  links: LinkArea[]
  rules: Rule[]
  images: ImageRef[]
  pageIndex: number
  bodyLeft: number
  bodyRight: number
  /** Márgenes por columna: una cita se mide contra su propia columna. */
  columnMargins: Map<number, { left: number; right: number }>
}

function marginsFor(ctx: PageContext, column: number): { left: number; right: number } {
  return ctx.columnMargins.get(column) ?? { left: ctx.bodyLeft, right: ctx.bodyRight }
}

const BULLET_RE = /^([•·▪▫◦‣⁃∙●○■□▶►✓✔→»※*+])\s+/u
const DASH_BULLET_RE = /^([-–—])\s+/u
const ORDERED_RE = /^\(?([0-9]{1,3}|[ivxlcdm]{1,7}|[IVXLCDM]{1,7}|[a-zA-Z])([.)])\s+/
const CAPTION_RE =
  /^(fig(?:ura|ure|\.)?|tabla|table|cuadro|gr[áa]fic[oa]|imagen|ilustraci[óo]n|esquema|chart|exhibit|anexo|listado|listing|algoritmo|algorithm|ecuaci[óo]n|equation)\s*\.?\s*(\d+(?:[.\-]\d+)*|[IVXLC]+)\b/i
const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+){0,4})[.)]?\s+(?=\S)/
const APPENDIX_HEADING_RE = /^(cap[íi]tulo|chapter|parte|part|secci[óo]n|section|anexo|ap[ée]ndice|appendix|unidad|tema|lecci[óo]n|m[óo]dulo)\s+([0-9]+|[IVXLC]+|[A-Z])\b/i
const SENTENCE_END_RE = /[.!?:;]["'”’)\]]?\s*$/

export interface Marker {
  ordered: boolean
  /** Marcador normalizado para la salida Markdown. */
  marker: string
  /** Marcador tal cual aparece en el PDF, necesario para recortarlo. */
  rawMarker: string
  rest: string
  startX: number
}

function matchMarker(line: Line): Marker | null {
  const text = line.text
  const bullet = BULLET_RE.exec(text) ?? DASH_BULLET_RE.exec(text)
  if (bullet) return { ordered: false, marker: '-', rawMarker: bullet[1], rest: text.slice(bullet[0].length), startX: line.x0 }
  const ordered = ORDERED_RE.exec(text)
  if (ordered) {
    const token = ordered[1]
    if (/^\d+$/.test(token) && Number(token) > 400) return null
    return { ordered: true, marker: `${token}${ordered[2]}`, rawMarker: ordered[0].trim(), rest: text.slice(ordered[0].length), startX: line.x0 }
  }
  return null
}

/** Un marcador aislado solo se acepta si es un inicio natural de lista. */
function plausibleListStart(marker: Marker): boolean {
  if (!marker.ordered) return true
  const token = marker.marker.slice(0, -1)
  return /^(1|01|a|A|i|I)$/.test(token)
}

function isHeadingCandidate(block: Line[], ctx: PageContext): { level: number } | null {
  if (!ctx.opts.detectHeadings) return null
  if (block.length > 3) return null
  const text = block.map((l) => l.text).join(' ').trim()
  if (!text || text.length > 220) return null
  if (/[,;]$/.test(text)) return null
  if (!/\p{L}|\d/u.test(text)) return null

  const size = Math.max(...block.map((l) => l.size))
  const ratio = size / ctx.bodySize
  const bold = block.reduce((a, l) => a + l.boldRatio * l.text.length, 0) / Math.max(1, text.length)
  const caps = block.reduce((a, l) => a + l.capsRatio, 0) / block.length
  const numbered = NUMBERED_HEADING_RE.exec(text)
  const appendix = APPENDIX_HEADING_RE.test(text)
  const wordCount = text.split(/\s+/).length

  const sizeIndex = ctx.headingSizes.findIndex((s) => size >= s - 0.4)
  const sizeLevel = sizeIndex >= 0 ? clamp(sizeIndex + 1, 1, 6) : 0
  const fallback = clamp(ctx.headingSizes.length + 1, 1, 6)

  if (numbered && (ratio >= 1.0 || bold > 0.5)) {
    const depth = clamp(numbered[1].split('.').length, 1, 6)
    // El tamaño define la jerarquía real; la numeración solo marca un mínimo.
    return { level: sizeLevel ? clamp(Math.max(sizeLevel, depth), 1, 6) : depth }
  }
  if (appendix && (ratio >= 1.05 || bold > 0.5)) return { level: sizeLevel || 1 }
  if (ratio >= 1.12) return { level: sizeLevel || fallback }
  if (bold > 0.7 && wordCount <= 18 && !SENTENCE_END_RE.test(text)) {
    return { level: sizeLevel || clamp(fallback, 2, 6) }
  }
  if (caps > 0.85 && wordCount <= 12 && text.replace(/[^\p{L}]/gu, '').length >= 3 && ratio >= 0.98) {
    return { level: sizeLevel || fallback }
  }
  return null
}

const LANG_HINTS: [RegExp, string][] = [
  [/^\s*(?:import|from)\s+\w+|def\s+\w+\(|print\(|elif\s|self\./m, 'python'],
  [/\b(?:const|let|var)\s+\w+\s*=|=>|function\s+\w*\(|console\.log|require\(/m, 'javascript'],
  [/\binterface\s+\w+\s*{|:\s*(?:string|number|boolean)\b|export\s+type\b/m, 'typescript'],
  [/\b(?:public|private|protected)\s+(?:static\s+)?(?:void|int|String)\b|System\.out\.print/m, 'java'],
  [/#include\s*<|std::|printf\(|int\s+main\s*\(/m, 'cpp'],
  [/\bSELECT\b[\s\S]*\bFROM\b|\bINSERT\s+INTO\b|\bCREATE\s+TABLE\b/i, 'sql'],
  [/^\s*[{[][\s\S]*["'][\w-]+["']\s*:/m, 'json'],
  [/<\/?[a-z][\w-]*(?:\s[^>]*)?>/m, 'html'],
  [/^\s*(?:\$|#)\s+\w+|\bapt-get\b|\bnpm\s+(?:i|install)\b|\bgit\s+\w+/m, 'bash'],
  [/^\s*<\?php|\$\w+\s*=/m, 'php'],
  [/\bfunc\s+\w+\(|package\s+main\b/m, 'go'],
  [/\bfn\s+\w+\(|let\s+mut\b|::<.*>/m, 'rust'],
]

function guessLanguage(code: string): string {
  for (const [re, lang] of LANG_HINTS) if (re.test(code)) return lang
  return ''
}

function inline(line: Line, ctx: PageContext): string {
  return renderInline(line.spans, { opts: ctx.opts, links: ctx.links } satisfies InlineContext)
}

/** Une líneas de un párrafo aplicando des-guionado y saltos configurables. */
function joinParagraph(lines: Line[], ctx: PageContext): string {
  let out = ''
  for (const line of lines) {
    const piece = inline(line, ctx)
    if (!piece) continue
    if (!out) {
      out = piece
      continue
    }
    if (ctx.opts.lineBreaks === 'preserve') {
      out += `  \n${piece}`
      continue
    }
    const hyphenated = /[\p{Ll}\p{Lu}]-$/u.test(out) && /^[\p{Ll}]/u.test(piece)
    if (ctx.opts.dehyphenate && hyphenated && !/\d-$/.test(out)) out = `${out.slice(0, -1)}${piece}`
    else out += ` ${piece}`
  }
  if (!ctx.opts.normalizeWhitespace) return out.trim()
  return tidySpacing(mergeAdjacentEmphasis(out.replace(/[ \t]{2,}/g, ' '))).trim()
}

function buildCode(block: Line[], ctx: PageContext): MdNode {
  const minX = Math.min(...block.map((l) => l.x0))
  const widths = block.flatMap((l) => l.spans.filter((s) => s.str.length).map((s) => s.w / s.str.length))
  const charWidth = median(widths) || ctx.bodySize * 0.6
  const lines = block.map((l) => {
    const indent = Math.max(0, Math.round((l.x0 - minX) / charWidth))
    return ' '.repeat(indent) + l.spans.map((s) => s.str).join('').replace(/\s+$/, '')
  })
  const text = lines.join('\n')
  return { type: 'code', text, lang: guessLanguage(text), page: ctx.pageIndex }
}

function buildList(block: Line[], ctx: PageContext): MdNode | null {
  const markers = block.map(matchMarker)
  const starts = markers.map((m, i) => (m ? i : -1)).filter((i) => i >= 0)
  if (!starts.length) return null
  if (starts.length === 1 && !plausibleListStart(markers[starts[0]]!)) return null

  const tiers: number[] = []
  for (const i of starts) {
    const x = block[i].x0
    if (!tiers.some((t) => Math.abs(t - x) <= 6)) tiers.push(x)
  }
  tiers.sort((a, b) => a - b)

  const items: ListItem[] = []
  let current: { marker: Marker; lines: Line[]; depth: number } | null = null
  const flush = () => {
    if (!current) return
    const rendered = renderItem(current.marker, current.lines, ctx)
    items.push({ md: rendered, depth: current.depth, ordered: current.marker.ordered, marker: current.marker.marker, children: [] })
    current = null
  }

  for (let i = 0; i < block.length; i++) {
    const marker = markers[i]
    if (marker) {
      flush()
      const depth = tiers.findIndex((t) => Math.abs(t - block[i].x0) <= 6)
      current = { marker, lines: [block[i]], depth: Math.max(0, depth) }
    } else if (current) {
      current.lines.push(block[i])
    } else {
      return null // texto suelto antes del primer marcador: no es una lista limpia
    }
  }
  flush()
  if (!items.length) return null

  const ordered = items[0].ordered
  const start = ordered ? parseInt(items[0].marker, 10) || 1 : 1
  return { type: 'list', ordered, start, items, page: ctx.pageIndex }
}

/** Renderiza el contenido de un elemento, quitando el marcador de viñeta. */
function renderItem(marker: Marker, lines: Line[], ctx: PageContext): string {
  const [first, ...rest] = lines
  const firstMd = renderInline(stripMarkerSpans(first.spans, marker), { opts: ctx.opts, links: ctx.links })
  const tail = rest.length ? joinParagraph(rest, ctx) : ''
  if (!tail) return firstMd
  const hyphenated = /[\p{Ll}\p{Lu}]-$/u.test(firstMd) && /^[\p{Ll}]/u.test(tail)
  const joined = ctx.opts.dehyphenate && hyphenated ? `${firstMd.slice(0, -1)}${tail}` : `${firstMd} ${tail}`
  return mergeAdjacentEmphasis(joined)
}

/**
 * Descarta los caracteres del marcador recorriendo los spans, no la cadena ya
 * marcada: así el énfasis y los enlaces sobreviven intactos.
 */
function stripMarkerSpans(spans: Span[], marker: Marker): Span[] {
  const wanted = marker.rawMarker.replace(/\s+/g, '')
  const out: Span[] = []
  let matched = 0

  for (const span of spans) {
    if (matched >= wanted.length) {
      out.push(span)
      continue
    }
    let cut = 0
    while (cut < span.str.length && matched < wanted.length) {
      const ch = span.str[cut]
      if (/\s/.test(ch)) {
        cut++
        continue
      }
      if (ch !== wanted[matched]) break
      matched++
      cut++
    }
    const rest = span.str.slice(cut).replace(/^\s+/, '')
    if (!rest) continue
    const ratio = cut / Math.max(1, span.str.length)
    out.push({ ...span, str: rest, x: span.x + span.w * ratio, w: span.w * (1 - ratio) })
  }

  return out.length ? out : spans
}

/** Quita el énfasis que envuelve la línea completa (títulos íntegramente en negrita). */
function unwrapEmphasis(md: string): string {
  const m = /^(\*{1,3})([\s\S]+)\1$/.exec(md.trim())
  if (!m) return md
  return m[2].includes(m[1]) ? md : m[2]
}

function isQuote(block: Line[], ctx: PageContext): boolean {
  if (!ctx.opts.detectQuotes) return false
  const margins = marginsFor(ctx, block[0].column)
  const x0 = Math.min(...block.map((l) => l.x0))
  const x1 = Math.max(...block.map((l) => l.x1))
  const size = Math.max(...block.map((l) => l.size))
  const indentLeft = x0 - margins.left
  const indentRight = margins.right - x1
  if (size > ctx.bodySize * 1.04) return false
  if (indentLeft < ctx.bodySize * 1.5) return false
  const italic = block.reduce((a, l) => a + l.italicRatio, 0) / block.length
  return indentRight > ctx.bodySize * 0.6 || italic > 0.6 || block.length >= 2
}

function classifyBlock(block: Line[], ctx: PageContext): MdNode[] {
  const text = block.map((l) => l.text).join(' ').trim()
  if (!text) return []

  const monoRatio = block.reduce((a, l) => a + l.monoRatio * Math.max(1, l.text.length), 0) / Math.max(1, text.length)
  if (ctx.opts.detectCode && monoRatio > 0.65 && text.length > 3) return [buildCode(block, ctx)]

  const heading = isHeadingCandidate(block, ctx)
  const headingWins =
    !!heading &&
    (Math.max(...block.map((l) => l.size)) > ctx.bodySize * 1.08 ||
      block.reduce((a, l) => a + l.boldRatio, 0) / block.length > 0.7)

  if (ctx.opts.detectLists && matchMarker(block[0]) && !headingWins) {
    const list = buildList(block, ctx)
    if (list) return [list]
  }

  if (heading) {
    const fullyBold = block.reduce((a, l) => a + l.boldRatio, 0) / block.length > 0.88
    const headingCtx: PageContext = fullyBold ? { ...ctx, opts: { ...ctx.opts, preserveEmphasis: false } } : ctx
    const md = unwrapEmphasis(block.map((l) => inline(l, headingCtx)).join(' ').replace(/\s+/g, ' ').trim())
    return [{ type: 'heading', level: heading.level, md, text, page: ctx.pageIndex }]
  }

  if (ctx.opts.detectCaptions && CAPTION_RE.test(text) && block.length <= 4 && text.length < 400) {
    return [{ type: 'caption', md: joinParagraph(block, ctx), page: ctx.pageIndex }]
  }

  if (ctx.opts.math === 'latex') {
    const mathRatio = block.reduce((a, l) => a + l.mathRatio, 0) / block.length
    const { left, right } = marginsFor(ctx, block[0].column)
    const centered = block.every((l) => Math.abs((l.x0 + l.x1) / 2 - (left + right) / 2) < ctx.bodySize * 2.5)
    if ((mathRatio > 0.45 || (centered && looksMathematical(text))) && text.length < 400 && block.length <= 4) {
      return [{ type: 'math', tex: unicodeToLatex(text), page: ctx.pageIndex }]
    }
  }

  if (isQuote(block, ctx)) return [{ type: 'quote', md: joinParagraph(block, ctx), page: ctx.pageIndex }]

  const md = escapeLineStart(joinParagraph(block, ctx))
  return md ? [{ type: 'paragraph', md, page: ctx.pageIndex }] : []
}

function shouldBreak(prev: Line, line: Line, block: Line[], ctx: PageContext): boolean {
  if (prev.column !== line.column) return true
  const delta = line.baseline - prev.baseline
  if (delta < 0) return true
  if (delta > ctx.leading * 1.42) return true
  if (line.size / prev.size > 1.14 || line.size / prev.size < 0.87) return true
  if (Math.abs(line.boldRatio - prev.boldRatio) > 0.55) return true
  if (Math.abs(line.monoRatio - prev.monoRatio) > 0.55) return true
  if (ctx.opts.detectLists && matchMarker(line) && !matchMarker(prev)) {
    // Una viñeta abre bloque salvo que continúe una lista ya iniciada.
    if (!block.some((l) => matchMarker(l))) return true
  }
  const blockRight = Math.max(...block.map((l) => l.x1))
  const blockLeft = Math.min(...block.map((l) => l.x0))
  if (prev.x1 < blockRight - prev.size * 2.5 && SENTENCE_END_RE.test(prev.text)) return true
  if (line.x0 - blockLeft > prev.size * 0.9 && SENTENCE_END_RE.test(prev.text)) return true
  return false
}

function splitBlocks(lines: Line[], ctx: PageContext): Line[][] {
  const blocks: Line[][] = []
  let current: Line[] = []
  for (const line of lines) {
    if (!current.length) {
      current = [line]
      continue
    }
    if (shouldBreak(current[current.length - 1], line, current, ctx)) {
      blocks.push(current)
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length) blocks.push(current)
  return blocks
}

/** Márgenes de cada columna presente en la página. */
export function marginsByColumn(lines: Line[], geometry: PageGeometry, bodySize: number): Map<number, { left: number; right: number }> {
  const groups = new Map<number, Line[]>()
  for (const line of lines) {
    const bucket = groups.get(line.column)
    if (bucket) bucket.push(line)
    else groups.set(line.column, [line])
  }
  const out = new Map<number, { left: number; right: number }>()
  for (const [column, group] of groups) out.set(column, bodyMargins(group, geometry, bodySize))
  return out
}

/** Margen izquierdo y derecho del cuerpo de texto de la página. */
export function bodyMargins(lines: Line[], geometry: PageGeometry, bodySize: number): { left: number; right: number } {
  const body = lines.filter((l) => Math.abs(l.size - bodySize) <= bodySize * 0.18 && l.text.length > 20)
  const source = body.length >= 3 ? body : lines
  if (!source.length) return { left: geometry.width * 0.1, right: geometry.width * 0.9 }
  const left = weightedMode(source.map((l) => [Math.round(l.x0 / 3) * 3, l.text.length] as [number, number]))
  const right = Math.max(...source.map((l) => l.x1))
  return { left: left ?? Math.min(...source.map((l) => l.x0)), right }
}

export interface PageAnalysis {
  nodes: MdNode[]
  footnotes: { label: string; number: string; md: string }[]
  tables: number
  lists: number
  headings: number
  codeBlocks: number
}

/** Convierte las líneas de una página en nodos Markdown estructurados. */
export function analyzePage(lines: Line[], ctx: PageContext): PageAnalysis {
  const result: PageAnalysis = { nodes: [], footnotes: [], tables: 0, lists: 0, headings: 0, codeBlocks: 0 }
  if (!lines.length) return result

  let body = lines
  const footnoteLines: Line[] = []

  if (ctx.opts.detectFootnotes) {
    const zoneTop = ctx.geometry.height * 0.74
    const separators = ctx.rules.filter(
      (r) => r.horizontal && r.y0 > zoneTop && r.x1 - r.x0 < ctx.geometry.width * 0.55 && r.x0 < ctx.geometry.width * 0.5,
    )
    const cut = separators.length ? Math.min(...separators.map((r) => r.y0)) : Infinity
    const candidates = lines.filter(
      (l) => l.top > Math.min(cut, ctx.geometry.height * 0.8) && l.size <= ctx.bodySize * 0.93 && l.text.length > 2,
    )
    if (candidates.length && (Number.isFinite(cut) || candidates.some((l) => /^[\d*†‡§¶]/.test(l.text)))) {
      footnoteLines.push(...candidates)
      const set = new Set(candidates)
      body = lines.filter((l) => !set.has(l))
    }
  }

  const tableRegions: TableRegion[] = ctx.opts.detectTables ? findTableRegions(body, ctx.leading, ctx.bodySize, ctx.rules) : []
  const claimed = new Set<number>()
  for (const region of tableRegions) for (let i = region.start; i < region.end; i++) claimed.add(i)

  const images = [...ctx.images].sort((a, b) => a.rect.y0 - b.rect.y0)
  let imageCursor = 0
  const emitImagesBefore = (y: number) => {
    while (imageCursor < images.length && images[imageCursor].rect.y0 <= y) {
      result.nodes.push({ type: 'image', ref: images[imageCursor], page: ctx.pageIndex })
      imageCursor++
    }
  }

  let i = 0
  while (i < body.length) {
    const region = tableRegions.find((r) => r.start === i)
    if (region) {
      emitImagesBefore(body[i].top)
      const table = buildTable(body, region, { opts: ctx.opts, links: ctx.links }, ctx.opts, ctx.leading)
      if (table) {
        result.nodes.push({ type: 'table', header: table.header, rows: table.rows, align: table.align, page: ctx.pageIndex })
        result.tables++
        i = region.end
        continue
      }
      claimed.delete(i)
    }

    // Bloque de texto normal: agrupa hasta la próxima región tabular.
    const nextTable = tableRegions.find((r) => r.start > i)
    const limit = nextTable ? nextTable.start : body.length
    const slice = body.slice(i, limit).filter((_, k) => !claimed.has(i + k))
    for (const block of splitBlocks(slice, ctx)) {
      emitImagesBefore(block[0].top)
      const nodes = classifyBlock(block, ctx)
      for (const node of nodes) {
        if (node.type === 'heading') result.headings++
        if (node.type === 'list') result.lists++
        if (node.type === 'code') result.codeBlocks++
        result.nodes.push(node)
      }
    }
    i = limit
  }

  emitImagesBefore(Infinity)

  if (footnoteLines.length) {
    for (const group of splitBlocks(footnoteLines, ctx)) {
      const raw = group.map((l) => l.text).join(' ').trim()
      const m = /^([\d]{1,3}|[*†‡§¶]{1,3})[.)]?\s+/.exec(raw)
      const number = m ? m[1] : String(result.footnotes.length + 1)
      const label = `nota-${ctx.pageIndex}-${number}`
      let md = joinParagraph(group, ctx)
      if (m) md = md.replace(/^[\s\\*`]*/, '').replace(new RegExp(`^${number.replace(/[*†‡§¶]/g, '\\$&')}[.)]?\\s*`), '')
      result.footnotes.push({ label, number, md: md.trim() })
    }
  }

  return result
}
