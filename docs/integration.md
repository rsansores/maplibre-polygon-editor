# Integration guide

Everything a host application needs to embed the editor, from the one-line component to driving
the core from your own code. If you only read one section, read
[Storing areas on a server](#storing-areas-on-a-server): it is where most integrations go wrong.

- [The data model](#the-data-model)
- [The ready-made component](#the-ready-made-component)
- [Your own layout](#your-own-layout)
- [Your own map](#your-own-map)
- [Basemaps: any style, or your own tiles](#basemaps-any-style-or-your-own-tiles)
- [Snapping to streets](#snapping-to-streets)
- [Search and routing services](#search-and-routing-services)
- [Locked areas and read-only mode](#locked-areas-and-read-only-mode)
- [Theming](#theming)
- [Internationalization](#internationalization)
- [Keyboard](#keyboard)
- [Issues: what the editor refuses, and why](#issues-what-the-editor-refuses-and-why)
- [Storing areas on a server](#storing-areas-on-a-server)
- [Without Vue](#without-vue)
- [Limits and roadmap](#limits-and-roadmap)

## The data model

```ts
type Position = [lng: number, lat: number] // WGS 84 degrees, GeoJSON order

interface Area {
  id: string // stable; the editor never changes it
  rings: Position[][] // [outer, ...holes], OPEN: the first vertex is not repeated
  properties: Record<string, unknown> // yours; `name` and `color` are read for display
  locked?: boolean // drawn and snapped to, never edited
}
```

The editor works on a private copy of what you give it and hands back a **new array after every
edit** — it never mutates your objects, and every value it emits can be kept (for undo in your own
app, for diffing, for sending to a server).

Rings are open because every operation on a vertex would otherwise have to keep a duplicate in step
with its twin. GeoJSON closes rings; convert at the boundary:

```ts
import { toFeatureCollection, fromGeoJSON } from 'maplibre-polygon-editor'

const geojson = toFeatureCollection(areas) // closed rings, RFC 7946 winding, id → feature.id
const { areas, skipped } = fromGeoJSON(geojson, () => crypto.randomUUID())
```

A `MultiPolygon` becomes one area per polygon (`id-1`, `id-2`, …): an area is one connected piece
of ground, which is what makes "the area this point is in" a single answer.

## The ready-made component

```vue
<PolygonEditor
  v-model="areas"
  :map-style="styleUrlOrObject"
  :center="[-100.39, 20.59]"
  :zoom="13"
  :snap-layers="streetLayers"
  :geocoder="geocoder"
  :router="router"
  overlap="clip"
  @ready="(map) => {}"
/>
```

The component fills its parent; give the parent a height. Below `narrowWidth` (720 px of _its own_
width, not the window's) the side panel moves under the map.

| Prop             | Type                            | Default                             | Purpose                                                                                     |
| ---------------- | ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `v-model`        | `Area[]`                        | `[]`                                | The areas. Replaced on every edit.                                                          |
| `mapStyle`       | `string \| StyleSpecification`  | —                                   | Any MapLibre style. Reactive: changing it swaps the basemap and keeps the areas.            |
| `center`, `zoom` | `Position`, `number`            | whole world                         | Initial camera. Ignored when there are areas to fit (see `fitAreas` on `PolygonEditorMap`). |
| `mapOptions`     | `Partial<MapOptions>`           | —                                   | Anything else MapLibre takes (`maxBounds`, `minZoom`, `hash`, …).                           |
| `snapLayers`     | `string[] \| (map) => string[]` | none                                | Basemap layers whose lines attract the cursor. [More](#snapping-to-streets).                |
| `geocoder`       | `Geocoder \| null`              | `null`                              | Place search. Pasted coordinates work without one.                                          |
| `router`         | `Router \| null`                | `null`                              | Replaces the built-in street following with your own service.                               |
| `overlap`        | `'clip' \| 'forbid' \| 'allow'` | `'clip'`                            | What a new drawing over an existing area does.                                              |
| `lockedOverlap`  | `'clip' \| 'forbid'`            | `'clip'`                            | Overlaps with a locked area follow `overlap`, or are refused (`forbid`).                    |
| `decimals`       | `number`                        | `8`                                 | Coordinate precision (8 ≈ 1.1 mm). Fixed at creation.                                       |
| `readonly`       | `boolean`                       | `false`                             | Show and select only.                                                                       |
| `locale`         | `string`                        | host's `vue-i18n` locale, else `en` | UI language.                                                                                |
| `messages`       | `Messages`                      | —                                   | Override or add strings.                                                                    |
| `listed`         | `(area: Area) => boolean`       | every area                          | Which areas the side panel lists; the others stay on the map.                               |
| `files`          | `boolean`                       | `true`                              | Show the import/export buttons.                                                             |
| `narrowWidth`    | `number`                        | `720`                               | Width below which the panel goes under the map.                                             |

| Event               | Payload                                       |
| ------------------- | --------------------------------------------- |
| `update:modelValue` | `Area[]` after every edit                     |
| `ready`             | the MapLibre `Map`, once its style has loaded |

The component exposes `editor` (the context described next) through a template ref.

## Your own layout

`PolygonEditor` is one layout over a headless core. When your app has its own design system,
build the layout yourself: call `usePolygonEditor()` in your component and place the connected
parts wherever they belong. Each part finds the editor through `provide`/`inject`, carries the theme
tokens itself, and works inside a drawer or a teleported sheet.

```vue
<script setup lang="ts">
import {
  usePolygonEditor,
  PolygonEditorMap,
  PolygonEditorAreaList,
  PolygonEditorInspector,
  type Area,
} from 'maplibre-polygon-editor'

const areas = defineModel<Area[]>({ required: true })
const editor = usePolygonEditor({
  modelValue: areas,
  onUpdate: (next) => (areas.value = next),
  snapLayers: ['road_minor', 'road_major'],
})
</script>

<template>
  <MyToolbar>
    <MyButton :pressed="editor.state.value.mode === 'draw'" @click="editor.setMode('draw')">Draw</MyButton>
    <MyButton :disabled="!editor.state.value.canUndo" @click="editor.undo()">Undo</MyButton>
  </MyToolbar>
  <PolygonEditorMap :map-style="style" />
  <MySheet><PolygonEditorAreaList /><PolygonEditorInspector /></MySheet>
</template>
```

| Part                     | What it is                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PolygonEditorMap`       | Creates a MapLibre map, attaches the editor, draws the overlays. Props: `mapStyle`, `center`, `zoom`, `fitAreas` (default `true`), `mapOptions`, `controls`. |
| `PolygonEditorOverlays`  | The hint, the measurement readout and the message toast, positioned over a map. Included in `PolygonEditorMap`; place it yourself over a map you own.        |
| `PolygonEditorToolbar`   | Modes, undo/redo, the snapping/tracing/routing toggles, fit, import/export.                                                                                  |
| `PolygonEditorAreaList`  | Every area with its colour and size (only those `listed` accepts); click selects, double-click zooms.                                                        |
| `PolygonEditorInspector` | The selected area (name, size, perimeter, merge, delete) and the selected corner (exact coordinates).                                                        |
| `PolygonEditorSearch`    | Place search and coordinate parsing; while drawing, a result can be added as a corner.                                                                       |

`usePolygonEditor(options)` returns the context the parts use. Everything a toolbar, a menu or a
form needs is on it:

| Member                                                                                     |                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                                                                                    | `ShallowRef<EditorState>`: `areas`, `mode`, `selectedId`, `selectedVertex`, `draft`, `pending`, `snapping`, `tracing`, `followRoads`, `canUndo`, `canRedo`, `readonly`. |
| `areas`, `selectedArea`, `selectedVertex`                                                  | Computed views of the state. `selectedVertex` includes its `position` and how many other areas share it.                                                                |
| `issue`, `issueMessage`, `dismissIssue()`                                                  | The last refusal or adjustment, raw and translated.                                                                                                                     |
| `hint`                                                                                     | What the user should do next, translated.                                                                                                                               |
| `cursor`                                                                                   | Position, snap kind and current segment length under the cursor.                                                                                                        |
| `setMode(mode)`, `finish()`, `cancel()`, `undo()`, `redo()`                                | Drawing and history.                                                                                                                                                    |
| `setSnapping(on)`, `setTracing(on)`, `setFollowRoads(on)`                                  | Helper toggles.                                                                                                                                                         |
| `select(id)`, `rename(id, name)`, `deleteArea(id)`, `merge(id, otherId)`, `neighbours(id)` | Whole areas.                                                                                                                                                            |
| `setVertexPosition(position)`, `deleteVertex()`, `addPoint(position)`                      | Exact edits. `addPoint` adds a corner to the current drawing.                                                                                                           |
| `metrics(area)`, `nameOf(area)`, `listed(area)`                                            | Area (m²), perimeter (m), corner count; display name; whether the area list shows it.                                                                                   |
| `goTo(position, bbox?)`, `clearPin()`, `fitAll()`, `fitArea(id)`                           | Camera.                                                                                                                                                                 |
| `importFile(file)`, `exportGeoJSON(filename?)`, `toGeoJSON()`                              | Files.                                                                                                                                                                  |
| `attach(map, options?)`, `detach()`, `binding`                                             | Connect your own map (next section).                                                                                                                                    |
| `core`                                                                                     | The framework-agnostic `PolygonEditorCore`, for anything not wrapped here.                                                                                              |
| `t`, `locale()`                                                                            | The editor's translations, for your own labels.                                                                                                                         |

The demo at `?layout=custom` is a working example.

## Your own map

If your app already creates and owns MapLibre maps (one map component for the whole app, one tile
provider), skip `PolygonEditorMap` and attach the editor to your map:

```ts
const editor = usePolygonEditor({ modelValue: areas, onUpdate: (a) => (areas.value = a) })

onMapReady((map) => {
  editor.attach(map, { snapLayers: (m) => myStreetLayers(m), snapTolerancePx: 12 })
})
onBeforeUnmount(() => editor.detach())
```

```vue
<div class="my-map-frame" style="position: relative">
  <MyMap @ready="onMapReady" />
  <PolygonEditorOverlays />
</div>
```

The binding only adds GeoJSON sources and layers prefixed `pe-` (configurable with `prefix`) and
removes them on `detach()`. If you swap the map's style, the binding re-adds its layers on its own.

## Basemaps: any style, or your own tiles

The editor draws on whatever MapLibre style you give it — a hosted provider's style URL, your own
style JSON, raster or vector. Nothing in the editor depends on the basemap: it is the backdrop and,
optionally, the source of street lines to snap to.

**Self-hosting a country with no tile server.** The demo's approach scales to production. A
[PMTiles](https://docs.protomaps.com/pmtiles/) file is a whole tile set in one archive that the
browser reads in small HTTP range requests — any static host or object store serves it.

```bash
# One command: cut a country out of the Protomaps daily OpenStreetMap build.
pmtiles extract https://build.protomaps.com/20261006.pmtiles country.pmtiles \
  --bbox=-118.6,14.3,-86.5,32.8 --maxzoom=15        # use --region=country.geojson for a tight border
```

For reference, a city is a few megabytes and Mexico at street zoom is about 2.7 GB. Serve the file
with CORS and `Accept-Ranges` enabled, register the protocol, and build a style:

```ts
import { addProtocol } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'

addProtocol('pmtiles', new Protocol().tile)

const style = {
  version: 8,
  glyphs: 'https://your.host/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://your.host/sprites/light',
  sources: {
    protomaps: {
      type: 'vector',
      url: 'pmtiles://https://your.host/country.pmtiles',
      attribution: '© OpenStreetMap',
    },
  },
  layers: layers('protomaps', namedFlavor('light'), { lang: 'es' }),
}
```

`scripts/fetch-demo-data.sh` in this repository does exactly this for the demo, including the fonts
and sprites; read it as a recipe.

**One provider for the whole app.** Treat the style as configuration: resolve it once (from your
backend's runtime config, say) and give the same style to every map in your app, the editor's
included. Switching provider is then a configuration change.

## Snapping to streets

`snapLayers` names the basemap layers whose lines attract the cursor. Layer ids differ between
styles, so pass a function when you support several:

```ts
// Protomaps basemaps: the road lines, without casings, labels and rails.
const streetLayers = (map) =>
  map
    .getStyle()
    .layers.filter(
      (l) => l.type === 'line' && /^roads_/.test(l.id) && !/casing|rail|runway|taxiway/.test(l.id),
    )
    .map((l) => l.id)

// OpenMapTiles-based styles (MapTiler and others): the `transportation` source layer.
const omtStreets = (map) =>
  map
    .getStyle()
    .layers.filter((l) => l.type === 'line' && 'source-layer' in l && l['source-layer'] === 'transportation')
    .map((l) => l.id)
```

Missing layer ids are skipped, so a list can be shared by several styles. Polygon layers work too
(their outlines attract), e.g. building footprints or parcels.

**Precision of street snapping.** A vector tile stores its geometry on a 4096-unit grid per tile,
which at zoom 15 is well under a metre — finer than the street centrelines are drawn in
OpenStreetMap to begin with. Snapping to a street therefore lands _on the street as the map draws
it_, which is as good as the data. Snapping to another area is exact.

Area geometry always attracts before streets: a shared border has to be exact; a street is only as
good as the map data.

## Following roads

With `snapLayers` set, the toolbar offers **Follow roads**. Between two clicks on streets the border
then follows the streets the map is drawing, with no service involved:

- **In any direction.** One-way streets and turn restrictions do not exist here: a border is not a
  car trip. (This is why a car router is the wrong tool — it loops around blocks and doubles back.)
- **As close as possible to the straight line** between the two clicks. Among street paths, the
  one that hugs the line wins over a shorter one further away; `straightness` (default 4) sets how
  strongly.
- **Never touching itself.** The path may not run along, cross or pass through the drawing so
  far. The one exception is the stretch just drawn (and, closing, the first one): a click a little
  past a corner can only be left the way it was reached, so the path may go back to the corner —
  and that retraced bit is cut from both, so the click _becomes_ the corner. Likewise a straight
  segment to a free click that would cross the stretch just drawn ends that stretch where they
  cross.
- **Clicks sit on the street.** With follow roads on, a click on a street moves onto the street as
  the path follows it (at most 4 m); a border that stepped off the street to the exact pixel and
  back would be a spike.
- **Straight across gaps.** Street crossings up to 80 m apart that no street joins — the two banks
  of a river, the two sides of a highway — may be joined by a straight line, at four times the cost
  of a street. In an ordinary grid a street is always cheaper; a long detour to a distant bridge is
  not.
- **Starting from a border.** A click on an existing area's border that lies on a street (say, an
  earlier cut along that street) joins the street network too, so a city can be cut again and
  again along its streets.
- **Off the streets, straight.** A click in a field is a straight segment, without complaint. Only
  when both clicks are on streets and no reasonable path joins them (more than `maxDetour`, 3×, the
  straight distance) is the segment straight _and_ the user told why.

Closing an area (clicking its first corner, Enter, or a double click) follows the streets back to
the first corner the same way.

The network is built from what is on screen around the two clicks, so both have to be in view —
which they are, since the user just clicked them. A segment spanning a whole city at zoom 13 takes
a few hundred milliseconds; at street zoom, a few tens.

## Search and routing services

Both are plain functions; the editor never calls a service you did not give it.
Neither is needed for following roads, above.

```ts
type Geocoder = (
  text: string,
  query: { near?: Position; language?: string; signal?: AbortSignal },
) => Promise<{ label: string; position: Position; bbox?: [w, s, e, n] }[]>

type Router = (from: Position, to: Position, signal?: AbortSignal) => Promise<Position[] | null>
```

Adapters are included for two open-source services you can run yourself from a country extract:

```ts
import { photonGeocoder, osrmRouter } from 'maplibre-polygon-editor'

const geocoder = photonGeocoder({ url: 'https://photon.example.org', bbox: [-118.6, 14.3, -86.5, 32.8] })
// Only if you need a network the basemap does not draw. Use a profile that
// ignores one-way streets (foot), never a driving one.
const router = osrmRouter({ url: 'https://osrm.example.org', profile: 'foot' })
```

A `router` replaces the built-in street following; most hosts should not pass one.

Writing your own is a few lines — for example, a geocoder that asks your backend, which in turn asks
whatever provider you pay for:

```ts
const geocoder: Geocoder = async (text, { near, signal }) => {
  const r = await fetch(`/api/places?q=${encodeURIComponent(text)}&near=${near}`, { signal })
  return (await r.json()).map((p) => ({ label: p.name, position: [p.lng, p.lat] }))
}
```

Both are optional and both fail soft. A search that errors or finds nothing says so and the map
stays fully usable. A router's route is used only when both clicks snapped to streets and the
route is plausible — no more than `maxDetour` (3×) the straight distance; otherwise the segment is
straight and the user is told why. A slow route is cancelled if the user cancels the drawing.

## Locked areas and read-only mode

Mark an area `locked: true` to show it as context: drawn dashed, selectable, snapped to and checked
against for overlaps, but never edited — for example the areas of a neighbouring region that the
current user may see but not change. A new drawing over a locked area is trimmed against it like
any other, so the new border matches the locked one exactly.

When ground under a locked area is not the user's to take at all — another owner's areas, shown for
context — set `lockedOverlap: 'forbid'`. A drawing, an edit or an import that would cover any part
of a locked area (more than `overlapToleranceM2`) is then refused with `overlap-locked` instead of
trimmed; the drawing stays on screen to be fixed, and imported areas that overlap are skipped.
Touching a locked area along a shared border is not an overlap. Overlaps with unlocked areas keep
following `overlap`, so a drawing over the user's own neighbours is still trimmed to share their
border:

```ts
usePolygonEditor({
  modelValue: areas, // the user's areas, plus another owner's with `locked: true`
  overlap: 'clip', // own neighbours: trim, share the border
  lockedOverlap: 'forbid', // locked areas: refuse
})
```

The refusal holds under every `overlap` policy, `allow` included. In the core: the `lockedOverlap`
option and `setLockedOverlapPolicy()`.

Areas shown only for context need not crowd the area list either. `listed` decides which areas
`PolygonEditorAreaList` shows; the rest stay on the map, selectable there. Reactive data the
function reads is tracked:

```ts
usePolygonEditor({
  modelValue: areas,
  lockedOverlap: 'forbid',
  listed: (area) => !area.locked, // list the user's areas only
})
```

A swatch keeps the colour the map gives the area, whatever is left out.

Corners and borders an editable area shares with a locked one are **pinned**: they cannot be
dragged, typed, deleted or split, because the locked side could not follow and the shared border
would tear. The editor says so (`pinned`) the moment the user tries; the area's other corners stay
fully editable.

`readonly` turns the whole editor into a viewer: selection, measurements and export still work.

**Permissions.** Between editing everything and editing nothing, a host can withhold the two acts
that change _which_ areas exist, for users who may reshape the areas they have but not add or
remove any:

```ts
usePolygonEditor({
  modelValue: areas,
  permissions: () => ({
    create: user.mayCreate, // draw, cut (a cut makes a new area) and import
    delete: (area) => area.properties.mine === true, // delete, or merge away
  }),
})
```

Both default to allowed. A withheld act is refused with `not-allowed`, and the parts do not offer
it: the toolbar drops _Draw_, _Cut_ and _Import_, the inspector drops _Delete_ and lists only the
neighbours that may be merged away (a merge keeps the selected area and deletes the other). Losing
`create` in the middle of a drawing drops the drawing. In the core: `permissions` in the options,
`setPermissions()`, `canDelete(id)`, and `canCreate` in the state.

## Theming

The stylesheet resolves every colour from the shadcn-style design-token names many apps already
define, with neutral fallbacks. Embedded in such an app it looks native with no configuration.

| Editor variable                                                                                                   | Reads                                                      | Used for                          |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------- |
| `--pe-bg`, `--pe-fg`, `--pe-card`                                                                                 | `--color-background`, `--color-foreground`, `--color-card` | surfaces and text                 |
| `--pe-primary`, `--pe-primary-fg`                                                                                 | `--color-primary`, `--color-primary-foreground`            | primary actions, selected corner  |
| `--pe-muted`, `--pe-muted-fg`                                                                                     | `--color-muted`, `--color-muted-foreground`                | secondary surfaces and text       |
| `--pe-accent`                                                                                                     | `--color-accent`                                           | selected list row, pressed toggle |
| `--pe-border`, `--pe-input`, `--pe-ring`                                                                          | `--color-border`, `--color-input`, `--color-ring`          | lines and focus                   |
| `--pe-danger`, `--pe-warning`                                                                                     | `--color-destructive`, `--color-warning`                   | delete, messages                  |
| `--pe-radius`                                                                                                     | `--radius`                                                 | corners                           |
| `--pe-area-1` … `--pe-area-8`                                                                                     | `--color-chart-1` … `--color-chart-8`                      | area palette                      |
| `--pe-map-draft`, `--pe-map-cut`, `--pe-map-snap-area`, `--pe-map-snap-street`, `--pe-map-locked`, `--pe-map-pin` | (fallbacks)                                                | map overlays                      |

An area with a `color` property uses that colour instead of the palette.

MapLibre paints with concrete colours, so the map binding reads the `--pe-area-*` and `--pe-map-*`
values once (any CSS colour works — `oklch()` included) and again when you call
`editor.binding.value?.refreshTheme()` — do that after switching between light and dark.

## Internationalization

English and Spanish are built in. When the host uses `vue-i18n`, the editor follows its global
locale automatically (it reads `$i18n.locale`; `vue-i18n` is not a dependency). `es-MX` falls back to
`es`. Pin a language with `locale`, and override or add strings with `messages`:

```ts
import { builtinMessages } from 'maplibre-polygon-editor'

const messages = {
  es: { areas: 'Áreas de servicio', defaultName: 'Área de servicio {n}' },
  pt: { ...builtinMessages.en, modeDraw: 'Desenhar' /* … */ },
}
```

`builtinMessages.en` lists every key. Issue messages are keyed `issue.<code>`.

## Keyboard

The map container listens when it has focus (click the map, or tab to it).

| Key                                                                                                           | Action                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| <kbd>V</kbd> / <kbd>D</kbd> / <kbd>C</kbd>                                                                    | Select / Draw / Cut mode                                                            |
| <kbd>Enter</kbd>                                                                                              | Finish the drawing or the cut                                                       |
| <kbd>Esc</kbd>                                                                                                | Cancel a drag, then the drawing, then the corner selection, then the area selection |
| <kbd>Backspace</kbd> / <kbd>Delete</kbd>                                                                      | Remove the last corner of the drawing, or delete the selected corner                |
| <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Undo, redo                                                                          |
| hold <kbd>Alt</kbd>                                                                                           | Place or drop a corner without snapping                                             |

## Issues: what the editor refuses, and why

Every refusal or adjustment is an `issue` event (and `editor.issue` in Vue) with a code; the built-in
messages cover all of them.

| Code                  | When                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `too-few-vertices`    | A ring would have fewer than three corners or enclose nothing.                 |
| `self-intersection`   | A border would cross or touch itself.                                          |
| `overlap`             | An edit would make two areas overlap (policy `clip` or `forbid`).              |
| `overlap-locked`      | A drawing, edit or import over a locked area (`lockedOverlap: 'forbid'`).      |
| `clipped`             | A new drawing was trimmed to the free ground. Informational.                   |
| `clipped-split`       | The free ground was in several pieces; the largest was kept.                   |
| `clipped-away`        | The drawing lies entirely inside existing areas.                               |
| `hole-outside`        | A hole would leave its area.                                                   |
| `cut-missed`          | A cut line does not cross an area from side to side.                           |
| `cut-crosses-hole`    | A cut line passes through a hole.                                              |
| `not-adjacent`        | A merge between areas that share no border.                                    |
| `locked`              | An edit on a locked area.                                                      |
| `not-allowed`         | A draw, cut, import, delete or merge the host's `permissions` withhold.        |
| `pinned`              | A move, deletion or insertion on a corner or border shared with a locked area. |
| `route-fallback`      | "Follow roads" found no street path near the line; the segment is straight.    |
| `import-skipped`      | Shapes in an import that are not valid polygons (`count` says how many).       |
| `invalid-coordinates` | Typed coordinates outside the valid range.                                     |

## Storing areas on a server

**Store the geometry as GeoJSON-compatible polygons in WGS 84** (in PostGIS:
`geometry(Polygon, 4326)`). The editor's output goes straight in:

```sql
INSERT INTO areas (id, name, geom)
VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326));  -- $3 = toFeature(area).geometry
```

**Validate on the server too.** The browser is not a trust boundary. The editor's rules are the
OGC simple-polygon rules plus "no overlap", so the server checks are:

```sql
-- Valid shape (the same rules the editor enforces).
SELECT ST_IsValid(geom) FROM ...;

-- No overlap with another area of the same set. Touching along a border is
-- allowed; covering shared ground is not. A tolerance absorbs floating-point noise.
SELECT other.id
FROM areas other
WHERE other.set_id = $set AND other.id <> $id
  AND ST_Intersects(other.geom, $geom)
  AND ST_Area(ST_Intersection(other.geom, $geom)::geography) > 0.01;  -- m²
```

Because shared borders hold _identical_ vertices, two neighbours relate as `ST_Touches` — never
`ST_Overlaps` — and the area of their intersection is exactly zero. If your server sees slivers,
something between the editor and the database changed the coordinates (a float column with less
precision, a reprojection, a simplification). Keep at least as many decimals as `decimals`.

**Decide what a point on a border belongs to.** With exactly shared borders, a point _on_ the
border (an address geocoded to the street centreline, say) is covered by both neighbours:
`ST_Covers` is true for both, `ST_Contains` for neither. Pick a rule and make it explicit — for
example the first match by a stable order:

```sql
SELECT id FROM areas WHERE set_id = $set AND ST_Covers(geom, $point) ORDER BY id LIMIT 1;
```

**Ids.** The editor creates ids with `crypto.randomUUID()` unless you pass `createId`. Use your
database's ids if you prefer (`createId: () => myUuidV7()`), or treat a new id as provisional and
map it on save.

**Saving a set.** An edit can change several areas at once (moving a shared corner changes every
area holding it; a cut changes one and creates another). Save the whole set, or diff the emitted
array against the previous one by object identity — unchanged areas are the _same objects_ from one
emission to the next.

## Without Vue

The core and the map binding have no Vue dependency (`maplibre-polygon-editor/core`):

```ts
import { Map } from 'maplibre-gl'
import { PolygonEditorCore, MapBinding } from 'maplibre-polygon-editor/core'

const map = new Map({ container: 'map', style: STYLE_URL })
const editor = new PolygonEditorCore({ decimals: 8, overlap: 'clip' })
editor.setAreas(loadedAreas)
editor.on('change', (areas) => save(areas))
editor.on('issue', (issue) => toast(issue.code))
editor.on('state', (state) => renderMyToolbar(state))

const binding = new MapBinding(map, editor, { snapLayers: ['road'], theme: { primary: '#0a84ff' } })

document.querySelector('#draw').addEventListener('click', () => editor.setMode('draw'))
```

`PolygonEditorCore` is also how you drive the editor from a test or a script — every user action
(`addPoint`, `finish`, `beginDrag` / `dragTo` / `endDrag`, `setVertex`, `mergeAreas`, …) is a method
on it, and none of them touch the DOM. Without the Vue parts, import nothing from the stylesheet and
style your own controls; pass `theme` to the binding for the map colours.

## Limits and roadmap

- An area is one polygon. Holes are kept, edited and validated, but there is no tool yet to _draw_
  a hole; import one or cut it in from GeoJSON.
- Gap detection (highlighting ground inside a region that no area covers) needs the region's
  boundary; it is planned as an optional `bounds` polygon.
- Large sets: every edit validates only the areas it changed, against neighbours whose bounding
  boxes touch theirs. Thousands of areas with hundreds of corners each are fine; tens of thousands
  of corners in a single area will make overlap checks noticeable.
