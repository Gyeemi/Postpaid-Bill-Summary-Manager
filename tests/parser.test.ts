import { describe, expect, it } from 'vitest'
import {
  detectSuggestedPeriod,
  extractMobileCandidates,
  findAccountSummaries,
  pickBestSummary
} from '../src/shared/accountSummary'

const P = (page: number, ...lines: string[]) => ({ page, text: lines.join('\n') })

describe('Account Summary parser', () => {
  it('extracts the canonical block on page 1', () => {
    const pages = [
      P(
        1,
        'Bharti Airtel Limited — Wireless Postpaid Bill',
        'Subscriber: Mr. Akash Prajapati   Mobile No: 77106873',
        'Billing Period: 01 Aug 2026 to 31 Aug 2026',
        'Account Summary',
        'Outstanding -0.78',
        'Penalty 0.00',
        'Bill Amount 1,077.00',
        'GST (5%) 53.85',
        'Credits / Debits 0.00',
        'Total Payable 1,131.00',
        'Payment History',
        'Amount Paid on 05 Aug 2026 1,131.00'
      )
    ]
    const x = pickBestSummary(findAccountSummaries(pages))!
    expect(x).toBeTruthy()
    expect(x.page).toBe(1)
    expect(x.outstanding).toBe(-78)
    expect(x.penalty).toBe(0)
    expect(x.billAmount).toBe(107700)
    expect(x.gst).toBe(5385)
    expect(x.creditsDebits).toBe(0)
    expect(x.totalPayable).toBe(113100)
    expect(x.coreMissing).toEqual([])
    // the official sample bill itself differs by one paisa group due to
    // rounding (1077.00 + 53.85 = 1130.85 vs 1131.00) — the parser must
    // report the difference, never "fix" it.
    expect(x.mismatchChh).toBe(-15)
  })

  it('finds the section on page 2 and survives split label/value lines', () => {
    const pages = [
      P(1, 'USAGE DETAILS', 'Data Volume 3.4 GB', 'Amount 999.99 for the month'),
      P(
        2,
        'II. Account Summary :',
        'Outstanding',
        '-0.78',
        'Penalty 0.00',
        'Bill Amount',
        '1,077.00',
        'GST @ 5%',
        '53.85',
        'Credits / Debits 0.00',
        'Total Payable 1,131.00',
        'BILL PAYMENT OPTIONS',
        'Pay via app 4,999.99'
      )
    ]
    const x = pickBestSummary(findAccountSummaries(pages))!
    expect(x.page).toBe(2)
    expect(x.billAmount).toBe(107700)
    expect(x.gst).toBe(5385)
    expect(x.totalPayable).toBe(113100)
    expect(x.outstanding).toBe(-78)
    // the decoy amount from the next section must not leak in
    expect(x.creditsDebits).toBe(0)
  })

  it('ignores unrelated amounts and "refer to account summary" text', () => {
    const pages = [
      P(
        1,
        'Please refer to Account Summary on page 3 for payable amount.',
        'Your plan costs 899.00 per month',
        'Amount Payable (before this bill): 5,000.00'
      ),
      P(2, 'CALL DETAILS', '1,999.00 2,999.00 3,999.00'),
      P(3, 'Account Summary', 'Current Bill Amount 1,200.00', 'GST 60.00', 'Total Payable 1,260.00')
    ]
    const found = findAccountSummaries(pages)
    expect(found.length).toBe(1)
    expect(found[0].page).toBe(3)
    expect(found[0].billAmount).toBe(120000)
    expect(found[0].totalPayable).toBe(126000)
    expect(found[0].mismatchChh).toBe(0)
  })

  it('does not read GST from "including GST" prose', () => {
    const pages = [
      P(
        1,
        'Account Summary',
        'Current Bill Amount (including GST @ 5%) 1,077.00',
        'Total Payable 1,131.00'
      )
    ]
    const x = pickBestSummary(findAccountSummaries(pages))!
    expect(x.billAmount).toBe(107700)
    expect(x.gst).toBeNull() // must NOT pick up 1077.00 as GST
    expect(x.coreMissing).toEqual([])
  })

  it('ends the section at the next section heading', () => {
    const pages = [
      P(
        1,
        'Account Summary',
        'Bill Amount 100.00',
        'Total Payable 105.00',
        'Important instructions',
        'Pay 999999.00 immediately'
      )
    ]
    const x = pickBestSummary(findAccountSummaries(pages))!
    expect(x.billAmount).toBe(10000)
    expect(x.totalPayable).toBe(10500)
    const toks = JSON.stringify(x.evidence)
    expect(toks).not.toContain('999999')
  })

  it('reports which core fields are missing for partial sections', () => {
    const pages = [P(1, 'Account Summary', 'Outstanding 10.00', 'Penalty 0.00')]
    const x = pickBestSummary(findAccountSummaries(pages))!
    expect(x.coreMissing).toContain('billAmount')
    expect(x.coreMissing).toContain('totalPayable')
  })
})

describe('mobile detection', () => {
  it('prefers labelled mobile numbers and counts repeats', () => {
    const pages = [
      P(1, 'Postpaid Bill', 'Mobile No: +91 77106-873 00? no.', 'Connection No 77106873', 'Invoice No 55/2026', 'Mobile No: 77106873')
    ]
    const c = extractMobileCandidates(pages)
    expect(c).toContain('77106873')
    expect(c[0]).toBe('77106873')
  })
})

describe('billing period suggestion', () => {
  it('detects the most frequent month/year', () => {
    const pages = [P(1, 'Billing Period: 01 Aug 2026 to 31 Aug 2026', 'Due date: 10 September 2026', 'Bill Aug 2026')]
    expect(detectSuggestedPeriod(pages)).toEqual({ month: 8, year: 2026 })
  })
})
