import type { LinkArea, Span } from './types'
import type { ConvertOptions } from './options'
import { asciiPunctuation, contains, escapeMarkdown } from './util'
import { unicodeToLatex } from './math'

interface Style {
  bold: boolean
  italic: boolean
  mono: boolean
  math: boolean
  script: 'normal' | 'sup' | 'sub'
  link: string
}

const PLAIN: Style = { bold: false, italic: false, mono: false, math: false, script: 'normal', link: '' }

const sameStyle = (a: Style, b: Style) =>
  a.bold === b.bold && a.italic === b.italic && a.mono === b.mono && a.math === b.math && a.script === b.script && a.link === b.link

export interface InlineContext {
  opts: ConvertOptions
  links: LinkArea[]
  inTable?: boolean
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>()[\]"']+[^\s<>()[\]"'.,;:!?])/gi
const EMAIL_RE = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g

function linkFor(span: Span, links: LinkArea[]): string {
  if (!links.length) return ''
  const cx = span.x + span.w / 2
  const cy = span.y - span.size * 0.3
  for (const l of links) if (contains(l.rect, cx, cy)) return l.url
  return ''
}

function styleOf(span: Span, ctx: InlineContext): Style {
  const o = ctx.opts
  return {
    bold: o.preserveEmphasis && span.bold,
    italic: o.preserveEmphasis && span.italic,
    mono: o.detectCode && span.mono,
    math: o.math === 'latex' && span.math,
    script: o.preserveSuperscripts ? span.script : 'normal',
    link: o.keepLinks ? span.link || linkFor(span, ctx.links) : '',
  }
}

function wrapEmphasis(text: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)
  if (!m || !m[2]) return text
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`
}

function codeSpan(text: string): string {
  const trimmed = text.replace(/^\s+|\s+$/g, '')
  if (!trimmed) return text
  let ticks = 1
  const runs = trimmed.match(/`+/g)
  if (runs) ticks = Math.max(...runs.map((r) => r.length)) + 1
  const fence = '`'.repeat(ticks)
  const pad = /^`|`$/.test(trimmed) ? ' ' : ''
  return `${fence}${pad}${trimmed}${pad}${fence}`
}

interface Atom {
  text: string
  style: Style | null
}

/** Convierte los spans de una línea en Markdown en línea, con énfasis y enlaces. */
export function renderInline(spans: Span[], ctx: InlineContext): string {
  const atoms: Atom[] = []
  let prev: Span | null = null

  for (const span of spans) {
    if (!span.str) continue
    if (prev) {
      const gap = span.x - (prev.x + prev.w)
      const needsSpace = gap > 0.2 * Math.min(prev.size, span.size)
      const lastText = atoms.length ? atoms[atoms.length - 1].text : ''
      if (needsSpace && !/\s$/.test(lastText) && !/^\s/.test(span.str)) atoms.push({ text: ' ', style: null })
    }
    atoms.push({ text: span.str, style: styleOf(span, ctx) })
    prev = span
  }

  // Los espacios heredan el estilo cuando unen dos fragmentos idénticos.
  for (let i = 0; i < atoms.length; i++) {
    if (atoms[i].style) continue
    const before = atoms[i - 1]?.style
    const after = atoms[i + 1]?.style
    atoms[i].style = before && after && sameStyle(before, after) ? before : PLAIN
  }

  const runs: { text: string; style: Style }[] = []
  for (const atom of atoms) {
    const style = atom.style as Style
    const last = runs[runs.length - 1]
    if (last && sameStyle(last.style, style)) last.text += atom.text
    else runs.push({ text: atom.text, style })
  }

  const expanded = ctx.opts.autolink ? runs.flatMap((r) => (r.style.link || r.style.mono ? [r] : splitAutolinks(r))) : runs
  return assemble(expanded, ctx)
}

function splitAutolinks(run: { text: string; style: Style }): { text: string; style: Style }[] {
  const out: { text: string; style: Style }[] = []
  let rest = run.text
  let cursor = 0
  const matches: { index: number; length: number; url: string }[] = []
  for (const m of rest.matchAll(URL_RE)) {
    matches.push({ index: m.index ?? 0, length: m[0].length, url: m[0].startsWith('www.') ? `https://${m[0]}` : m[0] })
  }
  for (const m of rest.matchAll(EMAIL_RE)) {
    if (matches.some((x) => (m.index ?? 0) >= x.index && (m.index ?? 0) < x.index + x.length)) continue
    matches.push({ index: m.index ?? 0, length: m[0].length, url: `mailto:${m[0]}` })
  }
  matches.sort((a, b) => a.index - b.index)
  for (const m of matches) {
    if (m.index > cursor) out.push({ text: rest.slice(cursor, m.index), style: run.style })
    out.push({ text: rest.slice(m.index, m.index + m.length), style: { ...run.style, link: m.url } })
    cursor = m.index + m.length
  }
  if (cursor < rest.length) out.push({ text: rest.slice(cursor), style: run.style })
  return out.length ? out : [run]
}

function assemble(runs: { text: string; style: Style }[], ctx: InlineContext): string {
  const pieces: { md: string; link: string }[] = []

  for (const run of runs) {
    if (!run.text) continue
    let md: string

    if (run.style.mono) {
      md = codeSpan(run.text)
    } else if (run.style.math) {
      const tex = unicodeToLatex(run.text)
      md = tex ? `$${tex}$` : ''
    } else {
      let text = ctx.opts.asciiPunctuation ? asciiPunctuation(run.text) : run.text
      md = escapeMarkdown(text, ctx.inTable)
      if (run.style.bold && run.style.italic) md = wrapEmphasis(md, '***')
      else if (run.style.bold) md = wrapEmphasis(md, '**')
      else if (run.style.italic) md = wrapEmphasis(md, '*')
    }

    if (run.style.script === 'sup') md = md.trim() ? `<sup>${md.trim()}</sup>` : md
    else if (run.style.script === 'sub') md = md.trim() ? `<sub>${md.trim()}</sub>` : md

    const last = pieces[pieces.length - 1]
    if (last && last.link === run.style.link) last.md += md
    else pieces.push({ md, link: run.style.link })
  }

  const joined = pieces
    .map((p) => {
      if (!p.link) return p.md
      const label = p.md.trim()
      if (!label) return p.md
      const lead = p.md.slice(0, p.md.length - p.md.trimStart().length)
      const tail = p.md.slice(p.md.trimEnd().length)
      return `${lead}[${label}](${encodeURI(p.link).replace(/\)/g, '%29')})${tail}`
    })
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return ctx.opts.normalizeWhitespace ? tidySpacing(mergeAdjacentEmphasis(joined)) : joined
}

/** Une énfasis contiguos separados solo por un espacio: `*a* *b*` → `*a b*`. */
export function mergeAdjacentEmphasis(md: string): string {
  return md
    .replace(/\*\*\* \*\*\*/g, ' ')
    .replace(/(?<!\*)\*\* \*\*(?!\*)/g, ' ')
    .replace(/(?<![*\\])\* \*(?!\*)/g, ' ')
    .replace(/<\/sup> ?<sup>/g, '')
    .replace(/<\/sub> ?<sub>/g, '')
}

/** Corrige el espaciado que deja la geometría del PDF antes de la puntuación. */
export function tidySpacing(md: string): string {
  return md
    .replace(/\s+([.,;:)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+%/g, ' %')
}
