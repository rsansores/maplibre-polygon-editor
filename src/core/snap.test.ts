import { describe, expect, it } from 'vitest'
import { area, project, square } from '../test-support/fixtures'
import { onSegment } from './geo'
import { snap } from './snap'
import type { Position } from './types'

// 100 000 px per degree: 1 px = 0.00001°.
const at = (p: Position) => project(p)
const areas = [area('a', square(0, 0, 0.01))]

describe('snap', () => {
  it('returns the raw position when nothing is in reach', () => {
    const raw: Position = [0.5, 0.5]
    expect(snap(raw, at(raw), { project, tolerancePx: 10, areas })).toEqual({ position: raw, kind: 'none' })
  })

  it('pulls the cursor onto a nearby vertex', () => {
    const raw: Position = [0.01003, 0.00004] // 3 px right, 4 px up of (0.01, 0)
    const result = snap(raw, at(raw), { project, tolerancePx: 10, areas })
    expect(result).toMatchObject({ kind: 'vertex', areaId: 'a', index: 1, position: [0.01, 0] })
  })

  it('lands exactly on an edge, not merely near it', () => {
    const raw: Position = [0.00502, 0.00003]
    const result = snap(raw, at(raw), { project, tolerancePx: 10, areas })
    expect(result.kind).toBe('edge')
    expect(onSegment(result.position, [0, 0], [0.01, 0], 1e-12)).toBe(true)
  })

  it('skips areas outside the bounds it is given, and finds the same target inside them', () => {
    const raw: Position = [0.01003, 0.00004]
    const around = snap(raw, at(raw), {
      project,
      tolerancePx: 10,
      areas,
      bounds: [0.0099, -0.0001, 0.0101, 0.0001],
    })
    expect(around).toEqual(snap(raw, at(raw), { project, tolerancePx: 10, areas }))
    const elsewhere = snap(raw, at(raw), { project, tolerancePx: 10, areas, bounds: [1, 1, 2, 2] })
    expect(elsewhere.kind).toBe('none')
  })

  it('prefers a vertex over a closer edge', () => {
    const raw: Position = [0.00006, 0.00001] // 1 px from the edge, ~6 px from the corner
    const result = snap(raw, at(raw), { project, tolerancePx: 10, areas })
    expect(result.kind).toBe('vertex')
  })

  it('prefers area geometry over streets', () => {
    const street: Position[] = [
      [0.00002, -1],
      [0.00002, 1],
    ]
    const raw: Position = [0.00003, 0.005]
    const result = snap(raw, at(raw), { project, tolerancePx: 10, areas, lines: [street] })
    expect(result.kind).toBe('edge')
  })

  it('snaps to a street when no area is near, and remembers the street', () => {
    const street: Position[] = [
      [0.5, 0.4],
      [0.5, 0.6],
    ]
    const raw: Position = [0.50004, 0.5]
    const result = snap(raw, at(raw), { project, tolerancePx: 10, areas, lines: [street] })
    expect(result.kind).toBe('line')
    expect(result.position).toEqual([0.5, 0.5])
    expect(result.path).toBe(street)
  })

  it('ignores the vertex being dragged', () => {
    const raw: Position = [0.01002, 0]
    const result = snap(raw, at(raw), {
      project,
      tolerancePx: 10,
      areas,
      ignore: (p) => p[0] === 0.01 && p[1] === 0,
    })
    expect(result.kind).not.toBe('vertex')
  })

  it('offers extra points, such as the first vertex of a draft', () => {
    const first: Position = [0.3, 0.3]
    const raw: Position = [0.30005, 0.3]
    expect(snap(raw, at(raw), { project, tolerancePx: 10, areas, points: [first] })).toMatchObject({
      kind: 'vertex',
      position: first,
    })
  })
})
