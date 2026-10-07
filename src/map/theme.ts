/**
 * Map colours. MapLibre paints with concrete colours, not CSS variables, so
 * the binding reads the `--pe-*` custom properties once (and again on
 * `refreshTheme()`) and resolves each to `rgba()`. Resolving through a canvas
 * means any CSS colour works — hex, `hsl()`, `oklch()`, a named colour.
 */
export interface MapTheme {
  /** Area palette; an area with a `color` property uses that instead. */
  areas: string[]
  primary: string
  vertexFill: string
  draft: string
  cut: string
  snapArea: string
  snapStreet: string
  locked: string
  pin: string
}

export const DEFAULT_THEME: MapTheme = {
  areas: ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d'],
  primary: '#4f46e5',
  vertexFill: '#ffffff',
  draft: '#0284c7',
  cut: '#ea580c',
  snapArea: '#4f46e5',
  snapStreet: '#0d9488',
  locked: '#64748b',
  pin: '#dc2626',
}

let probe: CanvasRenderingContext2D | null | undefined

/** Any CSS colour → `rgba(r, g, b, a)`, or `null` when the browser cannot parse it. */
export function resolveColor(css: string): string | null {
  const value = css.trim()
  if (!value) return null
  if (probe === undefined) {
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
    probe = canvas?.getContext('2d', { willReadFrequently: true }) ?? null
  }
  if (!probe) return value
  probe.clearRect(0, 0, 1, 1)
  // An unparseable value leaves fillStyle unchanged; a sentinel detects that.
  probe.fillStyle = '#010203'
  probe.fillStyle = value
  if (probe.fillStyle === '#010203' && value.toLowerCase() !== '#010203') return null
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  return `rgba(${r}, ${g}, ${b}, ${Math.round(((a ?? 255) / 255) * 1000) / 1000})`
}

/** Read the theme from the custom properties visible on `element`. */
export function readTheme(element: Element): MapTheme {
  const style = getComputedStyle(element)
  const read = (name: string, fallback: string) => resolveColor(style.getPropertyValue(name)) ?? fallback
  const areas = DEFAULT_THEME.areas.map((fallback, i) => read(`--pe-area-${i + 1}`, fallback))
  return {
    areas,
    primary: read('--pe-map-primary', DEFAULT_THEME.primary),
    vertexFill: read('--pe-map-vertex', DEFAULT_THEME.vertexFill),
    draft: read('--pe-map-draft', DEFAULT_THEME.draft),
    cut: read('--pe-map-cut', DEFAULT_THEME.cut),
    snapArea: read('--pe-map-snap-area', DEFAULT_THEME.snapArea),
    snapStreet: read('--pe-map-snap-street', DEFAULT_THEME.snapStreet),
    locked: read('--pe-map-locked', DEFAULT_THEME.locked),
    pin: read('--pe-map-pin', DEFAULT_THEME.pin),
  }
}
