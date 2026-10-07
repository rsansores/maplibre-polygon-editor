import { expect, type Page } from '@playwright/test'
import type { Area, Position } from '../../src'

/** Open the demo with search and routing off (no network), and wait for the map. */
export async function openDemo(page: Page, query = ''): Promise<void> {
  await page.goto(`/?helpers=0&theme=light${query}`)
  await page.waitForFunction(() => (window as unknown as { __demo?: unknown }).__demo !== undefined)
  // The demo fits the map to the areas on load; let that animation finish so
  // it cannot override the camera below.
  await page.waitForFunction(
    () => !(window as unknown as { __demo: { map: import('maplibre-gl').Map } }).__demo.map.isMoving(),
  )
  // A fixed camera, so every test coordinate is on screen at street zoom
  // (about 4.5 m per pixel here).
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const { map } = (window as unknown as { __demo: { map: import('maplibre-gl').Map } }).__demo
        map.once('idle', resolve)
        map.jumpTo({ center: [-100.388, 20.592], zoom: 14 })
      }),
  )
}

/** Page coordinates of a longitude/latitude on the map. */
export async function toScreen(page: Page, p: Position): Promise<{ x: number; y: number }> {
  return page.evaluate(([lng, lat]) => {
    const { map } = (window as unknown as { __demo: { map: import('maplibre-gl').Map } }).__demo
    const rect = map.getCanvas().getBoundingClientRect()
    const point = map.project([lng, lat])
    return { x: rect.left + point.x, y: rect.top + point.y }
  }, p)
}

/** The longitude/latitude under a page pixel. */
async function pixelToPosition(page: Page, x: number, y: number): Promise<Position> {
  return page.evaluate(
    ({ px, py }) => {
      const { map } = (window as unknown as { __demo: { map: import('maplibre-gl').Map } }).__demo
      const rect = map.getCanvas().getBoundingClientRect()
      const ll = map.unproject([px - rect.left, py - rect.top])
      return [ll.lng, ll.lat] as Position
    },
    { px: x, py: y },
  )
}

/** The editor's areas, as the core holds them. */
export async function areas(page: Page): Promise<Area[]> {
  return page.evaluate(() => {
    const demo = (window as unknown as { __demo: { editor: { areas: { value: unknown } } } }).__demo
    return JSON.parse(JSON.stringify(demo.editor.areas.value)) as Area[]
  })
}

export async function areaById(page: Page, id: string): Promise<Area> {
  const found = (await areas(page)).find((a) => a.id === id)
  expect(found, `area ${id}`).toBeDefined()
  return found!
}

/**
 * Click the whole pixel nearest `p` (browsers deliver integer mouse
 * coordinates) and return the exact longitude/latitude of that pixel — where
 * the editor should put a free click, to the last decimal.
 */
export async function clickMap(page: Page, p: Position): Promise<Position> {
  const s = await toScreen(page, p)
  const x = Math.round(s.x)
  const y = Math.round(s.y)
  const at = await pixelToPosition(page, x, y)
  await page.mouse.click(x, y)
  return at
}

/** Drag from `from` to `to` (whole pixels) and return the exact position of the drop pixel. */
export async function dragOnMap(page: Page, from: Position, to: Position): Promise<Position> {
  const a = await toScreen(page, from)
  const b = await toScreen(page, to)
  const [x, y] = [Math.round(b.x), Math.round(b.y)]
  const at = await pixelToPosition(page, x, y)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + x) / 2, (a.y + y) / 2, { steps: 4 })
  await page.mouse.move(x, y, { steps: 4 })
  await page.mouse.up()
  return at
}

/** Does any ring of `area` hold a vertex within `epsilon` degrees of `p`? */
export function holds(area: Area, p: Position, epsilon = 1e-7): boolean {
  return area.rings.some((r) =>
    r.some((q) => Math.abs(q[0] - p[0]) < epsilon && Math.abs(q[1] - p[1]) < epsilon),
  )
}

export async function mode(page: Page, name: 'select' | 'draw' | 'cut'): Promise<void> {
  await page.locator(`.pe-toolbar [data-mode="${name}"]`).click()
}

export async function snapping(page: Page, on: boolean): Promise<void> {
  const button = page.locator('.pe-toolbar button', { hasText: /^Snap$/ })
  if ((await button.getAttribute('aria-pressed')) !== String(on)) await button.click()
}
