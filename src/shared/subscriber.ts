/**
 * Subscriber identification helpers: PDF filename -> display name, title
 * parsing and mobile-number normalisation for directory matching.
 */

const TITLE_RE = /^(mr|mrs|ms|miss|dr|prof|hon'?ble|shri|smt)[.)]?\.?\s+/i

/** "Mr. Akash Prajapati.pdf" -> "Mr. Akash Prajapati" (extension removed only). */
export function stripPdfExtension(fileName: string): string {
  let name = fileName.trim().replace(/[\\/]+$/, '')
  name = name.replace(/\.pdf$/i, '')
  // strip Windows duplicate markers like "file (1).pdf" and control chars
  name = name.replace(/\s*\((?:\d+)\)$/, '')
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f<>:"|?*]/g, '')
  return name.replace(/\s+/g, ' ').trim()
}

/** Split a leading honorific ("Mr.", "Mrs.") from a subscriber name. */
export function splitTitle(fullName: string): { title: string | null; name: string } {
  const m = TITLE_RE.exec(fullName)
  if (!m) return { title: null, name: fullName.trim() }
  let title = m[1].toLowerCase()
  const map: Record<string, string> = { mr: 'Mr.', mrs: 'Mrs.', ms: 'Ms.', miss: 'Ms.', dr: 'Dr.', prof: 'Prof.', hon: 'Hon.', shri: 'Shri', smt: 'Smt.' }
  title = map[title.startsWith('hon') ? 'hon' : title] ?? title.replace(/^./, (c) => c.toUpperCase()) + '.'
  return { title, name: fullName.slice(m[0].length).trim() }
}

/** Leading report number in a filename, e.g. "01. ", "7) ", "12- ", "03_ ".
 * Only honoured when what follows starts with a letter (so "12-01 bill" stays intact). */
const FILE_SR_RE = /^(\d{1,3})[.)\-_]\s*(?=\p{L})/u

export interface ParsedFilename {
  /** number typed into the filename, to be shown as Sr. No — null when absent */
  sr: number | null
  /** everything after the number, exactly as written (title kept) */
  fullName: string
  /** honorific if one of Mr./Mrs./Ms./Dr./… leads the rest */
  title: string | null
  /** personal name with title removed — feeds the Username column */
  name: string
}

/** "01. Mr. A K Basu Mullick.pdf" -> Sr 01, title "Mr.", username "A K Basu Mullick". */
export function parseSubscriberFilename(fileName: string): ParsedFilename {
  let rest = stripPdfExtension(fileName)
  let sr: number | null = null
  const m = FILE_SR_RE.exec(rest)
  if (m) {
    sr = parseInt(m[1], 10) || null
    rest = rest.slice(m[0].length).trim()
  }
  const { title, name } = splitTitle(rest)
  return { sr, fullName: rest, title, name }
}

/** Display Sr for a report row: the filename's number when present, else position. */
export function displaySr(srFromFilename: number | null | undefined, fallbackIndex: number): string {
  const n = typeof srFromFilename === 'number' && srFromFilename > 0 ? srFromFilename : fallbackIndex + 1
  return String(n).padStart(2, '0')
}

/** Sr labels for a row list: keep explicit filename numbers, give the rest the
 * smallest unused numbers in order — so an unnumbered row never duplicates "02.". */
export function assignSrs<T extends { srFromFilename?: number | null }>(rows: T[]): string[] {
  const used = new Set<number>()
  for (const r of rows) if (typeof r.srFromFilename === 'number' && r.srFromFilename > 0) used.add(r.srFromFilename)
  let next = 1
  return rows.map((r) => {
    if (typeof r.srFromFilename === 'number' && r.srFromFilename > 0) return String(r.srFromFilename).padStart(2, '0')
    while (used.has(next)) next++
    used.add(next)
    return String(next++).padStart(2, '0')
  })
}

/** Stable order: filename numbers first (ascending), rows without a number keep input order after them. */
export function sortByFileSr<T extends { srFromFilename?: number | null }>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const sa = a.r.srFromFilename ?? Number.MAX_SAFE_INTEGER
      const sb = b.r.srFromFilename ?? Number.MAX_SAFE_INTEGER
      return sa === sb ? a.i - b.i : sa - sb
    })
    .map((x) => x.r)
}

/** keep digits only, strip country code, keep at most 12 digits */
export function normalizeMobile(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = String(raw).replace(/\D/g, '')
  if (d.length > 8 && d.startsWith('91')) d = d.slice(2)
  if (d.length > 8 && /^0?1?7\d{7}$/.test(d)) {
    // Bhutan mobile numbers are 8 digits; a leading '0' or '177...' account
    // prefix may be present.
    d = d.replace(/^0/, '')
    if (d.length > 8) d = d.slice(-8)
  }
  return d.length >= 6 ? d : null
}

/** comparison key: last 8 digits */
export function mobileMatchKey(raw: string | null | undefined): string | null {
  const n = normalizeMobile(raw)
  if (!n) return null
  return n.length > 8 ? n.slice(-8) : n
}

/** true when two numbers refer to the same SIM */
export function mobilesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = mobileMatchKey(a)
  const kb = mobileMatchKey(b)
  return !!ka && !!kb && ka === kb
}

/** human-friendly display number for a report */
export function prettyMobile(raw: string | null | undefined): string | null {
  const n = normalizeMobile(raw)
  if (!n) return null
  return n
}

// ---------------------------------------------------------------------------
// Subscriber-name matching (filename -> Employee & SIM Directory)
// ---------------------------------------------------------------------------

/** lowercase, title-free, punctuation-free person key */
export function personNameKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const words = raw
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|prof|shri|smt)\b\.?/g, ' ')
    .replace(/[^a-z\u00c0-\u024f ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
  return words.length ? words.join(' ') : null
}

/** subset test: every token of `small` lines up in order with a token of `big`
 *  (exact, or an initial letter standing for the full token); `big` may carry
 *  at most two extra tokens (extra initials). */
function subsetTokens(small: string[], big: string[]): boolean {
  if (big.length - small.length > 2) return false
  let bi = 0
  for (const s of small) {
    let found = false
    while (bi < big.length && !found) {
      const g = big[bi++]
      found = g === s || (s.length <= 2 && g.startsWith(s)) || (g.length <= 2 && s.startsWith(g))
    }
    if (!found) return false
  }
  return true
}

/** order-insensitive subset test: each token of small finds a fresh partner in big */
function subsetTokensUnordered(small: string[], big: string[]): boolean {
  if (big.length - small.length > 2) return false
  const used = new Set<number>()
  for (const s of small) {
    let hit = -1
    for (let i = 0; i < big.length && hit < 0; i++) {
      if (used.has(i)) continue
      const g = big[i]
      if (g === s || (s.length <= 2 && g.startsWith(s)) || (g.length <= 2 && s.startsWith(g))) hit = i
    }
    if (hit < 0) return false
    used.add(hit)
  }
  return true
}

/**
 * True when a filename-derived subscriber name and a directory name clearly
 * describe the same person. Conservative: needs a full (≥3-char) token to
 * match exactly; initials are only accepted as stand-ins for full tokens.
 * Token order is not enforced (directory entries are often written
 * "Surname GivenName").
 */
export function personNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = personNameKey(a)
  const kb = personNameKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const ta = ka.split(' ')
  const tb = kb.split(' ')
  const sharesFull = ta.some((x) => x.length >= 3 && tb.includes(x))
  if (!sharesFull) return false
  return subsetTokens(ta, tb) || subsetTokens(tb, ta) || subsetTokensUnordered(ta, tb) || subsetTokensUnordered(tb, ta)
}
