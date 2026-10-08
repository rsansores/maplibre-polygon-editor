# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

### Fixed

- Large sets of areas no longer make editing lag. Each polygon's bounds are remembered, and
  snapping, dragging, tracing, noding, the overlap checks and clipping skip every area too far away
  to matter; with 1 000 areas a mouse move went from ~4–13 ms to ~0.04 ms of snapping, and dropping
  a corner from 1–5 s to 20–70 ms. The map binding sends MapLibre only the sources that changed, so
  moving the cursor no longer re-tiles every area each frame, and locked areas are drawn from a
  source of their own (`pe-locked`, layer `pe-locked-fill`) that a drag or a drawing never touches.

### Added

- `SnapContext.bounds`: the longitude/latitude box around the cursor; `snap()` skips areas outside
  it. The map binding sets it.

## 0.1.0 — 2026-10-08

First release.

### Added

- `PolygonEditorCore`: a framework-agnostic editor for sets of polygons whose shared borders stay
  shared — draw, cut, merge, drag, insert and delete corners, typed coordinates, undo/redo.
- Snapping to corners, borders and basemap streets; tracing along a border or street between two
  clicks; an optional custom router in place of the built-in street following.
- "Follow roads" without a routing service: the border follows the streets the map is drawing, in
  any direction, as close as possible to the straight line between two clicks, never doubling back
  over the drawing, and crossing rivers or highways straight when the nearest bridge is far. Clicks
  on an earlier border that lies on a street join the network, so a city can be cut again and again
  along its streets; closing an area follows the streets back to its first corner. The border never
  touches itself: a click a little past a corner becomes the corner, and clicks sit on the street
  the path follows.
- Overlap policies (`clip`, `forbid`, `allow`), OGC validity rules, locked areas whose shared corners
  and borders are pinned.
- Overlap measured by thickness, not area: two areas overlap when some connected piece of their
  intersection has `2 · area / perimeter` above `overlapToleranceM` (default 1 cm), so the rounding
  sliver a border clipped onto a locked neighbour's edge leaves never counts, however long the
  border. `overlaps`, `overlapThickness` and `polygonThickness` are exported, and the integration
  guide gives the same rule in PostGIS.
- `lockedOverlap: 'forbid'`: a drawing, edit or import that would cover a locked area is refused
  with the `overlap-locked` issue instead of trimmed, while overlaps with unlocked areas keep
  following `overlap`. The default, `'clip'`, keeps locked areas under `overlap`.
- `permissions`: a host can withhold creating areas (draw, cut, import) and deleting them (delete,
  merge away) without making the editor read-only. Refused with the `not-allowed` issue; the
  toolbar and the inspector stop offering what is withheld.
- `listed`: a host can keep areas out of `PolygonEditorAreaList` while they stay on the map — e.g.
  locked areas shown only for context.
- `MapBinding` for MapLibre GL JS 5 and 6.
- Vue 3: `PolygonEditor`, the headless `usePolygonEditor` composable and connected parts (map,
  overlays, toolbar, area list, inspector, search).
- GeoJSON and KML import, GeoJSON export; coordinate parsing (decimal, DMS, `geo:` URIs).
- Photon geocoder and OSRM router adapters.
- English and Spanish, overridable per locale; theming through shadcn-style design tokens.
