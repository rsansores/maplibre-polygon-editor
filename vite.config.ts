/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

// Three modes:
//   `vite`                    -> dev server for the standalone demo (index.html)
//   `vite build`              -> library build for embedding in a host app
//   `BUILD_DEMO=1 vite build` -> static demo for GitHub Pages (dist-demo/)
//
// The demo is 100% client-side: its basemap is a PMTiles file served next to
// the page, so it deploys as plain static files.
const isDemo = process.env.BUILD_DEMO === '1'

export default defineConfig(({ command }) => {
  if (isDemo) {
    return {
      plugins: [vue()],
      // Served from https://<user>.github.io/maplibre-polygon-editor/.
      base: process.env.DEMO_BASE ?? '/maplibre-polygon-editor/',
      publicDir: 'demo/public',
      build: { outDir: 'dist-demo', emptyOutDir: true },
    }
  }

  return {
    plugins: [vue()],
    publicDir: command === 'build' ? false : 'demo/public',
    // Declared up front so the dev server never re-optimizes and reloads the
    // page mid-session (which the browser tests would see as a navigation).
    optimizeDeps: {
      include: ['maplibre-gl', 'pmtiles', '@protomaps/basemaps', 'polyclip-ts', 'vue', 'vue-i18n'],
    },
    build:
      command === 'build'
        ? {
            lib: {
              entry: {
                'polygon-editor': resolve(import.meta.dirname, 'src/index.ts'),
                core: resolve(import.meta.dirname, 'src/core/index.ts'),
              },
              // ESM only: MapLibre 6 is ESM-only, so a CommonJS build could not load it anyway.
              formats: ['es'],
              cssFileName: 'polygon-editor',
            },
            rollupOptions: {
              // Peers come from the host; dependencies are installed next to
              // the package, so the host's bundler can dedupe them. Nothing is
              // inlined.
              external: ['vue', 'maplibre-gl', /^maplibre-gl\//, 'polyclip-ts'],
            },
          }
        : undefined,
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
      coverage: {
        provider: 'v8',
        include: ['src/core/**', 'src/adapters/**'],
        reporter: ['text', 'html'],
      },
    },
  }
})
