/**
 * Renderizador Markdown mínimo y seguro para la vista previa.
 * Cubre el subconjunto que genera el conversor (GFM + notas al pie +
 * super/subíndices) y escapa cualquier HTML presente en la fuente.
 */

// Marcadores fuera del rango imprimible: nunca aparecen en un Markdown real.
const SENTINEL = String.fromCharCode(1)
const CLOSE = String.fromCharCode(2)
const ESC_OPEN = `${SENTINEL}E`
const CODE_OPEN = `${SENTINEL}C`

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function slugId(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function safeUrl(url: string): string {
  const trimmed = url.trim()
  if (/^(https?:|mailto:|tel:|#|\.|\/|data:image\/)/i.test(trimmed)) return escapeHtml(trimmed)
  return '#'
}

function inline(src: string): string {
  const escapes: string[] = []
  const codes: string[] = []

  let text = src.replace(/\\([\\`*_{}[\]()#+\-.!|<>~$])/g, (_, ch: string) => {
    escapes.push(ch)
    return `${ESC_OPEN}${escapes.length - 1}${CLOSE}`
  })

  text = text.replace(/(`+)([\s\S]*?)\1/g, (_, _fence: string, code: string) => {
    codes.push(`<code>${escapeHtml(code.replace(/^ | $/g, ''))}</code>`)
    return `${CODE_OPEN}${codes.length - 1}${CLOSE}`
  })

  text = escapeHtml(text)

  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_, alt: string, url: string) => `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy" />`,
  )
  text = text.replace(/\[\^([^\]]+)\]/g, (_, id: string) => {
    const slug = slugId(id)
    return `<sup class="fn-ref"><a href="#fn-${slug}" id="fnref-${slug}">[${escapeHtml(id)}]</a></sup>`
  })
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_, label: string, url: string) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  )

  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
  text = text.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  // Solo se restauran las etiquetas que genera el propio conversor, y siempre
  // emparejadas: así nunca sobrevive un atributo ni una etiqueta suelta.
  text = text.replace(/&lt;(sup|sub)&gt;([\s\S]*?)&lt;\/\1&gt;/g, '<$1>$2</$1>')
  text = text.replace(/&lt;br\s*\/?&gt;/g, '<br />')
  text = text.replace(/\$([^$\n]+)\$/g, '<span class="math">$1</span>')

  text = text.replace(new RegExp(`${CODE_OPEN}(\\d+)${CLOSE}`, 'g'), (_, i: string) => codes[Number(i)])
  text = text.replace(new RegExp(`${ESC_OPEN}(\\d+)${CLOSE}`, 'g'), (_, i: string) => escapeHtml(escapes[Number(i)]))
  return text
}

interface ListFrame {
  ordered: boolean
  indent: number
}

export interface RenderedMarkdown {
  html: string
  headings: { level: number; text: string; id: string }[]
}

export function renderMarkdown(source: string): RenderedMarkdown {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  const headings: RenderedMarkdown['headings'] = []
  const stack: ListFrame[] = []
  let paragraph: string[] = []
  let i = 0

  const closeLists = (toIndent = -1) => {
    while (stack.length && stack[stack.length - 1].indent > toIndent) {
      html.push(stack.pop()!.ordered ? '</ol>' : '</ul>')
    }
  }
  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) {
      const rows = lines
        .slice(1, end)
        .filter((l) => l.includes(':'))
        .map((l) => {
          const idx = l.indexOf(':')
          const key = escapeHtml(l.slice(0, idx))
          const value = escapeHtml(l.slice(idx + 1).trim().replace(/^"|"$/g, ''))
          return `<div class="fm-row"><span class="fm-key">${key}</span><span class="fm-val">${value}</span></div>`
        })
      html.push(`<div class="front-matter">${rows.join('')}</div>`)
      i = end + 1
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      closeLists()
      continue
    }

    const fence = /^(```|~~~)(.*)$/.exec(trimmed)
    if (fence) {
      flushParagraph()
      closeLists()
      const marker = fence[1]
      const lang = fence[2].trim()
      const body: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== marker) {
        body.push(lines[i])
        i++
      }
      const attr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
      html.push(`<pre class="code-block"${attr}><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    if (/^\$\$\s*$/.test(trimmed)) {
      flushParagraph()
      closeLists()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\$\$\s*$/.test(lines[i].trim())) {
        body.push(lines[i])
        i++
      }
      html.push(`<div class="math-block">${escapeHtml(body.join('\n'))}</div>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      closeLists()
      const level = heading[1].length
      const raw = heading[2].replace(/\s+#+\s*$/, '')
      const id = slugId(raw.replace(/[*`_[\]]/g, ''))
      headings.push({ level, text: raw.replace(/[*`_]/g, ''), id })
      html.push(`<h${level} id="${id}">${inline(raw)}</h${level}>`)
      continue
    }

    const footnote = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(trimmed)
    if (footnote) {
      flushParagraph()
      closeLists()
      const slug = slugId(footnote[1])
      html.push(
        `<div class="footnote" id="fn-${slug}"><span class="fn-label">${escapeHtml(footnote[1])}</span><span>${inline(footnote[2])}</span></div>`,
      )
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph()
      closeLists()
      html.push('<hr />')
      continue
    }

    if (/^<!--/.test(trimmed)) {
      flushParagraph()
      closeLists()
      html.push(`<div class="page-marker">${escapeHtml(trimmed.replace(/^<!--\s*|\s*-->$/g, ''))}</div>`)
      continue
    }

    if (trimmed.startsWith('>')) {
      flushParagraph()
      closeLists()
      const body: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        body.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      i--
      html.push(`<blockquote>${inline(body.join(' '))}</blockquote>`)
      continue
    }

    if (trimmed.startsWith('|') && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1]?.trim() ?? '')) {
      flushParagraph()
      closeLists()
      i = renderTableBlock(lines, i, html)
      continue
    }

    const listItem = /^(\s*)([-+*]|\d{1,9}[.)])\s+(.*)$/.exec(line)
    if (listItem) {
      flushParagraph()
      const indent = Math.floor(listItem[1].replace(/\t/g, '  ').length / 2)
      const ordered = /\d/.test(listItem[2])
      closeLists(indent)
      const top = stack[stack.length - 1]
      if (!top || top.indent < indent) {
        html.push(ordered ? '<ol>' : '<ul>')
        stack.push({ ordered, indent })
      } else if (top.ordered !== ordered) {
        html.push(stack.pop()!.ordered ? '</ol>' : '</ul>')
        html.push(ordered ? '<ol>' : '<ul>')
        stack.push({ ordered, indent })
      }
      html.push(`<li>${inline(listItem[3])}</li>`)
      continue
    }

    closeLists()
    paragraph.push(trimmed)
  }

  flushParagraph()
  closeLists()
  return { html: html.join('\n'), headings }
}

function renderTableBlock(lines: string[], start: number, html: string[]): number {
  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim())

  const header = cells(lines[start])
  const aligns = cells(lines[start + 1]).map((spec) => {
    const left = spec.startsWith(':')
    const right = spec.endsWith(':')
    return right && left ? 'center' : right ? 'right' : 'left'
  })

  let i = start + 2
  const rows: string[][] = []
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    rows.push(cells(lines[i]))
    i++
  }

  const hasHeader = header.some((c) => c)
  const th = hasHeader
    ? `<thead><tr>${header.map((c, k) => `<th style="text-align:${aligns[k] ?? 'left'}">${inline(c)}</th>`).join('')}</tr></thead>`
    : ''
  const tb = `<tbody>${rows
    .map((r) => `<tr>${r.map((c, k) => `<td style="text-align:${aligns[k] ?? 'left'}">${inline(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`
  html.push(`<div class="table-wrap"><table>${th}${tb}</table></div>`)
  return i - 1
}
