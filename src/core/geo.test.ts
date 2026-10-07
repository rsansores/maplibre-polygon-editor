import { describe, expect, it } from 'vitest'
import { square } from '../test-support/fixtures'
import {
  bounds,
  dedupeRing,
  distance,
  onSegment,
  pointInPolygon,
  polygonArea,
  ringArea,
  ringLength,
  roundPosition,
  segmentIntersection,
  segmentsCross,
} from './geo'

describe('measurements', () => {
  it('measures a degree of latitude as about 111.2 km', () => {
    expect(distance([0, 0], [0, 1])).toBeCloseTo(111_195, -1)
  })

  it('measures a small square near the equator in square metres', () => {
    // 0.001° ≈ 111.3 m a side at the equator.
    const side = 111.32
    expect(ringArea(square(0, 0, 0.001))).toBeCloseTo(side * side, -1)
  })

  it('gives the same area whichever way the ring winds', () => {
    const ring = square(-100.4, 20.6, 0.01)
    expect(ringArea([...ring].reverse())).toBeCloseTo(ringArea(ring), 6)
  })

  it('subtracts holes from the area', () => {
    const outer = square(0, 0, 0.002)
    const hole = square(0.0005, 0.0005, 0.001)
    expect(polygonArea([outer, hole])).toBeCloseTo(ringArea(outer) - ringArea(hole), 6)
  })

  it('closes the ring when measuring its length', () => {
    expect(ringLength(square(0, 0, 0.001))).toBeCloseTo(4 * 111.19, -1)
  })
})

describe('planar predicates', () => {
  it('tells a crossing from a touch', () => {
    expect(segmentsCross([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true)
    // Sharing an endpoint is not a crossing.
    expect(segmentsCross([0, 0], [1, 1], [1, 1], [2, 0])).toBe(false)
    // Collinear overlap is a shared border, not a crossing.
    expect(segmentsCross([0, 0], [2, 0], [1, 0], [3, 0])).toBe(false)
  })

  it('finds where two segments meet', () => {
    const hit = segmentIntersection([0, 0], [2, 0], [1, -1], [1, 1])
    expect(hit?.point).toEqual([1, 0])
    expect(hit?.t).toBeCloseTo(0.5)
    expect(segmentIntersection([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull()
  })

  it('knows when a point lies on a segment', () => {
    expect(onSegment([0.5, 0], [0, 0], [1, 0], 1e-9)).toBe(true)
    expect(onSegment([0.5, 1e-6], [0, 0], [1, 0], 1e-9)).toBe(false)
  })

  it('treats a point in a hole as outside', () => {
    const rings = [square(0, 0, 4), square(1, 1, 2)]
    expect(pointInPolygon([0.5, 0.5], rings)).toBe(true)
    expect(pointInPolygon([2, 2], rings)).toBe(false)
    expect(pointInPolygon([5, 5], rings)).toBe(false)
  })
})

describe('helpers', () => {
  it('rounds to a fixed number of decimals', () => {
    expect(roundPosition([-100.123456789, 20.987654321], 8)).toEqual([-100.12345679, 20.98765432])
  })

  it('drops consecutive duplicates and a closing vertex', () => {
    expect(
      dedupeRing(
        [
          [0, 0],
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
        0,
      ),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ])
  })

  it('computes the bounds of a set of points', () => {
    expect(bounds(square(1, 2, 3))).toEqual([1, 2, 4, 5])
    expect(bounds([])).toBeNull()
  })
})
