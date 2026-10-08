import { describe, expect, it } from 'vitest'
import { area, square } from '../test-support/fixtures'
import { overlapThickness } from './clip'
import { polygonThickness } from './geo'
import { findOverlap, overlaps, polygonIssues, ringSelfIntersects } from './validate'

const EPS = 5e-9

describe('polygonIssues', () => {
  it('accepts a simple square', () => {
    expect(polygonIssues([square(0, 0, 0.01)], EPS)).toEqual([])
  })

  it('needs three distinct vertices that enclose something', () => {
    expect(
      polygonIssues(
        [
          [
            [0, 0],
            [1, 0],
          ],
        ],
        EPS,
      ),
    ).toEqual(['too-few-vertices'])
    expect(
      polygonIssues(
        [
          [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
        ],
        EPS,
      ),
    ).toEqual(['too-few-vertices'])
  })

  it('refuses a bow tie', () => {
    const bowTie: [number, number][] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ]
    expect(ringSelfIntersects(bowTie, EPS)).toBe(true)
    expect(polygonIssues([bowTie], EPS)).toEqual(['self-intersection'])
  })

  it('refuses a ring that touches itself at a vertex', () => {
    const touching: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [1, 0],
      [0, 2],
    ]
    expect(ringSelfIntersects(touching, EPS)).toBe(true)
  })

  it('refuses a hole outside its polygon', () => {
    expect(polygonIssues([square(0, 0, 1), square(5, 5, 1)], EPS)).toEqual(['hole-outside'])
    expect(polygonIssues([square(0, 0, 4), square(1, 1, 1)], EPS)).toEqual([])
  })
})

describe('findOverlap', () => {
  const left = area('left', square(0, 0, 0.01))

  it('does not count a shared border as an overlap', () => {
    expect(findOverlap([square(0.01, 0, 0.01)], [left], EPS, 0.01)).toBeNull()
  })

  it('finds a real overlap', () => {
    expect(findOverlap([square(0.005, 0, 0.01)], [left], EPS, 0.01)?.id).toBe('left')
  })

  it('ignores areas whose bounds are apart', () => {
    expect(findOverlap([square(1, 1, 0.01)], [left], EPS, 0.01)).toBeNull()
  })
})

describe('overlaps (by thickness, not area)', () => {
  // One metre of latitude, in degrees.
  const M = 1 / 111_195

  it('measures a thin strip by its width', () => {
    const strip: [number, number][] = [
      [0, 0],
      [0.5, 0],
      [0.5, M],
      [0, M],
    ]
    expect(polygonThickness([strip])).toBeCloseTo(1, 2)
  })

  it('never counts a long shared border that rounding left a sliver along', () => {
    // A 55 km border, the neighbour's side one 8th-decimal step (~1.1 mm) past it.
    const a = [square(0, 0, 0.5)]
    const b: [number, number][][] = [
      [
        [0.5 - 1e-8, 0],
        [1, 0],
        [1, 0.5],
        [0.5 - 1e-8, 0.5],
      ],
    ]
    expect(overlapThickness(a, b, EPS)).toBeLessThan(0.002)
    expect(overlaps(a, b)).toBe(false)
    expect(findOverlap(a, [area('b', ...b)], EPS, 0.01)).toBeNull()
  })

  it('counts a real overlap of one metre by one metre', () => {
    const a = [square(0, 0, 0.01)]
    const b = [square(0.01 - M, 0.01 - M, 0.01)]
    expect(overlapThickness(a, b, EPS)).toBeGreaterThan(0.4)
    expect(overlaps(a, b)).toBe(true)
    expect(findOverlap(a, [area('b', ...b)], EPS, 0.01)?.id).toBe('b')
  })

  it('takes the tolerance in metres', () => {
    const a = [square(0, 0, 0.01)]
    const b = [square(0.01 - M, 0.01 - M, 0.01)]
    expect(overlaps(a, b, { toleranceM: 1 })).toBe(false)
  })
})
