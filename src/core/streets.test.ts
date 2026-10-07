import { describe, expect, it } from 'vitest'
import { streetPath } from './streets'
import type { Position } from './types'

// A street grid around the origin, 0.001° (~111 m) between streets. Each
// street is one long line, as a map would draw it, crossing the others with
// no shared vertex — the network has to find the crossings itself.
const S = 0.001
function grid(n = 6): Position[][] {
  const lines: Position[][] = []
  for (let i = 0; i <= n; i++) {
    lines.push([
      [0, i * S],
      [n * S, i * S],
    ])
    lines.push([
      [i * S, 0],
      [i * S, n * S],
    ])
  }
  return lines
}

/** The path, rounded to 9 decimals so interpolated crossings compare cleanly. */
const ok = (r: ReturnType<typeof streetPath>) => {
  if (!('path' in r)) throw new Error(`expected a path, got ${r.reason}`)
  return r.path.map(([x, y]) => [Number(x.toFixed(9)), Number(y.toFixed(9))] as Position)
}

describe('streetPath', () => {
  it('follows a street between two points on it, in either direction', () => {
    const lines = grid()
    expect(ok(streetPath(lines, [0.0005, S], [0.0035, S]))).toEqual([
      [S, S],
      [2 * S, S],
      [3 * S, S],
    ])
    expect(ok(streetPath(lines, [0.0035, S], [0.0005, S]))).toEqual([
      [3 * S, S],
      [2 * S, S],
      [S, S],
    ])
  })

  it('turns corners, and finds the crossings the lines never shared as vertices', () => {
    const path = ok(streetPath(grid(), [0.0005, S], [2 * S, 0.0025]))
    // Every turn is at a crossing of two streets that were drawn as separate lines.
    for (const [x, y] of path) {
      expect(Math.abs(x / S - Math.round(x / S))).toBeLessThan(1e-6)
      expect(Math.abs(y / S - Math.round(y / S))).toBeLessThan(1e-6)
    }
    expect(path.at(-1)).toEqual([2 * S, 2 * S])
  })

  it('stays near the straight line rather than taking an equally long detour', () => {
    // From the bottom-left crossing to the top-right one, every staircase is
    // equally long; the chosen one hugs the diagonal.
    const path = ok(streetPath(grid(), [0, 0], [4 * S, 4 * S]))
    for (const [x, y] of path) expect(Math.abs(x - y)).toBeLessThanOrEqual(S + 1e-12)
  })

  it('ignores the direction the lines were drawn in (one-way streets)', () => {
    // The same street drawn as two lines pointing at each other.
    const lines: Position[][] = [
      [
        [0, 0],
        [2 * S, 0],
      ],
      [
        [4 * S, 0],
        [2 * S, 0],
      ],
    ]
    expect(ok(streetPath(lines, [S, 0], [3 * S, 0]))).toEqual([[2 * S, 0]])
  })

  it('joins a street that a tile boundary cut in two', () => {
    // Two pieces of one street that overlap a little and share no vertex,
    // like a line clipped into two neighbouring tiles with a buffer.
    const lines: Position[][] = [
      [
        [0, 0],
        [0.0021, 0],
      ],
      [
        [0.0019, 0],
        [0.004, 0],
      ],
    ]
    const path = ok(streetPath(lines, [0.0005, 0], [0.0035, 0]))
    expect(path.length).toBeGreaterThan(0)
  })

  it('reports where a point near a street joined it, so the point can move onto it', () => {
    // 2 m off the street at y = S.
    const result = streetPath(grid(), [0.0005, S + 0.000018], [0.0025, S])
    if (!('path' in result)) throw new Error(result.reason)
    expect(result.from[0]).toBeCloseTo(0.0005, 9)
    expect(result.from[1]).toBeCloseTo(S, 9)
    // The path runs from there, not from the point off the street.
    expect(ok(result)[0]).toEqual([S, S])
  })

  it('says when a point is off the streets', () => {
    expect(streetPath(grid(), [0.0005, 0.0005], [0.0035, S])).toEqual({ reason: 'off-street' })
  })

  it('says when no street joins the two points', () => {
    const lines: Position[][] = [
      [
        [0, 0],
        [S, 0],
      ],
      [
        [0, 5 * S],
        [S, 5 * S],
      ],
    ]
    expect(streetPath(lines, [0.0005, 0], [0.0005, 5 * S])).toEqual({ reason: 'no-path' })
  })

  it('refuses a path that wanders far from the line', () => {
    // A U-shaped street: from one arm to the other is 30 m straight but ~1.1 km along it.
    const lines: Position[][] = [
      [
        [0, 0],
        [0, 0.005],
        [0.0003, 0.005],
        [0.0003, 0],
      ],
    ]
    expect(streetPath(lines, [0, 0], [0.0003, 0], { gapMetres: 0 })).toEqual({ reason: 'detour' })
    // With straight crossings (the default) the two ends are simply joined.
    expect(ok(streetPath(lines, [0, 0], [0.0003, 0]))).toEqual([])
  })
  it('does not run along a path it is told to avoid', () => {
    // From a point just past the corner (x = 2S) on y = S, going north: the
    // way back west along y = S is the drawing so far, so it must use x = 3S.
    const drawn: Position[] = [
      [0.5 * S, S],
      [2.2 * S, S],
    ]
    const path = ok(streetPath(grid(), [2.2 * S, S], [2.2 * S, 3 * S], { avoid: drawn }))
    expect(path[0]).toEqual([3 * S, S])
  })
  it('crosses a river straight instead of detouring to a distant bridge', () => {
    // Two banks 55 m apart, each with its own streets running down to it; the
    // only bridge is ~900 m east.
    const bank = 0.0005
    const lines: Position[][] = [
      [
        [0, 0],
        [10 * S, 0],
      ],
      [
        [0, bank],
        [10 * S, bank],
      ],
      [
        [10 * S, 0],
        [10 * S, bank],
      ],
    ]
    for (let i = 0; i <= 10; i++) {
      lines.push([
        [i * S, -2 * S],
        [i * S, 0],
      ])
      lines.push([
        [i * S, bank],
        [i * S, 2 * S],
      ])
    }
    const path = ok(streetPath(lines, [2 * S, -S], [2 * S, 1.5 * S]))
    expect(path).toEqual([
      [2 * S, 0],
      [2 * S, bank],
    ])
    // Without crossings, the only street path is far too long.
    expect(streetPath(lines, [2 * S, -S], [2 * S, 1.5 * S], { gapMetres: 0 })).toEqual({ reason: 'detour' })
  })

  it('prefers streets to a straight crossing in an ordinary grid', () => {
    // Streets every 50 m: crossings are within reach, but walking the block is cheaper.
    const T = 0.00045
    const lines: Position[][] = []
    for (let i = 0; i <= 8; i++) {
      lines.push([
        [0, i * T],
        [8 * T, i * T],
      ])
      lines.push([
        [i * T, 0],
        [i * T, 8 * T],
      ])
    }
    const path = ok(streetPath(lines, [0.5 * T, T], [6.5 * T, 5 * T]))
    for (let k = 0; k + 1 < path.length; k++) {
      const [a, b] = [path[k]!, path[k + 1]!]
      // Every leg runs along a street: horizontal or vertical, never diagonal.
      expect(Math.abs(a[0] - b[0]) < 1e-9 || Math.abs(a[1] - b[1]) < 1e-9).toBe(true)
    }
  })
  it('never lays a straight crossing over a street', () => {
    // Two dead ends 55 m apart with a street running between them that joins
    // neither: a straight link would pass over that street without a junction.
    const lines: Position[][] = [
      [
        [0, -2 * S],
        [0, 0],
      ],
      [
        [0.0005, 0],
        [0.0005, -2 * S],
      ],
      [
        [0.00025, -S],
        [0.00025, S],
      ],
    ]
    const result = streetPath(lines, [0, -S], [0.0005, -S])
    expect('path' in result).toBe(false)
  })
})
