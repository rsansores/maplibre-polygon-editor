import { distance, onSegment, pathLength, projectOntoSegment, samePosition } from './geo'
import { locateOnRing, walkForward } from './topology'
import type { SnapResult } from './snap'
import type { Area, Position } from './types'

/**
 * Tracing: when two consecutive clicks both land on the same existing border
 * (or the same street), the segment between them follows that border instead
 * of cutting straight across. This is what makes a new area share its
 * neighbour's border exactly, vertex for vertex, without the user clicking
 * every vertex of it.
 */

/**
 * The vertices between `from` and `to` along a ring both lie on, taking the
 * shorter way round. `null` when no ring of `areas` holds both points.
 */
export function traceAlongAreas(
  areas: readonly Area[],
  from: Position,
  to: Position,
  epsilon: number,
  prefer?: string,
): Position[] | null {
  const ordered = prefer ? [...areas].sort((a, b) => (a.id === prefer ? -1 : b.id === prefer ? 1 : 0)) : areas
  for (const area of ordered) {
    for (const ring of area.rings) {
      const a = locateOnRing(ring, from, epsilon)
      const b = locateOnRing(ring, to, epsilon)
      if (!a || !b) continue
      const forward = walkForward(ring, a, b)
      const backward = walkForward(
        [...ring].reverse(),
        reversePosition(ring.length, a),
        reversePosition(ring.length, b),
      )
      const length = (path: Position[]) => pathLength([from, ...path, to])
      return length(forward) <= length(backward) ? forward : backward
    }
  }
  return null
}

/** The same point on the ring read backwards. */
function reversePosition(n: number, p: { index: number; t: number }): { index: number; t: number } {
  // Vertex i becomes n-1-i; a point at t along edge i (i → i+1) lies at 1-t
  // along reversed edge n-2-i (which runs from old i+1 to old i).
  if (p.t === 0) return { index: n - 1 - p.index, t: 0 }
  return { index: (n - 2 - p.index + n) % n, t: 1 - p.t }
}

/** Where `p` sits on the open polyline `line`, as `index + t`, or `null`. */
function locateOnLine(line: readonly Position[], p: Position, epsilon: number): number | null {
  for (let i = 0; i < line.length; i++) if (samePosition(line[i]!, p, epsilon)) return i
  for (let i = 0; i + 1 < line.length; i++) {
    if (onSegment(p, line[i]!, line[i + 1]!, epsilon))
      return i + projectOntoSegment(p, line[i]!, line[i + 1]!).t
  }
  return null
}

/** The vertices of `line` strictly between `from` and `to`, in travel order. */
export function traceAlongLine(
  line: readonly Position[],
  from: Position,
  to: Position,
  epsilon: number,
): Position[] | null {
  const s0 = locateOnLine(line, from, epsilon)
  const s1 = locateOnLine(line, to, epsilon)
  if (s0 === null || s1 === null) return null
  const out: Position[] = []
  if (s0 < s1) for (let k = Math.floor(s0) + 1; k < s1; k++) out.push(line[k]!)
  else for (let k = Math.ceil(s0) - 1; k > s1; k--) out.push(line[k]!)
  return out
}

/**
 * The intermediate vertices to insert between two snapped clicks, or `null`
 * for a straight segment. Area borders are tried before streets.
 */
export function traceBetween(
  previous: SnapResult,
  next: SnapResult,
  areas: readonly Area[],
  epsilon: number,
  options: { areas: boolean; lines: boolean },
): Position[] | null {
  if (options.areas && isAreaSnap(previous) && isAreaSnap(next)) {
    const path = traceAlongAreas(areas, previous.position, next.position, epsilon, next.areaId)
    if (path && path.length > 0) return path
  }
  if (options.lines && previous.path && (next.kind === 'line' || next.kind === 'line-vertex')) {
    const path = traceAlongLine(previous.path, previous.position, next.position, epsilon)
    if (path && path.length > 0) return path
  }
  return null
}

const isAreaSnap = (s: SnapResult) => s.kind === 'vertex' || s.kind === 'edge'

/** A router: the road path between two points, or `null` when there is none. */
export type Router = (from: Position, to: Position, signal?: AbortSignal) => Promise<Position[] | null>

/**
 * Ask `router` for the road between two points and keep it only when it is
 * plausible: a route more than `maxDetour` times the straight distance is
 * almost always the map routing around a missing connection, and the border
 * the user meant is the straight line. Returns the intermediate vertices, or
 * `null` to fall back to a straight segment.
 */
export async function routeBetween(
  router: Router,
  from: Position,
  to: Position,
  maxDetour: number,
  signal?: AbortSignal,
): Promise<Position[] | null> {
  let path: Position[] | null
  try {
    path = await router(from, to, signal)
  } catch {
    return null
  }
  if (!path || path.length < 2) return null
  const straight = distance(from, to)
  if (straight > 0 && pathLength(path) > straight * maxDetour) return null
  // The route starts and ends on the road nearest each click; the clicks
  // themselves stay the endpoints.
  return path.slice(1, -1)
}
