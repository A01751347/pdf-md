/** Clasificación tipográfica a partir del nombre de fuente incrustado. */

const BOLD_RE = /bold|black|heavy|semib|demib|extrab|ultrab|[-_]bd(\b|[^a-z])|w[6-9]00|-(700|800|900)\b|cmbx|nimbusromno9l-med|-md\b|medi\b/i
const ITALIC_RE = /italic|oblique|-it(\b|[^a-z])|cmti|cmmi|kursiv|slant/i
const MONO_RE =
  /mono|courier|consol|menlo|monaco|inconsolat|sourcecodepro|source_?code|firacode|jetbrains|typewriter|cmtt|nimbusmonl|lucidatypewriter|andalemono|dejavusansmono|liberationmono|ubuntumono|ibmplexmono|robotomono|operatormono|hack|anonymouspro|pt_?mono|cascadia/i
const SERIF_RE =
  /serif|times|georgia|garamond|book(?!man ?old ?style ?sans)|minion|palatino|cambria|constantia|roman|cmr\d|utopia|charter|caslon|baskerville|didot|bodoni|nimbusrom|liberationserif|dejavuserif|freeserif|stix|merriweather|lora|spectral|source ?serif/i
const MATH_RE =
  /cmmi|cmsy|cmex|msam|msbm|mathematicalpi|euclid|mtsy|mtmi|mt-?extra|stixgeneral|stixmath|xits|latinmodernmath|cambriamath|asana|neoeuler|symbol|esint|rsfs|wasy|mathjax|cmm\d|txsy|pxsy/i
const SANS_RE = /sans|arial|helvetica|calibri|verdana|tahoma|segoe|roboto|opensans|lato|montserrat|inter|nunito|futura|gill|frutiger|myriad|avenir|dejavusans|liberationsans|freesans|univers|franklin|proximanova/i

export interface FontProfile {
  bold: boolean
  italic: boolean
  mono: boolean
  serif: boolean
  math: boolean
  family: string
}

const cache = new Map<string, FontProfile>()

/** Elimina el prefijo de subconjunto ("ABCDEE+Arial") y normaliza. */
export function cleanFontName(raw: string): string {
  return raw.replace(/^[A-Z]{6}\+/, '').replace(/[,_]/g, '-')
}

/**
 * Deriva estilos desde el nombre. `flags` son los booleanos que ya resolvió
 * pdf.js a partir del descriptor de fuente, que tienen prioridad.
 */
export function profileFont(rawName: string, flags?: { bold?: boolean; italic?: boolean }): FontProfile {
  const key = `${rawName}|${flags?.bold ? 1 : 0}${flags?.italic ? 1 : 0}`
  const hit = cache.get(key)
  if (hit) return hit
  const name = cleanFontName(rawName || '')
  const sans = SANS_RE.test(name)
  const profile: FontProfile = {
    bold: flags?.bold ?? BOLD_RE.test(name),
    italic: flags?.italic ?? ITALIC_RE.test(name),
    mono: MONO_RE.test(name),
    serif: !sans && SERIF_RE.test(name),
    math: MATH_RE.test(name),
    family: name.replace(/-(Bold|Italic|Oblique|Regular|Medium|Light|Black|BoldItalic|MT|PS)+$/gi, '') || 'desconocida',
  }
  cache.set(key, profile)
  return profile
}
