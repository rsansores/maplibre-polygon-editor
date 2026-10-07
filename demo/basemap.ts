import { Protocol } from 'pmtiles'
import { addProtocol, setWorkerUrl, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import { layers, namedFlavor } from '@protomaps/basemaps'
// MapLibre 6 runs its tile parsing in a worker loaded from a separate file.
// A bundler moves the main module, so tell MapLibre where the worker ended up.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

setWorkerUrl(workerUrl)

// The demo's basemap is one PMTiles file served next to the page
// (demo/public/data, built by scripts/fetch-demo-data.sh): vector tiles for
// one city, no tile server and no API key. A real deployment points the same
// style at its own, larger file — or at any other MapLibre style.

let registered = false

export function basemapStyle(flavor: 'light' | 'dark', lang: string): StyleSpecification {
  if (!registered) {
    addProtocol('pmtiles', new Protocol().tile)
    registered = true
  }
  const data = new URL(`${import.meta.env.BASE_URL}data/`, window.location.href).href
  return {
    version: 8,
    glyphs: `${data}fonts/{fontstack}/{range}.pbf`,
    sprite: `${data}sprites/${flavor}`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${data}demo.pmtiles`,
        attribution:
          '<a href="https://openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: layers('protomaps', namedFlavor(flavor), { lang }),
  }
}

/**
 * The street layers of the Protomaps style: the lines worth snapping to.
 * Casings, labels and rails are left out.
 */
export function streetLayers(map: MapLibreMap): string[] {
  return (map.getStyle()?.layers ?? [])
    .filter((l) => l.type === 'line' && /^roads_/.test(l.id) && !/casing|rail|runway|taxiway|pier/.test(l.id))
    .map((l) => l.id)
}

/** Querétaro, Mexico — the area the bundled tiles cover. */
export const DEMO_CENTER: [number, number] = [-100.392, 20.592]
export const DEMO_BOUNDS: [[number, number], [number, number]] = [
  [-100.52, 20.5],
  [-100.28, 20.7],
]
