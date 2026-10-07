import { distance, pathLength, segmentIntersection } from './geo'
import type { Position } from './types'

/**
 * Following streets between two clicks, without a routing service.
 *
 * A car router answers the wrong question for a border: it respects one-way
 * streets and turn restrictions and prefers fast roads, so the "route"
 * between two corners of a block can loop around the block, double back on
 * itself, or detour along an avenue. A border needs the path along streets,
 * in any direction, that stays closest to the straight line the user meant.
 *
 * So the editor builds that network itself from the street lines the map is
 * already drawing: it joins them where they meet ("noding"), ignores
 * direction, and searches for the cheapest path where a street costs its
 * length plus a penalty that grows with its distance from the straight line.
 * Everything is in local metres around the two points; the output is the
 * streets' own vertices in longitude/latitude.
 */

export interface StreetPathOptions {
  /** A click within this many metres of a street joins the network. Default 4. */
  attachMetres?: number
  /** Street ends within this many metres of each other or of a street are joined. Default 1.5. */
  joinMetres?: number
  /**
   * How strongly the path prefers to stay near the straight line between the
   * two points. 0 is the plain shortest path along streets. Default 4: a
   * street a quarter of the distance away costs twice as much per metre.
   */
  straightness?: number
  /** A path longer than this multiple of the straight distance is refused. Default 3. */
  maxDetour?: number
  /**
   * Street crossings (intersections, dead ends) at most this many metres
   * apart may be joined by a straight line where no street joins them — across
   * a river, a rail line or a highway with its nearest bridge far away.
   * Default 80. 0 turns it off.
   */
  gapMetres?: number
  /**
   * What a metre of such a straight crossing costs, in metres of street.
   * Default 4: a street is always preferred unless going round is much longer.
   */
  gapCost?: number
  /**
   * A path already drawn (the rest of the drawing). The new path may not run
   * along it, so a drawing never doubles back on itself.
   */
  avoid?: readonly Position[]
}

export type StreetPathResult =
  /** Intermediate vertices between the two points (both excluded). */
  | { path: Position[] }
  /** One of the points is not on a street: the segment is straight by design. */
  | { reason: 'off-street' }
  /** Both are on streets, but no plausible street path joins them. */
  | { reason: 'no-path' | 'detour' }

interface Node {
  x: number
  y: number
  p: Position
  edges: number[]
}

interface Edge {
  a: number
  b: number
  length: number
  /** Replaced by two halves when a point was attached in its middle. */
  removed?: boolean
  /** Cost per metre relative to a street (a straight crossing costs more). */
  factor: number
}

/** Equirectangular metres around an origin — exact enough within a city view. */
function projector(origin: Position) {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180)
  const ky = 110_574
  return (p: Position): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky]
}

class Grid<T> {
  private cells = new Map<string, T[]>()
  constructor(private readonly size: number) {}
  private key(cx: number, cy: number) {
    return `${cx},${cy}`
  }
  add(item: T, minX: number, minY: number, maxX: number, maxY: number) {
    for (let cx = Math.floor(minX / this.size); cx <= Math.floor(maxX / this.size); cx++) {
      for (let cy = Math.floor(minY / this.size); cy <= Math.floor(maxY / this.size); cy++) {
        const k = this.key(cx, cy)
        const cell = this.cells.get(k)
        if (cell) cell.push(item)
        else this.cells.set(k, [item])
      }
    }
  }
  near(minX: number, minY: number, maxX: number, maxY: number): Set<T> {
    const out = new Set<T>()
    for (let cx = Math.floor(minX / this.size); cx <= Math.floor(maxX / this.size); cx++) {
      for (let cy = Math.floor(minY / this.size); cy <= Math.floor(maxY / this.size); cy++) {
        for (const item of this.cells.get(this.key(cx, cy)) ?? []) out.add(item)
      }
    }
    return out
  }
}

interface Segment {
  a: Position
  b: Position
  ax: number
  ay: number
  bx: number
  by: number
  /** Parameters along the segment where it must be split. */
  cuts: number[]
}

function paramOn(px: number, py: number, s: Segment): { t: number; d: number } {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / len2))
  return { t, d: Math.hypot(s.ax + dx * t - px, s.ay + dy * t - py) }
}

/** The street network (undirected) built from polylines, plus the two endpoints attached to it. */
export class StreetNetwork {
  readonly nodes: Node[] = []
  readonly edges: Edge[] = []
  readonly toLocal: (p: Position) => [number, number]
  private readonly nodeGrid: Grid<number>
  private readonly edgeGrid = new Grid<number>(60)

  constructor(
    lines: readonly (readonly Position[])[],
    origin: Position,
    private readonly join: number,
  ) {
    this.toLocal = projector(origin)
    this.nodeGrid = new Grid<number>(Math.max(join * 4, 1))

    const segments: Segment[] = []
    const segGrid = new Grid<number>(60)
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]!
        const b = line[i + 1]!
        if (a[0] === b[0] && a[1] === b[1]) continue
        const [ax, ay] = this.toLocal(a)
        const [bx, by] = this.toLocal(b)
        const index = segments.push({ a, b, ax, ay, bx, by, cuts: [0, 1] }) - 1
        segGrid.add(
          index,
          Math.min(ax, bx) - join,
          Math.min(ay, by) - join,
          Math.max(ax, bx) + join,
          Math.max(ay, by) + join,
        )
      }
    }

    // Noding: split every segment where another crosses it, or where another
    // one's end rests on it (T-junctions, and the ends tile clipping leaves
    // where one street continues in the next tile).
    segments.forEach((s, i) => {
      const box = [
        Math.min(s.ax, s.bx),
        Math.min(s.ay, s.by),
        Math.max(s.ax, s.bx),
        Math.max(s.ay, s.by),
      ] as const
      for (const j of segGrid.near(box[0], box[1], box[2], box[3])) {
        if (j <= i) continue
        const o = segments[j]!
        const hit = segmentIntersection([s.ax, s.ay], [s.bx, s.by], [o.ax, o.ay], [o.bx, o.by])
        if (hit) {
          s.cuts.push(hit.t)
          o.cuts.push(hit.u)
        }
        for (const [px, py, target] of [
          [s.ax, s.ay, o],
          [s.bx, s.by, o],
          [o.ax, o.ay, s],
          [o.bx, o.by, s],
        ] as const) {
          const { t, d } = paramOn(px, py, target)
          if (d <= join && t > 0 && t < 1) target.cuts.push(t)
        }
      }
    })

    for (const s of segments) {
      const cuts = [...new Set(s.cuts)].sort((x, y) => x - y)
      let previous = this.nodeAt(s.a, s.ax, s.ay)
      for (let k = 1; k < cuts.length; k++) {
        const t = cuts[k]!
        const p: Position = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]
        const node = this.nodeAt(p, s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t)
        this.connect(previous, node)
        previous = node
      }
    }
  }

  /** The node at (x, y), merging with any within `join` metres. */
  private nodeAt(p: Position, x: number, y: number): number {
    for (const i of this.nodeGrid.near(x - this.join, y - this.join, x + this.join, y + this.join)) {
      const n = this.nodes[i]!
      if (Math.hypot(n.x - x, n.y - y) <= this.join) return i
    }
    const index = this.nodes.push({ x, y, p, edges: [] }) - 1
    this.nodeGrid.add(index, x, y, x, y)
    return index
  }

  private connect(a: number, b: number, factor = 1): void {
    if (a === b) return
    const na = this.nodes[a]!
    const nb = this.nodes[b]!
    const index = this.edges.push({ a, b, length: Math.hypot(na.x - nb.x, na.y - nb.y), factor }) - 1
    na.edges.push(index)
    nb.edges.push(index)
    this.edgeGrid.add(
      index,
      Math.min(na.x, nb.x),
      Math.min(na.y, nb.y),
      Math.max(na.x, nb.x),
      Math.max(na.y, nb.y),
    )
  }

  /**
   * Join street crossings and dead ends that are at most `gap` metres apart
   * but not joined by a street, with straight links costing `cost` per metre.
   * Shape points along a street (two edges) are left out: a crossing from the
   * middle of a block is never what a border means.
   */
  bridgeGaps(gap: number, cost: number): void {
    if (gap <= 0) return
    const ends = this.nodes.map((n, i) => (n.edges.length !== 2 ? i : -1)).filter((i) => i >= 0)
    const grid = new Grid<number>(gap)
    for (const i of ends) grid.add(i, this.nodes[i]!.x, this.nodes[i]!.y, this.nodes[i]!.x, this.nodes[i]!.y)
    for (const i of ends) {
      const n = this.nodes[i]!
      const linked = new Set(
        n.edges.map((e) => (this.edges[e]!.a === i ? this.edges[e]!.b : this.edges[e]!.a)),
      )
      for (const j of grid.near(n.x - gap, n.y - gap, n.x + gap, n.y + gap)) {
        if (j <= i || linked.has(j)) continue
        const m = this.nodes[j]!
        if (Math.hypot(n.x - m.x, n.y - m.y) <= gap) this.connect(i, j, cost)
      }
    }
  }

  /**
   * Join a point to the network: the point itself becomes a node, linked to
   * the nearest spot on the nearest street within `within` metres (which
   * splits that street). `null` when no street is that close.
   */
  attach(p: Position, within: number): number | null {
    const [x, y] = this.toLocal(p)
    let best: { edge: number; t: number; d: number } | null = null
    for (const e of this.edgeGrid.near(x - within, y - within, x + within, y + within)) {
      const edge = this.edges[e]!
      if (edge.removed) continue
      const a = this.nodes[edge.a]!
      const b = this.nodes[edge.b]!
      const s = { ax: a.x, ay: a.y, bx: b.x, by: b.y } as Segment
      const { t, d } = paramOn(x, y, s)
      // Attach to streets only, never to a straight crossing.
      if (edge.factor === 1 && d <= within && (!best || d < best.d)) best = { edge: e, t, d }
    }
    if (!best) return null
    const edge = this.edges[best.edge]!
    const a = this.nodes[edge.a]!
    const b = this.nodes[edge.b]!
    const onStreet: Position = [a.p[0] + (b.p[0] - a.p[0]) * best.t, a.p[1] + (b.p[1] - a.p[1]) * best.t]
    const middle = this.nodeAt(onStreet, a.x + (b.x - a.x) * best.t, a.y + (b.y - a.y) * best.t)
    if (middle !== edge.a && middle !== edge.b) {
      edge.removed = true
      this.connect(edge.a, middle)
      this.connect(middle, edge.b)
    }
    // The click itself is the endpoint, exactly where the user put it.
    const index = this.nodes.push({ x, y, p, edges: [] }) - 1
    this.connect(index, middle)
    return index
  }
}

/** Binary min-heap of [cost, node]. */
class Heap {
  private items: [number, number][] = []
  get size() {
    return this.items.length
  }
  push(item: [number, number]) {
    const h = this.items
    h.push(item)
    let i = h.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (h[parent]![0] <= h[i]![0]) break
      ;[h[parent], h[i]] = [h[i]!, h[parent]!]
      i = parent
    }
  }
  pop(): [number, number] {
    const h = this.items
    const top = h[0]!
    const last = h.pop()!
    if (h.length > 0) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < h.length && h[l]![0] < h[m]![0]) m = l
        if (r < h.length && h[r]![0] < h[m]![0]) m = r
        if (m === i) break
        ;[h[m], h[i]] = [h[i]!, h[m]!]
        i = m
      }
    }
    return top
  }
}

/**
 * Edges that run along `avoid` (their middle lies on it), except the ones
 * touching the two endpoints — the path has to leave from and arrive at the
 * drawing.
 */
function blockedEdges(
  network: StreetNetwork,
  avoid: readonly Position[],
  join: number,
  start: number,
  goal: number,
): Uint8Array {
  const blocked = new Uint8Array(network.edges.length)
  if (avoid.length < 2) return blocked
  const grid = new Grid<number>(60)
  const pts = avoid.map((p) => network.toLocal(p))
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]!
    const [bx, by] = pts[i + 1]!
    grid.add(
      i,
      Math.min(ax, bx) - join,
      Math.min(ay, by) - join,
      Math.max(ax, bx) + join,
      Math.max(ay, by) + join,
    )
  }
  network.edges.forEach((edge, e) => {
    if (edge.a === start || edge.b === start || edge.a === goal || edge.b === goal) return
    const a = network.nodes[edge.a]!
    const b = network.nodes[edge.b]!
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    for (const i of grid.near(mx, my, mx, my)) {
      const [ax, ay] = pts[i]!
      const [bx, by] = pts[i + 1]!
      if (paramOn(mx, my, { ax, ay, bx, by } as Segment).d <= join) {
        blocked[e] = 1
        return
      }
    }
  })
  return blocked
}

/** Distance from (px, py) to the segment (0,0)→(cx, cy). */
function offLine(px: number, py: number, cx: number, cy: number): number {
  const len2 = cx * cx + cy * cy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * cx + py * cy) / len2))
  return Math.hypot(px - cx * t, py - cy * t)
}

/**
 * The path along `lines` from `from` to `to`, in either direction along any
 * street, staying as close as it can to the straight line between them.
 */
export function streetPath(
  lines: readonly (readonly Position[])[],
  from: Position,
  to: Position,
  options: StreetPathOptions = {},
): StreetPathResult {
  const attachMetres = options.attachMetres ?? 4
  const join = options.joinMetres ?? 1.5
  const straightness = options.straightness ?? 4
  const maxDetour = options.maxDetour ?? 3

  const network = new StreetNetwork(lines, from, join)
  network.bridgeGaps(options.gapMetres ?? 80, options.gapCost ?? 4)
  const start = network.attach(from, attachMetres)
  const goal = network.attach(to, attachMetres)
  if (start === null || goal === null) return { reason: 'off-street' }

  const blocked = blockedEdges(network, options.avoid ?? [], join, start, goal)
  const chord = Math.max(distance(from, to), 1)
  const g = network.nodes[goal]!
  const s0 = network.nodes[start]!
  const cx = g.x - s0.x
  const cy = g.y - s0.y

  const cost = new Float64Array(network.nodes.length).fill(Infinity)
  const via = new Int32Array(network.nodes.length).fill(-1)
  const heap = new Heap()
  cost[start] = 0
  heap.push([0, start])
  while (heap.size > 0) {
    const [c, n] = heap.pop()
    if (n === goal) break
    if (c > cost[n]!) continue
    const node = network.nodes[n]!
    for (const e of node.edges) {
      if (blocked[e]) continue
      const edge = network.edges[e]!
      if (edge.removed) continue
      const m = edge.a === n ? edge.b : edge.a
      const other = network.nodes[m]!
      const mx = (node.x + other.x) / 2 - s0.x
      const my = (node.y + other.y) / 2 - s0.y
      const weight = edge.length * edge.factor * (1 + (straightness * offLine(mx, my, cx, cy)) / chord)
      const next = c + weight
      if (next < cost[m]!) {
        cost[m] = next
        via[m] = n
        heap.push([next, m])
      }
    }
  }
  if (cost[goal] === Infinity) return { reason: 'no-path' }

  const nodes: number[] = []
  for (let n = goal; n !== -1; n = via[n]!) nodes.push(n)
  nodes.reverse()
  const points = nodes.map((n) => network.nodes[n]!.p)
  if (pathLength(points) > chord * maxDetour) return { reason: 'detour' }
  // The clicks are the endpoints; drop the street points that coincide with
  // them (a click on a street attaches at its own position) and repeats.
  const same = (a: Position, b: Position) => distance(a, b) < 0.01
  const path: Position[] = []
  for (const p of points.slice(1, -1)) {
    if (same(p, from) || same(p, to) || (path.length > 0 && same(p, path[path.length - 1]!))) continue
    path.push(p)
  }
  return { path }
}
