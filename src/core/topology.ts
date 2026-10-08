import {
  boxesTouch,
  boxHolds,
  mayHold,
  onSegment,
  polygonBounds,
  projectOntoSegment,
  samePosition,
} from './geo'
import type { Area, EdgeRef, Position, VertexRef } from './types'

/**
 * Shared borders without a planar graph.
 *
 * Two areas share a border when they hold the **same vertices** along it.
 * The editor keeps that true by construction: a vertex placed on a neighbour's
 * edge is inserted into that edge too, a dragged vertex carries every vertex
 * at the same position with it, and a removed vertex is removed from every
 * area holding it. "The same" means equal within `epsilon` degrees, which the
 * editor sets well below the precision it rounds coordinates to.
 *
 * Every function here is pure: it returns new arrays and never mutates its
 * input, which is what makes undo a matter of keeping the old value. That is
 * also what lets each one skip, by its remembered bounds, every area too far
 * away to hold the vertex in question: with a city's worth of areas loaded,
 * an edit touches the few around it, not all of them.
 */

/** Every vertex, in any area, sitting at `position`. */
export function linkedVertices(areas: readonly Area[], position: Position, epsilon: number): VertexRef[] {
  const out: VertexRef[] = []
  for (const area of areas) {
    if (!mayHold(area.rings, position, epsilon)) continue
    area.rings.forEach((ring, r) => {
      ring.forEach((p, i) => {
        if (samePosition(p, position, epsilon)) out.push({ areaId: area.id, ring: r, index: i })
      })
    })
  }
  return out
}

export function vertexAt(areas: readonly Area[], ref: VertexRef): Position | undefined {
  return areas.find((a) => a.id === ref.areaId)?.rings[ref.ring]?.[ref.index]
}

/**
 * Move the vertex `ref` and every vertex linked to it (in unlocked areas) to
 * `to`. Linked vertices in locked areas stay put — the caller decides whether
 * moving away from a locked neighbour is allowed (validation will see the
 * resulting overlap or gap).
 */
export function moveVertex(areas: readonly Area[], ref: VertexRef, to: Position, epsilon: number): Area[] {
  const from = vertexAt(areas, ref)
  if (!from) return [...areas]
  return areas.map((area) => {
    if (area.locked || !mayHold(area.rings, from, epsilon)) return area
    let changed = false
    const rings = area.rings.map((ring) =>
      ring.map((p) => {
        if (!samePosition(p, from, epsilon)) return p
        changed = true
        return to
      }),
    )
    return changed ? { ...area, rings } : area
  })
}

/**
 * Insert `position` into the edge `edge`, and into the matching edge of every
 * other unlocked area that shares that edge (same two endpoints, either
 * direction). Returns the new areas and the inserted vertex's reference.
 */
export function insertVertex(
  areas: readonly Area[],
  edge: EdgeRef,
  position: Position,
  epsilon: number,
): { areas: Area[]; vertex: VertexRef } {
  const area = areas.find((a) => a.id === edge.areaId)
  const ring = area?.rings[edge.ring]
  if (!area || !ring) return { areas: [...areas], vertex: { ...edge } }
  const a = ring[edge.index]!
  const b = ring[(edge.index + 1) % ring.length]!

  const next = areas.map((candidate) => {
    if (candidate.id !== edge.areaId && (candidate.locked || !mayHold(candidate.rings, a, epsilon)))
      return candidate
    let changed = false
    const rings = candidate.rings.map((r, ri) => {
      const out: Position[] = []
      for (let i = 0; i < r.length; i++) {
        const p = r[i]!
        const q = r[(i + 1) % r.length]!
        out.push(p)
        const isTarget = candidate.id === edge.areaId && ri === edge.ring && i === edge.index
        const isTwin =
          !isTarget &&
          ((samePosition(p, a, epsilon) && samePosition(q, b, epsilon)) ||
            (samePosition(p, b, epsilon) && samePosition(q, a, epsilon)))
        if (isTarget || isTwin) {
          out.push(position)
          changed = true
        }
      }
      return out
    })
    return changed ? { ...candidate, rings } : candidate
  })
  return { areas: next, vertex: { areaId: edge.areaId, ring: edge.ring, index: edge.index + 1 } }
}

/** Remove the vertex `ref` and every vertex linked to it, from unlocked areas. */
export function removeVertex(areas: readonly Area[], ref: VertexRef, epsilon: number): Area[] {
  const at = vertexAt(areas, ref)
  if (!at) return [...areas]
  return areas.map((area) => {
    if (area.locked || !mayHold(area.rings, at, epsilon)) return area
    const rings = area.rings.map((ring) => ring.filter((p) => !samePosition(p, at, epsilon)))
    const changed = rings.some((r, i) => r.length !== area.rings[i]!.length)
    return changed ? { ...area, rings } : area
  })
}

/**
 * Make every vertex that lies on another area's edge a vertex of that edge too
 * ("noding"). Run after anything that creates vertices numerically — a clip,
 * a split — so the new border is shared and not merely coincident.
 *
 * Only the areas listed in `sources` contribute vertices; every unlocked area
 * may receive them.
 */
export function nodeAreas(areas: readonly Area[], sources: readonly string[], epsilon: number): Area[] {
  const result = [...areas]
  const donors = result.flatMap((a, i) => (sources.includes(a.id) ? [i] : []))
  const near = (i: number, j: number) => {
    const a = polygonBounds(result[i]!.rings)
    const b = polygonBounds(result[j]!.rings)
    return a !== null && b !== null && boxesTouch(a, b, epsilon)
  }
  for (const d of donors) {
    const receivers = result.flatMap((a, i) => (i !== d && !a.locked && near(i, d) ? [i] : []))
    for (const ring of result[d]!.rings) {
      for (const p of ring) {
        for (const i of receivers) result[i] = insertOnEdges(result[i]!, p, epsilon)
      }
    }
  }
  // A receiving area may have donated nothing but gained vertices; donors, in
  // turn, must hold every vertex their neighbours hold along shared edges.
  result.forEach((area, i) => {
    if (sources.includes(area.id)) return
    for (const d of donors) {
      if (result[d]!.locked || !near(i, d)) continue
      for (const ring of result[i]!.rings) {
        for (const p of ring) result[d] = insertOnEdges(result[d]!, p, epsilon)
      }
    }
  })
  return result
}

/** Insert `p` into the first edge of each ring of `area` it lies strictly inside. */
function insertOnEdges(area: Area, p: Position, epsilon: number): Area {
  const box = polygonBounds(area.rings)
  if (!box || !boxHolds(box, p, epsilon)) return area
  let changed = false
  const rings = area.rings.map((ring) => {
    if (ring.some((q) => samePosition(q, p, epsilon))) return ring
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      if (onSegment(p, a, b, epsilon)) {
        changed = true
        return [...ring.slice(0, i + 1), p, ...ring.slice(i + 1)]
      }
    }
    return ring
  })
  return changed ? { ...area, rings } : area
}

/** Position along a ring: `index + t`, where `t` ∈ [0, 1) is how far along edge `index`. */
export interface RingPosition {
  index: number
  t: number
}

/** Where `p` sits on `ring`, if it sits on it at all. */
export function locateOnRing(ring: readonly Position[], p: Position, epsilon: number): RingPosition | null {
  for (let i = 0; i < ring.length; i++) {
    if (samePosition(ring[i]!, p, epsilon)) return { index: i, t: 0 }
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    if (onSegment(p, a, b, epsilon)) return { index: i, t: projectOntoSegment(p, a, b).t }
  }
  return null
}

/**
 * The ring's vertices strictly between `from` and `to`, walking forward
 * (increasing index, wrapping). When `from` and `to` are the same point the
 * walk goes once around the whole ring.
 */
export function walkForward(ring: readonly Position[], from: RingPosition, to: RingPosition): Position[] {
  const n = ring.length
  const s0 = from.index + from.t
  let s1 = to.index + to.t
  if (s1 <= s0) s1 += n
  const out: Position[] = []
  for (let k = Math.floor(s0) + 1; k < s1; k++) out.push(ring[k % n]!)
  return out
}
