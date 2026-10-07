import { expect, test } from '@playwright/test'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { PolygonEditorCore, Position, SnapResult, snap as snapFn } from '../../src'

interface Demo {
  map: MapLibreMap
  editor: { core: PolygonEditorCore }
  snap: typeof snapFn
}

// Random drawings on the real demo map, with "follow roads" on: areas from
// 4–7 street clicks, cuts across a city-wide area, and second cuts that start
// on the first one — at three zooms. Every one must produce valid polygons;
// a border that touches itself anywhere fails the run. Seeded, so a failure
// reproduces.

test('every random area and cut along streets is valid', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?helpers=0&theme=light')
  await page.waitForFunction(() => {
    const demo = (window as unknown as { __demo?: Demo }).__demo
    return demo !== undefined && !demo.map.isMoving()
  })

  const failures = await page.evaluate(async () => {
    const { map, editor, snap } = (window as unknown as { __demo: Demo }).__demo
    const core = editor.core
    let seed = 20261007
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const layers = (map.getStyle().layers ?? [])
      .filter(
        (l) => l.type === 'line' && /^roads_/.test(l.id) && !/casing|rail|runway|taxiway|pier/.test(l.id),
      )
      .map((l) => l.id)
    // Snap the way the map binding does with "follow roads" on.
    const at = (p: Position, free = false): SnapResult => {
      if (free) return { position: p, kind: 'none' }
      const q = map.project(p)
      const lines: Position[][] = []
      for (const f of map.queryRenderedFeatures(
        [
          [q.x - 30, q.y - 30],
          [q.x + 30, q.y + 30],
        ],
        { layers },
      )) {
        const g = f.geometry
        if (g.type === 'LineString') lines.push(g.coordinates as Position[])
        else if (g.type === 'MultiLineString') lines.push(...(g.coordinates as Position[][]))
      }
      return snap(p, q, {
        project: (x) => map.project(x),
        tolerancePx: 12,
        lineTolerancePx: 30,
        areas: core.getState().areas,
        lines,
        points: core.getState().draft.map((d) => d.position),
      })
    }
    const issues: string[] = []
    core.on('issue', (i) => issues.push(i.code))
    const failures: string[] = []
    core.setFollowRoads(true)

    for (const zoom of [13.5, 14.5, 15.5]) {
      await new Promise((resolve) => {
        map.once('idle', resolve)
        map.jumpTo({ center: [-100.392, 20.591], zoom })
      })
      const b = map.getBounds()
      const [W, E, S, N] = [b.getWest(), b.getEast(), b.getSouth(), b.getNorth()]
      for (let trial = 0; trial < 8; trial++) {
        const label = `zoom ${zoom} trial ${trial}`

        // An area around a random centre.
        core.setAreas([])
        core.setMode('draw')
        issues.length = 0
        const cx = W + (E - W) * (0.3 + 0.4 * rnd())
        const cy = S + (N - S) * (0.3 + 0.4 * rnd())
        const k = 4 + Math.floor(rnd() * 4)
        const rx = (E - W) * (0.1 + 0.15 * rnd())
        const ry = (N - S) * (0.1 + 0.15 * rnd())
        for (let i = 0; i < k; i++) {
          const a = (i / k) * 2 * Math.PI + rnd() * 0.5
          await core.addPoint(at([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]))
        }
        const first = core.getState().draft[0]!
        await core.addPoint({ ...first.snap, position: first.position })
        if (core.getState().areas.length !== 1) failures.push(`${label} draw: ${issues.join(', ')}`)

        // A cut across a city-wide area.
        core.setMode('select')
        const m = (f: number, g: number): Position => [W + (E - W) * f, S + (N - S) * g]
        core.setAreas([
          {
            id: 'city',
            properties: {},
            rings: [[m(0.05, 0.05), m(0.95, 0.05), m(0.95, 0.95), m(0.05, 0.95)]],
          },
        ])
        core.setMode('cut')
        issues.length = 0
        const y0 = 0.2 + 0.6 * rnd()
        const y1 = 0.2 + 0.6 * rnd()
        await core.addPoint(at(m(0.01, y0), true))
        const clicks = 2 + Math.floor(rnd() * 3)
        for (let i = 1; i <= clicks; i++) {
          const t = i / (clicks + 1)
          await core.addPoint(at(m(0.1 + 0.8 * t, y0 + (y1 - y0) * t + 0.1 * (rnd() - 0.5))))
        }
        await core.addPoint(at(m(0.99, y1), true))
        if (!core.finish()) {
          failures.push(`${label} cut: ${issues.join(', ')}`)
          core.cancelDraft()
          continue
        }

        // A second cut from a point on the first, north or south.
        const piece = core.getState().areas[0]!
        const on = piece.rings[0]!.filter(
          (p) =>
            p[0] > W + (E - W) * 0.2 &&
            p[0] < E - (E - W) * 0.2 &&
            p[1] > S + (N - S) * 0.1 &&
            p[1] < N - (N - S) * 0.1,
        )
        if (on.length === 0) continue
        const start = on[Math.floor(rnd() * on.length)]!
        const target = rnd() < 0.5 ? N - (N - S) * 0.01 : S + (N - S) * 0.01
        core.setMode('cut')
        issues.length = 0
        await core.addPoint({ position: start, kind: 'vertex', areaId: piece.id })
        const more = 1 + Math.floor(rnd() * 2)
        for (let i = 1; i <= more; i++) {
          const t = i / (more + 1)
          await core.addPoint(
            at([start[0] + (E - W) * 0.1 * (rnd() - 0.5), start[1] + (target - start[1]) * t]),
          )
        }
        await core.addPoint(at([start[0], target], true))
        if (!core.finish()) failures.push(`${label} second cut: ${issues.join(', ')}`)
        core.cancelDraft()
      }
    }
    return failures
  })
  expect(failures).toEqual([])
})
