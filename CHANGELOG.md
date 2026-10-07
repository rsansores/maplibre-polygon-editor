# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- `PolygonEditorCore`: a framework-agnostic editor for sets of polygons whose shared borders stay
  shared — draw, cut, merge, drag, insert and delete corners, typed coordinates, undo/redo.
- Snapping to corners, borders and basemap streets; tracing along a border or street between two
  clicks; optional routing along the road network with a plausibility check.
- Overlap policies (`clip`, `forbid`, `allow`), OGC validity rules, locked areas whose shared corners
  and borders are pinned.
- `MapBinding` for MapLibre GL JS 5 and 6.
- Vue 3: `PolygonEditor`, the headless `usePolygonEditor` composable and connected parts (map,
  overlays, toolbar, area list, inspector, search).
- GeoJSON and KML import, GeoJSON export; coordinate parsing (decimal, DMS, `geo:` URIs).
- Photon geocoder and OSRM router adapters.
- English and Spanish; theming through shadcn-style design tokens.
