import type { Rect } from './util'

/** Un fragmento de texto con su geometría y tipografía resueltas. */
export interface Span {
  str: string
  /** Borde izquierdo en puntos, origen arriba-izquierda. */
  x: number
  /** Línea base, origen arriba-izquierda. */
  y: number
  w: number
  size: number
  font: string
  bold: boolean
  italic: boolean
  mono: boolean
  serif: boolean
  math: boolean
  /** Rotación en radianes; 0 para texto horizontal. */
  angle: number
  /** Desplazamiento vertical respecto a la línea base dominante. */
  script: 'normal' | 'sup' | 'sub'
  link?: string
}

/** Una línea física reconstruida a partir de spans contiguos. */
export interface Line {
  spans: Span[]
  text: string
  x0: number
  x1: number
  baseline: number
  top: number
  bottom: number
  size: number
  boldRatio: number
  italicRatio: number
  monoRatio: number
  mathRatio: number
  capsRatio: number
  page: number
  /** Fila del índice de columna asignado por el análisis de maquetación. */
  column: number
}

/** Segmento recto extraído del listado de operadores (bordes de tabla, filetes). */
export interface Rule {
  x0: number
  y0: number
  x1: number
  y1: number
  horizontal: boolean
  thickness: number
}

export interface ImageRef {
  id: string
  page: number
  rect: Rect
  /** PNG resultante del recorte de la página renderizada. */
  blob?: Blob
  dataUrl?: string
  width: number
  height: number
  alt: string
  path: string
}

export interface LinkArea {
  rect: Rect
  url: string
}

export interface PageGeometry {
  width: number
  height: number
  rotation: number
}

/** Contenido crudo de una página antes del análisis de maquetación. */
export interface RawPage {
  index: number
  geometry: PageGeometry
  spans: Span[]
  rules: Rule[]
  images: ImageRef[]
  links: LinkArea[]
  /** Verdadero si la página parece un escaneo (sin texto extraíble). */
  scanned: boolean
  charCount: number
}

export type Align = 'left' | 'center' | 'right'

export type MdNode =
  | { type: 'heading'; level: number; md: string; text: string; page: number }
  | { type: 'paragraph'; md: string; page: number }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[]; page: number }
  | { type: 'code'; text: string; lang: string; page: number }
  | { type: 'table'; header: string[] | null; rows: string[][]; align: Align[]; page: number }
  | { type: 'quote'; md: string; page: number }
  | { type: 'image'; ref: ImageRef; page: number }
  | { type: 'caption'; md: string; page: number }
  | { type: 'math'; tex: string; page: number }
  | { type: 'hr'; page: number }
  | { type: 'footnote'; label: string; md: string; page: number }
  | { type: 'pagebreak'; page: number }

export interface ListItem {
  md: string
  depth: number
  ordered: boolean
  marker: string
  children: ListItem[]
}

export interface DocumentMeta {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  modificationDate?: string
  pages: number
  fileName: string
  fileSize: number
}

export interface ConversionStats {
  pages: number
  scannedPages: number
  ocrPages: number
  headings: number
  tables: number
  lists: number
  images: number
  codeBlocks: number
  footnotes: number
  words: number
  characters: number
  durationMs: number
  bodyFontSize: number
  columnsDetected: number
}

export interface ConversionResult {
  markdown: string
  nodes: MdNode[]
  meta: DocumentMeta
  stats: ConversionStats
  images: ImageRef[]
  outline: { level: number; text: string; page: number }[]
  warnings: string[]
}

export type ProgressStage =
  | 'loading'
  | 'extracting'
  | 'ocr'
  | 'layout'
  | 'rendering'
  | 'emitting'
  | 'done'

export interface Progress {
  stage: ProgressStage
  page: number
  pages: number
  detail: string
  ratio: number
}
