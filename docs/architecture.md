# How it works

This is the map of the code and the reasoning behind its main decisions, for contributors and for
anyone who needs to trust the geometry.

## Layers

```
 src/core/        pure TypeScript, no DOM, no map, no framework
   types.ts         the data model (Area, Position, Issue)
   geo.ts           measurements (spherical) and predicates (planar)
   clip.ts          boolean operations (polyclip-ts)
   validate.ts      the validity rules
   topology.ts      shared vertices: link, move, insert, remove, node
   snap.ts          where a click meant to land
   trace.ts         following a border, a street, or a route between two clicks
   split.ts         cutting a polygon along a line
   geojson.ts kml.ts coordinates.ts format.ts   input, output, display
   history.ts       undo/redo over immutable snapshots
   editor.ts        PolygonEditorCore: modes, selection, draft, gestures, commits
 src/map/         MapBinding: MapLibre layers + pointer/keyboard → core calls
 src/adapters/    Photon geocoder, OSRM router
 src/vue/         usePolygonEditor (reactive context) + the parts + the default layout
```

Each layer only depends on the ones above it. The core is where every rule lives, and it is tested
on its own (`src/core/*.test.ts`); the browser tests (`tests/e2e`) check that pointer and keyboard
input reach it the way a person means it.

```
 pointer / keys ──▶ MapBinding ──snap()──▶ PolygonEditorCore ──state──▶ MapBinding.render() ──▶ GeoJSON layers
                                              │      │
                                       change │      │ issue
                                              ▼      ▼
                               usePolygonEditor (v-model, toast, parts)
```

## Immutable state

Every edit produces new arrays and new objects for what changed, and keeps the old objects for what
did not. That gives three things for free:

- **undo** is keeping the previous value (`History<Area[]>`), with no inverse operations to get
  wrong;
- **a drag is a preview**: `dragTo` replaces the working value on every pointer move, and `endDrag`
  either commits it as one history entry or restores the value from before the gesture;
- **hosts can diff** by object identity: an area that did not change is the same object in the next
  emission.

## Shared borders without a planar graph

A classic topology editor stores nodes and edges and derives polygons from them. That is robust
but heavy, and it makes the data model something other than "a list of polygons", which is what
every consumer (GeoJSON, PostGIS, a tile renderer) wants.

This editor keeps the list of polygons and maintains one invariant instead:

> Where two areas share a border, they hold the **same vertices** along it, at the **same
> coordinates**.

Every operation preserves it:

| Operation                           | How the invariant holds                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drag a vertex                       | Every vertex at the same position, in any unlocked area, moves with it (`moveVertex`).                                                                                                                 |
| Insert on an edge                   | The vertex goes into every edge with the same two endpoints, in either direction (`insertVertex`).                                                                                                     |
| Delete a vertex                     | It is removed from every area holding it (`removeVertex`).                                                                                                                                             |
| Draw over a neighbour               | The drawing is clipped to the free ground; its border along the neighbour then consists of the neighbour's own vertices plus the crossing points, which are inserted into the neighbour (`nodeAreas`). |
| Drop a vertex on a neighbour's edge | The dropped vertex is inserted into that edge (`nodeAreas` after `endDrag`).                                                                                                                           |
| Cut                                 | Both pieces receive the cut path vertex for vertex; the two crossing points are inserted into any neighbour sharing the edge they fell on.                                                             |
| Merge                               | The union is noded against every other area, so a third neighbour's T-junction survives.                                                                                                               |
| Trace                               | A segment between two points on the same ring takes the ring's own vertices between them.                                                                                                              |

"The same coordinates" is made reliable by **rounding**: every coordinate the editor creates is
rounded to `decimals` places (8 by default, about 1.1 mm). Two vertices are "the same" when they
are within half a unit of that grid (`epsilon`); a vertex "lies on" an edge when it is within one
unit of it (`edgeEpsilon`), which absorbs the rounding of a computed crossing point. The neighbour's
edge bends by at most that amount when the crossing point is inserted into it — a millimetre.

## Two geometries: spherical measurement, planar topology

- **Measurements** shown to people — area, perimeter, segment length — are spherical, in metres on
  the ground (`geo.ts`: haversine distances, spherical-excess area with the same radius turf uses).
- **Topology** — does a point lie on an edge, do two segments cross, is a polygon valid — is planar
  in longitude/latitude. This is the convention of GeoJSON and of PostGIS `geometry`, so the
  editor's notion of "valid" and "on the border" is the server's. An edge between two vertices is
  the straight line between them in degrees.

## Validity

`polygonIssues` applies the OGC simple-polygon rules, so an area the editor accepts is one
`ST_IsValid` accepts:

1. every ring has three or more vertices and the outer ring encloses some area;
2. no ring crosses _or touches_ itself (a vertex resting on a non-adjacent edge is a self-touch);
3. holes do not cross the outer ring and lie inside it.

On top of that, unless the overlap policy is `allow`, no two areas may share more than
`overlapToleranceM2` (0.01 m²) of ground. Overlap is measured as the area of the intersection, so
touching along a border is zero. Checks run only for the areas an edit changed, against areas whose
bounding boxes touch theirs.

A refused edit leaves the state as it was and emits an `issue`. A draft that cannot be finished
stays on screen.

## Snapping

`snap()` works in screen pixels for "how close" and in degrees for "where". Candidates are ranked
by kind first, then distance:

1. area vertices (and the draft's own vertices, so a drawing can be closed on its first corner);
2. area edges — the snapped point is computed on the edge itself, so it lies on it exactly;
3. street vertices;
4. street lines.

Area geometry always wins over the basemap: a shared border must be exact, and a street is only as
good as the map data. Streets come from `queryRenderedFeatures` on the layers the host names, in a
small box around the cursor, on every move — no index to keep in sync with the basemap.

While a vertex is dragged, it and the edges attached to it are ignored as targets.

## Tracing and routing

When two consecutive clicks both snapped to the same ring of an area, the segment between them
takes the ring's vertices between them, the shorter way round (`traceAlongAreas`). The same for
two clicks on the same street polyline (`traceAlongLine`) — the snap result carries the line it
landed on, so tracing works even after the map has moved between clicks. Tracing area borders is
off in cut mode, where the line is meant to go _across_ an area.

With a router and "follow roads" on, two clicks on streets that cannot be traced are routed. The
route is accepted only when it is at most `maxDetour` times the straight distance; a longer one
almost always means the network is missing a connection, and the straight line is what the user
meant. A route that arrives after the drawing was cancelled is dropped (a token per draft).

## Cutting

`splitPolygon` finds where the line crosses the outer ring, sorted along the line, and takes the
first stretch that runs inside the polygon (checked at its midpoint). The two pieces are built by
walking the ring forward from the exit back to the entry, and from the entry to the exit, each
closed by the cut path. Holes go to the piece containing them; a cut through a hole is refused. The
larger piece keeps the area's id and properties.

## Rendering

The binding owns six GeoJSON sources (`pe-areas`, `pe-vertices`, `pe-midpoints`, `pe-draft`,
`pe-snap`, `pe-pin`) and re-renders them at most once per animation frame. Only the selected area's
vertices and midpoints are drawn, so a set of thousands of areas costs one polygon layer. Colours
are read from CSS custom properties and resolved to `rgba()` through a 1×1 canvas, so any CSS
colour syntax works.

## Testing

- `src/**/*.test.ts` (Vitest) — geometry, topology, snapping, tracing, cutting, import/export and
  the editor's flows driven through `PolygonEditorCore`, the way a user would: draw, close, drag,
  undo.
- `tests/e2e/*.spec.ts` (Playwright) — the demo in headless Chromium with real MapLibre (WebGL
  through SwiftShader): a click lands where it was made to the last decimal, a dragged shared corner
  moves every area, keys do what they say.
