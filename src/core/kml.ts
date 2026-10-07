import { dedupeRing } from './geo'
import type { ImportResult } from './geojson'
import type { Position, Ring } from './types'

/**
 * Polygons from KML — what Google My Maps and Google Earth export. Every
 * `<Placemark>` holding a `<Polygon>` (directly or inside a `<MultiGeometry>`)
 * becomes an area; its `<name>` and `<description>` become properties.
 *
 * Uses the browser's `DOMParser`; pass another implementation to run it
 * elsewhere.
 */
export function fromKML(
  text: string,
  createId: () => string,
  parser: { parseFromString(text: string, type: DOMParserSupportedType): Document } = new DOMParser(),
): ImportResult {
  const doc = parser.parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return { areas: [], skipped: 1 }

  const result: ImportResult = { areas: [], skipped: 0 }
  for (const placemark of Array.from(doc.getElementsByTagName('Placemark'))) {
    const polygons = Array.from(placemark.getElementsByTagName('Polygon'))
    if (polygons.length === 0) {
      result.skipped++
      continue
    }
    const properties: Record<string, unknown> = {}
    const name = directChild(placemark, 'name')?.textContent?.trim()
    const description = directChild(placemark, 'description')?.textContent?.trim()
    if (name) properties.name = name
    if (description) properties.description = description

    polygons.forEach((polygon, i) => {
      const outer = ringOf(polygon, 'outerBoundaryIs')
      if (!outer) {
        result.skipped++
        return
      }
      const holes = Array.from(polygon.getElementsByTagName('innerBoundaryIs'))
        .map((inner) => parseCoordinates(inner.getElementsByTagName('coordinates')[0]?.textContent ?? ''))
        .filter((r) => r.length >= 3)
      const id = placemark.getAttribute('id')
      result.areas.push({
        id: id ? (polygons.length === 1 ? id : `${id}-${i + 1}`) : createId(),
        rings: [outer, ...holes],
        properties: { ...properties },
      })
    })
  }
  return result
}

function directChild(element: Element, tag: string): Element | undefined {
  return Array.from(element.children).find((c) => c.localName === tag)
}

function ringOf(polygon: Element, boundary: string): Ring | null {
  const element = polygon.getElementsByTagName(boundary)[0]
  const ring = parseCoordinates(element?.getElementsByTagName('coordinates')[0]?.textContent ?? '')
  return ring.length >= 3 ? ring : null
}

/** KML coordinates: whitespace-separated `lng,lat[,alt]` tuples. */
function parseCoordinates(text: string): Ring {
  const points: Position[] = []
  for (const tuple of text.trim().split(/\s+/)) {
    const [lng, lat] = tuple.split(',').map(Number)
    if (Number.isFinite(lng) && Number.isFinite(lat)) points.push([lng!, lat!])
  }
  return dedupeRing(points, 0)
}
