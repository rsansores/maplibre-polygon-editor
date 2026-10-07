import type { Router } from '../core/trace'
import type { Position } from '../core/types'

export interface OsrmOptions {
  /** Base URL of an OSRM server, e.g. `https://router.project-osrm.org`. */
  url: string
  /** Routing profile the server was built with. */
  profile?: string
  fetch?: typeof fetch
}

/**
 * A router backed by OSRM (https://project-osrm.org). Used by "follow roads":
 * the segment between two clicks on streets follows the street network.
 */
export function osrmRouter(options: OsrmOptions): Router {
  const doFetch = options.fetch ?? fetch.bind(globalThis)
  const base = options.url.replace(/\/$/, '')
  const profile = options.profile ?? 'driving'
  return async (from: Position, to: Position, signal?: AbortSignal) => {
    const coordinates = `${from[0]},${from[1]};${to[0]},${to[1]}`
    const response = await doFetch(
      `${base}/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=false`,
      { signal },
    )
    if (!response.ok) return null
    const body = (await response.json()) as {
      code?: string
      routes?: { geometry?: { coordinates?: Position[] } }[]
    }
    if (body.code !== 'Ok') return null
    return body.routes?.[0]?.geometry?.coordinates ?? null
  }
}
