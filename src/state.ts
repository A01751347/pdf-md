import type { PdfSession } from './core/convert'
import type { ConversionResult, Progress } from './core/types'

export type DocStatus = 'loading' | 'ready' | 'working' | 'done' | 'error' | 'locked'

export interface DocEntry {
  id: string
  file: File
  session: PdfSession | null
  pages: number
  status: DocStatus
  result: ConversionResult | null
  error: string | null
  progress: Progress | null
  stale: boolean
}

let counter = 0
export const nextId = () => `doc-${++counter}-${Date.now().toString(36)}`

export function statusLabel(entry: DocEntry): string {
  switch (entry.status) {
    case 'loading':
      return 'Abriendo…'
    case 'ready':
      return `${entry.pages} pág.`
    case 'working':
      return entry.progress?.detail ?? 'Convirtiendo…'
    case 'done':
      return `${entry.pages} pág. · ${entry.result?.stats.words.toLocaleString('es') ?? 0} palabras`
    case 'locked':
      return 'Protegido con contraseña'
    case 'error':
      return entry.error ?? 'Error'
  }
}
