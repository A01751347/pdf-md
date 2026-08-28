/** Idiomas soportados por el motor OCR (códigos Tesseract). */
export const OCR_LANGUAGES = [
  { code: 'spa', label: 'Español' },
  { code: 'eng', label: 'Inglés' },
  { code: 'por', label: 'Portugués' },
  { code: 'fra', label: 'Francés' },
  { code: 'deu', label: 'Alemán' },
  { code: 'ita', label: 'Italiano' },
  { code: 'cat', label: 'Catalán' },
  { code: 'nld', label: 'Neerlandés' },
  { code: 'rus', label: 'Ruso' },
  { code: 'chi_sim', label: 'Chino simplificado' },
  { code: 'jpn', label: 'Japonés' },
  { code: 'ara', label: 'Árabe' },
] as const

export interface ConvertOptions {
  /** Rango de páginas "1-5, 8, 12-" o vacío para todo el documento. */
  pageRange: string

  // --- Estructura ---
  detectHeadings: boolean
  normalizeHeadingLevels: boolean
  detectLists: boolean
  detectTables: boolean
  detectCode: boolean
  detectQuotes: boolean
  detectCaptions: boolean
  detectFootnotes: boolean
  detectColumns: boolean

  // --- Texto ---
  dehyphenate: boolean
  lineBreaks: 'join' | 'preserve'
  normalizeWhitespace: boolean
  asciiPunctuation: boolean
  preserveEmphasis: boolean
  preserveSuperscripts: boolean
  autolink: boolean
  keepLinks: boolean

  // --- Limpieza ---
  removeRepeatedHeaders: boolean
  removePageNumbers: boolean
  dropWatermarks: boolean

  // --- Tablas ---
  tableHeaderMode: 'auto' | 'first-row' | 'none'
  tableAlignment: boolean

  // --- Matemáticas ---
  math: 'plain' | 'latex'

  // --- Imágenes ---
  images: 'embed' | 'extract' | 'skip'
  imageScale: number
  minImageSize: number

  // --- OCR ---
  ocr: 'off' | 'auto' | 'force'
  ocrLanguage: string

  // --- Salida ---
  frontMatter: boolean
  pageSeparators: 'none' | 'comment' | 'rule'
  includeToc: boolean
  wrapWidth: number
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  pageRange: '',

  detectHeadings: true,
  normalizeHeadingLevels: true,
  detectLists: true,
  detectTables: true,
  detectCode: true,
  detectQuotes: true,
  detectCaptions: true,
  detectFootnotes: true,
  detectColumns: true,

  dehyphenate: true,
  lineBreaks: 'join',
  normalizeWhitespace: true,
  asciiPunctuation: false,
  preserveEmphasis: true,
  preserveSuperscripts: true,
  autolink: true,
  keepLinks: true,

  removeRepeatedHeaders: true,
  removePageNumbers: true,
  dropWatermarks: true,

  tableHeaderMode: 'auto',
  tableAlignment: true,

  math: 'plain',

  images: 'embed',
  imageScale: 2,
  minImageSize: 24,

  ocr: 'auto',
  ocrLanguage: 'spa',

  frontMatter: true,
  pageSeparators: 'none',
  includeToc: false,
  wrapWidth: 0,
}

export const PRESETS: { id: string; name: string; description: string; patch: Partial<ConvertOptions> }[] = [
  {
    id: 'balanced',
    name: 'Equilibrado',
    description: 'Ajustes recomendados para la mayoría de documentos.',
    patch: {},
  },
  {
    id: 'paper',
    name: 'Artículo académico',
    description: 'Dos columnas, notas al pie, fórmulas en LaTeX y sin encabezados repetidos.',
    patch: {
      detectColumns: true,
      detectFootnotes: true,
      math: 'latex',
      removeRepeatedHeaders: true,
      removePageNumbers: true,
      includeToc: false,
      preserveSuperscripts: true,
    },
  },
  {
    id: 'report',
    name: 'Informe / libro',
    description: 'Jerarquía de títulos normalizada, índice y separadores de página.',
    patch: {
      normalizeHeadingLevels: true,
      includeToc: true,
      pageSeparators: 'comment',
      detectCaptions: true,
    },
  },
  {
    id: 'scan',
    name: 'Escaneo (OCR)',
    description: 'Fuerza el reconocimiento óptico en todas las páginas.',
    patch: {
      ocr: 'force',
      detectTables: true,
      detectColumns: true,
      images: 'skip',
    },
  },
  {
    id: 'data',
    name: 'Tablas y datos',
    description: 'Máxima fidelidad en tablas, sin imágenes ni adornos.',
    patch: {
      detectTables: true,
      tableAlignment: true,
      tableHeaderMode: 'auto',
      images: 'skip',
      detectCaptions: false,
      frontMatter: false,
    },
  },
  {
    id: 'raw',
    name: 'Texto plano',
    description: 'Sin análisis estructural: solo el texto en orden de lectura.',
    patch: {
      detectHeadings: false,
      detectLists: false,
      detectTables: false,
      detectCode: false,
      detectQuotes: false,
      detectCaptions: false,
      detectFootnotes: false,
      images: 'skip',
      frontMatter: false,
      preserveEmphasis: false,
    },
  },
]

/** Expande "1-3, 7, 10-" a un conjunto de páginas 1-indexadas. */
export function parsePageRange(range: string, total: number): number[] {
  const trimmed = range.trim()
  if (!trimmed) return Array.from({ length: total }, (_, i) => i + 1)
  const wanted = new Set<number>()
  for (const part of trimmed.split(',')) {
    const chunk = part.trim()
    if (!chunk) continue
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(chunk)
    if (!m) continue
    const [, aRaw, dash, bRaw] = m
    if (!dash) {
      const p = Number(aRaw)
      if (p >= 1 && p <= total) wanted.add(p)
      continue
    }
    const from = aRaw ? Math.max(1, Number(aRaw)) : 1
    const to = bRaw ? Math.min(total, Number(bRaw)) : total
    for (let p = from; p <= to; p++) wanted.add(p)
  }
  const list = [...wanted].sort((a, b) => a - b)
  return list.length ? list : Array.from({ length: total }, (_, i) => i + 1)
}
