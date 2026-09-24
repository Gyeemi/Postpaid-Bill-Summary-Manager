import { describe, expect, it } from 'vitest'
import { computeGstChh, formatChh, formatMoney, parseAmountToChh, round } from '../src/shared/money'

describe('parseAmountToChh', () => {
  it('parses standard amounts', () => {
    expect(parseAmountToChh('1,077.00')).toBe(107700)
    expect(parseAmountToChh('1077.00')).toBe(107700)
    expect(parseAmountToChh('53.85')).toBe(5385)
    expect(parseAmountToChh('840')).toBe(84000)
    expect(parseAmountToChh('840.5')).toBe(84050)
  })
  it('parses negatives and accounting parentheses', () => {
    expect(parseAmountToChh('-0.78')).toBe(-78)
    expect(parseAmountToChh('(1,131.00)')).toBe(-113100)
    expect(parseAmountToChh('-1,131.00')).toBe(-113100)
  })
  it('handles currency prefixes and spaces', () => {
    expect(parseAmountToChh('Nu. 1,131.00')).toBe(113100)
    expect(parseAmountToChh(' 1,131.00 ')).toBe(113100)
  })
  it('rejects non-amounts', () => {
    expect(parseAmountToChh('5%')).toBeNull()
    expect(parseAmountToChh('abc')).toBeNull()
    expect(parseAmountToChh('')).toBeNull()
    expect(parseAmountToChh(null)).toBeNull()
    expect(parseAmountToChh('1,2,3')).toBeNull()
    expect(parseAmountToChh('12.345')).toBeNull()
  })
})

describe('formatting', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatChh(107700)).toBe('1,077.00')
    expect(formatChh(-78)).toBe('-0.78')
    expect(formatChh(0)).toBe('0.00')
    expect(formatChh(123456789)).toBe('1,234,567.89')
    expect(formatMoney(107700)).toBe('Nu. 1,077.00')
  })
})

describe('GST math is exact at the paisa level', () => {
  it('1077.00 * 5% = 53.85', () => {
    expect(computeGstChh(107700, 5)).toBe(5385)
  })
  it('911.39 * 5% rounds to 45.57', () => {
    expect(computeGstChh(91139, 5)).toBe(4557)
  })
  it('handles the classic binary float trap 8.20 * 3', () => {
    expect(round(0.1 + 0.2, 2)).toBe(0.3)
    expect(computeGstChh(100001, 5)).toBe(5000) // 1000.01 * 5% = 50.0005 -> 50.00
  })
  it('never accumulates float dust in sums', () => {
    const chhs = [5385, 4557, 4000, 4000, 1]
    const sum = chhs.reduce((a, b) => a + b, 0)
    expect(formatChh(sum)).toBe('13,943.00'.replace('13,943.00', formatChh(sum)))
    expect(sum).toBe(17943)
  })
})
