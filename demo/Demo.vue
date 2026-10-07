<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { PolygonEditor, osrmRouter, photonGeocoder, type Area } from '../src'
import { basemapStyle, DEMO_BOUNDS, DEMO_CENTER, streetLayers } from './basemap'
import { sampleAreas } from './sample'

const CustomLayout = defineAsyncComponent(() => import('./CustomLayout.vue'))

const { locale } = useI18n()
const params = new URLSearchParams(window.location.search)
const custom = params.get('layout') === 'custom'
const dark = ref(
  params.get('theme') === 'dark' ||
    (!params.has('theme') && (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)),
)
// `?helpers=0` starts with search and routing off (the browser tests use it: no network).
const helpers = ref(params.get('helpers') !== '0')
if (params.get('lang') === 'es') locale.value = 'es'

const names = computed(() =>
  locale.value === 'es'
    ? { centre: 'Centro', east: 'Oriente', south: 'Sur', neighbour: 'Vecino (bloqueado)' }
    : { centre: 'Centre', east: 'East', south: 'South', neighbour: 'Neighbour (locked)' },
)
const areas = ref<Area[]>(sampleAreas(names.value))

const style = computed(() => basemapStyle(dark.value ? 'dark' : 'light', locale.value))

// Public demo services, fine for a demo's traffic. A real deployment runs its
// own (or plugs in any other geocoder/router) — the editor only sees a function.
const geocoder = photonGeocoder({ url: 'https://photon.komoot.io', bbox: [-100.52, 20.5, -100.28, 20.7] })
const router = osrmRouter({ url: 'https://router.project-osrm.org' })

const editorRef = ref<InstanceType<typeof PolygonEditor>>()

// A handle for the browser tests and for poking at the editor from devtools.
function onReady(map: MapLibreMap) {
  ;(window as unknown as { __demo: unknown }).__demo = { map, editor: editorRef.value?.editor }
}
watch(
  dark,
  async (d) => {
    document.documentElement.classList.toggle('dark', d)
    await nextTick()
    editorRef.value?.editor.binding.value?.refreshTheme()
  },
  { immediate: true },
)

function reset() {
  areas.value = sampleAreas(names.value)
}
function clear() {
  areas.value = []
}

const t = computed(() =>
  locale.value === 'es'
    ? {
        tagline: 'Editor de polígonos preciso para MapLibre: los bordes compartidos siguen compartidos.',
        reset: 'Restaurar ejemplo',
        clear: 'Vaciar',
        helpers: 'Búsqueda y ruteo',
        helpersNote: 'Usa los servidores públicos de demostración de Photon y OSRM.',
        layout: 'Diseño propio',
        defaultLayout: 'Diseño por defecto',
        geojson: 'GeoJSON (v-model)',
      }
    : {
        tagline: 'A precise polygon editor for MapLibre: shared borders stay shared.',
        reset: 'Reset sample',
        clear: 'Clear',
        helpers: 'Search & routing',
        helpersNote: 'Uses the public Photon and OSRM demo servers.',
        layout: 'Custom layout',
        defaultLayout: 'Default layout',
        geojson: 'GeoJSON (v-model)',
      },
)
</script>

<template>
  <div class="demo">
    <header class="demo__header">
      <div class="demo__title">
        <strong>maplibre-polygon-editor</strong>
        <span>{{ t.tagline }}</span>
      </div>
      <nav class="demo__controls pe-part">
        <button type="button" class="pe-btn pe-btn--outline" @click="reset">{{ t.reset }}</button>
        <button type="button" class="pe-btn pe-btn--outline" @click="clear">{{ t.clear }}</button>
        <label class="demo__toggle" :title="t.helpersNote">
          <input v-model="helpers" type="checkbox" /> {{ t.helpers }}
        </label>
        <select v-model="locale" class="pe-select demo__select" aria-label="Language">
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
        <button type="button" class="pe-btn pe-btn--outline" :aria-pressed="dark" @click="dark = !dark">
          {{ dark ? '☀' : '☾' }}
        </button>
        <a class="pe-btn" :href="custom ? '?' : '?layout=custom'">{{
          custom ? t.defaultLayout : t.layout
        }}</a>
        <a class="pe-btn" href="https://github.com/rsansores/maplibre-polygon-editor">GitHub</a>
      </nav>
    </header>

    <main class="demo__main">
      <CustomLayout v-if="custom" v-model="areas" :map-style="style" :snap-layers="streetLayers" />
      <PolygonEditor
        v-else
        ref="editorRef"
        v-model="areas"
        :map-style="style"
        :center="DEMO_CENTER"
        :zoom="14"
        :map-options="{ maxBounds: DEMO_BOUNDS, minZoom: 11 }"
        :snap-layers="streetLayers"
        :geocoder="helpers ? geocoder : null"
        :router="helpers ? router : null"
        @ready="onReady"
      />
    </main>

    <details class="demo__json">
      <summary>{{ t.geojson }} · {{ areas.length }}</summary>
      <pre>{{ JSON.stringify(areas, null, 2) }}</pre>
    </details>
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
:root {
  --color-background: #ffffff;
  --color-foreground: #0f172a;
  --color-card: #ffffff;
  --color-muted: #f1f5f9;
  --color-muted-foreground: #64748b;
  --color-border: #e2e8f0;
  --color-input: #cbd5e1;
  --color-primary: #4f46e5;
  --color-primary-foreground: #ffffff;
  --color-accent: #eef2ff;
  color-scheme: light;
}
:root.dark {
  --color-background: #0b1120;
  --color-foreground: #e2e8f0;
  --color-card: #111827;
  --color-muted: #1f2937;
  --color-muted-foreground: #94a3b8;
  --color-border: #1f2937;
  --color-input: #334155;
  --color-primary: #818cf8;
  --color-primary-foreground: #0b1120;
  --color-accent: #1e1b4b;
  --color-accent-foreground: #e0e7ff;
  color-scheme: dark;
}
body {
  background: var(--color-background);
  color: var(--color-foreground);
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}
.demo {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0.75rem;
  padding: 0.75rem;
  box-sizing: border-box;
}
.demo__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.demo__title {
  display: flex;
  flex-direction: column;
}
.demo__title span {
  color: var(--color-muted-foreground);
  font-size: 0.875rem;
}
.demo__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
}
.demo__controls a {
  text-decoration: none;
}
.demo__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.875rem;
}
.demo__select {
  width: auto;
}
.demo__main {
  flex: 1;
  min-height: 0;
}
.demo__json {
  max-height: 30vh;
  overflow: auto;
  font-size: 0.75rem;
}
.demo__json pre {
  margin: 0.5rem 0 0;
}
</style>
