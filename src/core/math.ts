/** Traducción best-effort de símbolos Unicode a comandos LaTeX. */
const SYMBOLS: Record<string, string> = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\varepsilon', 'ϵ': '\\epsilon',
  'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ϑ': '\\vartheta', 'ι': '\\iota', 'κ': '\\kappa',
  'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ϖ': '\\varpi', 'ρ': '\\rho',
  'ϱ': '\\varrho', 'σ': '\\sigma', 'ς': '\\varsigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\varphi',
  'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi',
  'Σ': '\\Sigma', 'Υ': '\\Upsilon', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
  '∮': '\\oint', '√': '\\sqrt', '∛': '\\sqrt[3]', '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla',
  '±': '\\pm', '∓': '\\mp', '×': '\\times', '÷': '\\div', '⋅': '\\cdot', '∗': '\\ast', '∘': '\\circ',
  '≠': '\\neq', '≤': '\\leq', '≥': '\\geq', '≪': '\\ll', '≫': '\\gg', '≈': '\\approx', '≃': '\\simeq',
  '≅': '\\cong', '≡': '\\equiv', '∝': '\\propto', '∼': '\\sim', '≺': '\\prec', '≻': '\\succ',
  '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset', '⊃': '\\supset', '⊆': '\\subseteq',
  '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset', '∖': '\\setminus',
  '∀': '\\forall', '∃': '\\exists', '∄': '\\nexists', '¬': '\\neg', '∧': '\\land', '∨': '\\lor',
  '⊕': '\\oplus', '⊗': '\\otimes', '⊥': '\\perp', '∥': '\\parallel', '∠': '\\angle',
  '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow',
  '⇔': '\\Leftrightarrow', '↦': '\\mapsto', '⟶': '\\longrightarrow',
  'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}',
  'ℓ': '\\ell', 'ℏ': '\\hbar', '′': "'", '″': "''", '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots',
  '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor', '⟨': '\\langle', '⟩': '\\rangle',
  '°': '^{\\circ}', '‰': '\\permil', '∴': '\\therefore', '∵': '\\because',
}

const SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i',
}

const SUBSCRIPTS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₙ': 'n',
}

const MATH_CHAR_RE = /[α-ωΑ-Ω∑∏∫∮√∞∂∇±∓×÷⋅≠≤≥≈≡∈∉⊂⊃∪∩∅∀∃¬∧∨⊕⊗⊥→←↔⇒⇔ℝℕℤℚℂℓ⌈⌉⌊⌋⟨⟩⁰-⁹₀-₉]/

export function looksMathematical(text: string): boolean {
  if (MATH_CHAR_RE.test(text)) return true
  // Ecuaciones simples: "x = a + b" con operadores y pocas palabras largas.
  const words = text.split(/\s+/).filter(Boolean)
  const long = words.filter((w) => /^[\p{L}]{4,}$/u.test(w)).length
  return /[=<>]/.test(text) && /[+\-*/^_]/.test(text) && long <= words.length * 0.3 && words.length >= 2
}

export function unicodeToLatex(text: string): string {
  let out = ''
  let supRun = ''
  let subRun = ''
  const flush = () => {
    if (supRun) {
      out += supRun.length > 1 ? `^{${supRun}}` : `^${supRun}`
      supRun = ''
    }
    if (subRun) {
      out += subRun.length > 1 ? `_{${subRun}}` : `_${subRun}`
      subRun = ''
    }
  }
  for (const ch of text) {
    if (SUPERSCRIPTS[ch]) {
      if (subRun) flush()
      supRun += SUPERSCRIPTS[ch]
      continue
    }
    if (SUBSCRIPTS[ch]) {
      if (supRun) flush()
      subRun += SUBSCRIPTS[ch]
      continue
    }
    flush()
    const mapped = SYMBOLS[ch]
    if (mapped) out += mapped + ' '
    else if (ch === '%') out += '\\%'
    else if (ch === '&') out += '\\&'
    else if (ch === '#') out += '\\#'
    else out += ch
  }
  flush()
  return out.replace(/\s{2,}/g, ' ').trim()
}
