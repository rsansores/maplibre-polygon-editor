import { describe, expect, it } from 'vitest'
import { sortedVertices, square } from '../test-support/fixtures'
import recorded from '../test-support/cut-along-border.json'
import { polygonArea } from './geo'
import { splitPolygon } from './split'
import type { Position, Ring } from './types'

const EPS = 5e-9
const D = 8
const square01 = () => square(0, 0, 0.01)

describe('splitPolygon', () => {
  const box = square(0, 0, 0.01)

  it('cuts a square in two halves along a straight line', () => {
    const result = splitPolygon(
      [box],
      [
        [0.005, -0.001],
        [0.005, 0.011],
      ],
      D,
      EPS,
    )
    if (!('pieces' in result)) throw new Error(result.issue)
    const [a, b] = result.pieces
    expect(polygonArea(a) + polygonArea(b)).toBeCloseTo(polygonArea([box]), 3)
    expect(polygonArea(a)).toBeCloseTo(polygonArea(b), 0)
  })

  it('gives both pieces the same cut vertices', () => {
    const line: Position[] = [
      [0.005, -0.001],
      [0.004, 0.005],
      [0.005, 0.011],
    ]
    const result = splitPolygon([box], line, D, EPS)
    if (!('pieces' in result)) throw new Error(result.issue)
    const [a, b] = result.pieces
    const shared = sortedVertices(a[0]!).filter((v) => sortedVertices(b[0]!).includes(v))
    // Entry, the bend, and exit.
    expect(shared).toHaveLength(3)
    expect(shared).toContain('0.00400000,0.00500000')
  })

  it('reports a line that does not cross the polygon', () => {
    expect(
      splitPolygon(
        [box],
        [
          [1, 1],
          [2, 2],
        ],
        D,
        EPS,
      ),
    ).toEqual({ issue: 'cut-missed' })
  })

  it('reports a line that enters but never leaves', () => {
    expect(
      splitPolygon(
        [box],
        [
          [-0.001, 0.005],
          [0.005, 0.005],
        ],
        D,
        EPS,
      ),
    ).toEqual({ issue: 'cut-missed' })
  })

  it('keeps holes with the piece that contains them', () => {
    const hole = square(0.001, 0.001, 0.002)
    const result = splitPolygon(
      [box, hole],
      [
        [0.006, -0.001],
        [0.006, 0.011],
      ],
      D,
      EPS,
    )
    if (!('pieces' in result)) throw new Error(result.issue)
    const withHole = result.pieces.filter((p) => p.length === 2)
    expect(withHole).toHaveLength(1)
  })

  it('refuses to cut through a hole', () => {
    const hole = square(0.004, 0.004, 0.002)
    expect(
      splitPolygon(
        [box, hole],
        [
          [0.005, -0.001],
          [0.005, 0.011],
        ],
        D,
        EPS,
      ),
    ).toEqual({ issue: 'cut-crosses-hole' })
  })

  it('cuts off a corner when the line enters and leaves through neighbouring edges', () => {
    const result = splitPolygon(
      [box],
      [
        [0.008, -0.001],
        [0.011, 0.002],
      ],
      D,
      EPS,
    )
    if (!('pieces' in result)) throw new Error(result.issue)
    const sizes = result.pieces.map((p) => p[0]!.length).sort()
    expect(sizes).toEqual([3, 5])
  })

  it('cuts a notch when the line enters and leaves through the same edge', () => {
    const result = splitPolygon(
      [box],
      [
        [0.003, -0.001],
        [0.005, 0.004],
        [0.007, -0.001],
      ],
      D,
      EPS,
    )
    if (!('pieces' in result)) throw new Error(result.issue)
    const [a, b] = result.pieces
    expect(polygonArea(a) + polygonArea(b)).toBeCloseTo(polygonArea([box]), 3)
  })
})

describe('cuts that start along the border', () => {
  it('skips a first stretch that runs along the border and cuts where the line goes inside', () => {
    // Recorded on the demo map: a second cut that starts on the first cut and
    // follows its street for one block before turning into the area.
    const { areas, path } = recorded as unknown as {
      areas: { id: string; rings: Ring[] }[]
      path: Position[]
    }
    const area = areas.find((a) => a.id !== 'city')!
    const result = splitPolygon(area.rings, path, 8, 5e-9)
    if (!('pieces' in result)) throw new Error(result.issue)
    const total = polygonArea(area.rings)
    expect(polygonArea(result.pieces[0]) + polygonArea(result.pieces[1])).toBeCloseTo(total, -2)
  })

  it('does the same on a square', () => {
    // From the corner (0.01, 0) up the right edge to (0.01, 0.004), then across.
    const result = splitPolygon(
      [square01()],
      [
        [0.01, 0],
        [0.01, 0.004],
        [0.004, 0.004],
        [0.004, 0.011],
      ],
      D,
      EPS,
    )
    if (!('pieces' in result)) throw new Error(result.issue)
    expect(polygonArea(result.pieces[0]) + polygonArea(result.pieces[1])).toBeCloseTo(
      polygonArea([square01()]),
      3,
    )
  })
})
