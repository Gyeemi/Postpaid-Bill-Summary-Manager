/**
 * PDF text extraction pipeline (runs inside the worker thread, never in the UI).
 *
 * - pdf.js text layer -> line reconstruction
 * - Account Summary parser (label based, any page)
 * - OCR fallback (@napi-rs/canvas rasterisation + tesseract.js) for scanned bills
 */

import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { ExtractOutcome, PageText } from '../../shared/types'
import {
  detectSuggestedPeriod,
  extractMobileCandidates,
  extractServiceNumber,
  findAccountSummaries,
  pickBestSummary,
  summaryLooksConsistent,
  type PageText as SectionPageText
} from '../../shared/accountSummary'
import { formatChh } from '../../shared/money'

export interface ExtractRequest {
  billId?: number
  filePath: string
  pdfjsWorkerPath: string | null
  tessdataDir: string | null
  allowOcr: boolean
}

const SCANNED_CHARS_PER_PAGE = 40

function emptyOutcome(): ExtractOutcome {
  return {
    status: 'failed',
    outstanding: null,
    penalty: null,
    billAmount: null,
    gst: null,
    creditsDebits: null,
    totalPayable: null,
    mobileNumber: null,
    mobileCandidates: [],
    serviceNumber: null,
    mobileSource: 'none',
    evidence: {},
    warnings: [],
    error: null,
    ocrUsed: false,
    summaryPage: null,
    suggestedMonth: null,
    suggestedYear: null,
    textLength: 0
  }
}

async function loadPdfjs(workerPath: string | null): Promise<any> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (workerPath && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = /^(file|https?):/.test(workerPath) ? workerPath : pathToFileURL(workerPath).href
  }
  return pdfjs
}

async function pageToLines(page: any): Promise<string> {
  const content = await page.getTextContent()
  const items: { y: number; x: number; s: string }[] = []
  for (const it of content.items as any[]) {
    const str = typeof it.str === 'string' ? it.str : ''
    if (!str) continue
    const tr = it.transform
    items.push({ y: tr[5], x: tr[4], s: str })
  }
  if (items.length === 0) return ''
  items.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: { y: number; parts: { x: number; s: string }[] }[] = []
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2.4)
    if (row) {
      row.parts.push({ x: it.x, s: it.s })
      row.y = (row.y * (row.parts.length - 1) + it.y) / row.parts.length
    } else {
      rows.push({ y: it.y, parts: [{ x: it.x, s: it.s }] })
    }
  }
  rows.sort((a, b) => b.y - a.y)
  const lines: string[] = []
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x)
    let line = ''
    for (const p of r.parts) {
      if (line && !line.endsWith(' ') && !p.s.startsWith(' ')) line += ' '
      line += p.s
    }
    const trimmed = line.replace(/\s+/g, ' ').trim()
    if (trimmed) lines.push(trimmed)
  }
  return lines.join('\n')
}

interface DocPages {
  pages: PageText[]
  numPages: number
}

async function readPdfPages(filePath: string, pdfjs: any): Promise<{ doc: any; data: DocPages }> {
  const data = fs.readFileSync(filePath)
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    verbosity: 0,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    ignoreErrors: true
  }).promise
  const pages: PageText[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const text = await pageToLines(page)
    pages.push({ page: i, text })
  }
  return { doc, data: { pages, numPages: doc.numPages } }
}

async function ocrScannedPages(
  doc: any,
  pageIndexes: number[],
  tessdataDir: string | null
): Promise<PageText[]> {
  const { renderPageToPng, recognizePng } = await import('./ocr')
  const out: PageText[] = []
  for (const idx of pageIndexes) {
    try {
      const page = await doc.getPage(idx)
      const png = await renderPageToPng(page)
      if (!png) continue
      const text = await recognizePng(png, tessdataDir)
      if (text && text.trim()) out.push({ page: idx, text })
    } catch {
      /* page OCR failed — continue with the others */
    }
  }
  return out
}

function mergeOcrPages(pages: PageText[], ocr: PageText[]): PageText[] {
  const map = new Map(pages.map((p) => [p.page, p]))
  for (const o of ocr) {
    const cur = map.get(o.page)
    if (cur && cur.text.length < o.text.length) map.set(o.page, o)
    else if (!cur) map.set(o.page, o)
  }
  return [...map.values()].sort((a, b) => a.page - b.page)
}

export async function extractBillPdf(req: ExtractRequest): Promise<ExtractOutcome> {
  const outcome = emptyOutcome()
  if (!fs.existsSync(req.filePath)) {
    outcome.error = 'File not found on disk — it may have been moved, renamed or deleted. Re-import it.'
    return outcome
  }
  const head = Buffer.alloc(1024)
  const fd = fs.openSync(req.filePath, 'r')
  try {
    const n = fs.readSync(fd, head, 0, 1024, 0)
    if (!head.subarray(0, n).includes('%PDF-')) {
      outcome.error = 'The file is not a valid PDF document.'
      return outcome
    }
  } finally {
    fs.closeSync(fd)
  }

  let pdfjs: any
  try {
    pdfjs = await loadPdfjs(req.pdfjsWorkerPath)
  } catch (err) {
    outcome.error = `PDF engine failed to load: ${(err as Error).message}`
    return outcome
  }

  let doc: any = null
  let pages: PageText[] = []
  let numPages = 0
  try {
    const res = await readPdfPages(req.filePath, pdfjs)
    doc = res.doc
    pages = res.data.pages
    numPages = res.data.numPages
  } catch (err: any) {
    const name = String(err?.name ?? '')
    if (/password/i.test(name) || /password/i.test(String(err?.message))) {
      outcome.error = 'The PDF is password protected. Remove the password or enter the bill values manually.'
    } else if (/xref|structure|Missing Root|catalog|InvalidPDF/i.test(String(err?.message ?? ''))) {
      outcome.error = 'The PDF appears to be corrupted and could not be parsed.'
    } else {
      outcome.error = `Could not read the PDF: ${String(err?.message ?? err)}`
    }
    try {
      await doc?.destroy?.()
    } catch {
      /* ignore */
    }
    return outcome
  }

  try {
    const textLength = pages.reduce((a, p) => a + p.text.length, 0)
    outcome.textLength = textLength
    let summaries = findAccountSummaries(pages)
    let best = pickBestSummary(summaries)
    let ocrUsed = false

    const looksScanned = textLength < Math.max(120, SCANNED_CHARS_PER_PAGE * Math.max(1, numPages))
    if ((!best || best.coreMissing.length > 0) && looksScanned && req.allowOcr) {
      try {
        const ocr = await ocrScannedPages(doc, Array.from({ length: Math.min(numPages, 4) }, (_, i) => i + 1), req.tessdataDir)
        if (ocr.length > 0) {
          pages = mergeOcrPages(pages, ocr)
          ocrUsed = true
          summaries = findAccountSummaries(pages)
          best = pickBestSummary(summaries)
        }
      } catch (err) {
        outcome.warnings.push(`OCR fallback failed: ${(err as Error).message}`)
      }
    }
    outcome.ocrUsed = ocrUsed

    // --- Service Number on page 1 = primary source of truth for the mobile number ---
    const sn = extractServiceNumber(pages)
    const fallbackCandidates = extractMobileCandidates(pages)
    outcome.mobileCandidates = [...new Set([...(sn.number ? [sn.number, ...sn.candidates] : []), ...fallbackCandidates])]
    if (sn.number) {
      outcome.serviceNumber = sn.number
      outcome.mobileNumber = sn.number
      outcome.mobileSource = 'service-number'
      if (!sn.headingFound) {
        outcome.warnings.push('Service Number was matched by its label without a "Bill Summary" heading on page 1 — confirm the number is the right one.')
      }
    } else {
      outcome.serviceNumber = null
      outcome.mobileNumber = fallbackCandidates[0] ?? null
      outcome.mobileSource = fallbackCandidates.length ? 'label-fallback' : 'none'
    }

    const suggested = detectSuggestedPeriod(pages)
    if (suggested) {
      outcome.suggestedMonth = suggested.month
      outcome.suggestedYear = suggested.year
    }

    if (!best) {
      const foundHeadingOnly = pages.some((p) => /account\s*summary/i.test(p.text))
      outcome.status = 'failed'
      outcome.error = foundHeadingOnly
        ? 'An "Account Summary" heading was found but its amounts could not be read. Enter the values manually.' +
          (ocrUsed ? '' : ' (Text layer appeared to be an image scan; OCR was attempted.)')
        : 'No "Account Summary" section was detected in this PDF.' +
          (looksScanned && !ocrUsed ? ' The file looks scanned and OCR is unavailable/failed — enter values manually.' : '')
      return outcome
    }

    outcome.outstanding = best.outstanding
    outcome.penalty = best.penalty
    outcome.billAmount = best.billAmount
    outcome.gst = best.gst
    outcome.creditsDebits = best.creditsDebits
    outcome.totalPayable = best.totalPayable
    outcome.evidence = best.evidence
    outcome.summaryPage = best.page

    if (summaries.length > 1) {
      outcome.warnings.push(`Multiple Account Summary blocks found in the document — the most complete one was used (page ${best.page}).`)
    }
    if (best.coreMissing.length > 0) {
      const missing: Record<string, string> = {
        billAmount: 'Bill Amount',
        totalPayable: 'Total Payable',
        gst: 'GST'
      }
      outcome.status = 'needs_review'
      outcome.warnings.push(
        `Account Summary found but these values could not be matched: ${best.coreMissing.map((c) => missing[c] ?? c).join(', ')}. Please review / enter them.`
      )
      return outcome
    }
    if (best.gst === null) {
      outcome.status = 'needs_review'
      outcome.warnings.push('GST amount was not found next to its label. Enable auto-calculation or enter it.')
      return outcome
    }
    if (best.mismatchChh !== null && best.mismatchChh !== 0) {
      const consistent = summaryLooksConsistent(best)
      if (!consistent) {
        outcome.status = 'needs_review'
        outcome.warnings.push(
          `Basic + GST differs from Total Payable by Nu. ${formatChh(best.mismatchChh)}. Outstanding / penalty / credits may explain it — please review.`
        )
        return outcome
      }
      outcome.warnings.push(
        `Basic + GST differs from Total Payable by Nu. ${formatChh(best.mismatchChh)} — explained by Outstanding/Penalty/Credits in the bill.`
      )
    }
    // The mobile number's authoritative source is the Employee & SIM Directory
    // (matched by subscriber name). Anything found in the PDF — the page-1
    // Service Number included — is recorded as a hint/cross-check here, never
    // a review trigger by itself.
    if (!sn.number) {
      outcome.warnings.push(
        fallbackCandidates.length
          ? `No Service Number found on page 1 — PDF shows ${outcome.mobileNumber} under another label; it is kept only as a hint.`
          : 'No Service Number found in the page-1 Bill Summary; the directory match (by subscriber name) decides the number.'
      )
    }
    outcome.status = 'extracted'
    return outcome
  } finally {
    try {
      await doc?.destroy?.()
    } catch {
      /* ignore */
    }
  }
}

export type { SectionPageText }
