// Screenshot the running demo — for the README and for eyeballing a change.
//
//   pnpm dev &                                   # serves on :5198
//   node scripts/shoot.mjs [url] [out.png] [width] [height]
import { chromium } from '@playwright/test'

const [url = 'http://localhost:5198/', out = 'docs/screenshot.png', width = '1400', height = '860'] =
  process.argv.slice(2)

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(url)
await page.waitForSelector('.maplibregl-canvas')
// Let the tiles arrive and the fonts render.
await page.waitForTimeout(2500)
await page.screenshot({ path: out })
await browser.close()
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
