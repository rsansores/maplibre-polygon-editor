import { describe, expect, it } from 'vitest'
import { area, square } from '../test-support/fixtures'
import { routeBetween, traceAlongAreas, traceAlongLine, traceBetween } from './trace'
import type { Position } from './types'

const EPS = 1e-9

describe('traceAlongAreas', () => {
  // A pentagon: (0,0) (2,0) (2,1) (1,2) (0,1)
  const pentagon = area('p', [
    [0, 0],
    [2, 0],
    [2, 1],
    [1, 2],
    [0, 1],
  ])

  it('follows the shorter way round between two border points', () => {
    expect(traceAlongAreas([pentagon], [1, 0], [2, 1.5 - 0.5], EPS)).toEqual([[2, 0]])
  })

  it('walks backwards when that is shorter', () => {
    expect(traceAlongAreas([pentagon], [2, 1], [1, 0], EPS)).toEqual([[2, 0]])
  })

  it('collects several vertices', () => {
    expect(traceAlongAreas([pentagon], [1, 0], [1.5, 1.5], EPS)).toEqual([
      [2, 0],
      [2, 1],
    ])
  })

  it('returns null when the points are not on one ring', () => {
    expect(traceAlongAreas([pentagon], [1, 0], [5, 5], EPS)).toBeNull()
  })
})

describe('traceAlongLine', () => {
  const street: Position[] = [
    [0, 0],
    [1, 0],
    [2, 1],
    [3, 1],
  ]

  it('follows a street forwards', () => {
    expect(traceAlongLine(street, [0.5, 0], [2.5, 1], EPS)).toEqual([
      [1, 0],
      [2, 1],
    ])
  })

  it('follows a street backwards', () => {
    expect(traceAlongLine(street, [2.5, 1], [0.5, 0], EPS)).toEqual([
      [2, 1],
      [1, 0],
    ])
  })
})

describe('traceBetween', () => {
  const a = area('a', square(0, 0, 1))

  it('traces a neighbour border when both clicks snapped to it', () => {
    const path = traceBetween(
      { position: [0.5, 0], kind: 'edge', areaId: 'a', ring: 0, index: 0 },
      { position: [1, 0.5], kind: 'edge', areaId: 'a', ring: 0, index: 1 },
      [a],
      EPS,
      { areas: true, lines: true },
    )
    expect(path).toEqual([[1, 0]])
  })

  it('draws straight when a click was free', () => {
    expect(
      traceBetween(
        { position: [0.5, 0], kind: 'edge', areaId: 'a' },
        { position: [3, 3], kind: 'none' },
        [a],
        EPS,
        { areas: true, lines: true },
      ),
    ).toBeNull()
  })

  it('can be told to leave area borders alone', () => {
    expect(
      traceBetween(
        { position: [0.5, 0], kind: 'edge', areaId: 'a' },
        { position: [1, 0.5], kind: 'edge', areaId: 'a' },
        [a],
        EPS,
        { areas: false, lines: true },
      ),
    ).toBeNull()
  })
})

describe('routeBetween', () => {
  const from: Position = [0, 0]
  const to: Position = [0.01, 0]

  it('keeps a plausible route, minus its endpoints', async () => {
    const router = async () =>
      [
        [0, 0.0001],
        [0.005, 0.001],
        [0.01, 0.0001],
      ] as Position[]
    expect(await routeBetween(router, from, to, 3)).toEqual([[0.005, 0.001]])
  })

  it('falls back when the route is a long detour', async () => {
    const router = async () =>
      [
        [0, 0],
        [0, 0.05],
        [0.01, 0.05],
        [0.01, 0],
      ] as Position[]
    expect(await routeBetween(router, from, to, 3)).toBeNull()
  })

  it('falls back when the router fails or finds nothing', async () => {
    expect(await routeBetween(async () => null, from, to, 3)).toBeNull()
    expect(
      await routeBetween(
        async () => {
          throw new Error('offline')
        },
        from,
        to,
        3,
      ),
    ).toBeNull()
  })
})
