import { describe, expect, it } from 'vitest'
import { formatBytes, formatCosine, formatDate, formatZ } from '../src/lib/format'

describe('formatBytes', () => {
  it('renders zero and sub-KB sizes as whole bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('switches units at each 1024 boundary', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB')
  })

  it('drops the decimal from 10 of a unit upward', () => {
    expect(formatBytes(10 * 1024)).toBe('10 KB')
    expect(formatBytes(999 * 1024 * 1024)).toBe('999 MB')
  })

  it('never displays 1024 of a unit — values that round there promote instead', () => {
    expect(formatBytes(1048064)).toBe('1.0 MB') // 1023.5 KB
    expect(formatBytes(1023 * 1024)).toBe('1023 KB')
  })

  it('values that round to 10 drop the decimal like the rest of the >=10 range', () => {
    expect(formatBytes(10189)).toBe('10 KB') // 9.95 KB
    expect(formatBytes(10138)).toBe('9.9 KB') // 9.90 KB
  })
})

describe('formatDate', () => {
  it('renders the timestamp in the local calendar', () => {
    expect(formatDate(Date.UTC(2026, 5, 15, 12, 0))).toContain('2026')
  })
})

describe('formatCosine', () => {
  it('always shows three places, trailing zeros kept', () => {
    // The trailing zero is information: it says the third place was measured
    // and is zero, not that the number was printed short.
    expect(formatCosine(0.1)).toBe('0.100')
    expect(formatCosine(0.107)).toBe('0.107')
    expect(formatCosine(1)).toBe('1.000')
  })

  it('rounds at the third place rather than truncating', () => {
    expect(formatCosine(0.10749)).toBe('0.107')
    expect(formatCosine(0.1076)).toBe('0.108')
    // Rounds up across the place, and across the leading digit with it.
    expect(formatCosine(0.9996)).toBe('1.000')
    // An exact-looking half goes whichever way the binary value actually sits —
    // 0.1075 is stored a hair BELOW the half, so it rounds down. Asserted
    // rather than legislated: no display formatter should promise a half-up
    // rule its own float representation does not keep.
    expect(formatCosine(0.1075)).toBe('0.107')
  })

  it('keeps the two scoring routes apart at their real magnitudes', () => {
    // The distributions D10 measured: a text query's ~0.1 against a
    // model-to-model 0.85-0.99. Neither is rescaled to meet the other.
    expect(formatCosine(0.1068)).toBe('0.107')
    expect(formatCosine(0.9124)).toBe('0.912')
  })
})

describe('formatZ', () => {
  it('shows two places, trailing zeros kept', () => {
    expect(formatZ(3.14159)).toBe('3.14')
    expect(formatZ(2)).toBe('2.00')
    expect(formatZ(4.031)).toBe('4.03')
  })

  it('rounds up across the place', () => {
    expect(formatZ(2.995)).toBe('3.00')
    expect(formatZ(1.996)).toBe('2.00')
  })

  it('prints a negative z as it comes', () => {
    // Ordinary, not an error: a result below the collection's median has one,
    // and a floor-filtered set can contain several.
    expect(formatZ(-0.4)).toBe('-0.40')
    expect(formatZ(-1.276)).toBe('-1.28')
  })
})
