// Line diff for the side-by-side code view (LCS over lines).

export type DiffRow =
  | { kind: "same"; left: string; right: string; leftNo: number; rightNo: number }
  | { kind: "removed"; left: string; leftNo: number }
  | { kind: "added"; right: string; rightNo: number }

// LCS is O(n*m) memory; past this many cells, fall back to a positional diff.
const MAX_CELLS = 4_000_000

export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split("\n")
  const b = after.split("\n")

  if (a.length * b.length > MAX_CELLS) {
    return positionalDiff(a, b)
  }

  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "same", left: a[i], right: b[j], leftNo: i + 1, rightNo: j + 1 })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: "removed", left: a[i], leftNo: i + 1 })
      i++
    } else {
      rows.push({ kind: "added", right: b[j], rightNo: j + 1 })
      j++
    }
  }
  for (; i < a.length; i++) rows.push({ kind: "removed", left: a[i], leftNo: i + 1 })
  for (; j < b.length; j++) rows.push({ kind: "added", right: b[j], rightNo: j + 1 })
  return rows
}

function positionalDiff(a: string[], b: string[]): DiffRow[] {
  const rows: DiffRow[] = []
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    if (k < a.length && k < b.length && a[k] === b[k]) {
      rows.push({ kind: "same", left: a[k], right: b[k], leftNo: k + 1, rightNo: k + 1 })
      continue
    }
    if (k < a.length) rows.push({ kind: "removed", left: a[k], leftNo: k + 1 })
    if (k < b.length) rows.push({ kind: "added", right: b[k], rightNo: k + 1 })
  }
  return rows
}
