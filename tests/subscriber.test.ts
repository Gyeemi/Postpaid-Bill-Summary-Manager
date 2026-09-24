import { describe, expect, it } from 'vitest'
import { personNamesMatch,  assignSrs, displaySr, mobileMatchKey, mobilesMatch, normalizeMobile, parseSubscriberFilename, sortByFileSr, splitTitle, stripPdfExtension } from '../src/shared/subscriber'

describe('filename handling', () => {
  it('strips only the .pdf extension', () => {
    expect(stripPdfExtension('Mr. Akash Prajapati.pdf')).toBe('Mr. Akash Prajapati')
    expect(stripPdfExtension('TBL Data Card.pdf')).toBe('TBL Data Card')
    expect(stripPdfExtension('bill.final.2026.pdf')).toBe('bill.final.2026')
    expect(stripPdfExtension('UPPER CASE.PDF')).toBe('UPPER CASE')
  })
  it('removes windows duplicate markers', () => {
    expect(stripPdfExtension('Akash Prajapati (1).pdf')).toBe('Akash Prajapati')
  })
})

describe('title splitting', () => {
  it('recognises honorifics', () => {
    expect(splitTitle('Mr. Akash Prajapati')).toEqual({ title: 'Mr.', name: 'Akash Prajapati' })
    expect(splitTitle('Mrs. Dechen Wangmo')).toEqual({ title: 'Mrs.', name: 'Dechen Wangmo' })
    expect(splitTitle('Ms Anita')).toEqual({ title: 'Ms.', name: 'Anita' })
  })
  it('leaves SIM descriptions untouched', () => {
    expect(splitTitle('TBL Data Card')).toEqual({ title: null, name: 'TBL Data Card' })
    expect(splitTitle('Boiler SIM')).toEqual({ title: null, name: 'Boiler SIM' })
  })
})

describe('mobile normalisation & matching', () => {
  it('keeps digits and drops the country code', () => {
    expect(normalizeMobile('+91 77106-873')).toBe('77106873')
    expect(normalizeMobile('9177106873')).toBe('77106873')
    expect(normalizeMobile('77100802')).toBe('77100802')
    expect(normalizeMobile('n/a')).toBeNull()
  })
  it('matches via last 8 digits', () => {
    expect(mobilesMatch('077106873', '77106873')).toBe(true)
    expect(mobilesMatch('+91-77106873', '77106873')).toBe(true)
    expect(mobilesMatch('177106873', '77106873')).toBe(true) // account-number prefix
    expect(mobilesMatch('77106873', '77106874')).toBe(false)
    expect(mobileMatchKey(null)).toBeNull()
  })
})

describe('filename Sr/Title/Username parsing', () => {
  it('moves a leading number to Sr and splits the title', () => {
    const p = parseSubscriberFilename('01. Mr. A K Basu Mullick.pdf')
    expect(p).toEqual({ sr: 1, fullName: 'Mr. A K Basu Mullick', title: 'Mr.', name: 'A K Basu Mullick' })
  })
  it('leaves Title empty when no honorific is present', () => {
    const p = parseSubscriberFilename('02. A K Basu Mullick.pdf')
    expect(p.sr).toBe(2)
    expect(p.title).toBeNull()
    expect(p.name).toBe('A K Basu Mullick')
  })
  it('accepts other separators and no leading zero', () => {
    expect(parseSubscriberFilename('7) Dr. Kinley Dorji.pdf')).toMatchObject({ sr: 7, title: 'Dr.', name: 'Kinley Dorji' })
    expect(parseSubscriberFilename('12- Mrs. Chimi.pdf')).toMatchObject({ sr: 12, title: 'Mrs.', name: 'Chimi' })
  })
  it('does not treat date-like names as numbers', () => {
    expect(parseSubscriberFilename('12-01 bill Aug.pdf').sr).toBeNull()
  })
  it('no number -> null Sr, plain parse still applies', () => {
    expect(parseSubscriberFilename('Mr. Akash Prajapati.pdf')).toMatchObject({ sr: null, title: 'Mr.', name: 'Akash Prajapati' })
  })
  it('displaySr + ordering', () => {
    expect(displaySr(3, 0)).toBe('03')
    expect(displaySr(null, 0)).toBe('01')
    expect(displaySr(0, 4)).toBe('05')
    const rows = [{ srFromFilename: null }, { srFromFilename: 3 }, { srFromFilename: 1 }]
    expect(sortByFileSr(rows).map((r) => r.srFromFilename)).toEqual([1, 3, null])
  })
})

describe('assignSrs', () => {
  it('gives unnumbered rows the smallest unused numbers', () => {
    expect(assignSrs([{ srFromFilename: 2 }, {}, {}])).toEqual(['02', '01', '03'])
    expect(assignSrs([{ srFromFilename: 1 }, { srFromFilename: 1 }, {}])).toEqual(['01', '01', '02'])
    expect(assignSrs([{}, {}])).toEqual(['01', '02'])
  })
})


describe('personNamesMatch (filename -> directory lookup)', () => {
  it('matches titles, initials and order-insensitive subsets', () => {
    expect(personNamesMatch('Mr. A K Basu Mullick', 'A K Basu Mullick')).toBe(true)
    expect(personNamesMatch('A.K. Basu Mullick', 'Basu Mullick')).toBe(true)
    expect(personNamesMatch('Cheten Dorji', 'C. Dorji')).toBe(true)
    expect(personNamesMatch('Ms. Sonam Lhamo', 'Sonam Lhamo')).toBe(true)
  })
  it('rejects unrelated or too-similar-but-different people', () => {
    expect(personNamesMatch('Boiler SIM', 'Dechen Wangmo')).toBe(false)
    expect(personNamesMatch('Akash Prajapati', 'A K Basu Mullick')).toBe(false)
    expect(personNamesMatch('Mr. Kumar', 'Mrs. Kumari Devi')).toBe(false) // 'kumar' vs 'kumari' not exact
    expect(personNamesMatch('TBL Data Card', 'TBL Voice Card')).toBe(false) // differs beyond initials
  })
  it('handles department SIM names without a person title', () => {
    expect(personNamesMatch('TBL Data Card', 'TBL Data Card')).toBe(true)
    expect(personNamesMatch('Boiler SIM', 'Boiler SIM')).toBe(true)
    expect(personNamesMatch('   ', 'Boiler SIM')).toBe(false)
  })
})
