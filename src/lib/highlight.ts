/** Coloreado ligero del Markdown de salida para la vista de código fuente. */

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineTokens(text: string): string {
  return esc(text)
    .replace(/(`[^`]+`)/g, '<span class="tok-fence">$1</span>')
    .replace(/(\*\*\*?[^*]+\*\*\*?)/g, '<span class="tok-mark">$1</span>')
    .replace(/(!?\[[^\]]*\]\([^)]*\))/g, '<span class="tok-link">$1</span>')
}

export function highlightMarkdown(source: string): string {
  const lines = source.split('\n')
  const out: string[] = []
  let inFence = false
  let inFrontMatter = lines[0]?.trim() === '---'

  lines.forEach((line, index) => {
    const trimmed = line.trim()

    if (inFrontMatter) {
      out.push(`<span class="tok-meta">${esc(line)}</span>`)
      if (index > 0 && trimmed === '---') inFrontMatter = false
      return
    }
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence
      out.push(`<span class="tok-fence">${esc(line)}</span>`)
      return
    }
    if (inFence) {
      out.push(esc(line))
      return
    }
    if (/^#{1,6}\s/.test(trimmed)) {
      out.push(`<span class="tok-head">${esc(line)}</span>`)
      return
    }
    if (/^\|/.test(trimmed)) {
      out.push(`<span class="tok-table">${esc(line)}</span>`)
      return
    }
    if (/^<!--/.test(trimmed)) {
      out.push(`<span class="tok-meta">${esc(line)}</span>`)
      return
    }
    const listMatch = /^(\s*)([-+*]|\d{1,9}[.)])(\s+)(.*)$/.exec(line)
    if (listMatch) {
      out.push(`${listMatch[1]}<span class="tok-mark">${esc(listMatch[2])}</span>${listMatch[3]}${inlineTokens(listMatch[4])}`)
      return
    }
    if (/^>\s?/.test(trimmed)) {
      out.push(`<span class="tok-mark">${esc(line)}</span>`)
      return
    }
    out.push(inlineTokens(line))
  })

  return out.join('\n')
}
