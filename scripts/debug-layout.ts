import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { loadPdf, extractPage } from '../src/core/extract'
import { computeBodySize, detectColumns, typicalLeading } from '../src/core/layout'
import { DEFAULT_OPTIONS } from '../src/core/options'
import type { Line, RawPage } from '../src/core/types'

const target = process.argv[2]
const pageNo = Number(process.argv[3] ?? 2)
const bytes = readFileSync(target)
const { doc } = await loadPdf(new Uint8Array(bytes).buffer as ArrayBuffer)
void basename

const raws: RawPage[] = []
for (let p = 1; p <= doc.numPages; p++) raws.push(await extractPage(await doc.getPage(p), { ...DEFAULT_OPTIONS, images: 'skip' }))
const body = computeBodySize(raws)
const page = raws[pageNo - 1]

const { clusterForDebug } = await import('../src/core/layout')
const lines: Line[] = clusterForDebug(page.spans, page.index)
const leading = typicalLeading(lines)
console.log(`cuerpo=${body}pt  leading=${leading.toFixed(1)}  líneas=${lines.length}`)

let band: Line[] = []
const bands: Line[][] = []
for (const line of lines) {
  const prev = band[band.length - 1]
  if (prev && line.top - prev.bottom > leading * 0.85) {
    bands.push(band)
    band = []
  }
  band.push(line)
}
if (band.length) bands.push(band)

bands.forEach((b, i) => {
  const layout = detectColumns(b, page.geometry, body)
  console.log(`\nBanda ${i + 1}: ${b.length} líneas  y=${b[0].top.toFixed(0)}..${b[b.length - 1].bottom.toFixed(0)}  columnas=${layout.bounds.length || 1}`)
  for (const l of b) console.log(`   x ${l.x0.toFixed(0)}..${l.x1.toFixed(0)}  ${l.text.slice(0, 70)}`)
  if (layout.gutters.length) console.log('   calles:', layout.gutters.map((g) => `${g.from}..${g.to}`).join(', '))
})
