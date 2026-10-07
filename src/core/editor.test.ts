import { describe, expect, it, vi } from 'vitest'
import { area, free, square } from '../test-support/fixtures'
import { PolygonEditorCore, type EditorOptions } from './editor'
import { polygonArea } from './geo'
import { polygonIssues } from './validate'
import { linkedVertices } from './topology'
import type { SnapResult } from './snap'
import type { Area, Issue, Position } from './types'

let seq = 0
function makeEditor(options: EditorOptions = {}) {
  seq = 0
  const editor = new PolygonEditorCore({
    createId: () => `new-${++seq}`,
    createProperties: (n) => ({ name: `Area ${n}` }),
    ...options,
  })
  const issues: Issue[] = []
  const changes: Area[][] = []
  editor.on('issue', (i) => issues.push(i))
  editor.on('change', (a) => changes.push(a))
  return { editor, issues, changes }
}

async function drawRing(editor: PolygonEditorCore, ring: Position[]) {
  editor.setMode('draw')
  for (const p of ring) await editor.addPoint(free(p))
  // Click the first vertex again to close.
  await editor.addPoint(free(ring[0]!))
}

describe('drawing', () => {
  it('creates an area when the draft is closed on its first vertex', async () => {
    const { editor, changes } = makeEditor()
    await drawRing(editor, square(0, 0, 0.01))
    const state = editor.getState()
    expect(state.areas).toHaveLength(1)
    expect(state.areas[0]).toMatchObject({ id: 'new-1', properties: { name: 'Area 1' } })
    expect(state.selectedId).toBe('new-1')
    expect(state.draft).toEqual([])
    expect(changes).toHaveLength(1)
  })

  it('places every vertex exactly where it was clicked, to the configured precision', async () => {
    const { editor } = makeEditor({ decimals: 8 })
    await drawRing(editor, [
      [-100.391234567, 20.591234567],
      [-100.381234567, 20.591234567],
      [-100.381234567, 20.601234567],
    ])
    expect(editor.getState().areas[0]!.rings[0]![0]).toEqual([-100.39123457, 20.59123457])
  })

  it('keeps the draft and says why when the ring crosses itself', async () => {
    const { editor, issues } = makeEditor()
    editor.setMode('draw')
    for (const p of [
      [0, 0],
      [0.01, 0.01],
      [0.01, 0],
      [0, 0.01],
    ] as Position[])
      await editor.addPoint(free(p))
    expect(editor.finish()).toBe(false)
    expect(issues).toEqual([{ code: 'self-intersection' }])
    expect(editor.getState().draft).toHaveLength(4)
  })

  it('undoes the last click before it undoes an area', async () => {
    const { editor } = makeEditor()
    await drawRing(editor, square(0, 0, 0.01))
    editor.setMode('draw')
    await editor.addPoint(free([1, 1]))
    await editor.addPoint(free([1.01, 1]))
    editor.undo()
    expect(editor.getState().draft).toHaveLength(1)
    expect(editor.getState().areas).toHaveLength(1)
  })

  it('ignores a double click on the same spot', async () => {
    const { editor } = makeEditor()
    editor.setMode('draw')
    await editor.addPoint(free([0, 0]))
    await editor.addPoint(free([0, 0]))
    expect(editor.getState().draft).toHaveLength(1)
  })
})

describe('neighbours', () => {
  it('clips a new area to the free ground so the border is shared vertex for vertex', async () => {
    const { editor, issues } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    // Drawn sloppily over the right half of `a`.
    await drawRing(editor, square(0.006, 0, 0.01))
    const [a, b] = editor.getState().areas
    expect(issues.map((i) => i.code)).toEqual(['clipped'])
    // What is left of the 0.01° square drawn from x = 0.006 is the strip from x = 0.01 to 0.016.
    expect(polygonArea(b!.rings) / polygonArea(a!.rings)).toBeCloseTo(0.6, 3)
    // The two corners of the shared border are each held by both areas.
    expect(linkedVertices([a!, b!], [0.01, 0], editor.epsilon)).toHaveLength(2)
    expect(linkedVertices([a!, b!], [0.01, 0.01], editor.epsilon)).toHaveLength(2)
  })

  it('nodes a T-junction created by clipping into the neighbour', async () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    // Overlaps only the lower half of a's right edge.
    await drawRing(editor, [
      [0.008, -0.002],
      [0.02, -0.002],
      [0.02, 0.005],
      [0.008, 0.005],
    ])
    const [a, b] = editor.getState().areas
    const junction = b!.rings[0]!.find((p) => p[0] === 0.01 && p[1] === 0.005)
    expect(junction).toBeDefined()
    expect(a!.rings[0]).toContainEqual([0.01, 0.005])
  })

  it('refuses an overlap under the forbid policy', async () => {
    const { editor, issues } = makeEditor({ overlap: 'forbid' })
    editor.setAreas([area('a', square(0, 0, 0.01))])
    await drawRing(editor, square(0.006, 0, 0.01))
    expect(editor.getState().areas).toHaveLength(1)
    expect(issues).toEqual([{ code: 'overlap', otherId: 'a' }])
  })

  it('refuses an area drawn entirely inside another', async () => {
    const { editor, issues } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    await drawRing(editor, square(0.002, 0.002, 0.002))
    expect(issues.map((i) => i.code)).toEqual(['clipped-away'])
  })

  it('traces the neighbour border between two clicks on it', async () => {
    const { editor } = makeEditor()
    // An L-shaped neighbour whose right side has a kink at (0.01, 0.005)… made of
    // two vertices the user never clicks.
    editor.setAreas([
      area('a', [
        [0, 0],
        [0.01, 0],
        [0.011, 0.003],
        [0.011, 0.007],
        [0.01, 0.01],
        [0, 0.01],
      ]),
    ])
    editor.setMode('draw')
    await editor.addPoint({ position: [0.01, 0], kind: 'vertex', areaId: 'a', ring: 0, index: 1 })
    await editor.addPoint({ position: [0.01, 0.01], kind: 'vertex', areaId: 'a', ring: 0, index: 4 })
    await editor.addPoint(free([0.02, 0.01]))
    await editor.addPoint(free([0.02, 0]))
    expect(editor.draftPath()).toEqual([
      [0.01, 0],
      [0.011, 0.003],
      [0.011, 0.007],
      [0.01, 0.01],
      [0.02, 0.01],
      [0.02, 0],
    ])
    expect(editor.finish()).toBe(true)
    const [a, b] = editor.getState().areas
    for (const p of a!.rings[0]!.slice(1, 5))
      expect(linkedVertices([a!, b!], p, editor.epsilon)).toHaveLength(2)
  })

  it('draws straight across a neighbour border when tracing is off', async () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    editor.setTracing(false)
    editor.setMode('draw')
    await editor.addPoint({ position: [0.01, 0], kind: 'vertex', areaId: 'a' })
    await editor.addPoint({ position: [0, 0.01], kind: 'vertex', areaId: 'a' })
    expect(editor.draftPath()).toHaveLength(2)
  })
})

describe('dragging', () => {
  function twoNeighbours() {
    const made = makeEditor()
    made.editor.setAreas([area('a', square(0, 0, 0.01)), area('b', square(0.01, 0, 0.01))])
    return made
  }

  it('moves a shared corner in both areas', () => {
    const { editor } = twoNeighbours()
    editor.beginDrag({ areaId: 'a', ring: 0, index: 2 }) // (0.01, 0.01)
    editor.dragTo([0.012, 0.011])
    expect(editor.endDrag()).toBe(true)
    const [a, b] = editor.getState().areas
    expect(a!.rings[0]![2]).toEqual([0.012, 0.011])
    expect(b!.rings[0]).toContainEqual([0.012, 0.011])
  })

  it('puts everything back when the drag ends in an invalid shape', () => {
    const { editor, issues, changes } = twoNeighbours()
    const before = editor.getState().areas
    editor.beginDrag({ areaId: 'a', ring: 0, index: 0 }) // (0, 0)
    editor.dragTo([0.005, 0.02]) // folds `a` over itself
    expect(editor.endDrag()).toBe(false)
    expect(editor.getState().areas).toBe(before)
    expect(issues[0]?.code).toBe('self-intersection')
    expect(changes).toHaveLength(0)
  })

  it('refuses a drag that pushes into a neighbour', () => {
    const { editor, issues } = makeEditor()
    // A gap between them this time, so the corner is not shared.
    editor.setAreas([area('a', square(0, 0, 0.01)), area('b', square(0.012, 0, 0.01))])
    editor.beginDrag({ areaId: 'a', ring: 0, index: 2 }) // (0.01, 0.01)
    editor.dragTo([0.015, 0.01])
    expect(editor.endDrag()).toBe(false)
    expect(issues[0]).toMatchObject({ code: 'overlap' })
  })

  it('inserts a vertex on a shared edge into both areas', () => {
    const { editor } = twoNeighbours()
    // a's edge 1 is (0.01,0)→(0.01,0.01), shared with b.
    editor.beginInsert({ areaId: 'a', ring: 0, index: 1 }, [0.01, 0.005])
    editor.dragTo([0.0105, 0.005])
    expect(editor.endDrag()).toBe(true)
    const [a, b] = editor.getState().areas
    expect(a!.rings[0]).toHaveLength(5)
    expect(b!.rings[0]).toHaveLength(5)
    expect(linkedVertices([a!, b!], [0.0105, 0.005], editor.epsilon)).toHaveLength(2)
  })

  it('is one undo step', () => {
    const { editor } = twoNeighbours()
    const before = editor.getState().areas
    editor.beginDrag({ areaId: 'a', ring: 0, index: 2 })
    editor.dragTo([0.011, 0.011])
    editor.dragTo([0.012, 0.012])
    editor.endDrag()
    editor.undo()
    expect(editor.getState().areas).toBe(before)
    editor.redo()
    expect(editor.getState().areas[0]!.rings[0]![2]).toEqual([0.012, 0.012])
  })

  it('does not let a locked area be edited', () => {
    const { editor, issues } = makeEditor()
    editor.setAreas([{ ...area('a', square(0, 0, 0.01)), locked: true }])
    expect(editor.beginDrag({ areaId: 'a', ring: 0, index: 0 })).toBe(false)
    expect(issues).toEqual([{ code: 'locked', areaId: 'a' }])
  })
})

describe('typed coordinates', () => {
  it('moves a vertex to exact coordinates', () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    expect(editor.setVertex({ areaId: 'a', ring: 0, index: 2 }, [0.0123456789, 0.0111])).toBe(true)
    expect(editor.getState().areas[0]!.rings[0]![2]).toEqual([0.01234568, 0.0111])
  })

  it('rejects coordinates that are not on Earth', () => {
    const { editor, issues } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    expect(editor.setVertex({ areaId: 'a', ring: 0, index: 2 }, [200, 0])).toBe(false)
    expect(issues).toEqual([{ code: 'invalid-coordinates' }])
  })
})

describe('deleting', () => {
  it('will not leave a triangle with two vertices', () => {
    const { editor, issues } = makeEditor()
    editor.setAreas([
      area('t', [
        [0, 0],
        [0.01, 0],
        [0, 0.01],
      ]),
    ])
    expect(editor.deleteVertex({ areaId: 't', ring: 0, index: 0 })).toBe(false)
    expect(issues[0]?.code).toBe('too-few-vertices')
  })

  it('deletes an area, and undo brings it back', () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    editor.select('a')
    editor.deleteArea('a')
    expect(editor.getState()).toMatchObject({ areas: [], selectedId: null })
    editor.undo()
    expect(editor.getState().areas).toHaveLength(1)
  })
})

describe('cutting', () => {
  it('splits the area the line crosses, keeping its identity on the larger piece', async () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    editor.setMode('cut')
    await editor.addPoint(free([0.003, -0.001]))
    await editor.addPoint(free([0.003, 0.011]))
    expect(editor.finish()).toBe(true)
    const [a, b] = editor.getState().areas
    expect(a!.id).toBe('a')
    expect(a!.properties.name).toBe('a')
    expect(b!.id).toBe('new-1')
    expect(polygonArea(a!.rings)).toBeGreaterThan(polygonArea(b!.rings))
  })

  it('carries the cut points into a neighbour that shares the cut edge', async () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01)), area('top', square(0, 0.01, 0.01))])
    editor.select('a')
    editor.setMode('cut')
    await editor.addPoint(free([0.005, -0.001]))
    await editor.addPoint(free([0.005, 0.0105])) // ends inside `top`
    expect(editor.finish()).toBe(true)
    const top = editor.getArea('top')!
    expect(top.rings[0]).toContainEqual([0.005, 0.01])
  })

  it('says so when the line misses every area', async () => {
    const { editor, issues } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    editor.setMode('cut')
    await editor.addPoint(free([1, 1]))
    await editor.addPoint(free([2, 2]))
    expect(editor.finish()).toBe(false)
    expect(issues).toEqual([{ code: 'cut-missed' }])
  })
})

describe('merging', () => {
  it('merges two neighbours into one', () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01)), area('b', square(0.01, 0, 0.01))])
    expect(editor.mergeAreas('a', 'b')).toBe(true)
    const areas = editor.getState().areas
    expect(areas).toHaveLength(1)
    expect(areas[0]!.id).toBe('a')
    expect(polygonArea(areas[0]!.rings)).toBeCloseTo(polygonArea([square(0, 0, 0.01)]) * 2, -1)
  })

  it('refuses to merge areas that do not touch', () => {
    const { editor, issues } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01)), area('b', square(1, 1, 0.01))])
    expect(editor.mergeAreas('a', 'b')).toBe(false)
    expect(issues).toEqual([{ code: 'not-adjacent', areaId: 'a', otherId: 'b' }])
  })

  it('keeps a third neighbour sharing its vertices with the merged area', () => {
    const { editor } = makeEditor()
    // c sits on top of a and b; its bottom edge holds the T-junction (0.01, 0.01).
    editor.setAreas([
      area('a', square(0, 0, 0.01)),
      area('b', square(0.01, 0, 0.01)),
      area('c', [
        [0, 0.01],
        [0.01, 0.01],
        [0.02, 0.01],
        [0.02, 0.02],
        [0, 0.02],
      ]),
    ])
    expect(editor.mergeAreas('a', 'b')).toBe(true)
    const merged = editor.getArea('a')!
    expect(merged.rings[0]).toContainEqual([0.01, 0.01])
  })
})

describe('following roads', () => {
  const street = (from: Position, to: Position) => ({
    kind: 'line' as const,
    position: from,
    path: [from, to],
  })

  it('routes between two clicks on streets', async () => {
    const router = vi.fn(async (from: Position, to: Position) => [from, [0.005, 0.0002] as Position, to])
    const { editor } = makeEditor({ router })
    editor.setFollowRoads(true)
    editor.setTracing(false)
    editor.setMode('draw')
    await editor.addPoint(street([0, 0], [0, 1]))
    await editor.addPoint({ ...street([0.01, 0], [0.01, 1]), position: [0.01, 0] })
    expect(router).toHaveBeenCalledOnce()
    expect(editor.draftPath()).toEqual([
      [0, 0],
      [0.005, 0.0002],
      [0.01, 0],
    ])
  })

  it('falls back to a straight segment and says so', async () => {
    const { editor, issues } = makeEditor({ router: async () => null })
    editor.setFollowRoads(true)
    editor.setTracing(false)
    editor.setMode('draw')
    await editor.addPoint(street([0, 0], [0, 1]))
    await editor.addPoint({ ...street([0.01, 0], [0.01, 1]), position: [0.01, 0] })
    expect(editor.draftPath()).toHaveLength(2)
    expect(issues).toEqual([{ code: 'route-fallback' }])
  })

  it('drops a route that arrives after the draft was cancelled', async () => {
    let release: (value: Position[]) => void = () => {}
    const router = () => new Promise<Position[]>((resolve) => (release = resolve))
    const { editor } = makeEditor({ router })
    editor.setFollowRoads(true)
    editor.setTracing(false)
    editor.setMode('draw')
    await editor.addPoint(street([0, 0], [0, 1]))
    const second = editor.addPoint({ ...street([0.01, 0], [0.01, 1]), position: [0.01, 0] })
    expect(editor.getState().pending).toBe(true)
    editor.cancelDraft()
    release([
      [0, 0],
      [0.01, 0],
    ])
    await second
    expect(editor.getState().draft).toEqual([])
  })

  it('cannot be switched on without a router', () => {
    const { editor } = makeEditor()
    editor.setFollowRoads(true)
    expect(editor.getState().followRoads).toBe(false)
  })
})

describe('importing and properties', () => {
  it('adds valid areas, skips invalid ones and reports how many', () => {
    const { editor, issues } = makeEditor()
    const added = editor.addAreas([
      area('ok', square(0, 0, 0.01)),
      area('bad', [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
      ]),
    ])
    expect(added).toBe(1)
    expect(issues).toEqual([{ code: 'import-skipped', count: 1 }])
  })

  it('gives an imported area a fresh id when its id is taken', () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    editor.addAreas([area('a', square(1, 1, 0.01))])
    expect(editor.getState().areas.map((a) => a.id)).toEqual(['a', 'new-1'])
  })

  it('updates properties as an undoable edit', () => {
    const { editor } = makeEditor()
    editor.setAreas([area('a', square(0, 0, 0.01))])
    editor.updateProperties('a', { name: 'North' })
    expect(editor.getArea('a')!.properties.name).toBe('North')
    editor.undo()
    expect(editor.getArea('a')!.properties.name).toBe('a')
  })
})

describe('read-only', () => {
  it('refuses every edit', async () => {
    const { editor, changes } = makeEditor({ readonly: true })
    editor.setAreas([area('a', square(0, 0, 0.01))])
    editor.setMode('draw')
    expect(editor.getState().mode).toBe('select')
    expect(editor.beginDrag({ areaId: 'a', ring: 0, index: 0 })).toBe(false)
    expect(editor.deleteArea('a')).toBe(false)
    expect(editor.updateProperties('a', { name: 'x' })).toBe(false)
    expect(changes).toHaveLength(0)
  })

  it('still lets the user select', () => {
    const { editor } = makeEditor({ readonly: true })
    editor.setAreas([area('a', square(0, 0, 0.01))])
    editor.select('a')
    expect(editor.getState().selectedId).toBe('a')
  })
})

describe('dropping onto a neighbour', () => {
  it('makes a vertex dropped on a neighbour edge a vertex of that edge', () => {
    const { editor } = makeEditor()
    // A gap of 0.002 between them; drag a's corner onto b's left edge.
    editor.setAreas([area('a', square(0, 0, 0.01)), area('b', square(0.012, 0, 0.01))])
    editor.beginDrag({ areaId: 'a', ring: 0, index: 1 }) // (0.01, 0)
    editor.dragTo([0.012, 0.004])
    expect(editor.endDrag()).toBe(true)
    expect(editor.getArea('b')!.rings[0]).toContainEqual([0.012, 0.004])
  })
})

describe('borders shared with a locked area', () => {
  function withLockedNeighbour() {
    const made = makeEditor()
    made.editor.setAreas([
      area('a', square(0, 0, 0.01)),
      { ...area('locked', square(0.01, 0, 0.01)), locked: true },
    ])
    return made
  }

  it('pins a shared corner: dragging it moves nothing and says why, once', () => {
    const { editor, issues, changes } = withLockedNeighbour()
    expect(editor.beginDrag({ areaId: 'a', ring: 0, index: 1 })).toBe(true) // (0.01, 0)
    editor.dragTo([0.005, 0.002])
    editor.dragTo([0.004, 0.003])
    expect(editor.endDrag()).toBe(false)
    expect(issues).toEqual([{ code: 'pinned', otherId: 'locked' }])
    expect(changes).toHaveLength(0)
  })

  it('pins a shared border: a midpoint drag inserts nothing', () => {
    const { editor, issues } = withLockedNeighbour()
    expect(editor.beginInsert({ areaId: 'a', ring: 0, index: 1 }, [0.01, 0.005])).toBe(true)
    editor.dragTo([0.008, 0.005])
    editor.endDrag()
    expect(editor.getArea('a')!.rings[0]).toHaveLength(4)
    expect(issues[0]?.code).toBe('pinned')
  })

  it('refuses typed coordinates and deletion of a pinned corner', () => {
    const { editor, issues } = withLockedNeighbour()
    expect(editor.setVertex({ areaId: 'a', ring: 0, index: 1 }, [0.009, 0])).toBe(false)
    expect(editor.deleteVertex({ areaId: 'a', ring: 0, index: 1 })).toBe(false)
    expect(issues.map((i) => i.code)).toEqual(['pinned', 'pinned'])
  })

  it('still lets the free corners move', () => {
    const { editor } = withLockedNeighbour()
    expect(editor.setVertex({ areaId: 'a', ring: 0, index: 0 }, [-0.001, 0])).toBe(true)
  })
})

describe('following streets (no router: the network the map draws)', () => {
  // Streets every 0.001° (~111 m), each drawn as one long line, as a map would.
  const S = 0.001
  const streets = (): Position[][] => {
    const lines: Position[][] = []
    for (let i = 0; i <= 6; i++) {
      lines.push([
        [0, i * S],
        [6 * S, i * S],
      ])
      lines.push([
        [i * S, 6 * S],
        [i * S, 0],
      ])
    }
    return lines
  }
  const onStreetLine = (x: number) => Math.abs(x / S - Math.round(x / S)) < 1e-4
  const isOnGrid = (p: Position) => onStreetLine(p[0]) || onStreetLine(p[1])
  const street = (position: Position): SnapResult => ({ position, kind: 'line' })

  function city() {
    const made = makeEditor()
    made.editor.setStreetSource(() => streets())
    made.editor.setFollowRoads(true)
    // One big area over the whole city, drawn freely beyond its last streets.
    made.editor.setAreas([area('city', square(-0.5 * S, -0.5 * S, 7 * S))])
    return made
  }

  it('is available once the map supplies streets', () => {
    const { editor } = city()
    expect(editor.getState()).toMatchObject({ canFollowRoads: true, followRoads: true })
  })

  it('cuts the city along streets, in any direction, near the line the user clicked', async () => {
    const { editor } = city()
    editor.setMode('cut')
    await editor.addPoint(free([-S, 1.5 * S])) // outside, west
    await editor.addPoint(street([0, 1.5 * S])) // on the first north–south street
    await editor.addPoint(street([5 * S, 4.5 * S])) // across town, on another
    await editor.addPoint(free([7.5 * S, 4.5 * S])) // outside, east
    const path = editor.draftPath()
    // Between the two street clicks the cut runs along streets only.
    const inner = path.slice(2, -2)
    expect(inner.length).toBeGreaterThan(4)
    for (const p of inner) expect(isOnGrid(p)).toBe(true)
    expect(editor.finish()).toBe(true)
    expect(editor.getState().areas).toHaveLength(2)
  })

  it('cuts again from a point on an earlier cut, which lies on a street', async () => {
    const { editor } = city()
    editor.setMode('cut')
    await editor.addPoint(free([-S, 2 * S]))
    await editor.addPoint(street([0.5 * S, 2 * S]))
    await editor.addPoint(street([5.5 * S, 2 * S]))
    await editor.addPoint(free([7.5 * S, 2 * S]))
    expect(editor.finish()).toBe(true)

    // The second cut starts on the first cut's border — snapped to the area,
    // not to the street — and still follows the streets from there.
    editor.setMode('cut')
    await editor.addPoint({ position: [2.5 * S, 2 * S], kind: 'edge', areaId: 'city' })
    await editor.addPoint(street([4 * S, 5.5 * S]))
    await editor.addPoint(free([4 * S, 7.5 * S]))
    const inner = editor.draftPath().slice(1, -2)
    expect(inner.length).toBeGreaterThan(2)
    for (const p of inner) expect(isOnGrid(p)).toBe(true)
    expect(editor.finish()).toBe(true)
    expect(editor.getState().areas).toHaveLength(3)
  })

  it('draws straight to and from a click off the streets, without complaining', async () => {
    const { editor, issues } = city()
    editor.setMode('draw')
    await editor.addPoint(street([S, S]))
    await editor.addPoint(free([1.5 * S, 1.5 * S])) // inside a block
    expect(editor.draftPath()).toHaveLength(2)
    expect(issues).toEqual([])
  })

  it('turns a click a little past a corner into the corner, never doubling back', async () => {
    const { editor } = makeEditor()
    editor.setStreetSource(() => streets())
    editor.setFollowRoads(true)
    editor.setMode('draw')
    // The second click is ~22 m past the corner at x = 4S. The only way north
    // from there that stays near the line is back to that corner — so the
    // corner is where the border turns, and the click moves there.
    await editor.addPoint(street([0.5 * S, S]))
    await editor.addPoint(street([4.2 * S, S]))
    await editor.addPoint(street([4.2 * S, 4 * S]))
    const path = editor.draftPath()
    const keys = path.map((p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`)
    expect(new Set(keys).size).toBe(keys.length)
    const second = editor.getState().draft[1]!.position
    expect(second[0]).toBeCloseTo(4 * S, 9)
    expect(second[1]).toBeCloseTo(S, 9)
    // Nothing of the drawing lies east of the corner but the last click.
    expect(path.slice(0, -1).every((p) => p[0] <= 4 * S + 1e-9)).toBe(true)
  })

  it('never leaves a drawing that crosses itself, whatever the clicks', async () => {
    // A tight zig-zag of street clicks and free clicks: each path may come
    // back onto the stretch before it, or a straight segment may cross it.
    const clicks: [Position, boolean][] = [
      [[0.5 * S, S], true],
      [[3 * S, 2.5 * S], true],
      [[2 * S, 0.5 * S], false],
      [[4.5 * S, 1.2 * S], false],
      [[4 * S, 4 * S], true],
      [[S, 3.5 * S], true],
    ]
    const { editor } = makeEditor()
    editor.setStreetSource(() => streets())
    editor.setFollowRoads(true)
    editor.setMode('draw')
    for (const [p, onStreet] of clicks) await editor.addPoint(onStreet ? street(p) : free(p))
    expect(polygonIssues([editor.draftPath()], editor.epsilon)).not.toContain('self-intersection')
    expect(editor.finish()).toBe(true)
  })

  it('closes the area along the streets too', async () => {
    const { editor } = makeEditor()
    editor.setStreetSource(() => streets())
    editor.setFollowRoads(true)
    editor.setMode('draw')
    for (const p of [
      [0.5 * S, S],
      [4.5 * S, S],
      [4.5 * S, 4 * S],
      [S, 4.5 * S],
    ] as Position[])
      await editor.addPoint(street(p))
    // Back to the first corner: down x = S and along y = S, not across the block.
    await editor.addPoint(street([0.5 * S, S]))
    const ring = editor.getState().areas[0]!.rings[0]!
    expect(ring.some((p) => Math.abs(p[0] - S) < 1e-9 && Math.abs(p[1] - S) < 1e-9)).toBe(true)
  })

  it('draws a whole area along streets with the border following them', async () => {
    const { editor } = makeEditor()
    editor.setStreetSource(() => streets())
    editor.setFollowRoads(true)
    editor.setMode('draw')
    for (const p of [
      [0.5 * S, S],
      [4.5 * S, S],
      [4.5 * S, 4 * S],
      [0.5 * S, 4 * S],
    ] as Position[])
      await editor.addPoint(street(p))
    expect(editor.finish()).toBe(true)
    const ring = editor.getState().areas[0]!.rings[0]!
    for (const p of ring) expect(isOnGrid(p)).toBe(true)
  })
})
