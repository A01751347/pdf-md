/** Utilidades numéricas, geométricas y de texto compartidas por el motor. */

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

export function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Moda ponderada: devuelve la clave con mayor peso acumulado. */
export function weightedMode<T>(entries: Iterable<[T, number]>): T | undefined {
  let best: T | undefined
  let bestW = -Infinity
  const acc = new Map<T, number>()
  for (const [k, w] of entries) acc.set(k, (acc.get(k) ?? 0) + w)
  for (const [k, w] of acc) {
    if (w > bestW) {
      bestW = w
      best = k
    }
  }
  return best
}

/**
 * Agrupa valores en clústeres 1-D usando un umbral de separación.
 * Devuelve los centros ordenados junto al peso de cada clúster.
 */
export function cluster1d(values: number[], tolerance: number): { center: number; count: number; min: number; max: number }[] {
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const out: { center: number; count: number; min: number; max: number }[] = []
  let bucket: number[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - bucket[bucket.length - 1] <= tolerance) bucket.push(sorted[i])
    else {
      out.push(summarize(bucket))
      bucket = [sorted[i]]
    }
  }
  out.push(summarize(bucket))
  return out
}

function summarize(bucket: number[]) {
  return {
    center: mean(bucket),
    count: bucket.length,
    min: bucket[0],
    max: bucket[bucket.length - 1],
  }
}

export const rectWidth = (r: Rect) => r.x1 - r.x0
export const rectHeight = (r: Rect) => r.y1 - r.y0
export const rectArea = (r: Rect) => Math.max(0, rectWidth(r)) * Math.max(0, rectHeight(r))

export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) }
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null
}

export function rectUnion(a: Rect, b: Rect): Rect {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
}

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
  'ﬅ': 'st', 'ﬆ': 'st', 'Ĳ': 'IJ', 'ĳ': 'ij', 'Œ': 'OE', 'œ': 'oe',
  'Ω': 'Ω', 'Å': 'Å',
}

const SPACE_LIKE = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g

/** Normaliza texto crudo del PDF: ligaduras, espacios exóticos y guiones invisibles. */
export function normalizeGlyphs(input: string): string {
  let s = input
  if (/[ﬀ-ﬆĲĳŒœΩÅ]/.test(s)) {
    s = s.replace(/[ﬀ-ﬆĲĳŒœΩÅ]/g, (c) => LIGATURES[c] ?? c)
  }
  s = s.replace(SPACE_LIKE, ' ')
  s = s.replace(/\u00ad/g, '') // guion suave
  s = s.replace(/[\u200b-\u200d\ufeff]/g, '') // anchos cero
  return s
}

/** Comillas y guiones tipográficos → ASCII. */
export function asciiPunctuation(input: string): string {
  return input
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/–/g, '-')
    .replace(/—/g, '--')
    .replace(/…/g, '...')
}

/** Escapa caracteres que Markdown interpretaría, sin romper texto normal. */
export function escapeMarkdown(text: string, inTable = false): string {
  let out = text
    .replace(/\\/g, '\\\\')
    .replace(/([*`~])/g, '\\$1')
    .replace(/([[\]])/g, '\\$1')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Guion bajo solo es énfasis en los bordes de palabra.
  out = out.replace(/(^|[\s(])_/g, '$1\\_').replace(/_($|[\s).,;:!?])/g, '\\_$1')
  if (inTable) out = out.replace(/\|/g, '\\|')
  return out
}

/** Escapa un inicio de línea que Markdown leería como lista, cita o título. */
export function escapeLineStart(text: string): string {
  return text
    .replace(/^(\s*)(#{1,6})(\s)/, '$1\\$2$3')
    .replace(/^(\s*)([-+])(\s)/, '$1\\$2$3')
    .replace(/^(\s*)(\d{1,9})([.)])(\s)/, '$1$2\\$3$4')
    .replace(/^(\s*)(>)/, '$1\\$2')
    .replace(/^(\s*)(={2,}|-{3,}|_{3,})\s*$/, '$1\\$2')
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64) || 'documento'
}

export function collapseSpaces(text: string): string {
  return text.replace(/[ \t]+/g, ' ').trim()
}

/** Cede el hilo para que la interfaz siga respondiendo durante lotes largos. */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / Math.pow(1024, i)
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
