/**
 * "Payable Before" date helpers — the date by which the combined postpaid
 * bills must be paid, chosen manually by the user on the Bill Summary tab
 * (it replaced the former "Bill Preparation Month" picker).
 *
 * Stored internally as ISO yyyy-mm-dd (from the native calendar input);
 * ALWAYS displayed as DD|MM|YYYY, e.g. 2026-09-30 -> "30|09|2026".
 * Nothing here ever derives or defaults the date — it exists only when the
 * user explicitly selected it.
 */

const ISO_RE = /^\d{4}-(\d{2})-(\d{2})$/

/** Strict, real-calendar validation of the internal ISO form. */
export function isValidPayableIso(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = ISO_RE.exec(s)
  if (!m) return false
  const month = Number(m[1])
  const day = Number(m[2])
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) return false
  const daysInMonth = new Date(year, month, 0).getDate()
  return day <= daysInMonth
}

/** '2026-09-30' -> '30|09|2026'; null/invalid -> null. */
export function formatPayableBefore(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null
  const m = ISO_RE.exec(iso)
  if (!m) return null
  return `${m[2]}|${m[1]}|${iso.slice(0, 4)}`
}
