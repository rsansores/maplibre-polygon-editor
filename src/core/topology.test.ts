import { describe, expect, it } from 'vitest'
import { area, square } from '../test-support/fixtures'
import {
  insertVertex,
  linkedVertices,
  locateOnRing,
  moveVertex,
  nodeAreas,
  removeVertex,
  walkForward,
} from './topology'
import type { Area } from './types'

const EPS = 5e-9

/** Two unit squares side by side, sharing the edge x = 1. */
function neighbours(): Area[] {
  return [area('a', square(0, 0, 1)), area('b', square(1, 0, 1))]
}

describe('linked vertices', () => {
  it('finds every vertex at a position, across areas', () => {
    const links = linkedVertices(neighbours(), [1, 0], EPS)
    expect(links.map((l) => l.areaId).sort()).toEqual(['a', 'b'])
  })

  it('moves a shared vertex in both areas', () => {
    const moved = moveVertex(neighbours(), { areaId: 'a', ring: 0, index: 1 }, [1.2, -0.1], EPS)
    expect(moved[0]!.rings[0]![1]).toEqual([1.2, -0.1])
    expect(moved[1]!.rings[0]![0]).toEqual([1.2, -0.1])
  })

  it('leaves a locked neighbour where it is', () => {
    const areas = neighbours()
    areas[1] = { ...areas[1]!, locked: true }
    const moved = moveVertex(areas, { areaId: 'a', ring: 0, index: 1 }, [1.2, -0.1], EPS)
    expect(moved[1]).toBe(areas[1])
  })

  it('does not copy areas it did not touch', () => {
    const areas = [...neighbours(), area('far', square(10, 10, 1))]
    const moved = moveVertex(areas, { areaId: 'a', ring: 0, index: 0 }, [-0.5, 0], EPS)
    expect(moved[2]).toBe(areas[2])
  })
})

describe('inserting and removing', () => {
  it('inserts into the twin edge of a neighbour', () => {
    // Edge 1 of `a` runs (1,0) → (1,1); `b` holds the same edge as (0→3 wrap) reversed.
    const { areas, vertex } = insertVertex(neighbours(), { areaId: 'a', ring: 0, index: 1 }, [1, 0.5], EPS)
    expect(vertex).toEqual({ areaId: 'a', ring: 0, index: 2 })
    expect(areas[0]!.rings[0]).toHaveLength(5)
    expect(areas[1]!.rings[0]).toHaveLength(5)
    expect(linkedVertices(areas, [1, 0.5], EPS)).toHaveLength(2)
  })

  it('removes a shared vertex from every area', () => {
    const { areas } = insertVertex(neighbours(), { areaId: 'a', ring: 0, index: 1 }, [1, 0.5], EPS)
    const removed = removeVertex(areas, { areaId: 'a', ring: 0, index: 2 }, EPS)
    expect(removed[0]!.rings[0]).toHaveLength(4)
    expect(removed[1]!.rings[0]).toHaveLength(4)
  })
})

describe('noding', () => {
  it('turns a T-junction into a shared vertex', () => {
    // c = (0,1) (2,1) (2,3) (0,3) sits on top of both squares; its bottom edge
    // passes through their shared corner (1, 1).
    const areas = [...neighbours(), area('c', square(0, 1, 2))]
    const noded = nodeAreas(areas, ['c'], 1e-8)
    expect(noded[2]!.rings[0]).toContainEqual([1, 1])
  })

  it('puts a new vertex into the neighbour it lands on', () => {
    const areas = [
      area('a', square(0, 0, 1)),
      area('n', [
        [1, 0.5],
        [2, 0.5],
        [2, 1],
        [1, 1],
      ]),
    ]
    const noded = nodeAreas(areas, ['n'], 1e-8)
    expect(noded[0]!.rings[0]).toContainEqual([1, 0.5])
  })
})

describe('walking a ring', () => {
  const ring = square(0, 0, 1) // (0,0) (1,0) (1,1) (0,1)

  it('locates vertices and points on edges', () => {
    expect(locateOnRing(ring, [1, 1], EPS)).toEqual({ index: 2, t: 0 })
    expect(locateOnRing(ring, [0.5, 0], EPS)).toEqual({ index: 0, t: 0.5 })
    expect(locateOnRing(ring, [0.5, 0.5], EPS)).toBeNull()
  })

  it('collects the vertices strictly between two positions, wrapping', () => {
    expect(walkForward(ring, { index: 0, t: 0.5 }, { index: 2, t: 0.5 })).toEqual([
      [1, 0],
      [1, 1],
    ])
    expect(walkForward(ring, { index: 3, t: 0.5 }, { index: 0, t: 0.5 })).toEqual([[0, 0]])
  })
})
