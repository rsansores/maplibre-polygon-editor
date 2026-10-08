import { overlapThickness } from './clip'
import { boxesTouch, onSegment, planarSignedArea, pointInRing, polygonBounds, segmentsCross } from './geo'
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

export interface OverlapOptions {
  /** Two coordinates closer than this, in degrees, are the same. Default `5e-9` (half the 8th decimal). */
  epsilon?: number
  /** A piece of shared ground no thicker than this many metres is not an overlap. Default `0.01`. */
  toleranceM?: number
}

/**
 * Do two polygons overlap? They do when some connected piece of their
 * intersection is thicker than `toleranceM`, a piece's thickness being
 * `2 · area / perimeter` in metres. Sharing a border is not overlapping, nor is
 * the sliver that rounding the corners of one border onto another leaves.
 */
export function overlaps(a: readonly Ring[], b: readonly Ring[], options: OverlapOptions = {}): boolean {
  const boxA = polygonBounds(a)
  const boxB = polygonBounds(b)
  if (!boxA || !boxB || !boxesTouch(boxA, boxB)) return false
  return overlapThickness(a, b, options.epsilon ?? 5e-9) > (options.toleranceM ?? 0.01)
}

/** The first area in `others` that `rings` overlaps (see `overlaps`), or `null`. */
export function findOverlap(
  rings: readonly Ring[],
  others: readonly Area[],
  epsilon: number,
  toleranceM: number,
): Area | null {
  return others.find((other) => overlaps(rings, other.rings, { epsilon, toleranceM })) ?? null
}
