import { expect, test, type Page } from '@playwright/test'
import type { Position } from '../../src'
import { areas, clickMap, mode, snapping } from './helpers'

// How people use the tool: one big area over the whole city (free clicks,
// partly through open country), then cuts along the streets they want as
// borders — every cut after the first starting on an earlier one.

/** The street vertex drawn nearest to `near` (from the basemap's road layers). */
async function streetNear(page: Page, near: Position): Promise<Position> {
  return page.evaluate(([lng, lat]) => {
    const { map } = (window as unknown as { __demo: { map: import('maplibre-gl').Map } }).__demo
    const q = map.project([lng, lat])
    const layers = (map.getStyle().layers ?? [])
      .filter((l) => l.type === 'line' && /^roads_(minor|major|other|link)$/.test(l.id))
      .map((l) => l.id)
    let best: { d: number; c: Position } | null = null
    for (const f of map.queryRenderedFeatures(
      [
        [q.x - 40, q.y - 40],
        [q.x + 40, q.y + 40],
      ],
      { layers },
    )) {
      const g = f.geometry
      const lines = (
        g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
      ) as Position[][]
      for (const line of lines) {
        for (const c of line) {
          const s = map.project(c)
          const d = Math.hypot(s.x - q.x, s.y - q.y)
          if (!best || d < best.d) best = { d, c }
        }
      }
    }
    if (!best) throw new Error(`no street near ${lng}, ${lat}`)
    return best.c
  }, near)
}

async function freeClick(page: Page, p: Position) {
  await page.keyboard.down('Alt')
  await clickMap(page, p)
  await page.keyboard.up('Alt')
}

async function draftLength(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __demo: { editor: { core: { draftPath(): unknown[] } } } }
      ).__demo.editor.core.draftPath().length,
  )
}

test('cut a city-wide area along streets, twice', async ({ page }) => {
  await page.goto('/?helpers=0&theme=light')
  await page.waitForFunction(() => {
    const demo = (window as unknown as { __demo?: { map: import('maplibre-gl').Map } }).__demo
    return demo !== undefined && !demo.map.isMoving()
  })
  await page.locator('.demo__controls button', { hasText: 'Clear' }).click()
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const { map } = (window as unknown as { __demo: { map: import('maplibre-gl').Map } }).__demo
        map.once('idle', resolve)
        map.jumpTo({ center: [-100.39, 20.592], zoom: 13.5 })
      }),
  )

  // 1. The whole city, drawn freely.
  await snapping(page, false)
  await mode(page, 'draw')
  for (const p of [
    [-100.415, 20.576],
    [-100.365, 20.576],
    [-100.365, 20.608],
    [-100.415, 20.608],
  ] as Position[])
    await clickMap(page, p)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pe-list-item')).toHaveCount(1)

  // 2. Cut it west to east along streets: in from outside, three clicks on
  //    streets, out again.
  await snapping(page, true)
  await page.locator('.pe-toolbar button', { hasText: 'Follow roads' }).click()
  await mode(page, 'cut')
  await freeClick(page, [-100.419, 20.59])
  for (const near of [
    [-100.408, 20.59],
    [-100.392, 20.596],
    [-100.372, 20.588],
  ] as Position[])
    await clickMap(page, await streetNear(page, near))
  await freeClick(page, [-100.361, 20.588])
  // Five clicks, but the cut follows the streets between them.
  expect(await draftLength(page)).toBeGreaterThan(30)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pe-list-item')).toHaveCount(2)
  await expect(page.locator('.pe-toast')).toHaveCount(0)

  // 3. Cut the northern half from a point on the first cut, north along streets.
  const north = (await areas(page)).find((a) => a.rings[0]!.some((p) => p[1] > 20.6))!
  const start = north.rings[0]!.reduce((best, p) =>
    Math.hypot(p[0] + 100.386, p[1] - 20.5935) < Math.hypot(best[0] + 100.386, best[1] - 20.5935) ? p : best,
  )
  await clickMap(page, start)
  await clickMap(page, await streetNear(page, [-100.384, 20.604]))
  await freeClick(page, [-100.384, 20.611])
  expect(await draftLength(page)).toBeGreaterThan(10)
  await page.keyboard.press('Enter')
  await expect(page.locator('.pe-list-item')).toHaveCount(3)
  await expect(page.locator('.pe-toast')).toHaveCount(0)
})
