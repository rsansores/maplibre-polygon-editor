import { dedupeRing, onSegment, pointInRing, roundPosition, segmentIntersection, segmentsCross } from './geo'
import { walkForward, type RingPosition } from './topology'
import type { IssueCode, Position, Ring } from './types'

/**
 * Cutting a polygon in two along a polyline.
 *
 * The cut is the part of the line between the first point where it enters the
 * polygon's outer ring and the next point where it leaves. Both pieces hold
 * that part vertex for vertex, so the new border between them is shared from
 * the start. Holes go to whichever piece contains them; a cut through a hole
 * is refused rather than guessed at.
 */

interface Crossing {
  /** Distance along the cut line: segment index + parameter. */
  along: number
  /** Where on the ring. */
  at: RingPosition
  point: Position
}

export type SplitResult = { pieces: [Ring[], Ring[]] } | { issue: IssueCode }

export function splitPolygon(
  rings: readonly Ring[],
  line: readonly Position[],
  decimals: number,
  epsilon: number,
): SplitResult {
  const outer = rings[0]
  if (!outer || line.length < 2) return { issue: 'cut-missed' }

  const crossings: Crossing[] = []
  for (let k = 0; k + 1 < line.length; k++) {
    for (let i = 0; i < outer.length; i++) {
      const hit = segmentIntersection(line[k]!, line[k + 1]!, outer[i]!, outer[(i + 1) % outer.length]!)
      if (!hit) continue
      // A hit at the very end of a ring edge is the start of the next edge;
      // count it there only, or a cut through a vertex would cross twice.
      if (hit.u >= 1) continue
      crossings.push({ along: k + hit.t, at: { index: i, t: hit.u }, point: hit.point })
    }
  }
  crossings.sort((a, b) => a.along - b.along)
  const unique = crossings.filter((c, i) => i === 0 || c.along - crossings[i - 1]!.along > 1e-12)
  if (unique.length < 2) return { issue: 'cut-missed' }

  // Take the first stretch of the line that runs through the inside of the
  // polygon. A stretch along the border itself (a cut that starts by
  // following an earlier cut's street) is neither inside nor a cut: skip it.
  for (let i = 0; i + 1 < unique.length; i++) {
    const entry = unique[i]!
    const exit = unique[i + 1]!
    const middle = pointAlong(line, (entry.along + exit.along) / 2)
    if (onRing(middle, outer, epsilon * 10) || !pointInRing(middle, outer)) continue
    const result = piecesFor(rings, line, entry, exit, decimals, epsilon)
    if (result) return result
  }
  return { issue: 'cut-missed' }
}

function piecesFor(
  rings: readonly Ring[],
  line: readonly Position[],
  entry: Crossing,
  exit: Crossing,
  decimals: number,
  epsilon: number,
): SplitResult | null {
  const outer = rings[0]!
  const round = (p: Position) => roundPosition(p, decimals)
  const start = round(entry.point)
  const end = round(exit.point)
  const inner = line.slice(Math.floor(entry.along) + 1, Math.floor(exit.along) + 1).map(round)

  // The cut must not cross a hole.
  const cut = [start, ...inner, end]
  for (const hole of rings.slice(1)) {
    if (crossesRing(cut, hole)) return { issue: 'cut-crosses-hole' }
  }

  const a = dedupeRing([start, ...inner, end, ...walkForward(outer, exit.at, entry.at)], epsilon)
  const b = dedupeRing(
    [end, ...[...inner].reverse(), start, ...walkForward(outer, entry.at, exit.at)],
    epsilon,
  )
  if (a.length < 3 || b.length < 3) return null

  const piecesA: Ring[] = [a]
  const piecesB: Ring[] = [b]
  for (const hole of rings.slice(1)) (pointInRing(hole[0]!, a) ? piecesA : piecesB).push(hole)
  return { pieces: [piecesA, piecesB] }
}

function onRing(p: Position, ring: Ring, epsilon: number): boolean {
  return ring.some((a, i) => onSegment(p, a, ring[(i + 1) % ring.length]!, epsilon))
}

function pointAlong(line: readonly Position[], along: number): Position {
  const k = Math.min(Math.floor(along), line.length - 2)
  const t = along - k
  const a = line[k]!
  const b = line[k + 1]!
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function crossesRing(path: readonly Position[], ring: Ring): boolean {
  for (let k = 0; k + 1 < path.length; k++) {
    for (let i = 0; i < ring.length; i++) {
      if (segmentsCross(path[k]!, path[k + 1]!, ring[i]!, ring[(i + 1) % ring.length]!)) return true
    }
  }
  // Entirely inside a hole also counts.
  return path.some((p) => pointInRing(p, ring))
}
