import { overlapArea } from './clip'
import { bounds, onSegment, planarSignedArea, pointInRing, segmentsCross } from './geo'
import type { Area, IssueCode, Ring } from './types'

/**
 * Validity rules. They are the OGC "simple polygon" rules, so a polygon the
 * editor accepts is one PostGIS' `ST_IsValid` accepts too:
 *
 * - a ring has at least three distinct vertices and encloses some area;
 * - no ring crosses or touches itself;
 * - rings do not cross each other, and every hole is inside the outer ring.
 */

/** Does any edge of `ring` cross or touch a non-adjacent edge of the same ring? */
export function ringSelfIntersects(ring: Ring, epsilon: number): boolean {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges share a vertex by construction; skip them.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      const c = ring[j]!
      const d = ring[(j + 1) % n]!
      if (segmentsCross(a, b, c, d)) return true
      // A vertex resting on a non-adjacent edge is a self-touch, also invalid.
      if (onSegment(c, a, b, epsilon) || onSegment(d, a, b, epsilon)) return true
      if (onSegment(a, c, d, epsilon) || onSegment(b, c, d, epsilon)) return true
    }
  }
  return false
}

function ringsCross(a: Ring, b: Ring): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true
    }
  }
  return false
}

/** Every rule `rings` breaks, most fundamental first. Empty means valid. */
export function polygonIssues(rings: readonly Ring[], epsilon: number): IssueCode[] {
  const outer = rings[0]
  if (!outer || rings.some((ring) => ring.length < 3)) return ['too-few-vertices']
  // A crossing first: a bow tie also has zero net area, but "it crosses
  // itself" is the message that tells the user what to fix.
  if (rings.some((ring) => ringSelfIntersects(ring, epsilon))) return ['self-intersection']
  if (Math.abs(planarSignedArea(outer)) < epsilon * epsilon) return ['too-few-vertices']
  const issues: IssueCode[] = []
  for (let h = 1; h < rings.length; h++) {
    const hole = rings[h]!
    if (ringsCross(outer, hole) || !hole.every((p) => pointInRing(p, outer) || isOnRing(p, outer, epsilon))) {
      issues.push('hole-outside')
      break
    }
  }
  return issues
}

function isOnRing(p: Ring[number], ring: Ring, epsilon: number): boolean {
  return ring.some((a, i) => onSegment(p, a, ring[(i + 1) % ring.length]!, epsilon))
}

function boxesOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

/**
 * The first area in `others` that `rings` overlaps by more than
 * `toleranceM2` square metres, or `null`. Sharing a border is not overlapping.
 */
export function findOverlap(
  rings: readonly Ring[],
  others: readonly Area[],
  epsilon: number,
  toleranceM2: number,
): Area | null {
  const box = bounds(rings[0] ?? [])
  if (!box) return null
  for (const other of others) {
    const otherBox = bounds(other.rings[0] ?? [])
    if (!otherBox || !boxesOverlap(box, otherBox)) continue
    if (overlapArea(rings, other.rings, epsilon) > toleranceM2) return other
  }
  return null
}
