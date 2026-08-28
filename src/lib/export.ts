import type { ConversionResult } from '../core/types'

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadText(fileName: string, text: string, mime = 'text/markdown;charset=utf-8') {
  downloadBlob(fileName, new Blob([text], { type: mime }))
}

export function markdownFileName(source: string): string {
  return `${source.replace(/\.pdf$/i, '') || 'documento'}.md`
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export interface ZipEntry {
  name: string
  result: ConversionResult
}

/** Empaqueta uno o varios documentos con sus imágenes en un único ZIP. */
export async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const multiple = entries.length > 1

  for (const entry of entries) {
    const base = entry.name.replace(/\.pdf$/i, '') || 'documento'
    const folder = multiple ? zip.folder(base) : zip
    if (!folder) continue
    folder.file(`${base}.md`, entry.result.markdown)
    for (const image of entry.result.images) {
      if (image.blob) folder.file(image.path, image.blob)
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** Informe de conversión en texto plano, útil para auditar el resultado. */
export function buildReport(name: string, result: ConversionResult): string {
  const s = result.stats
  return [
    `Informe de conversión — ${name}`,
    ''.padEnd(40, '-'),
    `Páginas procesadas: ${s.pages}`,
    `Columnas detectadas: ${s.columnsDetected}`,
    `Cuerpo de texto: ${s.bodyFontSize} pt`,
    `Títulos: ${s.headings}`,
    `Tablas: ${s.tables}`,
    `Listas: ${s.lists}`,
    `Bloques de código: ${s.codeBlocks}`,
    `Imágenes: ${s.images}`,
    `Notas al pie: ${s.footnotes}`,
    `Páginas escaneadas: ${s.scannedPages} (OCR aplicado a ${s.ocrPages})`,
    `Palabras: ${s.words}`,
    `Duración: ${(s.durationMs / 1000).toFixed(2)} s`,
    '',
    result.warnings.length ? `Avisos:\n${result.warnings.map((w) => `  · ${w}`).join('\n')}` : 'Sin avisos.',
  ].join('\n')
}
