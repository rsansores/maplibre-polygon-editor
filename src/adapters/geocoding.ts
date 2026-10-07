import type { Position } from '../core/types'

/** One place a search found. */
export interface GeocodeResult {
  /** What to show: "Avenida Constituyentes 12, Querétaro". */
  label: string
  position: Position
  /** `[west, south, east, north]` when the place has an extent worth fitting. */
  bbox?: [number, number, number, number]
}

export interface GeocodeQuery {
  /** Bias results towards this point (usually the map centre). */
  near?: Position
  /** Preferred language for labels, e.g. `es`. */
  language?: string
  signal?: AbortSignal
}

/**
 * Anything that turns text into places. The editor only ever calls this; plug
 * in a hosted service, your own, or a lookup in your own database.
 */
export type Geocoder = (text: string, query: GeocodeQuery) => Promise<GeocodeResult[]>

export interface PhotonOptions {
  /** Base URL of a Photon instance, e.g. `https://photon.komoot.io`. */
  url: string
  limit?: number
  /** Restrict to `[west, south, east, north]`. */
  bbox?: [number, number, number, number]
  /** Languages the instance was imported with; others fall back to the default. */
  languages?: string[]
  fetch?: typeof fetch
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: Record<string, string | number | number[] | undefined> & { extent?: number[] }
}

/**
 * A geocoder backed by Photon (https://github.com/komoot/photon), an
 * OpenStreetMap search engine you can run yourself from a country extract.
 */
export function photonGeocoder(options: PhotonOptions): Geocoder {
  const doFetch = options.fetch ?? fetch.bind(globalThis)
  const languages = options.languages ?? ['en', 'de', 'fr']
  return async (text, query) => {
    const params = new URLSearchParams({ q: text, limit: String(options.limit ?? 6) })
    if (query.near) {
      params.set('lon', String(query.near[0]))
      params.set('lat', String(query.near[1]))
    }
    if (query.language && languages.includes(query.language)) params.set('lang', query.language)
    if (options.bbox) params.set('bbox', options.bbox.join(','))
    const response = await doFetch(`${options.url.replace(/\/$/, '')}/api?${params}`, {
      signal: query.signal,
    })
    if (!response.ok) throw new Error(`Photon answered ${response.status}`)
    const body = (await response.json()) as { features?: PhotonFeature[] }
    return (body.features ?? []).map((f) => {
      const extent = f.properties.extent
      return {
        label: photonLabel(f.properties),
        position: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as Position,
        // Photon's extent is [west, north, east, south].
        bbox:
          Array.isArray(extent) && extent.length === 4
            ? ([extent[0], extent[3], extent[2], extent[1]] as [number, number, number, number])
            : undefined,
      }
    })
  }
}

function photonLabel(p: Record<string, unknown>): string {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ')
  const head = p.name ? String(p.name) : street
  const tail = [p.name ? street : undefined, p.district, p.city, p.state]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .filter((x, i, all) => x !== head && all.indexOf(x) === i)
  return [head, ...tail].filter(Boolean).join(', ')
}
