import * as polyclip from 'polyclip-ts'
import { dedupeRing, polygonArea } from './geo'
import type { Position, Ring } from './types'

/**
 * Boolean operations between polygons, through polyclip-ts (a robust
 * Martinez-Rueda sweep). The editor's rings are open; polyclip's are closed,
 * so everything crossing this file is converted at the door.
 */

type ClosedPolygon = [number, number][][]

function closed(rings: readonly Ring[]): ClosedPolygon {
  return rings.map((ring) => {
    const out = ring.map((p) => [p[0], p[1]] as [number, number])
    if (out.length > 0) out.push([ring[0]![0], ring[0]![1]])
    return out
  })
}

function opened(multi: [number, number][][][], epsilon: number): Ring[][] {
  return multi
    .map((polygon) => polygon.map((ring) => dedupeRing(ring as Position[], epsilon)))
    .filter((polygon) => polygon.length > 0 && polygon[0]!.length >= 3)
}

/** Polygons (each `[outer, ...holes]`) covered by both `a` and `b`. */
export function intersect(a: readonly Ring[], b: readonly Ring[], epsilon: number): Ring[][] {
  return opened(polyclip.intersection(closed(a), closed(b)), epsilon)
}

/** `a` with every polygon in `others` removed. */
export function subtract(
  a: readonly Ring[],
  others: readonly (readonly Ring[])[],
  epsilon: number,
): Ring[][] {
  if (others.length === 0) return [a.map((r) => [...r])]
  return opened(polyclip.difference(closed(a), ...others.map(closed)), epsilon)
}

/** The union of `a` and `b`. */
export function unite(a: readonly Ring[], b: readonly Ring[], epsilon: number): Ring[][] {
  return opened(polyclip.union(closed(a), closed(b)), epsilon)
}

/** Square metres covered by both polygons. Touching along a border is 0. */
export function overlapArea(a: readonly Ring[], b: readonly Ring[], epsilon: number): number {
  return intersect(a, b, epsilon).reduce((sum, polygon) => sum + polygonArea(polygon), 0)
}
