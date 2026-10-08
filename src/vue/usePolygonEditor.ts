// The editor's Vue face: reactive state, actions and the map hook-up, with no
// markup. `PolygonEditor.vue` is one layout on top of it; a host with its own
// design system calls `usePolygonEditor()` in its own component and places the
// connected parts (`PolygonEditorMap`, `PolygonEditorToolbar`, …) wherever its
// panels and drawers live. The parts find this state through provide/inject.
import {
  computed,
  getCurrentScope,
  inject,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  toRaw,
  toValue,
  watch,
  type InjectionKey,
  type MaybeRefOrGetter,
} from 'vue'
import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  PolygonEditorCore,
  type EditorState,
  type LockedOverlapPolicy,
  type Mode,
  type OverlapPolicy,
  type Permissions,
} from '../core/editor'
import { boxesTouch, mayHold, polygonArea, polygonBounds, ringLength } from '../core/geo'
import { fromGeoJSON, toFeatureCollection } from '../core/geojson'
import { fromKML } from '../core/kml'
import type { Router } from '../core/trace'
import type { Area, Issue, Position } from '../core/types'
import { MapBinding, type CursorInfo, type MapBindingOptions } from '../map/binding'
import type { Geocoder } from '../adapters/geocoding'
import { createEditorI18n, type Messages } from './i18n'
import '../styles/editor.css'

export interface PolygonEditorOptions {
  /** The areas (the v-model). The editor keeps a private copy and reports edits through `onUpdate`. */
  modelValue?: MaybeRefOrGetter<Area[] | undefined>
  /** Called with a new array after every edit. */
  onUpdate?: (areas: Area[]) => void
  readonly?: MaybeRefOrGetter<boolean | undefined>
  /** What the user may do besides reshaping and renaming; see `Permissions`. */
  permissions?: MaybeRefOrGetter<Permissions | undefined>
  overlap?: MaybeRefOrGetter<OverlapPolicy | undefined>
  /** Overlaps with locked areas: like any other (`'clip'`, default) or refused (`'forbid'`). */
  lockedOverlap?: MaybeRefOrGetter<LockedOverlapPolicy | undefined>
  /** Decimal places coordinates are rounded to. Fixed for the editor's lifetime. */
  decimals?: number
  /** Place search. Optional: without it the search box still accepts coordinates. */
  geocoder?: MaybeRefOrGetter<Geocoder | null | undefined>
  /** Street router for "follow roads". Optional. */
  router?: MaybeRefOrGetter<Router | null | undefined>
  /** Basemap layers whose lines attract the cursor; see `MapBindingOptions.snapLayers`. */
  snapLayers?: MapBindingOptions['snapLayers']
  snapTolerancePx?: number
  /** Force a UI locale ('en', 'es'). Follows the host's vue-i18n locale when omitted. */
  locale?: MaybeRefOrGetter<string | undefined>
  messages?: MaybeRefOrGetter<Messages | undefined>
  /** Properties of a new area. Default: `{ name: 'Area n' }` in the active language. */
  createProperties?: (index: number) => Record<string, unknown>
  createId?: () => string
  /**
   * Which areas `PolygonEditorAreaList` lists. The others stay on the map —
   * e.g. locked areas shown only for context. Default: every area. Reactive
   * data the function reads is tracked.
   */
  listed?: (area: Area) => boolean
}

export interface AreaMetrics {
  area: number
  perimeter: number
  vertices: number
}

/** Plain-JSON copy that strips Vue proxies, so the core never holds the host's reactive objects. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T
}

const key = (p: Position) => `${p[0]},${p[1]}`

/**
 * Create the editor for this component and its descendants. Call it in the
 * setup of your layout component, then place the connected parts anywhere
 * below it.
 */
export function usePolygonEditor(options: PolygonEditorOptions = {}) {
  const { t, locale } = createEditorI18n(
    () => toValue(options.locale),
    () => toValue(options.messages),
  )

  const core = new PolygonEditorCore({
    decimals: options.decimals,
    overlap: toValue(options.overlap),
    lockedOverlap: toValue(options.lockedOverlap),
    readonly: toValue(options.readonly) ?? false,
    permissions: toValue(options.permissions),
    router: toValue(options.router) ?? null,
    createId: options.createId,
    createProperties: options.createProperties ?? ((n) => ({ name: t('defaultName', { n }) })),
  })

  const state = shallowRef<EditorState>(core.getState())
  const issue = ref<Issue | null>(null)
  const cursor = shallowRef<CursorInfo | null>(null)
  const binding = shallowRef<MapBinding | null>(null)
  let lastEmitted: Area[] | null = null
  let issueTimer: ReturnType<typeof setTimeout> | undefined
  const disposers: (() => void)[] = []

  disposers.push(core.on('state', (s) => (state.value = s)))
  disposers.push(
    core.on('change', (areas) => {
      lastEmitted = areas
      options.onUpdate?.(areas)
    }),
  )
  disposers.push(
    core.on('issue', (i) => {
      issue.value = i
      clearTimeout(issueTimer)
      issueTimer = setTimeout(() => (issue.value = null), 7000)
    }),
  )

  // v-model in: a value the host set (not the one we just emitted) replaces the areas.
  watch(
    () => toValue(options.modelValue),
    (value) => {
      if (!value || toRaw(value) === lastEmitted) return
      core.setAreas(plain(value), { resetHistory: lastEmitted === null })
    },
    { immediate: true },
  )
  watch(
    () => toValue(options.readonly) ?? false,
    (r) => core.setReadonly(r),
  )
  watch(
    () => toValue(options.permissions),
    (p) => core.setPermissions(p ?? {}),
  )
  watch(
    () => toValue(options.overlap),
    (o) => o && core.setOverlapPolicy(o),
  )
  watch(
    () => toValue(options.lockedOverlap) ?? 'clip',
    (o) => core.setLockedOverlapPolicy(o),
  )
  watch(
    () => toValue(options.router) ?? null,
    (r) => core.setRouter(r),
  )

  const areas = computed(() => state.value.areas)
  const selectedArea = computed(() => areas.value.find((a) => a.id === state.value.selectedId) ?? null)
  const selectedVertex = computed(() => {
    const ref = state.value.selectedVertex
    if (!ref) return null
    const position = areas.value.find((a) => a.id === ref.areaId)?.rings[ref.ring]?.[ref.index]
    if (!position) return null
    const k = key(position)
    const sharedWith = areas.value.filter(
      (a) =>
        a.id !== ref.areaId &&
        mayHold(a.rings, position, 0) &&
        a.rings.some((r) => r.some((p) => key(p) === k)),
    ).length
    return { ref, position, sharedWith }
  })

  function metrics(area: Area): AreaMetrics {
    return {
      area: polygonArea(area.rings),
      perimeter: ringLength(area.rings[0] ?? []),
      vertices: area.rings.reduce((n, r) => n + r.length, 0),
    }
  }

  /** Areas that share a border (two or more vertices) with `id` — the ones it can merge with. */
  function neighbours(id: string): Area[] {
    const area = areas.value.find((a) => a.id === id)
    if (!area) return []
    const mine = new Set(area.rings.flatMap((r) => r.map(key)))
    const box = polygonBounds(area.rings)
    return areas.value.filter((a) => {
      if (a.id === id || a.locked || !box) return false
      const other = polygonBounds(a.rings)
      if (!other || !boxesTouch(box, other)) return false
      return a.rings.flat().filter((p) => mine.has(key(p))).length >= 2
    })
  }

  function nameOf(area: Area): string {
    const name = area.properties.name
    return typeof name === 'string' && name.trim() ? name : t('area')
  }

  const hint = computed(() => {
    const s = state.value
    if (s.pending) return t('routing')
    if (s.mode === 'draw')
      return s.draft.length === 0
        ? t('hintDrawStart')
        : s.draft.length >= 3
          ? t('hintDrawClose')
          : t('hintDrawNext')
    if (s.mode === 'cut') return t('hintCut')
    if (s.readonly) return ''
    return s.selectedId ? t('hintSelected') : areas.value.length > 0 ? t('hintSelect') : ''
  })

  const issueMessage = computed(() =>
    issue.value ? t(`issue.${issue.value.code}`, { n: issue.value.count ?? '' }) : '',
  )

  // ── Map ───────────────────────────────────────────────────────────────

  /** Connect a MapLibre map. The editor draws on it and listens to it until `detach()`. */
  function attach(map: MapLibreMap, bindingOptions: MapBindingOptions = {}): MapBinding {
    detach()
    const b = new MapBinding(map, core, {
      snapLayers: options.snapLayers,
      snapTolerancePx: options.snapTolerancePx,
      ...bindingOptions,
    })
    b.onCursor((info) => (cursor.value = info))
    binding.value = b
    return b
  }

  function detach(): void {
    binding.value?.destroy()
    binding.value = null
  }

  // ── Actions ───────────────────────────────────────────────────────────

  const geocoder = computed(() => toValue(options.geocoder) ?? null)

  async function importFile(file: File): Promise<number> {
    const text = await file.text()
    const looksXml = /\.kml$/i.test(file.name) || text.trimStart().startsWith('<')
    const createId = options.createId ?? (() => crypto.randomUUID())
    let result
    try {
      result = looksXml ? fromKML(text, createId) : fromGeoJSON(JSON.parse(text), createId)
    } catch {
      issue.value = { code: 'import-skipped', count: 1 }
      return 0
    }
    if (result.skipped > 0) issue.value = { code: 'import-skipped', count: result.skipped }
    const added = core.addAreas(result.areas)
    if (added > 0) binding.value?.fitAreas()
    return added
  }

  function toGeoJSON() {
    return toFeatureCollection(areas.value, core.decimals)
  }

  function exportGeoJSON(filename = 'areas.geojson'): void {
    const blob = new Blob([JSON.stringify(toGeoJSON(), null, 2)], { type: 'application/geo+json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function goTo(position: Position, bbox?: [number, number, number, number]): void {
    binding.value?.show(position, bbox)
  }

  const context = {
    core,
    state,
    areas,
    selectedArea,
    selectedVertex,
    issue,
    issueMessage,
    cursor,
    hint,
    geocoder,
    canFollowRoads: computed(() => state.value.canFollowRoads),
    binding,
    t,
    locale,
    attach,
    detach,
    metrics,
    neighbours,
    nameOf,
    /** Whether `PolygonEditorAreaList` lists the area; see `PolygonEditorOptions.listed`. */
    listed: (area: Area) => options.listed?.(area) ?? true,
    /** Whether the area may be deleted or merged away. */
    canDelete: (area: Area) => {
      // Re-read with the state, so a part asking it re-renders when the areas do.
      void state.value
      return core.canDelete(area.id)
    },
    setMode: (mode: Mode) => core.setMode(mode),
    undo: () => core.undo(),
    redo: () => core.redo(),
    finish: () => core.finish(),
    cancel: () => core.cancelDraft(),
    select: (id: string | null) => core.select(id),
    setSnapping: (on: boolean) => core.setSnapping(on),
    setTracing: (on: boolean) => core.setTracing(on),
    setFollowRoads: (on: boolean) => core.setFollowRoads(on),
    rename: (id: string, name: string) => core.updateProperties(id, { name }),
    deleteArea: (id: string) => core.deleteArea(id),
    merge: (id: string, otherId: string) => core.mergeAreas(id, otherId),
    deleteVertex: () => selectedVertex.value && core.deleteVertex(selectedVertex.value.ref),
    setVertexPosition: (position: Position) =>
      selectedVertex.value && core.setVertex(selectedVertex.value.ref, position),
    addPoint: (position: Position) => core.addPoint({ position, kind: 'none' }),
    fitAll: () => binding.value?.fitAreas(),
    fitArea: (id: string) => binding.value?.fitAreas([id]),
    goTo,
    clearPin: () => binding.value?.setPin(null),
    importFile,
    exportGeoJSON,
    toGeoJSON,
    dismissIssue: () => (issue.value = null),
  }

  provide(CONTEXT_KEY, context)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      clearTimeout(issueTimer)
      detach()
      for (const d of disposers) d()
    })
  }

  return context
}

export type PolygonEditorContext = ReturnType<typeof usePolygonEditor>

const CONTEXT_KEY: InjectionKey<PolygonEditorContext> = Symbol('polygon-editor')

/** The editor created by an ancestor's `usePolygonEditor()`. */
export function usePolygonEditorContext(): PolygonEditorContext {
  const context = inject(CONTEXT_KEY, null)
  if (!context)
    throw new Error(
      'maplibre-polygon-editor: a part was used outside a component that called usePolygonEditor()',
    )
  return context
}
