import type { Align, Line, Rule, Span } from './types'
import type { ConvertOptions } from './options'
import { renderInline, type InlineContext } from './inline'
import { clamp, median } from './util'

export interface TableRegion {
  start: number
  end: number
  regions: { x0: number; x1: number }[]
  rules: Rule[]
}

export interface TableData {
  header: string[] | null
  rows: string[][]
  align: Align[]
}

const NUMERIC_RE = /^[\s$€£¥%()+\-±]*\d[\d\s.,']*\s*(?:%|€|\$|£|¥|pts?|kg|km|m|s|h|€\/\w+)?\s*[)]?$/i

/** Perfil de tinta por columna del grupo, para localizar separadores verticales. */
function inkProfile(lines: Line[], x0: number, x1: number) {
  const width = Math.max(1, Math.ceil(x1 - x0))
  const profile = new Float32Array(width)
  for (const line of lines) {
    const touched = new Uint8Array(width)
    for (const span of line.spans) {
      if (!span.str.trim()) continue
      const from = clamp(Math.floor(span.x - x0), 0, width - 1)
      const to = clamp(Math.ceil(span.x + span.w - x0), 0, width - 1)
      for (let i = from; i <= to; i++) touched[i] = 1
    }
    for (let i = 0; i < width; i++) profile[i] += touched[i]
  }
  for (let i = 0; i < width; i++) profile[i] /= lines.length
  return profile
}

function findRegions(lines: Line[], bodySize: number): { x0: number; x1: number }[] {
  const x0 = Math.min(...lines.map((l) => l.x0))
  const x1 = Math.max(...lines.map((l) => l.x1))
  if (x1 - x0 < 40) return []
  const profile = inkProfile(lines, x0, x1)
  const minGap = Math.max(5, bodySize * 0.75)
  const gaps: { from: number; to: number }[] = []
  let run = -1
  for (let i = 0; i < profile.length; i++) {
    const empty = profile[i] <= 0.12
    if (empty && run < 0) run = i
    if ((!empty || i === profile.length - 1) && run >= 0) {
      const end = empty ? i : i - 1
      if (end - run + 1 >= minGap && run > 2 && end < profile.length - 3) gaps.push({ from: run, to: end })
      run = -1
    }
  }
  if (!gaps.length) return []
  const edges = [0, ...gaps.flatMap((g) => [g.from, g.to + 1]), profile.length]
  const regions: { x0: number; x1: number }[] = []
  for (let i = 0; i < edges.length; i += 2) {
    regions.push({ x0: x0 + edges[i], x1: x0 + edges[i + 1] })
  }
  return regions.filter((r) => r.x1 - r.x0 > 2)
}

/** Texto plano de una celda, usado para decidir alineación y validez. */
function cellText(line: Line, regions: { x0: number; x1: number }[], index: number): string {
  const region = regions[index]
  return line.spans
    .filter((s) => {
      const cx = s.x + s.w / 2
      return cx >= region.x0 - 1 && cx <= region.x1 + 1
    })
    .map((s) => s.str)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function filledRegions(line: Line, regions: { x0: number; x1: number }[]): number[] {
  const hit = new Set<number>()
  for (const span of line.spans) {
    if (!span.str.trim()) continue
    const cx = span.x + span.w / 2
    const idx = regions.findIndex((r) => cx >= r.x0 - 1 && cx <= r.x1 + 1)
    if (idx >= 0) hit.add(idx)
  }
  return [...hit].sort((a, b) => a - b)
}

/**
 * Busca regiones tabulares en una secuencia de líneas contiguas.
 * Una tabla exige al menos dos columnas separadas por blanco constante y
 * al menos dos filas que las usen.
 */
export function findTableRegions(lines: Line[], leading: number, bodySize: number, rules: Rule[]): TableRegion[] {
  const out: TableRegion[] = []
  let i = 0
  while (i < lines.length) {
    // Grupo de líneas contiguas: mismo bloque visual.
    let j = i + 1
    while (
      j < lines.length &&
      lines[j].column === lines[j - 1].column &&
      lines[j].top - lines[j - 1].bottom < leading * 1.6 &&
      lines[j].size <= lines[j - 1].size * 1.35 &&
      lines[j].size >= lines[j - 1].size * 0.7
    ) {
      j++
    }
    const group = lines.slice(i, j)
    if (group.length >= 2) {
      const region = evaluateGroup(group, i, bodySize, rules)
      if (region) {
        out.push(region)
        i = region.end
        continue
      }
    }
    i = j
  }
  return out
}

/**
 * Indica si una banda se comporta como una rejilla tabular. El análisis de
 * columnas la consulta antes de partir la página: una tabla es una estructura
 * más específica que una maqueta a varias columnas y tiene prioridad.
 */
export function looksTabular(lines: Line[], bodySize: number): boolean {
  return lines.length >= 2 && evaluateGroup(lines, 0, bodySize, []) !== null
}

function evaluateGroup(group: Line[], offset: number, bodySize: number, rules: Rule[]): TableRegion | null {
  const regions = findRegions(group, bodySize)
  if (regions.length < 2) return null

  const filled = group.map((l) => filledRegions(l, regions))
  const multi = filled.filter((f) => f.length >= 2).length
  if (multi < 2 || multi / group.length < 0.45) return null

  // Cada región debe usarse con cierta frecuencia.
  const usage = regions.map((_, idx) => filled.filter((f) => f.includes(idx)).length / group.length)
  if (usage.some((u) => u < 0.25)) return null

  // Recorta líneas iniciales y finales que no participan de la rejilla.
  let start = 0
  while (start < group.length && filled[start].length < 2) start++
  let end = group.length
  while (end > start && filled[end - 1].length < 2) end--
  if (end - start < 2) return null

  // El texto de celda debe ser corto: descarta párrafos maquetados a dos columnas.
  const rows = group.slice(start, end)
  const perCell = median(
    rows.map((l, k) => {
      const used = Math.max(1, filled[start + k].length)
      return l.text.split(/\s+/).filter(Boolean).length / used
    }),
  )
  const numericColumn = regions.some((_, idx) =>
    rows.filter((l) => {
      const text = cellText(l, regions, idx)
      return text && NUMERIC_RE.test(text)
    }).length >= Math.max(2, rows.length * 0.5),
  )
  if (perCell > (regions.length >= 3 ? 8 : 5) && !numericColumn) return null

  const bbox = {
    top: Math.min(...rows.map((l) => l.top)),
    bottom: Math.max(...rows.map((l) => l.bottom)),
    x0: Math.min(...rows.map((l) => l.x0)),
    x1: Math.max(...rows.map((l) => l.x1)),
  }
  const inner = rules.filter(
    (r) => r.horizontal && r.y0 >= bbox.top - 6 && r.y0 <= bbox.bottom + 6 && r.x1 - r.x0 > (bbox.x1 - bbox.x0) * 0.55,
  )

  return { start: offset + start, end: offset + end, regions, rules: inner }
}

/** Construye la tabla Markdown a partir de la región detectada. */
export function buildTable(
  lines: Line[],
  region: TableRegion,
  ctx: InlineContext,
  opts: ConvertOptions,
  leading: number,
): TableData | null {
  const body = lines.slice(region.start, region.end)
  if (body.length < 2) return null

  const rowGroups = region.rules.length >= 2 ? groupByRules(body, region.rules) : groupByContinuation(body, region.regions, leading)
  if (rowGroups.length < 2) return null

  const cols = region.regions.length
  const rows: string[][] = rowGroups.map((group) => {
    const cells: Span[][] = Array.from({ length: cols }, () => [])
    for (const line of group) {
      for (const span of line.spans) {
        if (!span.str.trim()) continue
        const cx = span.x + span.w / 2
        let idx = region.regions.findIndex((r) => cx >= r.x0 - 1 && cx <= r.x1 + 1)
        if (idx < 0) idx = cx < region.regions[0].x0 ? 0 : cols - 1
        cells[idx].push(span)
      }
    }
    return cells.map((spans) => renderInline(spans.sort((a, b) => a.y - b.y || a.x - b.x), { ...ctx, inTable: true }).replace(/\s+/g, ' ').trim())
  })

  const nonEmpty = rows.filter((r) => r.some((c) => c))
  if (nonEmpty.length < 2) return null

  // GFM ya realza la cabecera: el énfasis explícito sobra.
  const header = pickHeader(nonEmpty, rowGroups, opts)?.map((cell) => cell.replace(/^\*\*([^*]+)\*\*$/, '$1')) ?? null
  const dataRows = header ? nonEmpty.slice(1) : nonEmpty
  if (!dataRows.length) return null

  const align: Align[] = Array.from({ length: cols }, (_, c) => {
    if (!opts.tableAlignment) return 'left'
    const values = dataRows.map((r) => r[c]).filter(Boolean)
    if (!values.length) return 'left'
    const numeric = values.filter((v) => NUMERIC_RE.test(v)).length
    return numeric / values.length >= 0.6 ? 'right' : 'left'
  })

  return { header, rows: dataRows, align }
}

function groupByRules(lines: Line[], rules: Rule[]): Line[][] {
  const ys = [...new Set(rules.map((r) => Math.round(r.y0)))].sort((a, b) => a - b)
  const groups: Line[][] = []
  for (const line of lines) {
    const band = ys.filter((y) => y < line.baseline).length
    ;(groups[band] ??= []).push(line)
  }
  return groups.filter((g) => g && g.length)
}

function groupByContinuation(lines: Line[], regions: { x0: number; x1: number }[], leading: number): Line[][] {
  const groups: Line[][] = []
  for (const line of lines) {
    const filled = filledRegions(line, regions)
    const prev = groups[groups.length - 1]
    const gap = prev ? line.top - prev[prev.length - 1].bottom : Infinity
    const isContinuation = prev && filled.length < 2 && gap < leading * 0.9
    if (isContinuation) prev.push(line)
    else groups.push([line])
  }
  return groups
}

function pickHeader(rows: string[][], groups: Line[][], opts: ConvertOptions): string[] | null {
  if (opts.tableHeaderMode === 'none') return null
  if (opts.tableHeaderMode === 'first-row') return rows[0]
  if (rows.length < 2) return null

  const first = groups[0] ?? []
  const rest = groups.slice(1).flat()
  const firstBold = first.length ? first.reduce((a, l) => a + l.boldRatio, 0) / first.length : 0
  const restBold = rest.length ? rest.reduce((a, l) => a + l.boldRatio, 0) / rest.length : 0
  if (firstBold > 0.55 && firstBold - restBold > 0.3) return rows[0]

  const firstNumeric = rows[0].filter((c) => c && NUMERIC_RE.test(c)).length
  const bodyNumeric = rows.slice(1).flat().filter((c) => c && NUMERIC_RE.test(c)).length
  const bodyCells = rows.slice(1).flat().filter(Boolean).length
  if (firstNumeric === 0 && bodyCells > 0 && bodyNumeric / bodyCells > 0.35) return rows[0]

  return rows[0].every((c) => c.length > 0 && c.length < 42) ? rows[0] : null
}

export function renderTable(table: TableData): string {
  const cols = Math.max(table.header?.length ?? 0, ...table.rows.map((r) => r.length))
  const pad = (row: string[]) => Array.from({ length: cols }, (_, i) => (row[i] ?? '').trim() || ' ')
  const header = table.header ? pad(table.header) : Array.from({ length: cols }, () => ' ')
  const sep = Array.from({ length: cols }, (_, i) => {
    const a = table.align[i] ?? 'left'
    return a === 'right' ? '---:' : a === 'center' ? ':---:' : '---'
  })
  const lines = [`| ${header.join(' | ')} |`, `| ${sep.join(' | ')} |`]
  for (const row of table.rows) lines.push(`| ${pad(row).join(' | ')} |`)
  return lines.join('\n')
}
