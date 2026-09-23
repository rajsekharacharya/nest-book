/*
  Parses the room-number input on the bulk-add form (ARCHITECTURE.md §9.2).

  Accepts comma-separated values, numeric ranges, or a mix:
    "101, 102, 103-105"  →  101 102 103 104 105

  Non-numeric numbers are real — "A1", "G-2", "Annexe 3" — so they are allowed
  as individual entries. Ranges require numeric endpoints, because "A1-A5" has
  no single obvious expansion.

  Pure and separately testable: this is the kind of parsing that quietly gets
  an off-by-one wrong, and it decides what rooms exist.
*/

export type ParsedRoomNumbers = {
  numbers: string[]
  errors: string[]
  /** Entries typed more than once, reported rather than silently collapsed. */
  duplicates: string[]
}

/** Ranges are capped so a typo like "1-99999" cannot try to create 99k rooms. */
const MAX_RANGE_SPAN = 200

export function parseRoomNumbers(input: string): ParsedRoomNumbers {
  const numbers: string[] = []
  const errors: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()

  const add = (value: string) => {
    if (seen.has(value)) {
      if (!duplicates.includes(value)) duplicates.push(value)
      return
    }
    seen.add(value)
    numbers.push(value)
  }

  // Newlines are separators too — pasting a column from a spreadsheet is the
  // obvious way to fill this in.
  const tokens = input
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter(Boolean)

  for (const token of tokens) {
    // A hyphen means a range only when both sides are numeric; otherwise it is
    // part of the name, as in "G-2".
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/)

    if (range) {
      const [, rawStart, rawEnd] = range
      const start = Number(rawStart)
      const end = Number(rawEnd)

      if (start > end) {
        errors.push(`"${token}" counts backwards.`)
        continue
      }
      if (end - start + 1 > MAX_RANGE_SPAN) {
        errors.push(`"${token}" covers more than ${MAX_RANGE_SPAN} rooms.`)
        continue
      }

      // Preserve leading zeros: "008-010" should give 008, 009, 010, because
      // that is how the doors are actually numbered.
      const width = rawStart.length === rawEnd.length ? rawStart.length : 0
      for (let value = start; value <= end; value++) {
        add(width > 0 ? String(value).padStart(width, '0') : String(value))
      }
      continue
    }

    if (token.length > 20) {
      errors.push(`"${token.slice(0, 20)}…" is too long for a room number.`)
      continue
    }

    add(token)
  }

  return { numbers, errors, duplicates }
}
