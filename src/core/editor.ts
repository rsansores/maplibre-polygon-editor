import { subtract, unite } from './clip'
import { dedupeRing, polygonArea, roundPosition, samePosition, segmentIntersection } from './geo'
import { History } from './history'
import { splitPolygon } from './split'
import type { SnapResult } from './snap'
import { insertVertex, locateOnRing, moveVertex, nodeAreas, removeVertex, vertexAt } from './topology'
import { streetPath } from './streets'
import { routeBetween, traceBetween, type Router } from './trace'
import type { Area, EdgeRef, Issue, Position, Ring, VertexRef } from './types'
import { findOverlap, polygonIssues } from './validate'

/**
 * The editor, without a map and without a UI framework.
 *
 * It owns the areas, the mode, the selection and the draft, and turns user
 * intentions ("add a point here", "move this vertex there") into new states.
 * A map binding feeds it positions; a UI renders what it emits. Because it
 * never touches the DOM it is tested on its own, and a host can drive it from
 * anything — a test, a form with coordinate inputs, a script.
 *
 * Nothing the user did is ever lost silently: an edit that would break a
 * rule is refused with an `issue` event, and a draft that cannot be finished
 * stays on screen to be fixed.
 */

export type Mode = 'select' | 'draw' | 'cut'

/** The street lines around two points (in any order, as drawn by the map). */
export type StreetSource = (from: Position, to: Position) => Position[][]

/**
 * What happens when a newly drawn area covers part of an existing one:
 *
 * - `clip` (default): the new area is trimmed to the free ground, and its
 *   border becomes the neighbour's border, vertex for vertex.
 * - `forbid`: the drawing is refused.
 * - `allow`: overlaps are kept. Edits never check for them.
 */
export type OverlapPolicy = 'clip' | 'forbid' | 'allow'

/**
 * What happens when an area would cover part of a *locked* one:
 *
 * - `clip` (default): nothing special — locked areas follow `overlap` like
 *   the rest, so a drawing over one is trimmed against it by default.
 * - `forbid`: the operation is refused with `overlap-locked`, whatever
 *   `overlap` says. Overlaps with unlocked areas still follow `overlap`.
 */
export type LockedOverlapPolicy = 'forbid' | 'clip'

export interface EditorOptions {
  /**
   * Decimal places every coordinate is rounded to. 8 places is about 1.1 mm;
   * GeoJSON consumers rarely need more and the rounding is what lets two
   * areas hold *the same* vertex.
   */
  decimals?: number
  overlap?: OverlapPolicy
  /** Overlaps with locked areas: like any other (`clip`, default) or refused (`forbid`). */
  lockedOverlap?: LockedOverlapPolicy
  /** Overlap smaller than this many square metres is numerical noise, not an overlap. */
  overlapToleranceM2?: number
  /**
   * Optional router for "follow roads", replacing the built-in street path.
   * It must ignore one-way streets and turn restrictions (a walking profile,
   * not a driving one): a border is not a car trip.
   */
  router?: Router | null
  /**
   * How strongly "follow roads" prefers streets near the straight line
   * between two clicks over shorter ones further away. Default 4.
   */
  straightness?: number
  /** A followed segment longer than this multiple of the straight distance falls back to straight. */
  maxDetour?: number
  /** New area ids. Defaults to `crypto.randomUUID()`. */
  createId?: () => string
  /** Properties for a new area; `index` is 1-based over the areas that exist. */
  createProperties?: (index: number) => Record<string, unknown>
  readonly?: boolean
  /** What the user may do besides reshaping and renaming. Everything, by default. */
  permissions?: Permissions
}

/**
 * Rights a host can withhold without making the editor read-only — for users
 * who may reshape the areas they have but not add or remove any. An action
 * withheld is refused with `not-allowed`; the Vue parts do not offer it.
 */
export interface Permissions {
  /** Draw a new area, cut one in two (the cut makes a new area) or import. Default `true`. */
  create?: boolean
  /** Whether `area` may be deleted, or merged away — a merge deletes one of the two. Default: every area. */
  delete?: (area: Area) => boolean
}

/** One click of the draft, with the vertices tracing or routing put before it. */
export interface DraftPoint {
  position: Position
  snap: SnapResult
  via: Position[]
}

export interface EditorState {
  areas: Area[]
  mode: Mode
  selectedId: string | null
  selectedVertex: VertexRef | null
  draft: DraftPoint[]
  /** A routed segment is being fetched. */
  pending: boolean
  snapping: boolean
  tracing: boolean
  followRoads: boolean
  /** "Follow roads" is available: there is a street source (the map) or a router. */
  canFollowRoads: boolean
  canUndo: boolean
  canRedo: boolean
  readonly: boolean
  /** New areas may be drawn, cut or imported; see `Permissions.create`. */
  canCreate: boolean
}

export interface EditorEvents {
  /** The areas changed by an edit (not by `setAreas`). Persist this. */
  change: (areas: Area[]) => void
  /** Anything changed: areas, mode, selection, draft, toggles. Render this. */
  state: (state: EditorState) => void
  /** An edit was refused or adjusted. */
  issue: (issue: Issue) => void
}

type Listener<K extends keyof EditorEvents> = EditorEvents[K]

const permissionsWith = (permissions: Permissions = {}): Required<Permissions> => ({
  create: permissions.create ?? true,
  delete: permissions.delete ?? (() => true),
})

const defaultId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export class PolygonEditorCore {
  private areas: Area[] = []
  private mode: Mode = 'select'
  private selectedId: string | null = null
  private selectedVertex: VertexRef | null = null
  private draft: DraftPoint[] = []
  private pending = false
  private draftToken = 0
  private snapping = true
  private tracing = true
  private followRoads = false
  private streetSource: StreetSource | null = null
  private readonly history = new History<Area[]>()
  private gesture: {
    before: Area[]
    vertex: VertexRef
    at: Position
    /** Set when the corner or border is shared with a locked area: the drag moves nothing. */
    pinnedBy?: string
    warned?: boolean
  } | null = null
  private readonly listeners: { [K in keyof EditorEvents]: Set<Listener<K>> } = {
    change: new Set(),
    state: new Set(),
    issue: new Set(),
  }

  readonly decimals: number
  /** Two coordinates closer than this are the same vertex. */
  readonly epsilon: number
  /** A vertex closer than this to an edge lies on it (covers rounding). */
  readonly edgeEpsilon: number
  private options: Required<Omit<EditorOptions, 'decimals' | 'permissions'>>
  private permissions: Required<Permissions>

  constructor(options: EditorOptions = {}) {
    this.decimals = options.decimals ?? 8
    this.epsilon = 0.5 * 10 ** -this.decimals
    this.edgeEpsilon = 10 ** -this.decimals
    this.options = {
      overlap: options.overlap ?? 'clip',
      lockedOverlap: options.lockedOverlap ?? 'clip',
      overlapToleranceM2: options.overlapToleranceM2 ?? 0.01,
      router: options.router ?? null,
      maxDetour: options.maxDetour ?? 3,
      straightness: options.straightness ?? 4,
      createId: options.createId ?? defaultId,
      createProperties: options.createProperties ?? (() => ({})),
      readonly: options.readonly ?? false,
    }
    this.permissions = permissionsWith(options.permissions)
  }

  // ── Events ──────────────────────────────────────────────────────────────

  on<K extends keyof EditorEvents>(event: K, listener: EditorEvents[K]): () => void {
    this.listeners[event].add(listener)
    return () => this.listeners[event].delete(listener)
  }

  private emit<K extends keyof EditorEvents>(event: K, ...args: Parameters<EditorEvents[K]>): void {
    for (const listener of this.listeners[event])
      (listener as (...a: Parameters<EditorEvents[K]>) => void)(...args)
  }

  private notify(): void {
    this.emit('state', this.getState())
  }

  private refuse(issue: Issue): false {
    this.emit('issue', issue)
    return false
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  getState(): EditorState {
    return {
      areas: this.areas,
      mode: this.mode,
      selectedId: this.selectedId,
      selectedVertex: this.selectedVertex,
      draft: this.draft,
      pending: this.pending,
      snapping: this.snapping,
      tracing: this.tracing,
      followRoads: this.followRoads,
      canFollowRoads: this.canFollowRoads,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      readonly: this.options.readonly,
      canCreate: this.permissions.create,
    }
  }

  getArea(id: string): Area | undefined {
    return this.areas.find((a) => a.id === id)
  }

  /** The draft as one path: every click with its traced or routed vertices. */
  draftPath(): Position[] {
    return this.draft.flatMap((p) => [...p.via, p.position])
  }

  /** "Follow roads" can work: the map supplies streets, or a router is set. */
  get canFollowRoads(): boolean {
    return this.streetSource !== null || this.options.router !== null
  }

  // ── Configuration ───────────────────────────────────────────────────────

  /** Replace the areas from outside (e.g. the host loaded them). Not an edit: no `change`, no history entry. */
  setAreas(areas: Area[], options: { resetHistory?: boolean } = {}): void {
    if (areas === this.areas) return
    this.areas = areas
    if (options.resetHistory) this.history.clear()
    if (this.selectedId && !this.getArea(this.selectedId)) this.selectedId = null
    if (this.selectedVertex && !vertexAt(this.areas, this.selectedVertex)) this.selectedVertex = null
    this.notify()
  }

  setReadonly(readonly: boolean): void {
    this.options.readonly = readonly
    if (readonly) {
      this.mode = 'select'
      this.draft = []
      this.selectedVertex = null
    }
    this.notify()
  }

  /** Replace the permissions. Losing `create` mid-drawing drops the drawing. */
  setPermissions(permissions: Permissions): void {
    this.permissions = permissionsWith(permissions)
    if (!this.permissions.create && this.mode !== 'select') {
      this.mode = 'select'
      this.draft = []
    }
    this.notify()
  }

  /** Whether the area may be deleted or merged away. */
  canDelete(id: string): boolean {
    const area = this.getArea(id)
    return area !== undefined && !area.locked && this.permissions.delete(area)
  }

  setRouter(router: Router | null): void {
    this.options.router = router
    if (!this.canFollowRoads) this.followRoads = false
    this.notify()
  }

  /**
   * Where "follow roads" gets its streets: the street lines around two points.
   * The map binding sets this to what the basemap draws; a host can supply
   * its own network instead.
   */
  setStreetSource(source: StreetSource | null): void {
    this.streetSource = source
    if (!this.canFollowRoads) this.followRoads = false
    this.notify()
  }

  setOverlapPolicy(policy: OverlapPolicy): void {
    this.options.overlap = policy
  }

  setLockedOverlapPolicy(policy: LockedOverlapPolicy): void {
    this.options.lockedOverlap = policy
  }

  /** Under `lockedOverlap: 'forbid'`, the locked area in `others` that `rings` overlaps, if any. */
  private lockedOverlapping(rings: readonly Ring[], others: readonly Area[]): Area | null {
    if (this.options.lockedOverlap !== 'forbid') return null
    return findOverlap(
      rings,
      others.filter((a) => a.locked),
      this.epsilon,
      this.options.overlapToleranceM2,
    )
  }

  setSnapping(on: boolean): void {
    this.snapping = on
    this.notify()
  }

  setTracing(on: boolean): void {
    this.tracing = on
    this.notify()
  }

  setFollowRoads(on: boolean): void {
    this.followRoads = on && this.canFollowRoads
    this.notify()
  }

  setMode(mode: Mode): void {
    if (this.options.readonly && mode !== 'select') return
    if (mode !== 'select' && !this.permissions.create) {
      this.refuse({ code: 'not-allowed' })
      return
    }
    this.mode = mode
    this.cancelDraft()
    if (mode !== 'select') this.selectedVertex = null
    this.notify()
  }

  // ── Selection ───────────────────────────────────────────────────────────

  select(id: string | null): void {
    this.selectedId = id && this.getArea(id) ? id : null
    this.selectedVertex = null
    this.notify()
  }

  selectVertex(ref: VertexRef | null): void {
    if (ref && !vertexAt(this.areas, ref)) return
    this.selectedVertex = ref
    if (ref) this.selectedId = ref.areaId
    this.notify()
  }

  // ── Drafting (draw and cut) ─────────────────────────────────────────────

  private round(p: Position): Position {
    return roundPosition(p, this.decimals)
  }

  /**
   * Add a click to the draft. `snap` is where the click landed after
   * snapping (kind `none` for a free click). Clicking the draft's first
   * vertex again closes and finishes a drawn area.
   */
  async addPoint(snap: SnapResult): Promise<void> {
    if (this.options.readonly || this.mode === 'select' || this.pending) return
    let position = this.round(snap.position)
    let next: SnapResult = { ...snap, position }
    const first = this.draft[0]
    const last = this.draft[this.draft.length - 1]
    if (last && samePosition(last.position, position, this.epsilon)) return

    const closing =
      this.mode === 'draw' &&
      first !== undefined &&
      this.draft.length >= 3 &&
      samePosition(first.position, position, this.epsilon)

    let via: Position[] = []
    if (last) {
      const followed = this.followVia(last.snap, next, closing)
      if (followed) {
        via = this.settle(followed, closing)
        if (followed.to && !closing) {
          position = this.round(followed.to)
          next = { ...next, position }
        }
      } else if (
        !closing &&
        this.followRoads &&
        this.options.router &&
        isLineSnap(last.snap) &&
        isLineSnap(snap)
      ) {
        const token = ++this.draftToken
        this.pending = true
        this.notify()
        const routed = await routeBetween(
          this.options.router,
          last.position,
          position,
          this.options.maxDetour,
        )
        this.pending = false
        // The user cancelled or switched mode while the route was in flight.
        if (token !== this.draftToken) {
          this.notify()
          return
        }
        if (routed) via = this.cleanVia(routed, last.position, position).via
        else this.emit('issue', { code: 'route-fallback' })
      }
    }

    if (via.length === 0 && this.followRoads && this.draft.length >= 2)
      this.cutStraightLoops(position, closing)
    if (closing) {
      this.finish(via)
      return
    }
    this.draft = [...this.draft, { position, snap: next, via }]
    this.notify()
  }

  /**
   * The vertices between two clicks that are not a straight line: a traced
   * border or street, or — with "follow roads" — the street path closest to
   * the straight line, never touching `drawn` (the drawing so far). With a
   * street path, `from` and `to` are where the two clicks joined the streets,
   * which is where they belong. `null` for a straight segment.
   */
  private followVia(
    from: SnapResult,
    to: SnapResult,
    closing: boolean,
  ): { via: Position[]; from?: Position; to?: Position } | null {
    const following = this.followRoads && this.canFollowRoads
    // Tracing a neighbour's border wins: a shared border must be exact. With
    // "follow roads" on, streets are followed through the whole network
    // rather than along the one line the two clicks happened to snap to.
    const traced = this.tracing
      ? traceBetween(from, to, this.areas, this.edgeEpsilon, {
          areas: this.mode === 'draw',
          lines: !following,
        })
      : null
    if (traced && traced.length > 0) return this.cleanVia(traced, from.position, to.position)
    if (!following || this.options.router || !this.streetSource) return null
    const last = this.draft[this.draft.length - 1]
    const second = this.draft[1]
    const result = streetPath(this.streetSource(from.position, to.position), from.position, to.position, {
      straightness: this.options.straightness,
      maxDetour: this.options.maxDetour,
      avoid: this.draftPath(),
      // The stretch just drawn may be retraced, and when closing the first one
      // too; `settle` trims what was.
      retraceEnd: this.draft.length >= 2 && last ? last.via.length + 1 : 0,
      retraceStart: closing && second ? second.via.length + 1 : 0,
    })
    if ('path' in result) {
      const onStreet = { from: this.round(result.from), to: this.round(result.to) }
      return { ...this.cleanVia(result.path, onStreet.from, onStreet.to), ...onStreet }
    }
    // A click off the streets (a field, a forest) is a straight segment by
    // design; only a failure between two street points is worth a word.
    if (result.reason !== 'off-street') this.emit('issue', { code: 'route-fallback' })
    return null
  }

  /**
   * Fit a followed path onto the drawing. The clicks move onto the streets
   * where the path joined them; and where the path comes back onto the
   * stretch just drawn (or, closing, onto the first one), the loop between is
   * cut out of both — a click a little past a corner becomes the corner.
   * Returns the vertices that remain between the two clicks.
   */
  private settle(
    followed: { via: Position[]; from?: Position; to?: Position },
    closing: boolean,
  ): Position[] {
    let via = [...followed.via]
    if (followed.from) this.moveDraftPoint(this.draft.length - 1, followed.from)
    if (closing && followed.to) this.moveDraftPoint(0, followed.to)
    if (!followed.from) return via
    via = this.cutTailLoop(via)
    if (closing) via = this.cutHeadLoop(via)
    return via
  }

  /** The stretch just drawn: the previous click, the vertices between, the last click. */
  private tail(): Position[] {
    const n = this.draft.length
    const last = this.draft[n - 1]
    if (!last) return []
    const previous = this.draft[n - 2]
    return [...(previous ? [previous.position] : []), ...last.via, last.position]
  }

  /**
   * `via` leaves the last click; if it comes back onto the stretch just drawn,
   * end the drawing where it comes back (furthest along `via`) and keep only
   * what follows.
   */
  private cutTailLoop(via: Position[]): Position[] {
    const tail = this.tail()
    for (let q = via.length - 1; q >= 0; q--) {
      const t = tail.findIndex((p) => samePosition(p, via[q]!, this.epsilon))
      if (t >= 0) {
        this.endDrawingAt(tail, t)
        return via.slice(q + 1)
      }
    }
    return via
  }

  /**
   * Cut the drawing back to `tail[t]`: the last click moves there, keeping the
   * stretch before it; at the previous click, the last click goes away. With
   * `crossing`, the click moves to that point just before `tail[t]` instead.
   */
  private endDrawingAt(tail: Position[], t: number, crossing?: Position): void {
    const n = this.draft.length
    const last = this.draft[n - 1]!
    const offset = tail.length - last.via.length - 1 // 1 when there is a previous click
    const position = crossing ?? tail[t]!
    if (t === tail.length - 1 && samePosition(position, last.position, this.epsilon)) return
    if (t < offset && !crossing) {
      this.draft = this.draft.slice(0, n - 1)
      return
    }
    // tail[offset + k] is last.via[k]; keep the vertices before tail[t].
    this.draft = [
      ...this.draft.slice(0, n - 1),
      {
        ...last,
        position,
        snap: { ...last.snap, position },
        via: last.via.slice(0, Math.max(0, t - offset)),
      },
    ]
  }

  /** The first stretch: the first click, the vertices between, the second click. */
  private head(): Position[] {
    const [first, second] = [this.draft[0], this.draft[1]]
    if (!first || !second) return first ? [first.position] : []
    return [first.position, ...second.via, second.position]
  }

  /**
   * Closing: `via` arrives at the first click; if it reaches the first stretch
   * earlier, start the drawing where it does (earliest along `via`) and keep
   * only what comes before.
   */
  private cutHeadLoop(via: Position[]): Position[] {
    const head = this.head()
    for (let q = 0; q < via.length; q++) {
      const h = head.findIndex((p) => samePosition(p, via[q]!, this.epsilon))
      if (h >= 0) {
        this.startDrawingAt(head, h)
        return via.slice(0, q)
      }
    }
    return via
  }

  /** Move the first click forward to `head[h]` (or `position`, on the stretch after it). */
  private startDrawingAt(head: Position[], h: number, position = head[h]!): void {
    const [first, second] = [this.draft[0]!, this.draft[1]]
    if (!second || (h === 0 && samePosition(position, first.position, this.epsilon))) return
    if (h === head.length - 1 && samePosition(position, second.position, this.epsilon)) {
      this.draft = [{ ...second, via: [] }, ...this.draft.slice(2)]
      return
    }
    // head[1 + k] is second.via[k]; keep the vertices after head[h].
    this.draft = [
      { ...first, position, snap: { ...first.snap, position } },
      { ...second, via: second.via.slice(h) },
      ...this.draft.slice(2),
    ]
  }

  /**
   * A straight segment from the last click to `to` that crosses the stretch
   * just drawn (a followed path that overshot the click) makes a loop; end the
   * drawing at the crossing instead. Closing, do the same at the first stretch.
   */
  private cutStraightLoops(to: Position, closing: boolean): void {
    const tail = this.tail()
    const from = tail[tail.length - 1]
    if (from && tail.length >= 3) {
      for (let i = 0; i + 2 < tail.length; i++) {
        const hit = segmentIntersection(from, to, tail[i]!, tail[i + 1]!)
        if (hit && hit.t > 0 && hit.t < 1 && hit.u > 0 && hit.u < 1) {
          this.endDrawingAt(tail, i + 1, this.round(hit.point))
          break
        }
      }
    }
    if (!closing) return
    const head = this.head()
    const last = this.draft[this.draft.length - 1]
    if (!last || head.length < 3) return
    for (let i = head.length - 2; i >= 1; i--) {
      const hit = segmentIntersection(last.position, head[0]!, head[i]!, head[i + 1]!)
      if (hit && hit.t > 0 && hit.t < 1 && hit.u > 0 && hit.u < 1) {
        this.startDrawingAt(head, i, this.round(hit.point))
        break
      }
    }
  }

  /**
   * Put draft point `index` at `position` (a click moving onto the street it
   * was meant to be on, at most a few metres), dropping vertices of its
   * incoming segment that now repeat it.
   */
  private moveDraftPoint(index: number, position: Position): void {
    const at = this.round(position)
    this.draft = this.draft.map((d, i) => {
      if (i !== index || samePosition(d.position, at, this.epsilon)) return d
      const via = [...d.via]
      while (via.length > 0 && samePosition(via[via.length - 1]!, at, this.epsilon)) via.pop()
      return { position: at, snap: { ...d.snap, position: at }, via }
    })
  }

  /** Rounded intermediate vertices, without repeats or copies of the two clicks. */
  private cleanVia(path: Position[], from: Position, to: Position): { via: Position[] } {
    const out: Position[] = []
    for (const raw of path) {
      const p = this.round(raw)
      const previous = out[out.length - 1] ?? from
      if (samePosition(p, previous, this.epsilon) || samePosition(p, to, this.epsilon)) continue
      out.push(p)
    }
    return { via: out }
  }

  /** Undo the last click of the draft (with whatever it traced). */
  removeLastPoint(): void {
    if (this.draft.length === 0) return
    this.draft = this.draft.slice(0, -1)
    this.notify()
  }

  cancelDraft(): void {
    this.draftToken++
    this.pending = false
    if (this.draft.length > 0) {
      this.draft = []
      this.notify()
    }
  }

  /**
   * Finish the draft: create an area (draw mode) or cut one (cut mode). A
   * drawn area closes from its last corner back to its first the same way a
   * click would get there — along a border or the streets when it can.
   */
  finish(closingVia?: Position[]): boolean {
    if (this.options.readonly || this.pending) return false
    if (this.mode !== 'select' && !this.permissions.create) return this.refuse({ code: 'not-allowed' })
    let ok = false
    if (this.mode === 'draw') {
      const first = this.draft[0]
      const last = this.draft[this.draft.length - 1]
      let closing = closingVia
      if (!closing && first && last && this.draft.length >= 3) {
        const followed = this.followVia(last.snap, first.snap, true)
        if (followed) closing = this.settle(followed, true)
        else if (this.followRoads) this.cutStraightLoops(first.position, true)
      }
      ok = this.finishArea(closing ?? [])
    } else if (this.mode === 'cut') {
      ok = this.finishCut()
    }
    if (ok) {
      this.draft = []
      this.notify()
    }
    return ok
  }

  private finishArea(closing: Position[]): boolean {
    const ring = dedupeRing(
      [...this.draftPath(), ...closing].map((p) => this.round(p)),
      this.epsilon,
    )

    const problems = polygonIssues([ring], this.epsilon)
    if (problems.length > 0) return this.refuse({ code: problems[0]! })

    let rings: Ring[] = [ring]
    const others = this.areas
    const lock = this.lockedOverlapping(rings, others)
    if (lock) return this.refuse({ code: 'overlap-locked', otherId: lock.id })
    const policy = this.options.overlap
    if (policy !== 'allow') {
      const overlapped = findOverlap(rings, others, this.epsilon, this.options.overlapToleranceM2)
      if (overlapped && policy === 'forbid') return this.refuse({ code: 'overlap', otherId: overlapped.id })
      if (overlapped) {
        const pieces = subtract(
          rings,
          others.map((a) => a.rings),
          this.epsilon,
        )
          .map((polygon) =>
            polygon.map((r) =>
              dedupeRing(
                r.map((p) => this.round(p)),
                this.epsilon,
              ),
            ),
          )
          .filter(
            (polygon) => polygon[0]!.length >= 3 && polygonArea(polygon) > this.options.overlapToleranceM2,
          )
        if (pieces.length === 0) return this.refuse({ code: 'clipped-away' })
        pieces.sort((a, b) => polygonArea(b) - polygonArea(a))
        rings = pieces[0]!
        const valid = polygonIssues(rings, this.epsilon)
        if (valid.length > 0) return this.refuse({ code: valid[0]! })
        this.emit('issue', { code: pieces.length > 1 ? 'clipped-split' : 'clipped', count: pieces.length })
      }
    }

    const area: Area = {
      id: this.options.createId(),
      rings,
      properties: this.options.createProperties(this.areas.length + 1),
    }
    const next = nodeAreas([...this.areas, area], [area.id], this.edgeEpsilon)
    this.commit(next)
    this.selectedId = area.id
    this.selectedVertex = null
    return true
  }

  private finishCut(): boolean {
    const line = this.draftPath()
    if (line.length < 2) return this.refuse({ code: 'cut-missed' })
    const candidates = [
      ...this.areas.filter((a) => a.id === this.selectedId),
      ...this.areas.filter((a) => a.id !== this.selectedId),
    ].filter((a) => !a.locked)

    let lastIssue: Issue = { code: 'cut-missed' }
    for (const area of candidates) {
      const result = splitPolygon(area.rings, line, this.decimals, this.epsilon)
      if ('issue' in result) {
        if (result.issue !== 'cut-missed') lastIssue = { code: result.issue, areaId: area.id }
        continue
      }
      const [a, b] = result.pieces
      for (const piece of [a, b]) {
        const problems = polygonIssues(piece, this.epsilon)
        if (problems.length > 0) return this.refuse({ code: problems[0]!, areaId: area.id })
      }
      const [keep, give] = polygonArea(a) >= polygonArea(b) ? [a, b] : [b, a]
      const created: Area = {
        id: this.options.createId(),
        rings: give,
        properties: this.options.createProperties(this.areas.length + 1),
      }
      const next = this.areas.flatMap((x) => (x.id === area.id ? [{ ...x, rings: keep }, created] : [x]))
      this.commit(nodeAreas(next, [area.id, created.id], this.edgeEpsilon))
      this.selectedId = area.id
      this.selectedVertex = null
      return true
    }
    return this.refuse(lastIssue)
  }

  // ── Vertex gestures ─────────────────────────────────────────────────────

  private editable(areaId: string): boolean {
    if (this.options.readonly) return false
    const area = this.getArea(areaId)
    if (!area) return false
    if (area.locked) return this.refuse({ code: 'locked', areaId })
    return true
  }

  /**
   * The locked area holding a vertex at `position`, if any. A corner shared
   * with a locked area is pinned: moving it would tear the shared border,
   * since the locked side cannot follow.
   */
  private lockedAt(position: Position): Area | undefined {
    return this.areas.find(
      (a) => a.locked && a.rings.some((r) => r.some((p) => samePosition(p, position, this.epsilon))),
    )
  }

  /** The locked area that shares the edge `edge` (both ends and the middle on its border), if any. */
  private lockedAlong(edge: EdgeRef): Area | undefined {
    const ring = this.getArea(edge.areaId)?.rings[edge.ring]
    if (!ring) return undefined
    const a = ring[edge.index]!
    const b = ring[(edge.index + 1) % ring.length]!
    const middle: Position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    return this.areas.find(
      (x) =>
        x.locked &&
        x.rings.some(
          (r) =>
            locateOnRing(r, a, this.edgeEpsilon) &&
            locateOnRing(r, b, this.edgeEpsilon) &&
            locateOnRing(r, middle, this.edgeEpsilon),
        ),
    )
  }

  /** Start dragging a vertex. Moves are previews until `endDrag`. */
  beginDrag(ref: VertexRef): boolean {
    const at = vertexAt(this.areas, ref)
    if (!at || !this.editable(ref.areaId)) return false
    this.gesture = { before: this.areas, vertex: ref, at, pinnedBy: this.lockedAt(at)?.id }
    this.selectedId = ref.areaId
    this.selectedVertex = ref
    this.notify()
    return true
  }

  /**
   * Insert a vertex on an edge and start dragging it (a midpoint handle).
   * Returns whether a gesture started; a border shared with a locked area
   * starts one that moves nothing and says why.
   */
  beginInsert(edge: EdgeRef, position: Position): boolean {
    if (!this.editable(edge.areaId)) return false
    const before = this.areas
    const at = this.round(position)
    const pinnedBy = this.lockedAlong(edge)?.id
    if (pinnedBy) {
      this.gesture = { before, vertex: { ...edge }, at, pinnedBy }
      return true
    }
    const { areas, vertex } = insertVertex(this.areas, edge, at, this.epsilon)
    this.areas = areas
    this.gesture = { before, vertex, at }
    this.selectedId = edge.areaId
    this.selectedVertex = vertex
    this.notify()
    return true
  }

  dragTo(position: Position): void {
    if (!this.gesture) return
    if (this.gesture.pinnedBy) {
      // Say so once per gesture, not on every pointer move.
      if (!this.gesture.warned) this.emit('issue', { code: 'pinned', otherId: this.gesture.pinnedBy })
      this.gesture.warned = true
      return
    }
    const to = this.round(position)
    this.areas = moveVertex(this.areas, this.gesture.vertex, to, this.epsilon)
    this.gesture.at = to
    this.notify()
  }

  /** Finish a drag: keep it if every touched area is still valid, otherwise put everything back. */
  endDrag(): boolean {
    const gesture = this.gesture
    if (!gesture) return false
    this.gesture = null
    const moved = this.areas
    this.areas = gesture.before
    if (moved === gesture.before) {
      this.notify()
      return false
    }
    // Dropped onto a neighbour's edge: make it a vertex of that edge too.
    return this.tryCommit(nodeAreas(moved, [gesture.vertex.areaId], this.edgeEpsilon))
  }

  cancelDrag(): void {
    if (!this.gesture) return
    this.areas = this.gesture.before
    this.gesture = null
    this.notify()
  }

  /** Put a vertex (and every vertex linked to it) at an exact position, e.g. typed coordinates. */
  setVertex(ref: VertexRef, position: Position): boolean {
    const at = vertexAt(this.areas, ref)
    if (!at || !this.editable(ref.areaId)) return false
    const lock = this.lockedAt(at)
    if (lock) return this.refuse({ code: 'pinned', areaId: ref.areaId, otherId: lock.id })
    if (
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1]) ||
      Math.abs(position[1]) > 90 ||
      Math.abs(position[0]) > 180
    ) {
      return this.refuse({ code: 'invalid-coordinates' })
    }
    const moved = moveVertex(this.areas, ref, this.round(position), this.epsilon)
    return this.tryCommit(nodeAreas(moved, [ref.areaId], this.edgeEpsilon))
  }

  /** Insert a vertex into an edge at an exact position. */
  insertAt(edge: EdgeRef, position: Position): boolean {
    if (!this.editable(edge.areaId)) return false
    const lock = this.lockedAlong(edge)
    if (lock) return this.refuse({ code: 'pinned', areaId: edge.areaId, otherId: lock.id })
    const { areas, vertex } = insertVertex(this.areas, edge, this.round(position), this.epsilon)
    const ok = this.tryCommit(areas)
    if (ok) this.selectedVertex = vertex
    return ok
  }

  deleteVertex(ref: VertexRef): boolean {
    const at = vertexAt(this.areas, ref)
    if (!at || !this.editable(ref.areaId)) return false
    const lock = this.lockedAt(at)
    if (lock) return this.refuse({ code: 'pinned', areaId: ref.areaId, otherId: lock.id })
    const ok = this.tryCommit(removeVertex(this.areas, ref, this.epsilon))
    if (ok) {
      this.selectedVertex = null
      this.notify()
    }
    return ok
  }

  // ── Whole areas ─────────────────────────────────────────────────────────

  deleteArea(id: string): boolean {
    if (!this.editable(id)) return false
    if (!this.permissions.delete(this.getArea(id)!)) return this.refuse({ code: 'not-allowed', areaId: id })
    this.commit(this.areas.filter((a) => a.id !== id))
    if (this.selectedId === id) {
      this.selectedId = null
      this.selectedVertex = null
    }
    this.notify()
    return true
  }

  /** Merge `otherId` into `id`. They must share a border; `id` keeps its identity and properties. */
  mergeAreas(id: string, otherId: string): boolean {
    if (id === otherId || !this.editable(id) || !this.editable(otherId)) return false
    const a = this.getArea(id)!
    const b = this.getArea(otherId)!
    if (!this.permissions.delete(b)) return this.refuse({ code: 'not-allowed', areaId: otherId })
    const merged = unite(a.rings, b.rings, this.epsilon)
    if (merged.length !== 1) return this.refuse({ code: 'not-adjacent', areaId: id, otherId })
    const rings = merged[0]!.map((r) =>
      dedupeRing(
        r.map((p) => this.round(p)),
        this.epsilon,
      ),
    )
    const next = this.areas.filter((x) => x.id !== otherId).map((x) => (x.id === id ? { ...x, rings } : x))
    const ok = this.tryCommit(nodeAreas(next, [id], this.edgeEpsilon), [id])
    if (ok) {
      this.selectedId = id
      this.selectedVertex = null
      this.notify()
    }
    return ok
  }

  /** Shallow-merge `patch` into an area's properties. */
  updateProperties(id: string, patch: Record<string, unknown>): boolean {
    if (this.options.readonly) return false
    const area = this.getArea(id)
    if (!area) return false
    this.commit(
      this.areas.map((a) => (a.id === id ? { ...a, properties: { ...a.properties, ...patch } } : a)),
    )
    this.notify()
    return true
  }

  /**
   * Add areas (an import). Coordinates are rounded; invalid polygons, and
   * under `lockedOverlap: 'forbid'` areas overlapping a locked one, are
   * skipped and reported.
   */
  addAreas(areas: Area[], options: { replace?: boolean } = {}): number {
    if (this.options.readonly) return 0
    if (!this.permissions.create) {
      this.refuse({ code: 'not-allowed' })
      return 0
    }
    const taken = new Set(options.replace ? [] : this.areas.map((a) => a.id))
    const accepted: Area[] = []
    let skipped = 0
    for (const area of areas) {
      const rings = area.rings.map((r) =>
        dedupeRing(
          r.map((p) => this.round(p)),
          this.epsilon,
        ),
      )
      if (polygonIssues(rings, this.epsilon).length > 0) {
        skipped++
        continue
      }
      const id = taken.has(area.id) ? this.options.createId() : area.id
      taken.add(id)
      accepted.push({ ...area, id, rings })
    }
    if (skipped > 0) this.emit('issue', { code: 'import-skipped', count: skipped })
    const base = options.replace ? [] : this.areas
    const locked = [...base, ...accepted].filter((a) => a.locked)
    const kept = accepted.filter((a) => a.locked || !this.lockedOverlapping(a.rings, locked))
    if (kept.length < accepted.length)
      this.emit('issue', { code: 'overlap-locked', count: accepted.length - kept.length })
    if (kept.length === 0) return 0
    this.commit(
      nodeAreas(
        [...base, ...kept],
        kept.map((a) => a.id),
        this.edgeEpsilon,
      ),
    )
    this.notify()
    return kept.length
  }

  // ── History ─────────────────────────────────────────────────────────────

  undo(): void {
    if (this.draft.length > 0) {
      this.removeLastPoint()
      return
    }
    const previous = this.history.undo(this.areas)
    if (previous === undefined) return
    this.areas = previous
    this.afterHistoryJump()
  }

  redo(): void {
    const next = this.history.redo(this.areas)
    if (next === undefined) return
    this.areas = next
    this.afterHistoryJump()
  }

  private afterHistoryJump(): void {
    if (this.selectedId && !this.getArea(this.selectedId)) this.selectedId = null
    if (this.selectedVertex && !vertexAt(this.areas, this.selectedVertex)) this.selectedVertex = null
    this.emit('change', this.areas)
    this.notify()
  }

  // ── Committing ──────────────────────────────────────────────────────────

  private commit(next: Area[]): void {
    this.history.push(this.areas)
    this.areas = next
    this.emit('change', next)
  }

  /**
   * Commit `next` if every area that changed is still valid, overlaps no
   * locked area when `lockedOverlap` forbids it and, unless overlaps are
   * allowed, overlaps nothing. Otherwise keep the current state
   * and report why.
   */
  private tryCommit(next: Area[], alsoCheck: string[] = []): boolean {
    const before = new Map(this.areas.map((a) => [a.id, a]))
    const changed = next.filter((a) => before.get(a.id) !== a || alsoCheck.includes(a.id))
    for (const area of changed) {
      const problems = polygonIssues(area.rings, this.epsilon)
      if (problems.length > 0) {
        this.notify()
        return this.refuse({ code: problems[0]!, areaId: area.id })
      }
    }
    for (const area of changed) {
      if (area.locked) continue
      const lock = this.lockedOverlapping(
        area.rings,
        next.filter((a) => a.id !== area.id),
      )
      if (lock) {
        this.notify()
        return this.refuse({ code: 'overlap-locked', areaId: area.id, otherId: lock.id })
      }
    }
    if (this.options.overlap !== 'allow') {
      for (const area of changed) {
        const others = next.filter((a) => a.id !== area.id)
        const hit = findOverlap(area.rings, others, this.epsilon, this.options.overlapToleranceM2)
        if (hit) {
          this.notify()
          return this.refuse({ code: 'overlap', areaId: area.id, otherId: hit.id })
        }
      }
    }
    this.commit(next)
    this.notify()
    return true
  }
}

const isLineSnap = (s: SnapResult) => s.kind === 'line' || s.kind === 'line-vertex'
