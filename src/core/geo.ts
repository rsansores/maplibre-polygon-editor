import type { Position, Ring } from './types'

/**
 * Geometry primitives.
 *
 * Two different "spaces" meet here, on purpose:
 *
 * - **Measurements** (area, length, distance) are spherical, so a number shown
 *   to a person is in metres on the ground, not in degrees.
 * - **Topology** (does a point sit on an edge, do two segments cross) is planar
 *   in longitude/latitude, the same convention GeoJSON and PostGIS `geometry`
 *   use. A vertex the editor puts "on" a neighbour's edge is on it by this
 *   definition, so a server that checks the polygons with planar predicates
 *   agrees with the editor.
 */

const MEAN_EARTH_RADIUS = 6371008.8
/** The radius turf and most web tools use for spherical area; kept for parity. */
const AREA_EARTH_RADIUS = 6378137

const rad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in metres. */
export function distance(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * MEAN_EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Length of an open path, in metres. */
export function pathLength(points: readonly Position[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!)
  return total
}

/** Length of a ring's boundary (closing edge included), in metres. */
export function ringLength(ring: Ring): number {
  if (ring.length < 2) return 0
  return pathLength(ring) + distance(ring[ring.length - 1]!, ring[0]!)
}

/**
 * Signed spherical area of an open ring in square metres. Positive when the
 * ring winds clockwise (as seen with north up), negative otherwise.
 */
function signedRingArea(ring: Ring): number {
  const n = ring.length
  if (n < 3) return 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]!
    const here = ring[i]!
    const next = ring[(i + 1) % n]!
    total += (rad(next[0]) - rad(prev[0])) * Math.sin(rad(here[1]))
  }
  return (total * AREA_EARTH_RADIUS * AREA_EARTH_RADIUS) / 2
}

/** Unsigned area of one ring, in square metres. */
export function ringArea(ring: Ring): number {
  return Math.abs(signedRingArea(ring))
}

/** Area of a polygon (outer ring minus its holes), in square metres. */
export function polygonArea(rings: readonly Ring[]): number {
  if (rings.length === 0) return 0
  let total = ringArea(rings[0]!)
  for (let i = 1; i < rings.length; i++) total -= ringArea(rings[i]!)
  return Math.max(0, total)
}

/**
 * How thick a polygon is, in metres: `2 · area / perimeter`, the perimeter
 * counting every ring. For a long thin strip this is its width; for a square
 * of side `s` it is `s / 2`. Zero for a polygon with no boundary.
 */
export function polygonThickness(rings: readonly Ring[]): number {
  const perimeter = rings.reduce((sum, ring) => sum + ringLength(ring), 0)
  return perimeter > 0 ? (2 * polygonArea(rings)) / perimeter : 0
}

/** Planar signed area in degrees², positive counter-clockwise. Used only for orientation. */
export function planarSignedArea(ring: Ring): number {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    total += a[0] * b[1] - b[0] * a[1]
  }
  return total / 2
}

/** Round both coordinates to `decimals` places. 8 decimals ≈ 1.1 mm at the equator. */
export function roundPosition(p: Position, decimals: number): Position {
  const f = 10 ** decimals
  return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f]
}

export function samePosition(a: Position, b: Position, epsilon: number): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon
}

/** Linear interpolation in longitude/latitude: the point at `t` along `a → b`. */
export function lerp(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/**
 * Where `p` projects onto the segment `a → b`, as a parameter clamped to
 * [0, 1], and the squared planar distance to that point. Works on any 2-D
 * coordinates — screen pixels or degrees.
 */
export function projectOntoSegment(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): { t: number; distanceSq: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq))
  const x = a[0] + dx * t - p[0]
  const y = a[1] + dy * t - p[1]
  return { t, distanceSq: x * x + y * y }
}

/** Does `p` lie on the segment `a → b` (endpoints included), within `epsilon` degrees? */
export function onSegment(p: Position, a: Position, b: Position, epsilon: number): boolean {
  return projectOntoSegment(p, a, b).distanceSq <= epsilon * epsilon
}

const cross = (o: Position, a: Position, b: Position) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/**
 * Where the segments `a → b` and `c → d` cross, as parameters along each, or
 * `null` when they do not. Parallel and collinear segments return `null`:
 * overlapping collinear edges are a shared border, not a crossing.
 */
export function segmentIntersection(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): { t: number; u: number; point: Position } | null {
  const r: Position = [b[0] - a[0], b[1] - a[1]]
  const s: Position = [d[0] - c[0], d[1] - c[1]]
  const denominator = r[0] * s[1] - r[1] * s[0]
  if (denominator === 0) return null
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denominator
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { t, u, point: lerp(a, b, t) }
}

/**
 * True when two segments cross at a point interior to both. Touching at an
 * endpoint, or running along each other, is not a crossing.
 */
export function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Even-odd point-in-ring test (boundary counts as outside). */
export function pointInRing(p: Position, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside
    }
  }
  return inside
}

/** Inside the outer ring and outside every hole. */
export function pointInPolygon(p: Position, rings: readonly Ring[]): boolean {
  if (rings.length === 0 || !pointInRing(p, rings[0]!)) return false
  for (let i = 1; i < rings.length; i++) if (pointInRing(p, rings[i]!)) return false
  return true
}

/** `[minLng, minLat, maxLng, maxLat]` of every vertex given. */
export function bounds(points: Iterable<Position>): [number, number, number, number] | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return minX === Infinity ? null : [minX, minY, maxX, maxY]
}

/** Drop consecutive duplicates (and a last vertex equal to the first) from an open ring. */
export function dedupeRing(ring: Ring, epsilon: number): Ring {
  const out: Ring = []
  for (const p of ring) {
    if (out.length === 0 || !samePosition(out[out.length - 1]!, p, epsilon)) out.push(p)
  }
  while (out.length > 1 && samePosition(out[0]!, out[out.length - 1]!, epsilon)) out.pop()
  return out
}
