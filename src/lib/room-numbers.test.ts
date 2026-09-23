import { describe, expect, it } from 'vitest'
import { parseRoomNumbers } from './room-numbers'

describe('parseRoomNumbers', () => {
  it('splits a comma-separated list', () => {
    expect(parseRoomNumbers('101, 102, 103').numbers).toEqual(['101', '102', '103'])
  })

  it('expands a numeric range inclusively at both ends', () => {
    // The off-by-one that matters: 103-105 is three rooms, not two.
    expect(parseRoomNumbers('103-105').numbers).toEqual(['103', '104', '105'])
  })

  it('mixes single values and ranges', () => {
    expect(parseRoomNumbers('101, 102, 103-105').numbers).toEqual([
      '101',
      '102',
      '103',
      '104',
      '105',
    ])
  })

  it('treats a single-value range as one room', () => {
    expect(parseRoomNumbers('201-201').numbers).toEqual(['201'])
  })

  it('preserves leading zeros when both endpoints share a width', () => {
    // The doors read 008, 009, 010 — not 8, 9, 10.
    expect(parseRoomNumbers('008-010').numbers).toEqual(['008', '009', '010'])
  })

  it('does not invent padding when endpoint widths differ', () => {
    expect(parseRoomNumbers('8-10').numbers).toEqual(['8', '9', '10'])
  })

  it('keeps a hyphen that is part of a name rather than a range', () => {
    // "G-2" is a ground-floor room, not a range from G to 2.
    expect(parseRoomNumbers('G-2, A1').numbers).toEqual(['G-2', 'A1'])
  })

  it('accepts non-numeric room numbers as individual entries', () => {
    expect(parseRoomNumbers('Annexe 3, Cottage').numbers).toEqual(['Annexe 3', 'Cottage'])
  })

  it('accepts newlines as separators, for pasted spreadsheet columns', () => {
    expect(parseRoomNumbers('101\n102\n103').numbers).toEqual(['101', '102', '103'])
  })

  it('reports a backwards range instead of silently producing nothing', () => {
    const result = parseRoomNumbers('105-103')
    expect(result.numbers).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it('refuses a range large enough to be a typo', () => {
    const result = parseRoomNumbers('1-99999')
    expect(result.numbers).toEqual([])
    expect(result.errors[0]).toMatch(/more than/)
  })

  it('collapses duplicates and reports them', () => {
    const result = parseRoomNumbers('101, 101, 102')
    expect(result.numbers).toEqual(['101', '102'])
    expect(result.duplicates).toEqual(['101'])
  })

  it('detects a duplicate produced by an overlapping range', () => {
    const result = parseRoomNumbers('101-103, 102')
    expect(result.numbers).toEqual(['101', '102', '103'])
    expect(result.duplicates).toEqual(['102'])
  })

  it('ignores blank entries from trailing or doubled commas', () => {
    expect(parseRoomNumbers('101, , 102,').numbers).toEqual(['101', '102'])
  })

  it('returns nothing for empty input without raising an error', () => {
    const result = parseRoomNumbers('   ')
    expect(result.numbers).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('tolerates spaces around a range hyphen', () => {
    expect(parseRoomNumbers('103 - 105').numbers).toEqual(['103', '104', '105'])
  })
})
