/** Banco de pruebas en Node: convierte un PDF y vuelca el Markdown y las métricas. */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { PdfSession } from '../src/core/convert'
import type { ConvertOptions } from '../src/core/options'
import { renderMarkdown } from '../src/lib/markdown'
import { highlightMarkdown } from '../src/lib/highlight'

const target = process.argv[2]
if (!target) throw new Error('Uso: selftest <archivo.pdf> [json-de-opciones]')

const overrides: Partial<ConvertOptions> = process.argv[3] ? JSON.parse(process.argv[3]) : {}
const bytes = readFileSync(target)
const file = new File([new Uint8Array(bytes)], basename(target), { type: 'application/pdf' })

const session = await PdfSession.open(file)
const result = await session.convert({ images: 'skip', ocr: 'off', ...overrides })

console.log('===== MARKDOWN =====')
console.log(result.markdown)
console.log('===== STATS =====')
console.log(JSON.stringify(result.stats, null, 2))
console.log('===== AVISOS =====')
console.log(result.warnings.join('\n') || '(ninguno)')
console.log('===== ESQUEMA =====')
console.log(result.outline.map((h) => `${'  '.repeat(h.level - 1)}h${h.level} ${h.text}`).join('\n') || '(vacío)')
const preview = renderMarkdown(result.markdown)
const highlighted = highlightMarkdown(result.markdown)
console.log('===== VISTA PREVIA =====')
console.log(`html=${preview.html.length} car.  titulos=${preview.headings.length}  resaltado=${highlighted.length} car.`)
const leaked = /<script|onerror=|javascript:/i.exec(preview.html)
console.log(leaked ? `¡HTML no saneado!: ${leaked[0]}` : 'HTML saneado correctamente')
session.destroy()
