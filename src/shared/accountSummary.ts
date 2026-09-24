/**
 * "Account Summary" section parser.
 *
 * Strategy (deliberately layout independent):
 *  1. Search EVERY page for a line whose text starts with "Account Summary"
 *     (case-insensitive, tolerant of numbering / colons / extra spaces).
 *  2. From that heading, collect lines until the section ends (a known other
 *     section heading, another Account Summary heading, or a hard line budget).
 *  3. Tokenise the section into words and numeric candidates, then locate each
 *     required field by its LABEL (synonym sets) and grab the nearest numeric
 *     token after it — preferring decimal amounts over bare integers and same
 *     line over next line, so split lines and tables both work.
 *  4. Amounts are parsed accounting-style: commas, minus signs and
 *     parentheses, exactly into integer minor units (chhatrum).
 */

import { parseAmountToChh } from './money'

export interface PageText {
  page: number
  text: string
}

export interface AccountSummaryExtraction {
  outstanding: number | null
  penalty: number | null
  billAmount: number | null
  gst: number | null
  creditsDebits: number | null
  totalPayable: number | null
  /** one evidence snippet (source line) per found field, for audit */
  evidence: Record<string, string>
  page: number
  coreFound: string[]
  coreMissing: string[]
  /** (basic + gst) - total in chh; null when not computable */
  mismatchChh: number | null
}

type MoneyField = 'outstanding' | 'penalty' | 'billAmount' | 'gst' | 'creditsDebits' | 'totalPayable'

const HEADING_RE = /^(?:[ivxlcdmIVXLCDM]+\s*[.)\-]\s*)?account\s*summary\b/i
const HEADING_STOP_RE =
  /^(?:[ivxlcdmIVXLCDM]+\s*[.)\-]\s*)?(?:payment\s+history|bills?\s+(?:and|&)\s+payment|billing\s+details|bill\s+details|payment\s+details|other\s+details|adjustment|tariff\s+plan|plan\s+details|circle\s+subscription|list\s+of\s+(?:local\s+)?calls|itemi[sz]ed|call\s+details|sms\s+details|data\s+usage|usage\s+details|gprs|roaming|important\s+(?:note|instruction|term)|notes?\b|terms\s*(?:&|and)\s*conditions|customer\s+care|your\s+payment|amount\s+breakup|breakup\s+of|dues\s+(?:as|previous)|recharge|invoice\s+details|bill\s+payment)/i

const SECTION_BUDGET_LINES = 220
const MAX_ABS_CHH = 10_000_000_00 // 10 crore Nu. sanity cap

/** label synonyms, each a sequence of lower-case words to match in order */
const FIELD_LABELS: Record<MoneyField, string[][]> = {
  outstanding: [['outstanding', 'dues'], ['outstanding']],
  penalty: [['penalty'], ['late', 'payment', 'charge'], ['late', 'payment', 'penalty']],
  billAmount: [['current', 'bill', 'amount'], ['total', 'bill', 'amount'], ['bill', 'amount']],
  gst: [['gst']],
  creditsDebits: [['credits', 'debits'], ['credit', 'debit'], ['adjustment'], ['adjustments']],
  totalPayable: [['total', 'amount', 'payable'], ['total', 'payable', 'amount'], ['amount', 'payable'], ['net', 'payable'], ['total', 'payable'], ['payable', 'amount'], ['net', 'amount', 'payable']]
}

// noise tokens that may sit *between* the words of a label ("credits / debits")
const LABEL_GAP_NOISE = new Set(['/', ':', '-', '–', '—', '(', ')'])
// tokens that may sit between label and value without ending the search
const VALUE_GAP_NOISE = new Set(['/', ':', '=', '|', '(', '(', ')', 'nu', 'nu.', 'rs', 'rs.', 'inr', 'the', 'is'])

interface Tok {
  raw: string
  lower: string
  line: number
  chh: number | null
}

function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9/@().%,-]/g, '').replace(/[.:,;]+$/, '')
}

function tokenizeSection(section: { line: number; text: string }[]): Tok[] {
  const toks: Tok[] = []
  section.forEach((s) => {
    const spaced = s.text
      .replace(/([a-z]+)\((\d+(?:\.\d+)?%)\)/gi, '$1 ($2)') // "GST(5%)" -> "GST (5%)"
      .replace(/([/|])/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!spaced) return
    for (const piece of spaced.split(' ')) {
      let raw = piece.trim()
      if (!raw || raw === '|') continue
      raw = raw.replace(/\u00a0/g, '')
      if (!raw) continue
      let chh: number | null = null
      if (/^[-+(]?[\d][\d,]*(?:\.\d+)?[)%]?$/.test(raw)) {
        if (!/%/.test(raw)) chh = parseAmountToChh(raw)
      }
      toks.push({ raw, lower: normalizeWord(raw), line: s.line, chh })
    }
  })
  return toks
}

/** Does the token sequence at position i start with one of the label synonyms? */
function matchLabel(toks: Tok[], i: number, synonyms: string[][]): number | null {
  for (const label of synonyms) {
    let j = i
    let ok = true
    for (let k = 0; k < label.length; k++) {
      while (j < toks.length && LABEL_GAP_NOISE.has(toks[j].lower) && toks[j].lower !== label[k]) j++
      if (j >= toks.length || toks[j].lower !== label[k]) {
        ok = false
        break
      }
      j++
    }
    if (!ok) continue
    // consume trailing rate noise for gst: "@ 5%" / "(18%)"
    while (
      j < toks.length &&
      (toks[j].lower === '@' || /^\(?\d+(?:\.\d+)?%\)?$/.test(toks[j].lower))
    ) {
      j++
    }
    return j
  }
  return null
}

/** guard: skip label hits that are prose like "including GST @ 5%" */
function precededByInclusive(toks: Tok[], i: number): boolean {
  for (let b = Math.max(0, i - 3); b < i; b++) {
    if (/^incl/.test(toks[b].lower)) return true
  }
  return false
}

interface Pick {
  idx: number
  tok: Tok
}

/** choose best numeric token after a label: same-line decimals preferred */
function pickAmount(toks: Tok[], startIdx: number, labelLine: number): Pick | null {
  let best: { idx: number; tok: Tok; score: number } | null = null
  const limit = Math.min(toks.length, startIdx + 12)
  let linesCrossed = 0
  for (let j = startIdx; j < limit; j++) {
    const t = toks[j]
    if (t.chh === null) {
      if (!VALUE_GAP_NOISE.has(t.lower) && t.lower.length > 0) {
        // a word between label and value: allow small noise like "amount :"
        if (linesCrossed > 2) break
      }
      continue
    }
    const hasDecimal = /\.\d/.test(t.raw)
    const sameLine = t.line === labelLine
    if (!sameLine) linesCrossed = Math.abs(t.line - labelLine)
    if (linesCrossed > 2) break
    let score = 0
    if (hasDecimal) score += 100
    if (/,/.test(t.raw)) score += 40
    if (sameLine) score += 60
    if (!hasDecimal) {
      const bare = parseInt(t.raw.replace(/[^\d]/g, ''), 10)
      if (!Number.isNaN(bare) && bare >= 1900 && bare <= 2150 && !sameLine) score -= 150 // year
      if (t.chh > 10_000_00) score -= 50 // implausibly large without decimals
    }
    if (Math.abs(t.chh) > MAX_ABS_CHH) score -= 1000
    if (!best || score > best.score) best = { idx: j, tok: t, score }
    if (sameLine && hasDecimal && score >= 160) break // strong match on the label line
  }
  return best ? { idx: best.idx, tok: best.tok } : null
}

export function findAccountSummaries(pages: PageText[]): AccountSummaryExtraction[] {
  const results: AccountSummaryExtraction[] = []
  const lines: { page: number; line: number; text: string; trimmed: string }[] = []
  for (const p of pages) {
    p.text
      .split(/\r?\n/)
      .forEach((text, idx) => lines.push({ page: p.page, line: idx, text, trimmed: text.replace(/\s+/g, ' ').trim() }))
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (!ln.trimmed || !HEADING_RE.test(ln.trimmed)) continue
    if (/^(?:please\s+)?(?:refer|see|continue)/i.test(ln.trimmed)) continue
    const sectionLines: { line: number; text: string }[] = []
    let end = i + 1
    for (; end < lines.length && end - i <= SECTION_BUDGET_LINES; end++) {
      const t = lines[end].trimmed
      if (HEADING_RE.test(t)) break // next account-summary block
      if (t && HEADING_STOP_RE.test(t)) break // unrelated section begins
      if (t) sectionLines.push({ line: lines[end].line, text: t })
    }
    if (sectionLines.length > 0) results.push(parseSection(sectionLines, ln.page))
    i = Math.max(i, end - 1)
  }
  return results
}

function parseSection(sectionLines: { line: number; text: string }[], page: number): AccountSummaryExtraction {
  const toks = tokenizeSection(sectionLines)
  const out: AccountSummaryExtraction = {
    outstanding: null,
    penalty: null,
    billAmount: null,
    gst: null,
    creditsDebits: null,
    totalPayable: null,
    evidence: {},
    page,
    coreFound: [],
    coreMissing: [],
    mismatchChh: null
  }
  const used = new Set<number>()

  for (const [field, synonyms] of Object.entries(FIELD_LABELS) as [MoneyField, string[][]][]) {
    for (let i = 0; i < toks.length; i++) {
      const valueStart = matchLabel(toks, i, synonyms)
      if (valueStart === null) continue
      if (field === 'gst' && precededByInclusive(toks, i)) continue
      const labelTok = toks[i]
      const pick = pickAmount(toks, valueStart, labelTok.line)
      if (!pick || used.has(pick.idx) || pick.tok.chh === null) continue
      used.add(pick.idx)
      out[field] = pick.tok.chh
      const evLine = sectionLines.find((l) => l.line === labelTok.line)
      out.evidence[field] = (evLine ? evLine.text : labelTok.raw).slice(0, 200)
      i = pick.idx
      break
    }
  }

  for (const c of ['billAmount', 'totalPayable'] as MoneyField[]) {
    if (out[c] !== null) out.coreFound.push(c)
    else out.coreMissing.push(c)
  }
  if (out.billAmount !== null && out.totalPayable !== null) {
    out.mismatchChh = out.billAmount + (out.gst ?? 0) - out.totalPayable
  }
  return out
}

/** choose the extraction with the most fields found (for multi-account bills) */
export function pickBestSummary(list: AccountSummaryExtraction[]): AccountSummaryExtraction | null {
  if (list.length === 0) return null
  const fields: MoneyField[] = ['outstanding', 'penalty', 'billAmount', 'gst', 'creditsDebits', 'totalPayable']
  const score = (x: AccountSummaryExtraction): number => {
    let s = 0
    for (const f of fields) if (x[f] !== null) s++
    if (x.mismatchChh === 0) s += 10
    if (x.coreMissing.length === 0) s += 20
    return s
  }
  return [...list].sort((a, b) => score(b) - score(a))[0]
}

/**
 * Cross-check: does the block behave like a real bill summary?
 * total ≈ bill + gst + penalty + outstanding + credits (within one rupee)
 */
export function summaryLooksConsistent(x: AccountSummaryExtraction): boolean {
  if (x.billAmount === null || x.totalPayable === null) return false
  const parts = (x.billAmount + (x.gst ?? 0) + (x.penalty ?? 0) + (x.outstanding ?? 0) + (x.creditsDebits ?? 0)) | 0
  return Math.abs(parts - x.totalPayable) <= 100
}

// ---------------------------------------------------------------------------
// mobile number detection
// ---------------------------------------------------------------------------

const MOBILE_LINE_RES: RegExp[] = [
  /(?:mobile|cell|wireless|gsm)\s*(?:no|number|#)?\s*[:.\-]?\s*((?:\+?\s*91[\s\-]?)?[\d][\d\s\-().]{6,16}\d)/gi,
  /(?:subscriber|account|connection|customer)\s*(?:no|number|#)\s*[:.\-]?\s*([\d][\d\s\-]{6,16}\d)/gi
]

/** returns digit-string candidates ordered by occurrence count */
export function extractMobileCandidates(pages: PageText[]): string[] {
  const counts = new Map<string, number>()
  const bump = (raw: string): void => {
    let digits = raw.replace(/\D/g, '')
    if (digits.startsWith('91') && digits.length > 8) digits = digits.slice(2)
    if (digits.length < 8 || digits.length > 12) return
    counts.set(digits, (counts.get(digits) ?? 0) + 1)
  }
  for (const p of pages) {
    for (const line of p.text.split(/\r?\n/)) {
      for (const re of MOBILE_LINE_RES) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(line)) !== null) bump(m[1])
      }
      const only = /^\((\d{8,12})\)$/.exec(line.trim())
      if (only) bump(only[1])
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map((e) => e[0])
}

// ---------------------------------------------------------------------------
// Service Number (page 1, under the "Bill Summary" table header) — the
// PRIMARY source of truth for the subscriber's mobile number. Deliberately
// position-based so it never confuses the number with Account Code,
// Bill No, or an "Alternate Mobile Number for SMS bill" elsewhere.
// ---------------------------------------------------------------------------

export interface ServiceNumberResult {
  number: string | null
  /** "Bill Summary" heading seen on the page */
  headingFound: boolean
  /** a "Service Number" label was seen (in the heading region or anywhere) */
  labelFound: boolean
  /** every number found under the label (multi-SIM bills list more than one) */
  candidates: string[]
}

/** digits + country-code trimming, validated as a plausible mobile number */
export function normalizeServiceNumber(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('975')) d = d.slice(3)
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1)
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
  if (d.length < 7 || d.length > 10) return null
  return d
}

export function extractServiceNumber(pages: PageText[], pageNumber = 1): ServiceNumberResult {
  const page = pages.find((p) => p.page === pageNumber) ?? (pageNumber === 1 ? pages[0] : undefined)
  if (!page) return { number: null, headingFound: false, labelFound: false, candidates: [] }
  const lines = page.text.split(/\r?\n/)
  const headingIdx = lines.findIndex((l) => /bill\s+summary/i.test(l))
  const start = headingIdx >= 0 ? headingIdx : 0
  const limit = Math.min(lines.length, start + 80)
  for (let i = start; i < limit; i++) {
    if (!/service\s*(?:number|no)\b/i.test(lines[i])) continue
    // a) value printed on the same line right after the label
    const inline = /service\s*(?:number|no)\b\.?\s*[:.\-]?\s*(\+?\d[\d\s().\-+]{5,14}\d)/i.exec(lines[i])
    const inlineNum = inline ? normalizeServiceNumber(inline[1]) : null
    // b) value(s) printed directly below the label row — first bare/leading number
    const below: string[] = []
    let scanned = 0
    for (let j = i + 1; j < lines.length && scanned < 6; j++) {
      const t = lines[j].trim()
      if (!t) continue
      scanned++
      const m = /^\(?\s*(\+?(?:975|0|91)?[\s.\-]?\d[\d\s.\-]{5,13}\d)/.exec(t)
      if (m) {
        const d = normalizeServiceNumber(m[1])
        if (d && !below.includes(d)) { below.push(d); continue }
      }
      break // first non-numeric row means the value column ended
    }
    const number = inlineNum ?? below[0] ?? null
    const candidates = [...new Set([...(inlineNum ? [inlineNum] : []), ...below])]
    return { number, headingFound: headingIdx >= 0, labelFound: true, candidates }
  }
  return { number: null, headingFound: headingIdx >= 0, labelFound: false, candidates: [] }
}

// ---------------------------------------------------------------------------
// billing period suggestion
// ---------------------------------------------------------------------------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export function detectSuggestedPeriod(pages: PageText[]): { month: number; year: number } | null {
  const text = pages.slice(0, 3).map((p) => p.text).join('\n')
  const counts = new Map<string, number>()
  const add = (month: number, year: number): void => {
    if (year < 2000 || year > 2100 || month < 1 || month > 12) return
    const k = `${month}-${year}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let m: RegExpExecArray | null
  const dayMonthYear = /\b(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?[\s./-]+([a-z]{3,9})\.?[\s./-]+(20\d\d)\b/gi
  while ((m = dayMonthYear.exec(text)) !== null) {
    const mi = MONTHS.findIndex((mm) => mm.startsWith(m![2].toLowerCase()))
    if (mi >= 0) add(mi + 1, parseInt(m[3], 10))
  }
  const monthYear = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s-]+(20\d\d)\b/gi
  while ((m = monthYear.exec(text)) !== null) {
    const mi = MONTHS.findIndex((mm) => mm.startsWith(m![1].toLowerCase()))
    if (mi >= 0) add(mi + 1, parseInt(m[2], 10))
  }
  const ym = /\b(20\d\d)[-\s](0?[1-9]|1[0-2])\b/g
  while ((m = ym.exec(text)) !== null) add(parseInt(m[2], 10), parseInt(m[1], 10))
  if (counts.size === 0) return null
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const [mo, yr] = best[0].split('-').map((x) => parseInt(x, 10))
  return { month: mo, year: yr }
}
