import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapMouseEvent,
  MapTouchEvent,
} from 'maplibre-gl'
import type { EditorState, PolygonEditorCore } from '../core/editor'
import { boxesTouch, distance, polygonBounds, samePosition, type Box } from '../core/geo'
import { snap, type SnapResult } from '../core/snap'
import type { Area, EdgeRef, Position, VertexRef } from '../core/types'
import { DEFAULT_THEME, readTheme, type MapTheme } from './theme'

export type { MapTheme } from './theme'

/**
 * Connects a `PolygonEditorCore` to a MapLibre map: draws its state as
 * GeoJSON layers and turns pointer and keyboard input into core calls.
 *
 * The binding owns nothing the core does not already know — it can be
 * detached and attached again (to the same map or another) at any time.
 */

export interface MapBindingOptions {
  /** Pixels within which the cursor snaps to a vertex, an edge or a street. */
  snapTolerancePx?: number
  /**
   * Basemap layer ids whose lines attract the cursor (usually the road
   * layers). Layers missing from the current style are skipped, so one list
   * can serve several styles.
   */
  snapLayers?: string[] | ((map: MapLibreMap) => string[])
  /** Colours. By default read from the `--pe-*` CSS custom properties of the map container. */
  theme?: Partial<MapTheme>
  /** Handle Enter, Escape, Backspace/Delete and undo/redo on the map. Default `true`. */
  keyboard?: boolean
  /** Prefix for the sources and layers the binding adds. Default `pe`. */
  prefix?: string
}

/** What is under the cursor, for a measuring overlay. */
export interface CursorInfo {
  position: Position
  snap: SnapResult['kind']
  /** Metres from the last draft vertex to the cursor, while drafting. */
  segment: number | null
}

type FC = GeoJSON.FeatureCollection

const EMPTY: FC = { type: 'FeatureCollection', features: [] }

export class MapBinding {
  private readonly prefix: string
  private readonly tolerance: number
  private theme: MapTheme = DEFAULT_THEME
  private state: EditorState
  private cursor: { position: Position; snap: SnapResult } | null = null
  private dragging = false
  private frame = 0
  private pin: Position | null = null
  private readonly cursorListeners = new Set<(info: CursorInfo | null) => void>()
  private readonly cleanups: (() => void)[] = []
  private hover: 'vertex' | 'midpoint' | 'area' | null = null
  private inputBound = false
  /**
   * What each source last received, so a frame re-sends only what changed.
   * `setData` makes MapLibre re-tile the whole source in its worker; with a
   * city's worth of areas, re-sending them on every cursor move is the lag.
   */
  private drawn: {
    editable?: readonly Area[]
    selectedId?: string | null
    locked?: readonly (readonly [Area, number])[]
    handles?: readonly unknown[]
  } = {}

  constructor(
    readonly map: MapLibreMap,
    private readonly core: PolygonEditorCore,
    private readonly options: MapBindingOptions = {},
  ) {
    this.prefix = options.prefix ?? 'pe'
    this.tolerance = options.snapTolerancePx ?? 12
    this.state = core.getState()
    this.cleanups.push(core.on('state', (s) => this.onState(s)))
    if (options.snapLayers) {
      core.setStreetSource((from, to) => this.streetsAround(from, to))
      this.cleanups.push(() => core.setStreetSource(null))
    }
    if (map.isStyleLoaded()) this.setup()
    else this.listen('load', () => this.setup())
    // A host that swaps the basemap style wipes our sources; put them back.
    this.listen('styledata', () => {
      if (!this.map.getSource(this.id('areas'))) this.setup()
    })
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Remove every layer, source and listener the binding added. The map stays. */
  destroy(): void {
    cancelAnimationFrame(this.frame)
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    for (const layer of this.layerIds()) if (this.map.getLayer(layer)) this.map.removeLayer(layer)
    for (const source of SOURCES) {
      if (this.map.getSource(this.id(source))) this.map.removeSource(this.id(source))
    }
    this.map.getCanvas().style.cursor = ''
    this.map.doubleClickZoom.enable()
  }

  /** Re-read the colours from CSS (call after the host switches theme). */
  refreshTheme(): void {
    this.theme = { ...readTheme(this.map.getContainer()), ...this.options.theme }
    if (this.map.getSource(this.id('areas'))) this.applyPaint()
    this.drawn = {}
    this.schedule()
  }

  /** Show a marker (e.g. a search result), or clear it with `null`. */
  setPin(position: Position | null): void {
    this.pin = position
    this.schedule()
  }

  /** Pin a place and bring it into view: fit `bbox` when given, otherwise fly to street level. */
  show(position: Position, bbox?: [number, number, number, number]): void {
    this.setPin(position)
    if (bbox) {
      this.map.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 48, maxZoom: 18 },
      )
    } else {
      this.map.flyTo({ center: position, zoom: Math.max(this.map.getZoom(), 17) })
    }
  }

  /** Fit the map to every area, or to the given ids. */
  fitAreas(ids?: string[], padding = 48): void {
    const points = this.state.areas.filter((a) => !ids || ids.includes(a.id)).flatMap((a) => a.rings[0] ?? [])
    if (points.length === 0) return
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [x, y] of points) {
      w = Math.min(w, x)
      s = Math.min(s, y)
      e = Math.max(e, x)
      n = Math.max(n, y)
    }
    this.map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding, maxZoom: 18 },
    )
  }

  /** Measurements under the cursor, for an overlay. Returns an unsubscribe function. */
  onCursor(listener: (info: CursorInfo | null) => void): () => void {
    this.cursorListeners.add(listener)
    return () => this.cursorListeners.delete(listener)
  }

  /** The map centre, e.g. to bias a search. */
  center(): Position {
    const c = this.map.getCenter()
    return [c.lng, c.lat]
  }

  // ── Setup ───────────────────────────────────────────────────────────────

  private id(name: string): string {
    return `${this.prefix}-${name}`
  }

  private layerIds(): string[] {
    return [
      'locked-fill',
      'area-fill',
      'area-line',
      'area-locked',
      'draft-fill',
      'draft-line',
      'draft-point',
      'midpoint',
      'vertex',
      'snap',
      'pin',
    ].map((l) => this.id(l))
  }

  private listen(type: string, handler: (e: never) => void, layer?: string): void {
    const map = this.map as unknown as {
      on: (...args: unknown[]) => void
      off: (...args: unknown[]) => void
    }
    if (layer) {
      map.on(type, layer, handler)
      this.cleanups.push(() => map.off(type, layer, handler))
    } else {
      map.on(type, handler)
      this.cleanups.push(() => map.off(type, handler))
    }
  }

  private setup(): void {
    if (this.map.getSource(this.id('areas'))) return
    this.theme = { ...readTheme(this.map.getContainer()), ...this.options.theme }
    this.drawn = {}
    for (const source of SOURCES) {
      this.map.addSource(this.id(source), { type: 'geojson', data: EMPTY })
    }
    const map = this.map
    // Locked areas get a source of their own: they never change while the
    // user edits, so the frames of a drag or a drawing never re-send them.
    map.addLayer({ id: this.id('locked-fill'), type: 'fill', source: this.id('locked') })
    map.addLayer({ id: this.id('area-fill'), type: 'fill', source: this.id('areas') })
    map.addLayer({
      id: this.id('area-line'),
      type: 'line',
      source: this.id('areas'),
      layout: { 'line-join': 'round' },
    })
    map.addLayer({
      id: this.id('area-locked'),
      type: 'line',
      source: this.id('locked'),
      paint: { 'line-dasharray': [2, 2] },
    })
    map.addLayer({
      id: this.id('draft-fill'),
      type: 'fill',
      source: this.id('draft'),
      filter: ['==', ['geometry-type'], 'Polygon'],
    })
    map.addLayer({
      id: this.id('draft-line'),
      type: 'line',
      source: this.id('draft'),
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    })
    map.addLayer({
      id: this.id('draft-point'),
      type: 'circle',
      source: this.id('draft'),
      filter: ['==', ['geometry-type'], 'Point'],
    })
    map.addLayer({ id: this.id('midpoint'), type: 'circle', source: this.id('midpoints') })
    map.addLayer({ id: this.id('vertex'), type: 'circle', source: this.id('vertices') })
    map.addLayer({ id: this.id('snap'), type: 'circle', source: this.id('snap') })
    map.addLayer({ id: this.id('pin'), type: 'circle', source: this.id('pin') })
    this.applyPaint()

    if (!this.inputBound) this.bindInput()
    this.applyMode()
    this.render()
  }

  private applyPaint(): void {
    const t = this.theme
    type PaintName = Parameters<MapLibreMap['setPaintProperty']>[1]
    const set = (layer: string, prop: PaintName, value: unknown) =>
      this.map.setPaintProperty(this.id(layer), prop, value as never)
    set('locked-fill', 'fill-color', ['get', 'color'])
    set('locked-fill', 'fill-opacity', 0.06)
    set('area-fill', 'fill-color', ['get', 'color'])
    set('area-fill', 'fill-opacity', ['case', ['get', 'selected'], 0.32, 0.18])
    set('area-line', 'line-color', ['get', 'color'])
    set('area-line', 'line-width', ['case', ['get', 'selected'], 3, 1.5])
    set('area-locked', 'line-color', t.locked)
    set('area-locked', 'line-width', 1.5)
    set('draft-fill', 'fill-color', ['case', ['get', 'cut'], t.cut, t.draft])
    set('draft-fill', 'fill-opacity', 0.12)
    set('draft-line', 'line-color', ['case', ['get', 'cut'], t.cut, t.draft])
    set('draft-line', 'line-width', 2.5)
    set('draft-line', 'line-dasharray', [2, 1.5])
    set('draft-point', 'circle-radius', ['case', ['get', 'first'], 6, 4])
    set('draft-point', 'circle-color', t.vertexFill)
    set('draft-point', 'circle-stroke-color', ['case', ['get', 'cut'], t.cut, t.draft])
    set('draft-point', 'circle-stroke-width', 2)
    set('midpoint', 'circle-radius', 4)
    set('midpoint', 'circle-color', t.vertexFill)
    set('midpoint', 'circle-opacity', 0.85)
    set('midpoint', 'circle-stroke-color', t.primary)
    set('midpoint', 'circle-stroke-width', 1)
    set('vertex', 'circle-radius', ['case', ['get', 'selected'], 7, 5.5])
    set('vertex', 'circle-color', ['case', ['get', 'selected'], t.primary, t.vertexFill])
    set('vertex', 'circle-stroke-color', t.primary)
    set('vertex', 'circle-stroke-width', ['case', ['get', 'shared'], 3, 2])
    set('snap', 'circle-radius', 9)
    set('snap', 'circle-opacity', 0)
    set('snap', 'circle-stroke-width', 2.5)
    set('snap', 'circle-stroke-color', [
      'match',
      ['get', 'kind'],
      ['vertex', 'edge'],
      t.snapArea,
      t.snapStreet,
    ])
    set('pin', 'circle-radius', 7)
    set('pin', 'circle-color', t.pin)
    set('pin', 'circle-stroke-color', t.vertexFill)
    set('pin', 'circle-stroke-width', 3)
  }

  private bindInput(): void {
    this.inputBound = true
    this.listen('mousemove', (e: MapMouseEvent) => this.onMove(e))
    this.listen('touchmove', (e: MapTouchEvent) => this.onMove(e))
    this.listen('click', (e: MapMouseEvent) => this.onClick(e))
    this.listen('dblclick', (e: MapMouseEvent) => this.onDoubleClick(e))
    this.listen('mousedown', (e: MapLayerMouseEvent) => this.onGrab(e, 'vertex'), this.id('vertex'))
    this.listen('touchstart', (e: MapLayerTouchEvent) => this.onGrab(e, 'vertex'), this.id('vertex'))
    this.listen('mousedown', (e: MapLayerMouseEvent) => this.onGrab(e, 'midpoint'), this.id('midpoint'))
    this.listen('touchstart', (e: MapLayerTouchEvent) => this.onGrab(e, 'midpoint'), this.id('midpoint'))
    this.listen('mouseup', () => this.onRelease())
    this.listen('touchend', () => this.onRelease())
    this.listen('touchcancel', () => this.onRelease())
    this.listen('mouseout', () => this.setCursor(null))

    if (this.options.keyboard !== false) {
      const container = this.map.getContainer()
      const onKey = (e: KeyboardEvent) => this.onKey(e)
      container.addEventListener('keydown', onKey)
      this.cleanups.push(() => container.removeEventListener('keydown', onKey))
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────

  private snapLayerIds(): string[] {
    const configured = this.options.snapLayers
    const ids = typeof configured === 'function' ? configured(this.map) : (configured ?? [])
    return ids.filter((id) => this.map.getLayer(id))
  }

  /** The line geometry of rendered features, as polylines. */
  private linesIn(box: [[number, number], [number, number]]): Position[][] {
    const layers = this.snapLayerIds()
    if (layers.length === 0) return []
    const lines: Position[][] = []
    for (const f of this.map.queryRenderedFeatures(box, { layers })) {
      const g = f.geometry
      if (g.type === 'LineString') lines.push(g.coordinates as Position[])
      else if (g.type === 'MultiLineString' || g.type === 'Polygon')
        lines.push(...(g.coordinates as Position[][]))
      else if (g.type === 'MultiPolygon') for (const p of g.coordinates) lines.push(...(p as Position[][]))
    }
    return lines
  }

  /** Street (or any reference) lines rendered around a screen point. */
  private referenceLines(point: { x: number; y: number }, radius: number): Position[][] {
    return this.linesIn([
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ])
  }

  /**
   * The streets drawn around two points, for "follow roads": the box spanning
   * both, padded so a path may swing a little wide, clipped to the view.
   */
  private streetsAround(from: Position, to: Position): Position[][] {
    const a = this.map.project(from)
    const b = this.map.project(to)
    const pad = Math.max(120, 0.5 * Math.hypot(a.x - b.x, a.y - b.y))
    const canvas = this.map.getCanvas()
    const clampX = (x: number) => Math.max(0, Math.min(canvas.clientWidth, x))
    const clampY = (y: number) => Math.max(0, Math.min(canvas.clientHeight, y))
    return this.linesIn([
      [clampX(Math.min(a.x, b.x) - pad), clampY(Math.min(a.y, b.y) - pad)],
      [clampX(Math.max(a.x, b.x) + pad), clampY(Math.max(a.y, b.y) + pad)],
    ])
  }

  /** Longitude/latitude bounds of the screen square `radius` pixels around `point`, whatever the bearing. */
  private boundsAround(point: { x: number; y: number }, radius: number): Box {
    const corners = [
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y - radius],
      [point.x + radius, point.y + radius],
      [point.x - radius, point.y + radius],
    ].map(([x, y]) => this.map.unproject([x!, y!]))
    const lngs = corners.map((c) => c.lng)
    const lats = corners.map((c) => c.lat)
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
  }

  private snapAt(e: MapMouseEvent | MapTouchEvent, ignore?: (p: Position) => boolean): SnapResult {
    const raw: Position = [e.lngLat.lng, e.lngLat.lat]
    const free = (e.originalEvent as MouseEvent).altKey === true
    if (!this.state.snapping || free) return { position: raw, kind: 'none' }
    const drafting = this.state.mode !== 'select'
    // Following roads, the user means "this street": streets reach further.
    const lineTolerance = this.state.followRoads ? this.tolerance * 2.5 : this.tolerance
    return snap(raw, e.point, {
      project: (p) => this.map.project(p),
      tolerancePx: this.tolerance,
      lineTolerancePx: lineTolerance,
      areas: this.state.areas,
      bounds: this.boundsAround(e.point, this.tolerance),
      lines: this.referenceLines(e.point, lineTolerance),
      points: drafting ? this.state.draft.map((d) => d.position) : undefined,
      ignore,
    })
  }

  private onMove(e: MapMouseEvent | MapTouchEvent): void {
    if (this.dragging) {
      const at = this.dragPosition()
      const result = this.snapAt(e, at ? (p) => samePosition(p, at, this.core.epsilon) : undefined)
      this.core.dragTo(result.position)
      this.setCursor({ position: result.position, snap: result })
      return
    }
    if (this.state.mode === 'select') {
      this.updateHover(e)
      if (this.cursor) this.setCursor(null)
      return
    }
    const snapped = this.snapAt(e)
    this.setCursor({ position: snapped.position, snap: snapped })
  }

  private updateHover(e: MapMouseEvent | MapTouchEvent): void {
    const hits = this.map.queryRenderedFeatures(e.point, {
      layers: [this.id('vertex'), this.id('midpoint'), this.id('area-fill'), this.id('locked-fill')].filter(
        (l) => this.map.getLayer(l),
      ),
    })
    const top = hits[0]?.layer.id
    const hover =
      top === this.id('vertex')
        ? 'vertex'
        : top === this.id('midpoint')
          ? 'midpoint'
          : top === this.id('area-fill') || top === this.id('locked-fill')
            ? 'area'
            : null
    if (hover !== this.hover) {
      this.hover = hover
      this.applyCursorStyle()
    }
  }

  private dragPosition(): Position | undefined {
    const v = this.state.selectedVertex
    return v ? this.state.areas.find((a) => a.id === v.areaId)?.rings[v.ring]?.[v.index] : undefined
  }

  private onClick(e: MapMouseEvent): void {
    if (this.state.mode === 'select') {
      const hits = this.map.queryRenderedFeatures(e.point, {
        layers: [this.id('vertex'), this.id('area-fill'), this.id('locked-fill')].filter((l) =>
          this.map.getLayer(l),
        ),
      })
      const vertex = hits.find((h) => h.layer.id === this.id('vertex'))
      if (vertex) {
        this.core.selectVertex(vertexRef(vertex.properties))
        return
      }
      // Several areas can be under the cursor only when overlaps are allowed;
      // prefer one that is not the current selection so a click cycles.
      const areaIds = hits
        .filter((h) => h.layer.id === this.id('area-fill') || h.layer.id === this.id('locked-fill'))
        .map((h) => String(h.properties.id))
      const next = areaIds.find((id) => id !== this.state.selectedId) ?? areaIds[0] ?? null
      this.core.select(next)
      return
    }
    void this.core.addPoint(this.snapAt(e))
  }

  private onDoubleClick(e: MapMouseEvent): void {
    if (this.state.mode === 'select') return
    e.preventDefault()
    this.core.finish()
  }

  private onGrab(e: MapLayerMouseEvent | MapLayerTouchEvent, kind: 'vertex' | 'midpoint'): void {
    if (this.state.mode !== 'select' || this.state.readonly) return
    if ('touches' in e.originalEvent && e.originalEvent.touches.length > 1) return
    const feature = e.features?.[0]
    if (!feature) return
    const started =
      kind === 'vertex'
        ? this.core.beginDrag(vertexRef(feature.properties))
        : this.core.beginInsert(
            edgeRef(feature.properties),
            (feature.geometry as GeoJSON.Point).coordinates as Position,
          )
    if (!started) return
    // Stops the map panning while a vertex is dragged.
    e.preventDefault()
    this.dragging = true
    this.applyCursorStyle()
  }

  private onRelease(): void {
    if (!this.dragging) return
    this.dragging = false
    this.core.endDrag()
    this.setCursor(null)
    this.applyCursorStyle()
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    const mod = e.ctrlKey || e.metaKey
    const s = this.state
    let handled = true
    if (mod && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) this.core.redo()
      else this.core.undo()
    } else if (mod && e.key.toLowerCase() === 'y') this.core.redo()
    else if (e.key === 'Enter' && s.draft.length > 0) this.core.finish()
    else if (!mod && !e.altKey && MODE_KEYS[e.key.toLowerCase()] && !s.readonly) {
      this.core.setMode(MODE_KEYS[e.key.toLowerCase()]!)
    } else if (e.key === 'Escape') {
      if (this.dragging) {
        this.dragging = false
        this.core.cancelDrag()
      } else if (s.draft.length > 0) this.core.cancelDraft()
      else if (s.selectedVertex) this.core.selectVertex(null)
      else if (s.selectedId) this.core.select(null)
      else handled = false
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (s.draft.length > 0) this.core.removeLastPoint()
      else if (s.selectedVertex) this.core.deleteVertex(s.selectedVertex)
      else handled = false
    } else handled = false
    if (handled) e.preventDefault()
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private onState(state: EditorState): void {
    const modeChanged = state.mode !== this.state.mode || state.readonly !== this.state.readonly
    this.state = state
    if (modeChanged) {
      this.applyMode()
      if (state.mode === 'select') this.setCursor(null)
    }
    this.schedule()
  }

  private applyMode(): void {
    // A double click finishes a draft instead of zooming.
    if (this.state.mode === 'select') this.map.doubleClickZoom.enable()
    else this.map.doubleClickZoom.disable()
    this.applyCursorStyle()
  }

  private applyCursorStyle(): void {
    const canvas = this.map.getCanvas()
    if (this.dragging) canvas.style.cursor = 'grabbing'
    else if (this.state.mode !== 'select') canvas.style.cursor = 'crosshair'
    else if (this.hover === 'vertex' || this.hover === 'midpoint')
      canvas.style.cursor = this.state.readonly ? '' : 'grab'
    else if (this.hover === 'area') canvas.style.cursor = 'pointer'
    else canvas.style.cursor = ''
  }

  private setCursor(cursor: { position: Position; snap: SnapResult } | null): void {
    this.cursor = cursor
    const last = this.state.draft[this.state.draft.length - 1]
    const info: CursorInfo | null = cursor
      ? {
          position: cursor.position,
          snap: cursor.snap.kind,
          segment: last && !this.dragging ? distance(last.position, cursor.position) : null,
        }
      : null
    for (const listener of this.cursorListeners) listener(info)
    this.schedule()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  private source(name: string): GeoJSONSource | undefined {
    return this.map.getSource(this.id(name)) as GeoJSONSource | undefined
  }

  private render(): void {
    if (!this.source('areas')) return
    const s = this.state
    this.renderAreas()
    this.renderHandles()

    const cut = s.mode === 'cut'
    const path = this.core.draftPath()
    const draft: GeoJSON.Feature[] = []
    if (s.mode !== 'select' && path.length > 0) {
      const withCursor = this.cursor ? [...path, this.cursor.position] : path
      if (!cut && withCursor.length >= 3) {
        draft.push({
          type: 'Feature',
          properties: { cut },
          geometry: { type: 'Polygon', coordinates: [[...withCursor, withCursor[0]!]] },
        })
      }
      if (withCursor.length >= 2)
        draft.push({
          type: 'Feature',
          properties: { cut },
          geometry: { type: 'LineString', coordinates: withCursor },
        })
      s.draft.forEach((d, i) => draft.push(point(d.position, { cut, first: i === 0 && !cut })))
    }
    this.source('draft')!.setData({ type: 'FeatureCollection', features: draft })

    const showSnap = this.cursor && this.cursor.snap.kind !== 'none'
    this.source('snap')!.setData({
      type: 'FeatureCollection',
      features: showSnap ? [point(this.cursor!.position, { kind: this.cursor!.snap.kind })] : [],
    })
    this.source('pin')!.setData({
      type: 'FeatureCollection',
      features: this.pin ? [point(this.pin, {})] : [],
    })
  }

  private areaFeature(a: Area, i: number, selected: boolean): GeoJSON.Feature {
    const palette = this.theme.areas
    return {
      type: 'Feature',
      properties: {
        id: a.id,
        color: typeof a.properties.color === 'string' ? a.properties.color : palette[i % palette.length]!,
        selected,
        locked: a.locked === true,
      },
      geometry: { type: 'Polygon', coordinates: a.rings.map((r) => [...r, r[0]!]) },
    }
  }

  private renderAreas(): void {
    const s = this.state
    if (this.drawn.editable === s.areas && this.drawn.selectedId === s.selectedId) return
    const locked: (readonly [Area, number])[] = []
    const editable: GeoJSON.Feature[] = []
    s.areas.forEach((a, i) => {
      if (a.locked) locked.push([a, i])
      else editable.push(this.areaFeature(a, i, a.id === s.selectedId))
    })
    const before = this.drawn.locked
    const lockedSame =
      before !== undefined &&
      before.length === locked.length &&
      before.every(([a, i], k) => a === locked[k]![0] && i === locked[k]![1])
    if (!lockedSame) {
      this.drawn.locked = locked
      this.source('locked')!.setData({
        type: 'FeatureCollection',
        features: locked.map(([a, i]) => this.areaFeature(a, i, false)),
      })
    }
    this.drawn.editable = s.areas
    this.drawn.selectedId = s.selectedId
    this.source('areas')!.setData({ type: 'FeatureCollection', features: editable })
  }

  /** The selected area's vertices and midpoints. */
  private renderHandles(): void {
    const s = this.state
    const selected = s.mode === 'select' ? s.areas.find((a) => a.id === s.selectedId && !a.locked) : undefined
    const editable = selected && !s.readonly ? selected : undefined
    const handles = [editable, s.selectedVertex, this.dragging]
    if (this.drawn.handles?.every((h, i) => h === handles[i])) return
    this.drawn.handles = handles
    const vertices: GeoJSON.Feature[] = []
    const midpoints: GeoJSON.Feature[] = []
    if (editable) {
      // Only areas around the selected one can share its corners.
      const box = polygonBounds(editable.rings)
      const counts = new Map<string, number>()
      for (const a of s.areas) {
        const other = polygonBounds(a.rings)
        if (!box || !other || !boxesTouch(box, other)) continue
        for (const r of a.rings) for (const p of r) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1)
      }
      editable.rings.forEach((ring, r) => {
        ring.forEach((p, i) => {
          const isSelected =
            s.selectedVertex?.areaId === editable.id &&
            s.selectedVertex.ring === r &&
            s.selectedVertex.index === i
          vertices.push(
            point(p, {
              areaId: editable.id,
              ring: r,
              index: i,
              selected: isSelected,
              shared: (counts.get(key(p)) ?? 0) > 1,
            }),
          )
          const q = ring[(i + 1) % ring.length]!
          if (!this.dragging)
            midpoints.push(
              point([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { areaId: editable.id, ring: r, index: i }),
            )
        })
      })
    }
    this.source('vertices')!.setData({ type: 'FeatureCollection', features: vertices })
    this.source('midpoints')!.setData({ type: 'FeatureCollection', features: midpoints })
  }
}

const SOURCES = ['areas', 'locked', 'vertices', 'midpoints', 'draft', 'snap', 'pin']

const key = (p: Position) => `${p[0]},${p[1]}`

const MODE_KEYS: Record<string, EditorState['mode']> = { v: 'select', d: 'draw', c: 'cut' }

function point(p: Position, properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.Point> {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: p } }
}

function vertexRef(props: Record<string, unknown> | null): VertexRef {
  return { areaId: String(props?.areaId), ring: Number(props?.ring), index: Number(props?.index) }
}

function edgeRef(props: Record<string, unknown> | null): EdgeRef {
  return vertexRef(props)
}
