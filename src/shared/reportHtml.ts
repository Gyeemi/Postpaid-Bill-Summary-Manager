/**
 * Builds the standalone HTML used for BOTH the on-screen print preview and the
 * exported / printed PDF. Kept as a single source of truth so the paper output
 * and the PDF always match. Amounts arrive as chhatrum (integer cents).
 */

import type { ReportSnapshot } from './types'
import { formatChh } from './money'

export interface ReportHtmlOptions {
  /** adds the on-screen toolbar with Print / Export buttons */
  interactive?: boolean
  /** data: URI of the organization logo, already read from disk */
  logoDataUri?: string | null
  darkChrome?: boolean
}

function esc(s: string | null | undefined): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildReportHtml(snapshot: ReportSnapshot, opts: ReportHtmlOptions = {}): string {
  const currency = snapshot.currency || 'Nu.'
  const gstRate = snapshot.gstRate ?? 5
  const rows = snapshot.rows
  const totalFmt = (v: number | null): string => (v === null ? '—' : `Nu. ${formatChh(v)}`)
  const cell = (v: number | null): string => (v === null ? '<span class="na">—</span>' : formatChh(v))

  const bodyRows = rows
    .map(
      (r, i) => `<tr>
      <td class="c">${esc(r.sr ?? '') || String(i + 1).padStart(2, '0')}</td>
      <td class="c">${esc(r.title) || '&nbsp;'}</td>
      <td>${esc(r.username)}</td>
      <td>${esc(r.designation) || '&nbsp;'}</td>
      <td class="mono">${esc(r.mobile) || '&nbsp;'}</td>
      <td class="num">${cell(r.outstanding ?? null)}</td>
      <td class="num">${cell(r.penalty ?? null)}</td>
      <td class="num">${cell(r.basic)}</td>
      <td class="num">${cell(r.gst)}</td>
      <td class="num">${cell(r.credits ?? null)}</td>
      <td class="num">${cell(r.total)}</td>
      <td class="num">${cell(r.deduction)}</td>
    </tr>`
    )
    .join('\n')

  const totals = snapshot.totals
  const logo = opts.logoDataUri
    ? `<img class="logo" src="${opts.logoDataUri}" alt="logo"/>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(snapshot.reportTitle)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", "Calibri", Arial, sans-serif;
    color: #16202e; background: #eef1f5; font-size: 11px;
  }
  .toolbar {
    position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; align-items: center;
    background: #16324f; color: #fff; padding: 10px 16px;
  }
  .toolbar .t { font-weight: 600; margin-right: auto; font-size: 13px; }
  .toolbar button {
    border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600;
    cursor: pointer; background: #2f6db3; color: #fff;
  }
  .toolbar button.alt { background: #ffffff1a; border: 1px solid #ffffff55; }
  /* A4 PORTRAIT: 210mm page − 2 × 11mm screen margins ⇒ 188mm sheet keeps a
     comfortable fit; print margins defined in @page below. */
  .sheet {
    width: 188mm; margin: 14px auto; background: #fff; padding: 10mm 9mm 8mm;
    box-shadow: 0 4px 18px rgba(10, 30, 60, .18);
  }
  header.rpt { display: flex; align-items: flex-start; gap: 14px; border-bottom: 3px solid #16324f; padding-bottom: 10px; }
  header.rpt .org { flex: 1; }
  header.rpt .org h1 { margin: 0; font-size: 16.5px; color: #16324f; letter-spacing: .2px; }
  header.rpt .org .sub { color: #4d5a6b; font-size: 11px; margin-top: 2px; }
  .logo { max-height: 46px; max-width: 130px; object-fit: contain; }
  h2.rpt-title { text-align: center; margin: 10px 0 2px; font-size: 13.5px; color: #14263c; }
  .meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; font-size: 9.5px; color: #40506a; margin-bottom: 8px; }
  .meta b { color: #16202e; }
  table.grid { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.grid { table-layout: fixed; }
  table.grid th, table.grid td { border: 1px solid #9fb0c4; padding: 2.6px 3.4px; vertical-align: top; font-size: 9.2px; line-height: 1.25; word-wrap: break-word; }
  table.grid thead th {
    background: #16324f; color: #fff; font-size: 8.7px; font-weight: 600; line-height: 1.2;
    text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  table.grid td.num, table.grid th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.grid td.c, table.grid th.c { text-align: center; }
  table.grid td.mono { text-align: center; letter-spacing: .4px; }
  tbody tr:nth-child(even) td { background: #f4f7fb; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tr.gtotal td { font-weight: 700; background: #dbe7f5 !important; border-top: 2px solid #16324f; }
  .na { color: #9aa7b8; }
  .totals { display: flex; justify-content: flex-end; margin-top: 10px; }
  .totals table { border-collapse: collapse; min-width: 62mm; font-size: 10.5px; }
  .totals td { padding: 2.6px 8px; border-bottom: 1px solid #d7dfe9; }
  .totals td.v { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals tr.final td { border-top: 2px solid #16324f; border-bottom: 0; font-weight: 700; }
  .foot { display: flex; margin-top: 16mm; }
  .sig { flex: 1; text-align: center; }
  .sig .line { border-top: 1px solid #16202e; width: 48mm; margin: 0 auto 4px; }
  .sig .cap { font-size: 10.5px; color: #40506a; }
  .rpt-note { margin-top: 12px; font-size: 10.5px; color: #4d5a6b; border-top: 1px dashed #c3ccd8; padding-top: 6px; }
  .pages { font-size: 10px; color: #66748c; margin-top: 6px; }
  @media print {
    body { background: #fff; font-size: 10.5px; }
    .toolbar { display: none !important; }
    /* the sheet fills the printable area; @page defines the PORTRAIT paper */
    .sheet { width: auto; margin: 0; box-shadow: none; padding: 0; }
    @page { size: A4 portrait; margin: 9mm 8mm 10mm 8mm; }
    /* header repeats on every printed page */
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { break-inside: avoid; }
    .foot { margin-top: 13mm; }
  }
</style>
</head>
<body>
${
  opts.interactive
    ? `<div class="toolbar no-print">
    <span class="t">Print preview — ${esc(snapshot.reportTitle)}</span>
    <button id="btn-print">Print…</button>
    <button class="alt" id="btn-close">Close</button>
  </div>`
    : ''
}
<div class="sheet" id="report-sheet">
  <header class="rpt">
    ${logo}
    <div class="org">
      <h1>${esc(snapshot.orgName) || 'Organization'}</h1>
      <div class="sub">${esc(snapshot.orgSub)}</div>
    </div>
  </header>

  <h2 class="rpt-title">${esc(snapshot.reportTitle)}</h2>
  <div class="meta">
    <span>Billing Month: <b>${esc(snapshot.billingLabel ?? snapshot.periodLabel)}</b></span>
    ${snapshot.payableBeforeFormatted ? `<span>Payable Before: <b>${esc(snapshot.payableBeforeFormatted)}</b></span>` : (snapshot.prepLabel ? `<span>Prepared In: <b>${esc(snapshot.prepLabel)}</b></span>` : '')}
    <span>Report date: <b>${esc(snapshot.reportDate)}</b></span>
    <span>Generated: <b>${esc(snapshot.generatedAt)}</b></span>
  </div>

  <table class="grid">
    <thead>
      <tr>
        <th class="c" style="width:6mm">Sr.</th>
        <th class="c" style="width:10mm">Title</th>
        <th style="width:19mm">Username</th>
        <th style="width:16mm">Designation</th>
        <th class="c" style="width:17mm">Number</th>
        <th class="num" style="width:15mm">Outstanding (${esc(currency)})</th>
        <th class="num" style="width:11mm">Penalty (${esc(currency)})</th>
        <th class="num" style="width:16mm">Bill Amount (${esc(currency)})</th>
        <th class="num" style="width:13mm">GST @ ${gstRate}% (${esc(currency)})</th>
        <th class="num" style="width:15mm">Credits / Debits (${esc(currency)})</th>
        <th class="num" style="width:17mm">Total Payable (${esc(currency)})</th>
        <th class="num" style="width:15mm">Deduction (${esc(currency)})</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || '<tr><td colspan="12" style="text-align:center;color:#98a4b6">No records included</td></tr>'}
      <tr class="gtotal">
        <td colspan="5" style="text-align:right">GRAND TOTAL (${rows.length} bill${rows.length === 1 ? '' : 's'})</td>
        <td class="num">${totalFmt(totals.outstanding ?? 0)}</td>
        <td class="num">${totalFmt(totals.penalty ?? 0)}</td>
        <td class="num">${totalFmt(totals.basic)}</td>
        <td class="num">${totalFmt(totals.gst)}</td>
        <td class="num">${totalFmt(totals.credits ?? 0)}</td>
        <td class="num">${totalFmt(totals.total)}</td>
        <td class="num">${totalFmt(totals.deduction)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td>Total Outstanding</td><td class="v">${totalFmt(totals.outstanding ?? 0)}</td></tr>
      <tr><td>Total Penalty</td><td class="v">${totalFmt(totals.penalty ?? 0)}</td></tr>
      <tr><td>Total Bill Amount</td><td class="v">${totalFmt(totals.basic)}</td></tr>
      <tr><td>Total GST @ ${gstRate}%</td><td class="v">${totalFmt(totals.gst)}</td></tr>
      <tr><td>Total Credits / Debits</td><td class="v">${totalFmt(totals.credits ?? 0)}</td></tr>
      <tr class="final"><td>Total Payable</td><td class="v">${totalFmt(totals.total)}</td></tr>
      <tr class="final"><td>Total Deduction</td><td class="v">${totalFmt(totals.deduction)}</td></tr>
    </table>
  </div>

  <div class="foot">
    <div class="sig"><div class="line"></div><div class="cap">Prepared By</div></div>
    <div class="sig"><div class="line"></div><div class="cap">Checked By</div></div>
    <div class="sig"><div class="line"></div><div class="cap">Approved By</div></div>
  </div>

  ${snapshot.footerText && snapshot.footerText.trim() ? `<div class="rpt-note">${esc(snapshot.footerText)}</div>` : ''}
</div>
${
  opts.interactive
    ? `<script>
      const p = window.api && window.api.printWin;
      const bp = document.getElementById('btn-print');
      if (bp) bp.onclick = () => { if (p) p.print(); else window.print(); };
      const bc = document.getElementById('btn-close');
      if (bc) bc.onclick = () => { if (p) p.close(); else window.close(); };
    </script>`
    : ''
}
</body>
</html>`
}
