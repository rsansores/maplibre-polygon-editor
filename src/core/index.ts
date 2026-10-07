// Framework-agnostic entry point: `maplibre-polygon-editor/core`.
// Everything here runs without Vue; the map binding needs only maplibre-gl.
export { PolygonEditorCore } from './editor'
export type {
  DraftPoint,
  EditorEvents,
  EditorOptions,
  EditorState,
  LockedOverlapPolicy,
  Mode,
  OverlapPolicy,
  Permissions,
  StreetSource,
} from './editor'
export { MapBinding } from '../map/binding'
export type { MapBindingOptions, MapTheme } from '../map/binding'

export type { Area, EdgeRef, Issue, IssueCode, Position, Ring, ScreenPoint, VertexRef } from './types'
export type { SnapContext, SnapKind, SnapResult } from './snap'
export type { Router } from './trace'

export { snap } from './snap'
export { traceAlongAreas, traceAlongLine, routeBetween } from './trace'
export { splitPolygon } from './split'
export { streetPath } from './streets'
export type { StreetPathOptions, StreetPathResult } from './streets'
export { linkedVertices, moveVertex, insertVertex, removeVertex, nodeAreas } from './topology'
export { polygonIssues, findOverlap, ringSelfIntersects } from './validate'
export { overlapArea, subtract, unite, intersect } from './clip'
export {
  distance,
  pathLength,
  ringLength,
  ringArea,
  polygonArea,
  pointInPolygon,
  bounds,
  roundPosition,
} from './geo'
export { toFeature, toFeatureCollection, fromGeoJSON } from './geojson'
export type { ImportResult } from './geojson'
export { fromKML } from './kml'
export { parseCoordinates } from './coordinates'
export { formatArea, formatLength } from './format'

export { photonGeocoder } from '../adapters/geocoding'
export type { Geocoder, GeocodeQuery, GeocodeResult, PhotonOptions } from '../adapters/geocoding'
export { osrmRouter } from '../adapters/routing'
export type { OsrmOptions } from '../adapters/routing'
