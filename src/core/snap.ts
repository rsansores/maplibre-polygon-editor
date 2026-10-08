import { boxesTouch, lerp, polygonBounds, projectOntoSegment, type Box } from './geo'
import type { Area, Position, ScreenPoint } from './types'

/**
 * Snapping: where a click "really" meant to land.
 *
 * Snapping is a helper, never a requirement. When nothing is within reach the
 * result is the raw position, kind `none`, and the editor uses it as is — a
 * border through a forest or across an unmapped field is drawn exactly where
 * the user clicked.
 *
 * Distances are measured on screen (pixels), because "close" is a property of
 * what the user sees at the current zoom. The snapped position, though, is
 * computed in longitude/latitude on the target's own geometry, so a point
 * snapped onto an edge lies on that edge exactly, at any zoom.
 */

export type SnapKind = 'vertex' | 'edge' | 'line-vertex' | 'line' | 'none'

export interface SnapResult {
  position: Position
  kind: SnapKind
  /** For `vertex` / `edge`: the area snapped to. */
  areaId?: string
  ring?: number
  /** Vertex index (`vertex`) or edge start index (`edge`). */
  index?: number
  /** For `line` / `line-vertex`: the reference line snapped to, kept so a later point can trace along it. */
  path?: readonly Position[]
}

export interface SnapContext {
  /** Longitude/latitude → screen pixels, at the current view. */
  project: (p: Position) => ScreenPoint
  /** How far, in pixels, a target may be and still attract the cursor. */
  tolerancePx: number
  /** The same for reference lines, when they should reach further (default `tolerancePx`). */
  lineTolerancePx?: number
  /** Areas whose vertices and edges attract. */
  areas: readonly Area[]
  /**
   * Longitude/latitude bounds of everything within `tolerancePx` of the
   * cursor. Areas outside it are skipped without projecting a vertex — with
   * many areas loaded, this is what keeps a mouse move cheap. Without it every
   * area is tried.
   */
  bounds?: Box
  /** Reference polylines (e.g. streets from the basemap) that attract. */
  lines?: readonly (readonly Position[])[]
  /** Extra points that attract as vertices (e.g. the draft's own first vertex). */
  points?: readonly Position[]
  /** Vertices to ignore, such as the one being dragged. */
  ignore?: (p: Position) => boolean
}

const toPair = (s: ScreenPoint): [number, number] => [s.x, s.y]

/**
 * Snap `raw` (a position under the cursor at `cursor` on screen). Priority is
 * by kind, then by distance: an area vertex beats an area edge beats a street
 * vertex beats a street line. Area geometry wins because a shared border has to
 * be exact; street geometry is only as good as the map data.
 */
export function snap(raw: Position, cursor: ScreenPoint, ctx: SnapContext): SnapResult {
  const limitSq = ctx.tolerancePx * ctx.tolerancePx
  const lineLimitSq = (ctx.lineTolerancePx ?? ctx.tolerancePx) ** 2
  const c = toPair(cursor)
  const ignore = ctx.ignore ?? (() => false)

  let best: { result: SnapResult; distanceSq: number; rank: number } | null = null
  const offer = (result: SnapResult, distanceSq: number, rank: number) => {
    if (distanceSq > (rank >= 2 ? lineLimitSq : limitSq)) return
    if (!best || rank < best.rank || (rank === best.rank && distanceSq < best.distanceSq)) {
      best = { result, distanceSq, rank }
    }
  }
  const distSq = (p: Position) => {
    const s = ctx.project(p)
    return (s.x - c[0]) ** 2 + (s.y - c[1]) ** 2
  }

  for (const p of ctx.points ?? []) {
    if (!ignore(p)) offer({ position: p, kind: 'vertex' }, distSq(p), 0)
  }

  for (const area of ctx.areas) {
    if (ctx.bounds) {
      const box = polygonBounds(area.rings)
      if (!box || !boxesTouch(box, ctx.bounds)) continue
    }
    area.rings.forEach((ring, r) => {
      const screen = ring.map((p) => toPair(ctx.project(p)))
      ring.forEach((p, i) => {
        if (ignore(p)) return
        const s = screen[i]!
        offer(
          { position: p, kind: 'vertex', areaId: area.id, ring: r, index: i },
          (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2,
          0,
        )
      })
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!
        const b = ring[(i + 1) % ring.length]!
        // An edge attached to an ignored vertex moves with it; snapping onto it is meaningless.
        if (ignore(a) || ignore(b)) continue
        const { t, distanceSq } = projectOntoSegment(c, screen[i]!, screen[(i + 1) % ring.length]!)
        // The ends of an edge are vertices; those are offered above.
        if (t <= 0 || t >= 1) continue
        offer({ position: lerp(a, b, t), kind: 'edge', areaId: area.id, ring: r, index: i }, distanceSq, 1)
      }
    })
  }

  ;(ctx.lines ?? []).forEach((line) => {
    const screen = line.map((p) => toPair(ctx.project(p)))
    line.forEach((p, i) => {
      const s = screen[i]!
      offer(
        { position: p, kind: 'line-vertex', path: line, index: i },
        (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2,
        2,
      )
    })
    for (let i = 0; i + 1 < line.length; i++) {
      const { t, distanceSq } = projectOntoSegment(c, screen[i]!, screen[i + 1]!)
      if (t <= 0 || t >= 1) continue
      offer({ position: lerp(line[i]!, line[i + 1]!, t), kind: 'line', path: line, index: i }, distanceSq, 3)
    }
  })

  return (best as { result: SnapResult } | null)?.result ?? { position: raw, kind: 'none' }
}
