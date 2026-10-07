import { defineConfig, devices } from '@playwright/test'

// Browser tests drive the demo with a real MapLibre map (WebGL through
// SwiftShader in headless Chromium). They cover what unit tests cannot: that a
// click, a drag or a key on the map reaches the editor the way a person means it.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5297',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
  ],
  webServer: {
    command: 'pnpm exec vite --port 5297 --strictPort',
    url: 'http://localhost:5297',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
