// Public API of maplibre-polygon-editor.

// The ready-made editor.
export { default as PolygonEditor } from './vue/PolygonEditor.vue'

// Headless Vue state + connected parts: a host with its own design system
// calls `usePolygonEditor()` in its own layout component and places these
// parts in its own panels. `PolygonEditor` above is one such layout.
export { usePolygonEditor, usePolygonEditorContext } from './vue/usePolygonEditor'
export type { PolygonEditorOptions, PolygonEditorContext, AreaMetrics } from './vue/usePolygonEditor'
export { default as PolygonEditorMap } from './vue/parts/PolygonEditorMap.vue'
export { default as PolygonEditorOverlays } from './vue/parts/PolygonEditorOverlays.vue'
export { default as PolygonEditorToolbar } from './vue/parts/PolygonEditorToolbar.vue'
export { default as PolygonEditorAreaList } from './vue/parts/PolygonEditorAreaList.vue'
export { default as PolygonEditorInspector } from './vue/parts/PolygonEditorInspector.vue'
export { default as PolygonEditorSearch } from './vue/parts/PolygonEditorSearch.vue'
export { builtinMessages } from './vue/i18n'
export type { Messages, MessageTable, Locale } from './vue/i18n'

// Everything framework-agnostic, also available as `maplibre-polygon-editor/core`.
export * from './core/index'
