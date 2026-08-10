import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate } from '../src/lib/format'

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
})

describe('formatDate', () => {
  it('renders the timestamp in the local calendar', () => {
    expect(formatDate(Date.UTC(2026, 5, 15, 12, 0))).toContain('2026')
  })
})
