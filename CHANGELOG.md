# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- "Follow roads" without a routing service: the border follows the streets the map is drawing, in
  any direction, as close as possible to the straight line between two clicks, never doubling back
  over the drawing, and crossing rivers or highways straight when the nearest bridge is far. Clicks
  on an earlier border that lies on a street join the network, so a city can be cut again and again
  along its streets; closing an area follows the streets back to its first corner. The border never
  touches itself: a click a little past a corner becomes the corner, and clicks sit on the street
  the path follows.
- `PolygonEditorCore`: a framework-agnostic editor for sets of polygons whose shared borders stay
  shared — draw, cut, merge, drag, insert and delete corners, typed coordinates, undo/redo.
- Snapping to corners, borders and basemap streets; tracing along a border or street between two
  clicks; an optional custom router in place of the built-in street following.
- Overlap policies (`clip`, `forbid`, `allow`), OGC validity rules, locked areas whose shared corners
  and borders are pinned.
- `MapBinding` for MapLibre GL JS 5 and 6.
- Vue 3: `PolygonEditor`, the headless `usePolygonEditor` composable and connected parts (map,
  overlays, toolbar, area list, inspector, search).
- GeoJSON and KML import, GeoJSON export; coordinate parsing (decimal, DMS, `geo:` URIs).
- Photon geocoder and OSRM router adapters.
- English and Spanish; theming through shadcn-style design tokens.
