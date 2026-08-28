import type { Line, PageGeometry, RawPage, Span } from './types'
import { clamp, median, weightedMode } from './util'
import { looksTabular } from './tables'

/** Inserta un espacio cuando la separación geométrica lo justifica. */
export function joinSpans(spans: Span[]): string {
  let out = ''
  let prev: Span | null = null
  for (const s of spans) {
    if (prev) {
      const gap = s.x - (prev.x + prev.w)
      if (gap > 0.2 * Math.min(prev.size, s.size) && !/\s$/.test(out) && !/^\s/.test(s.str)) out += ' '
    }
    out += s.str
    prev = s
  }
  return out
}

function summarizeLine(spans: Span[], page: number, column: number): Line {
  const ordered = [...spans].sort((a, b) => a.x - b.x)
  const weights: [number, number][] = ordered.map((s) => [Math.round(s.size * 2) / 2, Math.max(1, s.str.trim().length)])
  const size = weightedMode(weights) ?? ordered[0].size
  const baseline = median(ordered.filter((s) => s.size >= size * 0.85).map((s) => s.y)) || ordered[0].y

  let chars = 0
  let bold = 0
  let italic = 0
  let mono = 0
  let math = 0
  let letters = 0
  let caps = 0
  for (const s of ordered) {
    const n = s.str.trim().length
    if (!n) continue
    chars += n
    if (s.bold) bold += n
    if (s.italic) italic += n
    if (s.mono) mono += n
    if (s.math) math += n
    for (const ch of s.str) {
      if (/\p{L}/u.test(ch)) {
        letters++
        if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) caps++
      }
    }
  }

  const top = Math.min(...ordered.map((s) => s.y - s.size * 0.86))
  const bottom = Math.max(...ordered.map((s) => s.y + s.size * 0.24))

  return {
    spans: ordered,
    text: joinSpans(ordered).replace(/\s+/g, ' ').trim(),
    x0: Math.min(...ordered.map((s) => s.x)),
    x1: Math.max(...ordered.map((s) => s.x + s.w)),
    baseline,
    top,
    bottom,
    size,
    boldRatio: chars ? bold / chars : 0,
    italicRatio: chars ? italic / chars : 0,
    monoRatio: chars ? mono / chars : 0,
    mathRatio: chars ? math / chars : 0,
    capsRatio: letters ? caps / letters : 0,
    page,
    column,
  }
}

/** Marca superíndices y subíndices comparando con la línea base dominante. */
function tagScripts(line: Line) {
  for (const s of line.spans) {
    if (s.size >= line.size * 0.86) continue
    const delta = s.y - line.baseline
    if (delta < -line.size * 0.14) s.script = 'sup'
    else if (delta > line.size * 0.1) s.script = 'sub'
  }
}

function clusterByBaseline(spans: Span[], page: number, column: number): Line[] {
  if (!spans.length) return []
  const sorted = [...spans].sort((a, b) => a.y - b.y || a.x - b.x)
  const groups: Span[][] = []
  let bucket: Span[] = [sorted[0]]
  let anchor = sorted[0].y
  let anchorSize = sorted[0].size

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]
    const tol = clamp(0.42 * Math.max(s.size, anchorSize), 1.4, 9)
    if (Math.abs(s.y - anchor) <= tol) {
      bucket.push(s)
      anchorSize = Math.max(anchorSize, s.size)
    } else {
      groups.push(bucket)
      bucket = [s]
      anchor = s.y
      anchorSize = s.size
    }
  }
  groups.push(bucket)

  const lines = groups.map((g) => summarizeLine(g, page, column))
  const merged = absorbFloatingScripts(lines, page, column)
  merged.forEach(tagScripts)
  return merged.sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0)
}

/** Reincorpora fragmentos sueltos (índices, llamadas de nota) a su línea. */
function absorbFloatingScripts(lines: Line[], page: number, column: number): Line[] {
  if (lines.length < 2) return lines
  const alive = lines.map((l) => ({ line: l, dead: false }))
  for (let i = 0; i < alive.length; i++) {
    const small = alive[i]
    if (small.dead) continue
    const l = small.line
    if (l.text.length > 4 || l.spans.length > 2) continue
    let best: { idx: number; score: number } | null = null
    for (let j = 0; j < alive.length; j++) {
      if (j === i || alive[j].dead) continue
      const host = alive[j].line
      if (host.text.length <= 4) continue
      if (l.size >= host.size * 0.88) continue
      const dy = Math.abs(l.baseline - host.baseline)
      if (dy > host.size * 0.8) continue
      const nearRight = l.x0 >= host.x0 - 2 && l.x0 <= host.x1 + host.size * 1.2
      const nearLeft = l.x1 >= host.x0 - host.size * 1.2 && l.x1 <= host.x1 + 2
      if (!nearRight && !nearLeft) continue
      const score = dy + Math.abs(l.x0 - host.x1) * 0.05
      if (!best || score < best.score) best = { idx: j, score }
    }
    if (best) {
      const host = alive[best.idx].line
      alive[best.idx].line = summarizeLine([...host.spans, ...l.spans], page, column)
      small.dead = true
    }
  }
  return alive.filter((a) => !a.dead).map((a) => a.line)
}

export interface ColumnLayout {
  gutters: { from: number; to: number }[]
  bounds: { x0: number; x1: number }[]
}

const SINGLE_COLUMN: ColumnLayout = { gutters: [], bounds: [] }

/**
 * Localiza calles verticales de blanco dentro de una banda homogénea usando un
 * perfil de ocupación. Solo se aceptan calles con contenido real a ambos lados.
 */
export function detectColumns(bandLines: Line[], geometry: PageGeometry, bodySize: number): ColumnLayout {
  if (bandLines.length < 4) return SINGLE_COLUMN
  const ink = bandLines.flatMap((l) => l.spans).filter((s) => s.str.trim())
  if (ink.length < 8) return SINGLE_COLUMN

  const BIN = 2
  const bins = Math.max(1, Math.ceil(geometry.width / BIN))
  const rows = bandLines.length
  const occ = new Uint8Array(bins * rows)

  bandLines.forEach((line, row) => {
    for (const span of line.spans) {
      if (!span.str.trim()) continue
      const from = clamp(Math.floor(span.x / BIN), 0, bins - 1)
      const to = clamp(Math.ceil((span.x + span.w) / BIN), 0, bins - 1)
      for (let b = from; b <= to; b++) occ[row * bins + b] = 1
    }
  })

  const density = new Float32Array(bins)
  for (let b = 0; b < bins; b++) {
    let count = 0
    for (let r = 0; r < rows; r++) count += occ[r * bins + b]
    density[b] = count / rows
  }

  const lo = Math.floor((geometry.width * 0.13) / BIN)
  const hi = Math.ceil((geometry.width * 0.87) / BIN)
  const minGutter = Math.max(5, Math.round((geometry.width * 0.03) / BIN))
  const candidates: { from: number; to: number; width: number }[] = []
  let run = -1
  for (let b = lo; b <= hi; b++) {
    const empty = density[b] <= 0.03
    if (empty && run < 0) run = b
    if ((!empty || b === hi) && run >= 0) {
      const last = empty ? b : b - 1
      if (last - run + 1 >= minGutter) {
        candidates.push({ from: run * BIN, to: (last + 1) * BIN, width: (last - run + 1) * BIN })
      }
      run = -1
    }
  }
  if (!candidates.length) return SINGLE_COLUMN

  candidates.sort((a, b) => b.width - a.width)
  const chosen = candidates.slice(0, 2).sort((a, b) => a.from - b.from)

  const edges = [0, ...chosen.flatMap((g) => [g.from, g.to]), geometry.width]
  const bounds: { x0: number; x1: number }[] = []
  for (let i = 0; i < edges.length; i += 2) bounds.push({ x0: edges[i], x1: edges[i + 1] })

  const totalChars = ink.reduce((n, s) => n + s.str.trim().length, 0)
  for (const bound of bounds) {
    let chars = 0
    for (const s of ink) {
      const cx = s.x + s.w / 2
      if (cx >= bound.x0 && cx <= bound.x1) chars += s.str.trim().length
    }
    // Cada columna debe aportar texto en varias líneas de la banda.
    const rowsUsed = bandLines.filter((line) =>
      line.spans.some((s) => {
        const cx = s.x + s.w / 2
        return s.str.trim() && cx >= bound.x0 && cx <= bound.x1
      }),
    ).length
    if (chars / totalChars < 0.12 || rowsUsed < 2) return SINGLE_COLUMN
  }

  return { gutters: chosen.map((g) => ({ from: g.from, to: g.to })), bounds }
}

/** Comprueba que ninguna línea de la banda atraviese las calles de la maqueta. */
function fitsLayout(band: Line[], layout: ColumnLayout): boolean {
  for (const gutter of layout.gutters) {
    const width = gutter.to - gutter.from
    for (const line of band) {
      for (const span of line.spans) {
        if (!span.str.trim()) continue
        const overlap = Math.min(span.x + span.w, gutter.to) - Math.max(span.x, gutter.from)
        if (overlap > width * 0.5) return false
      }
    }
  }
  return true
}

/** Parte la página en bandas separadas por blanco horizontal claro. */
function splitBands(lines: Line[], leading: number): Line[][] {
  const bands: Line[][] = []
  let current: Line[] = []
  for (const line of lines) {
    const prev = current[current.length - 1]
    if (prev && line.top - prev.bottom > leading * 0.85) {
      bands.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length) bands.push(current)
  return bands
}

/**
 * Construye las líneas de una página. Aplica un corte XY: primero separa
 * bandas horizontales y solo dentro de cada banda busca columnas, de modo que
 * un título o una figura a todo el ancho no invalida el resto de la página.
 */
export function buildPageLines(page: RawPage, bodySize: number, useColumns: boolean): { lines: Line[]; columns: number } {
  const rawLines = clusterByBaseline(page.spans, page.index, 0)
  if (!useColumns || rawLines.length < 4) return { lines: rawLines, columns: 1 }

  const leading = typicalLeading(rawLines) || bodySize * 1.2
  const out: Line[] = []
  let columns = 1
  let previous: ColumnLayout | null = null

  for (const band of splitBands(rawLines, leading)) {
    // Una tabla también deja calles verticales: se comprueba primero.
    let layout = looksTabular(band, bodySize) ? SINGLE_COLUMN : detectColumns(band, page.geometry, bodySize)
    // Una banda corta no aporta evidencia propia: hereda la maqueta anterior
    // siempre que ninguna línea invada la calle.
    if (layout.bounds.length < 2 && previous && fitsLayout(band, previous)) layout = previous
    if (layout.bounds.length < 2) {
      previous = null
      out.push(...band)
      continue
    }
    previous = layout
    columns = Math.max(columns, layout.bounds.length)

    const buckets: Span[][] = layout.bounds.map(() => [])
    const full: Span[] = []
    for (const span of band.flatMap((l) => l.spans)) {
      const cx = span.x + span.w / 2
      let index = layout.bounds.findIndex((b) => cx >= b.x0 && cx <= b.x1)
      if (index < 0) index = 0
      const bound = layout.bounds[index]
      const crosses = span.x < bound.x0 - 4 || span.x + span.w > bound.x1 + 4
      if (crosses && span.w > (bound.x1 - bound.x0) * 0.85) full.push(span)
      else buckets[index].push(span)
    }

    const columnLines = buckets.flatMap((b, i) => clusterByBaseline(b, page.index, i))
    const fullLines = clusterByBaseline(full, page.index, -1)
    out.push(...interleaveReadingOrder(columnLines, fullLines))
  }

  return { lines: out, columns }
}

/**
 * Ordena por bandas: las líneas a todo el ancho actúan como separadores y las
 * columnas se leen de arriba abajo dentro de cada banda.
 */
function interleaveReadingOrder(columnLines: Line[], fullLines: Line[]): Line[] {
  const all = [...columnLines, ...fullLines].sort((a, b) => a.top - b.top)
  const out: Line[] = []
  let buffer: Line[] = []
  const flush = () => {
    if (!buffer.length) return
    buffer.sort((a, b) => a.column - b.column || a.top - b.top || a.x0 - b.x0)
    out.push(...buffer)
    buffer = []
  }
  for (const line of all) {
    if (line.column === -1) {
      flush()
      out.push(line)
    } else {
      buffer.push(line)
    }
  }
  flush()
  return out
}

/** Tamaño de cuerpo del documento: moda de tamaños ponderada por caracteres. */
export function computeBodySize(pages: RawPage[]): number {
  const weights: [number, number][] = []
  for (const p of pages) {
    for (const s of p.spans) {
      const n = s.str.trim().length
      if (n) weights.push([Math.round(s.size * 2) / 2, n])
    }
  }
  return weightedMode(weights) ?? 10
}

/** Escala de tamaños mayores que el cuerpo, para mapear niveles de título. */
export function headingScale(pages: RawPage[], bodySize: number): number[] {
  const counts = new Map<number, number>()
  for (const p of pages) {
    for (const s of p.spans) {
      const n = s.str.trim().length
      if (!n) continue
      const size = Math.round(s.size * 2) / 2
      if (size > bodySize * 1.06) counts.set(size, (counts.get(size) ?? 0) + n)
    }
  }
  const minChars = 12
  return [...counts.entries()]
    .filter(([, n]) => n >= minChars)
    .map(([size]) => size)
    .sort((a, b) => b - a)
    .slice(0, 6)
}

const DIGIT_RE = /\d+/g

function fingerprint(text: string): string {
  return text.replace(DIGIT_RE, '#').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Detecta encabezados y pies recurrentes comparando la misma banda vertical
 * a lo largo del documento.
 */
export function findRunningHeads(pageLines: Line[][], geometries: PageGeometry[]): Set<string> {
  const drop = new Set<string>()
  const pages = pageLines.length
  if (pages < 3) return drop

  const tally = new Map<string, { count: number; keys: string[] }>()
  pageLines.forEach((lines, i) => {
    const h = geometries[i].height
    for (const line of lines) {
      const inHeader = line.bottom < h * 0.09
      const inFooter = line.top > h * 0.91
      if (!inHeader && !inFooter) continue
      const fp = `${inHeader ? 'H' : 'F'}|${fingerprint(line.text)}`
      if (fp.length < 4) continue
      const entry = tally.get(fp) ?? { count: 0, keys: [] }
      entry.count++
      entry.keys.push(lineKey(line))
      tally.set(fp, entry)
    }
  })

  const threshold = Math.max(2, Math.ceil(pages * 0.34))
  for (const entry of tally.values()) {
    if (entry.count >= threshold) entry.keys.forEach((k) => drop.add(k))
  }
  return drop
}

export function lineKey(line: Line): string {
  return `${line.page}:${Math.round(line.top)}:${Math.round(line.x0)}:${line.text.slice(0, 24)}`
}

const PAGE_NUMBER_RE = /^(?:[-–—[(]?\s*)?(?:p[áa]g(?:ina)?\.?\s*|page\s*|pp?\.\s*)?(\d{1,4}|[ivxlcdm]{1,7}|[IVXLCDM]{1,7})(?:\s*(?:\/|de|of)\s*\d{1,4})?\s*[-–—\])]?$/i

export function isPageNumber(line: Line, geometry: PageGeometry): boolean {
  if (line.text.length > 22) return false
  const inZone = line.top > geometry.height * 0.88 || line.bottom < geometry.height * 0.12
  return inZone && PAGE_NUMBER_RE.test(line.text.trim())
}

/** Separación vertical típica entre líneas de un mismo párrafo. */
export function typicalLeading(lines: Line[]): number {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1]
    const b = lines[i]
    if (a.column !== b.column) continue
    const d = b.baseline - a.baseline
    if (d > 0 && d < a.size * 3.2) gaps.push(d)
  }
  const m = median(gaps)
  return m > 0 ? m : 12
}

/** Solo para diagnóstico: expone el agrupado por línea base. */
export const clusterForDebug = (spans: Span[], page: number) => clusterByBaseline(spans, page, 0)
