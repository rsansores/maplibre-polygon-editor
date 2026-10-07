// The editor's own strings, in English and Spanish.
//
// When the host app uses vue-i18n, the editor follows its locale with no
// wiring: it reads the global `$i18n.locale`, so vue-i18n is not even a
// dependency. A host can pin a `locale`, or override any string through
// `messages`.

import { computed, getCurrentInstance } from 'vue'

export type Locale = 'en' | 'es' | (string & {})
export type MessageTable = Record<string, string>
export type Messages = Record<Locale, MessageTable>

const en: MessageTable = {
  // Modes and tools
  modeSelect: 'Select',
  modeSelectTip: 'Select an area to move its vertices (V)',
  modeDraw: 'Draw',
  modeDrawTip: 'Draw a new area: click each corner, click the first one again to close (D)',
  modeCut: 'Cut',
  modeCutTip: 'Cut an area in two along a line (C)',
  undo: 'Undo',
  redo: 'Redo',
  finish: 'Finish',
  cancel: 'Cancel',
  snapping: 'Snap',
  snappingTip: 'Snap to corners, borders and streets. Hold Alt to place a point freely.',
  tracing: 'Trace borders',
  tracingTip: 'Between two points on the same border or street, follow it instead of drawing straight',
  followRoads: 'Follow roads',
  followRoadsTip:
    'Between two points on streets, follow the streets in any direction, as close as possible to the straight line',
  fitAll: 'Show all',
  import: 'Import',
  importTip: 'Import GeoJSON or KML',
  export: 'Export',
  exportTip: 'Download the areas as GeoJSON',
  more: 'More',

  // Hints in the map
  hintDrawStart: 'Click to place the first corner',
  hintDrawNext: 'Click to add a corner · double-click or Enter to finish · Backspace removes the last one',
  hintDrawClose: 'Click the first corner to close the area',
  hintCut: 'Click to draw a line across an area · double-click or Enter to cut',
  hintSelect: 'Click an area to edit it',
  hintSelected: 'Drag a corner to move it · drag a small dot to add a corner',
  routing: 'Following the road…',

  // Lists and inspector
  areas: 'Areas',
  noAreas: 'No areas yet',
  noAreasHint: 'Choose Draw and click on the map to place the corners of the first one.',
  area: 'Area',
  defaultName: 'Area {n}',
  name: 'Name',
  size: 'Size',
  perimeter: 'Perimeter',
  vertices: 'Corners',
  locked: 'Locked',
  lockedHint: 'This area can be seen and snapped to, but not edited.',
  deleteArea: 'Delete area',
  mergeWith: 'Merge with…',
  mergeHint: 'Merge an area that shares a border into this one',
  selectedVertex: 'Selected corner',
  latitude: 'Latitude',
  longitude: 'Longitude',
  applyCoordinates: 'Apply',
  deleteVertex: 'Delete corner',
  sharedVertex: 'Shared with {n} other areas',
  sharedVertexOne: 'Shared with 1 other area',
  nothingSelected: 'Select an area on the map or in the list.',

  // Search
  searchPlaceholder: 'Search a place or paste coordinates',
  searchCoordinates: 'Go to {lat}, {lng}',
  searchAddPoint: 'Add as a corner',
  searchNoResults: 'No results. You can still draw anywhere on the map.',
  searchFailed: 'Search is not available right now. You can still draw anywhere on the map.',
  searching: 'Searching…',
  searchClear: 'Clear',

  // Measurements overlay
  segment: 'Segment',
  snapVertex: 'Snapped to a corner',
  snapEdge: 'Snapped to a border',
  snapLine: 'Snapped to a street',
  snapFree: 'Free point',

  // Issues
  'issue.too-few-vertices': 'An area needs at least three corners that enclose some ground.',
  'issue.self-intersection': 'The border crosses itself. Move a corner or remove the last one.',
  'issue.overlap': 'Areas cannot overlap. The change was undone.',
  'issue.clipped':
    'The new area was trimmed to the free ground; it now shares its border with its neighbours.',
  'issue.clipped-split': 'The free ground was in several pieces; the largest was kept.',
  'issue.clipped-away': 'The new area lies entirely inside existing areas.',
  'issue.hole-outside': 'A hole must stay inside its area.',
  'issue.cut-missed': 'The line has to cross an area from one side to the other.',
  'issue.cut-crosses-hole': 'The line cannot pass through a hole.',
  'issue.not-adjacent': 'Only areas that share a border can be merged.',
  'issue.locked': 'This area is locked.',
  'issue.pinned': 'This corner or border is shared with a locked area, so it stays where it is.',
  'issue.route-fallback': 'No street path close to that line joins those points; a straight line was used.',
  'issue.import-skipped': '{n} shapes could not be imported (not polygons, or invalid).',
  'issue.invalid-coordinates': 'Those coordinates are not valid.',
  dismiss: 'Dismiss',
}

const es: MessageTable = {
  modeSelect: 'Seleccionar',
  modeSelectTip: 'Selecciona un área para mover sus vértices (V)',
  modeDraw: 'Dibujar',
  modeDrawTip: 'Dibuja un área nueva: haz clic en cada esquina y de nuevo en la primera para cerrarla (D)',
  modeCut: 'Cortar',
  modeCutTip: 'Corta un área en dos a lo largo de una línea (C)',
  undo: 'Deshacer',
  redo: 'Rehacer',
  finish: 'Terminar',
  cancel: 'Cancelar',
  snapping: 'Ajustar',
  snappingTip: 'Ajusta a esquinas, bordes y calles. Mantén Alt para colocar un punto libre.',
  tracing: 'Seguir bordes',
  tracingTip: 'Entre dos puntos del mismo borde o calle, lo sigue en lugar de trazar una recta',
  followRoads: 'Seguir calles',
  followRoadsTip:
    'Entre dos puntos sobre calles, sigue las calles en cualquier sentido, lo más cerca posible de la recta',
  fitAll: 'Ver todo',
  import: 'Importar',
  importTip: 'Importar GeoJSON o KML',
  export: 'Exportar',
  exportTip: 'Descargar las áreas como GeoJSON',
  more: 'Más',

  hintDrawStart: 'Haz clic para colocar la primera esquina',
  hintDrawNext: 'Clic para añadir una esquina · doble clic o Enter para terminar · Retroceso quita la última',
  hintDrawClose: 'Haz clic en la primera esquina para cerrar el área',
  hintCut: 'Haz clic para trazar una línea que atraviese un área · doble clic o Enter para cortar',
  hintSelect: 'Haz clic en un área para editarla',
  hintSelected: 'Arrastra una esquina para moverla · arrastra un punto pequeño para añadir una esquina',
  routing: 'Siguiendo la calle…',

  areas: 'Áreas',
  noAreas: 'Aún no hay áreas',
  noAreasHint: 'Elige Dibujar y haz clic en el mapa para colocar las esquinas de la primera.',
  area: 'Área',
  defaultName: 'Área {n}',
  name: 'Nombre',
  size: 'Superficie',
  perimeter: 'Perímetro',
  vertices: 'Esquinas',
  locked: 'Bloqueada',
  lockedHint: 'Esta área se ve y sirve para ajustar, pero no se puede editar.',
  deleteArea: 'Eliminar área',
  mergeWith: 'Unir con…',
  mergeHint: 'Une a esta un área que comparta borde con ella',
  selectedVertex: 'Esquina seleccionada',
  latitude: 'Latitud',
  longitude: 'Longitud',
  applyCoordinates: 'Aplicar',
  deleteVertex: 'Eliminar esquina',
  sharedVertex: 'Compartida con otras {n} áreas',
  sharedVertexOne: 'Compartida con otra área',
  nothingSelected: 'Selecciona un área en el mapa o en la lista.',

  searchPlaceholder: 'Busca un lugar o pega coordenadas',
  searchCoordinates: 'Ir a {lat}, {lng}',
  searchAddPoint: 'Añadir como esquina',
  searchNoResults: 'Sin resultados. Aun así puedes dibujar en cualquier parte del mapa.',
  searchFailed: 'La búsqueda no está disponible ahora. Aun así puedes dibujar en cualquier parte del mapa.',
  searching: 'Buscando…',
  searchClear: 'Limpiar',

  segment: 'Tramo',
  snapVertex: 'Ajustado a una esquina',
  snapEdge: 'Ajustado a un borde',
  snapLine: 'Ajustado a una calle',
  snapFree: 'Punto libre',

  'issue.too-few-vertices': 'Un área necesita al menos tres esquinas que encierren terreno.',
  'issue.self-intersection': 'El borde se cruza consigo mismo. Mueve una esquina o quita la última.',
  'issue.overlap': 'Las áreas no se pueden encimar. Se deshizo el cambio.',
  'issue.clipped': 'El área nueva se recortó al terreno libre; ahora comparte el borde con sus vecinas.',
  'issue.clipped-split': 'El terreno libre quedó en varios pedazos; se conservó el más grande.',
  'issue.clipped-away': 'El área nueva queda completamente dentro de áreas existentes.',
  'issue.hole-outside': 'Un hueco debe quedar dentro de su área.',
  'issue.cut-missed': 'La línea debe atravesar un área de lado a lado.',
  'issue.cut-crosses-hole': 'La línea no puede pasar por un hueco.',
  'issue.not-adjacent': 'Solo se pueden unir áreas que comparten un borde.',
  'issue.locked': 'Esta área está bloqueada.',
  'issue.pinned': 'Esta esquina o borde se comparte con un área bloqueada, así que no se mueve.',
  'issue.route-fallback': 'Ninguna ruta por calles cercana a esa línea une esos puntos; se usó una recta.',
  'issue.import-skipped': 'No se pudieron importar {n} figuras (no son polígonos o no son válidas).',
  'issue.invalid-coordinates': 'Esas coordenadas no son válidas.',
  dismiss: 'Cerrar',
}

export const builtinMessages: Messages = { en, es }

export type TFn = (key: string, params?: Record<string, unknown>) => string

function interpolate(s: string, params?: Record<string, unknown>): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`))
}

function mergeMessages(over?: Messages): Messages {
  if (!over) return builtinMessages
  const merged: Messages = { ...builtinMessages }
  for (const locale of Object.keys(over))
    merged[locale] = { ...(builtinMessages[locale] ?? {}), ...over[locale] }
  return merged
}

/** "es-MX" → "es" when only the language has a table. */
function tableFor(messages: Messages, locale: string): MessageTable | undefined {
  return messages[locale] ?? messages[locale.split('-')[0]!]
}

/**
 * Translation for one editor. Called by `usePolygonEditor`, which hands `t`
 * and the active locale to the parts through its context.
 */
export function createEditorI18n(
  getLocale: () => string | undefined,
  getMessages: () => Messages | undefined,
) {
  const instance = getCurrentInstance()
  // vue-i18n (any mode) exposes the global composer as `$i18n` with a `locale` that is a ref or a string.
  const hostI18n = instance?.appContext.config.globalProperties.$i18n as { locale?: unknown } | undefined
  const hostLocale = () => {
    const l = hostI18n?.locale as { value?: unknown } | string | undefined
    return typeof l === 'string' ? l : typeof l?.value === 'string' ? l.value : undefined
  }
  const active = computed(() => getLocale() ?? hostLocale() ?? 'en')
  const messages = computed(() => mergeMessages(getMessages()))
  const t: TFn = (key, params) => {
    const table = messages.value
    const s = tableFor(table, active.value)?.[key] ?? table.en?.[key] ?? key
    return interpolate(s, params)
  }
  return { t, locale: () => active.value }
}
