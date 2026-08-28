import type { DocumentMeta, ImageRef, ListItem, MdNode } from './types'
import type { ConvertOptions } from './options'
import { renderTable } from './tables'
import { slugify } from './util'

function yamlValue(value: string): string {
  const clean = value.replace(/\r?\n/g, ' ').trim()
  if (!clean) return '""'
  if (/^[\w .,\-/()áéíóúñüÁÉÍÓÚÑÜ]+$/.test(clean) && !/^[-?:]|:\s/.test(clean)) return clean
  return `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function frontMatter(meta: DocumentMeta): string {
  const rows: [string, string | undefined][] = [
    ['title', meta.title],
    ['author', meta.author],
    ['subject', meta.subject],
    ['keywords', meta.keywords],
    ['source', meta.fileName],
    ['pages', String(meta.pages)],
    ['created', meta.creationDate],
    ['modified', meta.modificationDate],
    ['producer', meta.producer],
  ]
  const body = rows
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${yamlValue(String(v))}`)
    .join('\n')
  return `---\n${body}\n---`
}

function wrapText(text: string, width: number): string {
  if (width < 30) return text
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (!line) line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      out.push(line)
      line = word
    }
  }
  if (line) out.push(line)
  return out.join('\n')
}

function renderList(items: ListItem[], start: number): string {
  const counters: number[] = []
  const lines: string[] = []
  for (const item of items) {
    const depth = Math.min(item.depth, 5)
    counters.length = depth + 1
    for (let i = 0; i <= depth; i++) counters[i] ??= 0
    counters[depth]++

    const indent = '  '.repeat(depth)
    const number = depth === 0 ? counters[0] + start - 1 : counters[depth]
    const marker = item.ordered ? `${number}.` : '-'
    const continuation = `\n${indent}${' '.repeat(marker.length + 1)}`
    lines.push(`${indent}${marker} ${item.md.replace(/\n/g, continuation)}`)
  }
  return lines.join('\n')
}

function imageSource(ref: ImageRef, mode: ConvertOptions['images']): string | null {
  if (mode === 'skip') return null
  if (mode === 'embed') return ref.dataUrl ?? null
  return ref.blob ? ref.path : null
}

export interface EmitInput {
  nodes: MdNode[]
  meta: DocumentMeta
  options: ConvertOptions
  footnotes: { label: string; md: string }[]
}

export function emitMarkdown({ nodes, meta, options, footnotes }: EmitInput): string {
  const chunks: string[] = []
  if (options.frontMatter) chunks.push(frontMatter(meta))

  if (options.includeToc) {
    const headings = nodes.filter((n): n is Extract<MdNode, { type: 'heading' }> => n.type === 'heading')
    if (headings.length >= 3) {
      const min = Math.min(...headings.map((h) => h.level))
      const toc = headings
        .map((h) => `${'  '.repeat(Math.min(h.level - min, 5))}- [${h.text.replace(/[[\]]/g, '')}](#${slugify(h.text)})`)
        .join('\n')
      chunks.push(`## Índice\n\n${toc}`)
    }
  }

  for (const node of nodes) {
    switch (node.type) {
      case 'heading':
        chunks.push(`${'#'.repeat(node.level)} ${node.md}`)
        break
      case 'paragraph':
        chunks.push(options.wrapWidth ? wrapText(node.md, options.wrapWidth) : node.md)
        break
      case 'quote': {
        const text = options.wrapWidth ? wrapText(node.md, options.wrapWidth - 2) : node.md
        chunks.push(text.split('\n').map((l) => `> ${l}`).join('\n'))
        break
      }
      case 'list':
        chunks.push(renderList(node.items, node.start))
        break
      case 'code': {
        const fence = node.text.includes('```') ? '~~~' : '```'
        chunks.push(`${fence}${node.lang}\n${node.text}\n${fence}`)
        break
      }
      case 'table':
        chunks.push(renderTable({ header: node.header, rows: node.rows, align: node.align }))
        break
      case 'image': {
        const src = imageSource(node.ref, options.images)
        if (src) chunks.push(`![${node.ref.alt || `Imagen de la página ${node.page}`}](${src})`)
        break
      }
      case 'caption':
        chunks.push(`*${node.md.replace(/^\*+|\*+$/g, '')}*`)
        break
      case 'math':
        chunks.push(`$$\n${node.tex}\n$$`)
        break
      case 'hr':
        chunks.push('---')
        break
      case 'pagebreak':
        if (options.pageSeparators === 'comment') chunks.push(`<!-- Página ${node.page} -->`)
        else if (options.pageSeparators === 'rule') chunks.push(`---\n\n<!-- Página ${node.page} -->`)
        break
      case 'footnote':
        break
    }
  }

  if (footnotes.length) {
    chunks.push('---')
    chunks.push(footnotes.map((f) => `[^${f.label}]: ${f.md}`).join('\n'))
  }

  return `${chunks.filter((c) => c.trim()).join('\n\n')}\n`.replace(/\n{4,}/g, '\n\n\n')
}
