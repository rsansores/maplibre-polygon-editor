// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { area, square } from '../test-support/fixtures'
import { fromGeoJSON, toFeatureCollection } from './geojson'
import { fromKML } from './kml'
import { planarSignedArea } from './geo'
import type { Position } from './types'

let n = 0
const createId = () => `gen-${++n}`

describe('GeoJSON export', () => {
  it('closes rings and winds them the RFC 7946 way', () => {
    const clockwise = [...square(0, 0, 1)].reverse()
    const hole = square(0.25, 0.25, 0.5) // counter-clockwise
    const fc = toFeatureCollection([area('a', clockwise, hole)])
    const [outer, inner] = fc.features[0]!.geometry.coordinates as Position[][]
    expect(outer![0]).toEqual(outer![outer!.length - 1])
    expect(planarSignedArea(outer!.slice(0, -1))).toBeGreaterThan(0)
    expect(planarSignedArea(inner!.slice(0, -1))).toBeLessThan(0)
  })

  it('carries the id and the properties', () => {
    const feature = toFeatureCollection([area('north', square(0, 0, 1))]).features[0]!
    expect(feature.id).toBe('north')
    expect(feature.properties).toEqual({ name: 'north' })
  })

  it('rounds on the way out when asked', () => {
    const fc = toFeatureCollection([area('a', square(0.123456789, 0, 1))], 3)
    expect(fc.features[0]!.geometry.coordinates[0]![0]).toEqual([0.123, 0])
  })
})

describe('GeoJSON import', () => {
  it('round-trips what it exports', () => {
    const areas = [area('a', square(0, 0, 1)), area('b', square(1, 0, 1))]
    const { areas: back, skipped } = fromGeoJSON(toFeatureCollection(areas), createId)
    expect(skipped).toBe(0)
    expect(back.map((a) => a.id)).toEqual(['a', 'b'])
    expect(back[0]!.rings[0]).toHaveLength(4)
  })

  it('splits a MultiPolygon into one area per polygon', () => {
    const { areas } = fromGeoJSON(
      {
        type: 'Feature',
        id: 'm',
        properties: { name: 'Islands' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[[...square(0, 0, 1), [0, 0]]], [[...square(5, 5, 1), [5, 5]]]],
        },
      },
      createId,
    )
    expect(areas.map((a) => a.id)).toEqual(['m-1', 'm-2'])
    expect(areas[1]!.properties.name).toBe('Islands')
  })

  it('skips features that hold no polygon', () => {
    const { areas, skipped } = fromGeoJSON(
      {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
          { type: 'Feature', properties: {}, geometry: null },
        ],
      },
      createId,
    )
    expect(areas).toEqual([])
    expect(skipped).toBe(2)
  })

  it('accepts a bare geometry', () => {
    const { areas } = fromGeoJSON({ type: 'Polygon', coordinates: [[...square(0, 0, 1), [0, 0]]] }, createId)
    expect(areas).toHaveLength(1)
  })

  it('rejects something that is not GeoJSON', () => {
    expect(fromGeoJSON('nope', createId)).toEqual({ areas: [], skipped: 1 })
  })
})

describe('KML import', () => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>My map</name>
    <Placemark id="pm1">
      <name>Centro</name>
      <description>Downtown</description>
      <Polygon>
        <outerBoundaryIs><LinearRing><coordinates>
          -100.40,20.58,0 -100.38,20.58,0 -100.38,20.60,0 -100.40,20.60,0 -100.40,20.58,0
        </coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>
          -100.395,20.585 -100.385,20.585 -100.385,20.595 -100.395,20.585
        </coordinates></LinearRing></innerBoundaryIs>
      </Polygon>
    </Placemark>
    <Placemark><name>A pin</name><Point><coordinates>-100.39,20.59</coordinates></Point></Placemark>
  </Document>
</kml>`

  it('reads polygons with their holes, names and descriptions', () => {
    const { areas, skipped } = fromKML(kml, createId)
    expect(skipped).toBe(1)
    expect(areas).toHaveLength(1)
    expect(areas[0]).toMatchObject({ id: 'pm1', properties: { name: 'Centro', description: 'Downtown' } })
    expect(areas[0]!.rings).toHaveLength(2)
    expect(areas[0]!.rings[0]).toHaveLength(4)
    expect(areas[0]!.rings[0]![0]).toEqual([-100.4, 20.58])
  })

  it('reports a file that is not XML', () => {
    expect(fromKML('<kml><broken', createId)).toEqual({ areas: [], skipped: 1 })
  })
})
