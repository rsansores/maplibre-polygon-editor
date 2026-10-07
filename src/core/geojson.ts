import { dedupeRing, roundPosition } from './geo'
import type { Area, Position, Ring } from './types'

/**
 * GeoJSON in and out (RFC 7946). Output rings are closed and the outer ring
 * winds counter-clockwise, holes clockwise, as the RFC recommends — so the
 * result goes straight into PostGIS (`ST_GeomFromGeoJSON`), turf, or a file.
 */

type AreaFeature = GeoJSON.Feature<GeoJSON.Polygon, Record<string, unknown>>

function signedArea(ring: Ring): number {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    total += a[0] * b[1] - b[0] * a[1]
  }
  return total / 2
}

function orient(ring: Ring, counterClockwise: boolean): Ring {
  return signedArea(ring) > 0 === counterClockwise ? ring : [...ring].reverse()
}

function closeRing(ring: Ring, decimals?: number): Position[] {
  const out =
    decimals === undefined
      ? ring.map((p) => [p[0], p[1]] as Position)
      : ring.map((p) => roundPosition(p, decimals))
  if (out.length > 0) out.push([out[0]![0], out[0]![1]])
  return out
}

/** One area as a GeoJSON Feature. The area id becomes the feature id. */
export function toFeature(area: Area, decimals?: number): AreaFeature {
  return {
    type: 'Feature',
    id: area.id,
    properties: { ...area.properties },
    geometry: {
      type: 'Polygon',
      coordinates: area.rings.map((ring, i) => closeRing(orient(ring, i === 0), decimals)),
    },
  }
}

export function toFeatureCollection(
  areas: readonly Area[],
  decimals?: number,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, Record<string, unknown>> {
  return { type: 'FeatureCollection', features: areas.map((a) => toFeature(a, decimals)) }
}

export interface ImportResult {
  areas: Area[]
  /** Features that held no polygon (points, lines, empty geometries). */
  skipped: number
}

function openRing(ring: GeoJSON.Position[]): Ring {
  return dedupeRing(
    ring.map((p) => [Number(p[0]), Number(p[1])] as Position),
    0,
  )
}

/**
 * Areas from any GeoJSON: a geometry, a Feature or a FeatureCollection.
 * A MultiPolygon becomes one area per polygon (ids suffixed `-1`, `-2`, …),
 * because an area is one connected piece of ground.
 */
export function fromGeoJSON(input: unknown, createId: () => string): ImportResult {
  const areas: Area[] = []
  let skipped = 0

  const addPolygon = (coords: GeoJSON.Position[][], id: string, properties: Record<string, unknown>) => {
    const rings = coords.map(openRing).filter((r) => r.length >= 3)
    if (rings.length === 0) {
      skipped++
      return
    }
    areas.push({ id, rings, properties: { ...properties } })
  }

  const visit = (
    geometry: GeoJSON.Geometry | null,
    id: string | undefined,
    properties: Record<string, unknown>,
  ) => {
    if (!geometry) {
      skipped++
      return
    }
    switch (geometry.type) {
      case 'Polygon':
        addPolygon(geometry.coordinates, id ?? createId(), properties)
        break
      case 'MultiPolygon':
        geometry.coordinates.forEach((polygon, i) =>
          addPolygon(
            polygon,
            id ? (geometry.coordinates.length === 1 ? id : `${id}-${i + 1}`) : createId(),
            properties,
          ),
        )
        break
      case 'GeometryCollection':
        geometry.geometries.forEach((g) => visit(g, undefined, properties))
        break
      default:
        skipped++
    }
  }

  const value = input as GeoJSON.GeoJSON
  if (!value || typeof value !== 'object' || !('type' in value)) return { areas, skipped: 1 }
  if (value.type === 'FeatureCollection') {
    for (const feature of value.features) visitFeature(feature)
  } else if (value.type === 'Feature') {
    visitFeature(value)
  } else {
    visit(value, undefined, {})
  }
  return { areas, skipped }

  function visitFeature(feature: GeoJSON.Feature) {
    const properties = { ...(feature.properties ?? {}) }
    const id =
      feature.id !== undefined
        ? String(feature.id)
        : typeof properties.id === 'string'
          ? properties.id
          : undefined
    visit(feature.geometry, id, properties)
  }
}
