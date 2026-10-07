/**
 * The data model. Everything here is plain JSON: the editor never holds a
 * reference to anything the host passed in, and every state it emits is a new
 * value the host may keep.
 */

/** `[longitude, latitude]` in degrees (WGS 84), the GeoJSON order. */
export type Position = [lng: number, lat: number]

/**
 * A ring of vertices, **open**: the first vertex is not repeated at the end.
 * GeoJSON closes its rings; the editor converts at the boundary
 * (`toFeatureCollection` / `fromGeoJSON`) so no operation has to keep a
 * duplicate vertex in step with its twin.
 */
export type Ring = Position[]

/** One polygon on the map. */
export interface Area<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable identifier. The editor never changes it. */
  id: string
  /** `[outer, ...holes]`, all open. The outer ring may wind either way. */
  rings: Ring[]
  /** Anything the host wants to carry along. `name` and `color` are read for display. */
  properties: P
  /**
   * A locked area is drawn, snapped to and checked for overlaps, but cannot be
   * edited — e.g. a neighbour that belongs to someone else.
   */
  locked?: boolean
}

/** Points at one vertex: `rings[ring][index]` of the area `areaId`. */
export interface VertexRef {
  areaId: string
  ring: number
  index: number
}

/** Points at one edge: from `rings[ring][index]` to the next vertex (wrapping). */
export interface EdgeRef {
  areaId: string
  ring: number
  index: number
}

/** A point on a screen, in CSS pixels. */
export interface ScreenPoint {
  x: number
  y: number
}

/** Why an operation was refused or adjusted. Hosts translate the code. */
export type IssueCode =
  | 'too-few-vertices'
  | 'self-intersection'
  | 'overlap'
  | 'clipped'
  | 'clipped-away'
  | 'clipped-split'
  | 'hole-outside'
  | 'cut-missed'
  | 'cut-crosses-hole'
  | 'not-adjacent'
  | 'locked'
  | 'pinned'
  | 'route-fallback'
  | 'import-skipped'
  | 'invalid-coordinates'

export interface Issue {
  code: IssueCode
  /** The area the issue is about, when there is one. */
  areaId?: string
  /** The other area involved (overlap, merge). */
  otherId?: string
  /** A count, where the code needs one (e.g. how many features an import skipped). */
  count?: number
}
