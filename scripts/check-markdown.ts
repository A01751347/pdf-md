import { renderMarkdown } from '../src/lib/markdown'

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[clic](javascript:alert(1))',
  '![x](javascript:alert(1))',
  '[a](" onmouseover="alert(1))',
  '<sup onclick="alert(1)">1</sup>',
  '`<script>alert(1)</script>`',
  '| a | b |\n| --- | --- |\n| <script>x</script> | ok |',
  '> <iframe src=evil></iframe>',
  '```\n<script>alert(1)</script>\n```',
]

const ALLOWED = /<\/?(?:p|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|del|hr|br|sup|sub|a|img|table|thead|tbody|tr|th|td|div|span|nav)\b[^>]*>/gi
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\.|\/|data:image\/)/i

/**
 * Solo cuenta como fuga el marcado que sobrevive fuera de la lista blanca:
 * el texto escapado (`&lt;img onerror=…&gt;`) es inerte y no debe alarmar.
 */
function residualMarkup(html: string): string | null {
  const stripped = html.replace(ALLOWED, '')
  const raw = /<[a-z!/]/i.exec(stripped)
  if (raw) return `etiqueta cruda ${raw[0]}`

  const handler = /<[a-z][^>]*\s(on[a-z]+)\s*=/i.exec(html)
  if (handler) return `manejador ${handler[1]}`

  for (const match of html.matchAll(/<(?:a|img)\b[^>]*?(?:href|src)="([^"]*)"/gi)) {
    if (!SAFE_URL.test(match[1])) return `url ${match[1].slice(0, 40)}`
  }
  return null
}

let bad = 0
for (const source of HOSTILE) {
  const { html } = renderMarkdown(source)
  const leak = residualMarkup(html)
  if (leak) {
    bad++
    console.log(`FUGA (${leak}) en: ${source.slice(0, 46)}\n   → ${html.slice(0, 160)}`)
  }
}

const structural = [
  ['# Título\n\ntexto', '<h1'],
  ['- a\n- b', '<ul>'],
  ['1. a\n2. b', '<ol>'],
  ['| a | b |\n| ---: | :---: |\n| 1 | 2 |', 'text-align:right'],
  ['```js\ncode\n```', 'data-lang="js"'],
  ['> cita', '<blockquote>'],
  ['texto[^n]\n\n[^n]: nota', 'fn-ref'],
  ['---\ntitle: X\n---\n\ncuerpo', 'front-matter'],
  ['$$\nx^2\n$$', 'math-block'],
  ['**negrita** y *cursiva* y `código`', '<strong>'],
  ['- a\n  - b\n- c', '<ul>\n<li>b</li>'],
  ['escape \\*literal\\*', '*literal*'],
] as const

for (const [source, expected] of structural) {
  const { html } = renderMarkdown(source)
  if (!html.includes(expected)) {
    bad++
    console.log(`FALTA "${expected}" para: ${JSON.stringify(source)}\n   → ${html.slice(0, 200)}`)
  }
}

console.log(bad ? `\n${bad} comprobación(es) fallida(s)` : `\n${HOSTILE.length + structural.length} comprobaciones superadas`)
