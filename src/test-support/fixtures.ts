import type { SnapResult } from '../core/snap'
import type { Area, Position, Ring } from '../core/types'

/** An axis-aligned square ring, counter-clockwise, `size` degrees wide. */
export function square(x: number, y: number, size: number): Ring {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ]
}

export function area(id: string, ...rings: Ring[]): Area {
  return { id, rings, properties: { name: id } }
}

/** A free click (nothing snapped). */
export function free(position: Position): SnapResult {
  return { position, kind: 'none' }
}

/** Screen projection for tests: 100 000 px per degree, y down. */
export const project = (p: Position) => ({ x: p[0] * 100_000, y: -p[1] * 100_000 })

/** Sort a ring's vertices so two rings can be compared regardless of start and direction. */
export function sortedVertices(ring: Ring): string[] {
  return ring.map((p) => `${p[0].toFixed(8)},${p[1].toFixed(8)}`).sort()
}
