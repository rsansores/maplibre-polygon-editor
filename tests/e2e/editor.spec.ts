import { expect, test } from '@playwright/test'
import type { Position } from '../../src'
import { areaById, areas, clickMap, dragOnMap, holds, mode, openDemo, snapping, toScreen } from './helpers'

// The sample: Centre and East side by side, South below both (holding the
// T-junction where they meet), and a locked Neighbour to the west.
const CENTRE_EAST_TOP: Position = [-100.388, 20.598]
const T_JUNCTION: Position = [-100.388, 20.588]

test.beforeEach(async ({ page }) => {
  await openDemo(page)
})

test('draws an area corner by corner and closes it on the first corner', async ({ page }) => {
  await snapping(page, false)
  await mode(page, 'draw')
  const ring: Position[] = [
    [-100.384, 20.6],
    [-100.378, 20.6],
    [-100.378, 20.604],
    [-100.384, 20.604],
  ]
  const clicked: Position[] = []
  for (const p of ring) clicked.push(await clickMap(page, p))
  await expect(page.locator('.pe-chip')).toContainText('first corner')
  await clickMap(page, ring[0]!)

  await expect(page.locator('.pe-list-item')).toHaveCount(5)
  const created = (await areas(page)).at(-1)!
  expect(created.rings[0]).toHaveLength(4)
  // A click is placed exactly where it lands (to 8 decimals, ~1 mm): no
  // smoothing, no simplification.
  for (const p of clicked) expect(holds(created, p, 1e-8)).toBe(true)
  await expect(page.locator('.pe-inspector input').first()).toHaveValue('Area 5')
})

test('trims a sloppy drawing to the free ground and shares the border', async ({ page }) => {
  await snapping(page, false)
  await mode(page, 'draw')
  // Overlaps East's right side (x = -100.376) by a few hundred metres.
  const clicked: Position[] = []
  for (const p of [
    [-100.379, 20.59],
    [-100.368, 20.59],
    [-100.368, 20.596],
    [-100.379, 20.596],
  ] as Position[])
    clicked.push(await clickMap(page, p))
  await page.keyboard.press('Enter')

  await expect(page.locator('.pe-toast')).toContainText('trimmed')
  const created = (await areas(page)).at(-1)!
  const east = await areaById(page, 'oriente')
  // Where the drawing crossed East's border, both areas now hold the same vertex.
  for (const lat of [clicked[0]![1], clicked[2]![1]]) {
    const junction = created.rings[0]!.find(
      (p) => Math.abs(p[0] + 100.376) < 1e-8 && Math.abs(p[1] - lat) < 1e-7,
    )
    expect(junction, `junction at ${lat}`).toBeDefined()
    expect(holds(east, junction!, 1e-9)).toBe(true)
  }
})

test('dragging a shared corner moves every area that holds it, and undo puts it back', async ({ page }) => {
  await snapping(page, false)
  await clickMap(page, [-100.394, 20.594]) // select Centre
  await expect(page.locator('.pe-list-item[aria-current="true"]')).toContainText('Centre')

  const dropped = await dragOnMap(page, CENTRE_EAST_TOP, [-100.3875, 20.5995])
  const at = (await areaById(page, 'centro')).rings[0]!.find(
    (p) => Math.abs(p[0] - dropped[0]) < 1e-7 && Math.abs(p[1] - dropped[1]) < 1e-7,
  )
  expect(at, 'the dragged corner is where it was dropped').toBeDefined()
  expect(holds(await areaById(page, 'oriente'), at!, 1e-9)).toBe(true)
  expect(holds(await areaById(page, 'centro'), CENTRE_EAST_TOP)).toBe(false)

  await page.locator('.maplibregl-canvas').focus()
  await page.keyboard.press('Control+z')
  expect(holds(await areaById(page, 'centro'), CENTRE_EAST_TOP)).toBe(true)
  expect(holds(await areaById(page, 'oriente'), CENTRE_EAST_TOP)).toBe(true)
})

test('the T-junction carries three areas', async ({ page }) => {
  await snapping(page, false)
  await clickMap(page, [-100.394, 20.594])
  const dropped = await dragOnMap(page, T_JUNCTION, [-100.3885, 20.5875])
  const holders = (await areas(page)).filter((a) => holds(a, dropped, 1e-7))
  expect(holders.map((a) => a.id).sort()).toEqual(['centro', 'oriente', 'sur'])
})

test('cuts an area in two with a line across it', async ({ page }) => {
  await snapping(page, false)
  await clickMap(page, [-100.394, 20.594])
  await mode(page, 'cut')
  await clickMap(page, [-100.394, 20.5995])
  const end = await toScreen(page, [-100.394, 20.5865])
  await page.mouse.dblclick(end.x, end.y)
  await expect(page.locator('.pe-list-item')).toHaveCount(5)
  const centre = await areaById(page, 'centro')
  expect(holds(centre, [-100.394, 20.598], 2e-5)).toBe(true)
})

test('a corner shared with a locked neighbour is pinned, and the editor says why', async ({ page }) => {
  await clickMap(page, [-100.394, 20.594]) // Centre
  await clickMap(page, [-100.4, 20.598]) // its north-west corner, shared with the locked neighbour
  await page.locator('input[name="lng"]').fill('-100.3995')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.pe-toast')).toContainText('shared with a locked area')
  expect(holds(await areaById(page, 'centro'), [-100.4, 20.598], 1e-9)).toBe(true)
})

test('moves a free corner to exact typed coordinates', async ({ page }) => {
  await clickMap(page, [-100.38, 20.594]) // East
  await clickMap(page, [-100.376, 20.598]) // its north-east corner, shared with no one
  await page.locator('input[name="lat"]').fill('20.5991234')
  await page.locator('input[name="lng"]').fill('-100.3751234')
  await page.getByRole('button', { name: 'Apply' }).click()
  expect(holds(await areaById(page, 'oriente'), [-100.3751234, 20.5991234], 1e-9)).toBe(true)
})

test('a locked area is selectable but not editable', async ({ page }) => {
  await clickMap(page, [-100.406, 20.59])
  await expect(page.locator('.pe-inspector')).toContainText('not edited')
  await expect(page.locator('.pe-inspector').getByRole('button', { name: 'Delete area' })).toHaveCount(0)
})

test('Escape abandons a draft and Backspace removes its last corner', async ({ page }) => {
  await snapping(page, false)
  await mode(page, 'draw')
  await clickMap(page, [-100.384, 20.6])
  await clickMap(page, [-100.378, 20.6])
  await page.keyboard.press('Backspace')
  await expect(page.locator('.pe-chip')).toContainText('Click to add a corner')
  await page.keyboard.press('Escape')
  await expect(page.locator('.pe-chip')).toContainText('first corner')
})

test('pasted coordinates work with no search service', async ({ page }) => {
  await page.locator('.pe-search input').fill(`20°35'19.7"N 100°23'23.6"W`)
  await expect(page.locator('.pe-results')).toContainText('20.588806')
})

test('follows the host locale', async ({ page }) => {
  await page.locator('.demo__select').selectOption('es')
  await expect(page.locator('.pe-toolbar')).toContainText('Dibujar')
})
