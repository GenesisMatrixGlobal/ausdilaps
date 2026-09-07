# Measure tab (Markup and Measure · SMK)

Measure lengths and areas straight off a live aerial map. Third tab of the
`site-markups` tool, alongside Building Markup and Road Markup.

`/staff/estimators/tools/site-markups` · `/staff/projects/tools/site-markups`

---

## What it is, and why it isn't the Building Markup tab

Building Markup and Road Markup are a Google **Static Maps** PNG fetched server-side
with an SVG overlay drawn on top. There is no panning at all, and the zoom control
re-fetches the image. That is the right architecture for what those tabs produce — a fixed,
reproducible export that gets baked to PNG and pushed into Box — and the wrong one for
measuring, which needs to roam freely.

So Measure is a real **Maps JavaScript API** map. Everything Residential carries for the
sake of its export is deliberately absent: no cadastre lookup, no lot ticking, no legend
colours, no Generate/Regenerate step, no PNG, no Salesforce sync, no persistence. Click,
read the number, move on.

**What it shares:** every square metre comes from the same functions
(`lib/kml/standard-markup/measure.ts` → `geometry.ts`), so a Measure figure and a
Residential exported markup agree on the same outline.

## Using it

| | |
|---|---|
| Place a point | Click the map. Nothing selected starts a new measurement; something selected extends it. |
| Move a point | Drag it. The area updates continuously, not on release. |
| Insert a point | Drag the faint midpoint handle between two points. |
| Delete a point | Right-click it. |
| Finish a shape | `Esc`, or click the selected row in the panel. The next map click starts a new measurement. |
| Undo a point | `⌫` / `Cmd+Z`, or the Undo button. |
| Switch line ↔ area | The toggle on the selected row. Points already placed carry across. |
| Line width | 3–30 m in half-metre steps. It is metres **on the ground**, not a stroke width — it re-buffers the ribbon, which changes the area. |
| Navigate | Type an address or suburb, or paste a Google Maps URL / a `-27.4698, 153.0251` pair. |
| More screen | The map's own fullscreen button, top right. |
| Export | **Download .png** — the frame you're looking at, every shape, a north arrow, and a legend of each area plus the total. |

**Line vs area.** A line is a ribbon centred on the points, half the width either side — a
frontage, kerb or footpath; its area is the ribbon, and it also reports centreline length.
An area's points *are* the boundary, and it has no width control.

**The total** is a plain sum of every measurement with enough points. Anything overlapping
is counted twice, which is nearly always what's wanted (two separate scopes) — the panel
says so rather than trying to be clever.

## Setup

One environment variable: **`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`**. Without it the tab
shows a "not configured" message and the other two tabs are unaffected.

It is a **second, separate key** from the server-side `GOOGLE_MAPS_API_KEY`. Never merge
them — the server key carries Geocoding, Directions and Static Maps quota, and Maps JS puts
its key in the client bundle by design. The protection is how the key is restricted:

1. **Enable the Maps JavaScript API** on the Cloud project. No other tool uses Maps JS, so it most likely needs turning on.
2. **Application restrictions → Websites:** exactly `https://ausdilaps.vercel.app/*`,
   `https://ausdilaps.com.au/*`, `http://localhost:3000/*`.
   ⚠️ Not `https://*.vercel.app/*` — that lets anyone's deployment spend the quota.
3. **API restrictions → Maps JavaScript API only.**
4. **A daily quota cap** (~500/day). A `Referer` header is forgeable, so the cap, not the
   referrer list, is the real cost ceiling.

**Cost:** Dynamic Maps gives 10,000 free map loads/month, then ~US$7/1,000. A "load" is one
map instantiation — panning, zooming and tiles are included. Under 50 staff this stays
inside the free tier.

---

## Architecture

### The one rule: geometry flows one way, overlay → React

Every geometry mutation — map click, vertex drag, midpoint insert, undo, clear, right-click
delete — writes into the overlay's `MVCArray`. `syncFromOverlay(id)` mirrors the result into
React state, which **only the panel reads**. React writes geometry back in exactly one
place: `createOverlay()`, before any listener is attached.

The tempting alternative is to reconcile both directions whenever they differ, guarded by a
"we're writing" ref. Don't. It fails not as an infinite loop (which a ref would catch) but
as a **stale frame**: the map is at path N+2 while React renders N, the reconcile sees "not
equal", pushes N back into the overlay, and the vertex under your finger jumps backwards.
With one direction there is nothing to guard.

Two consequences:

- **Undo and Clear are commands, not state** — "assign this array of points to that
  overlay" is an instruction. They're exposed through `useImperativeHandle` as
  `MapCommands`, which is also how the toolbar moves the camera (`goTo` / `fit`).
- **The reconcile effect is keyed on a structural signature string**
  (`id:mode:width` per shape, plus the active id) — never the shapes array, which gets a
  new identity on every write. A pure geometry write leaves the string identical, so the
  effect does not even run during a drag.

Live props reach the imperative handlers through a `latest` ref, assigned in an effect
declared **first** in the component: effects run in declaration order, so it is fresh by
the time reconcile reads it. It has to be an effect rather than a render-time assignment
because the React compiler lint forbids writing a ref during render.

### The ref-mirroring pattern carries over

`measure-shapes.ts` keeps `listRef` / `activeIdRef` as synchronous mirrors, for exactly the
reason `shapes.ts` does: React batches state updates, so two clicks in one tick both
observe the pre-click `activeId`. On the Residential tab that made three fast clicks start
three separate one-point shapes. Google owning the *path* doesn't help, because the decision
of **which** shape to write into is still made from React state.

There is one window where React owns geometry: the click that *creates* a measurement, whose
overlay doesn't exist yet. That point goes into state via `appendPoint`, and
`createOverlay()` reads it back a render later — the same code path that rehydrates after a
tab switch.

### Files

| File | Role |
|---|---|
| `lib/maps/loader.ts` | Singleton-promise script loader. `v=quarterly`, and **no `libraries=`** — `geometry` would offer `spherical.computeArea`, and every number here must come from our own `ringAreaSqm`. |
| `lib/maps/parse-google-maps-url.ts` | Pure parser for pasted links and coordinate pairs. |
| `lib/kml/standard-markup/measure.ts` | Shared measurement maths, re-exported from `shapes.ts`. |
| `components/tools/site-markups/measure-tab.tsx` | Toolbar + map + floating panel. |
| `components/tools/site-markups/measure-map.tsx` | The map and all imperative overlay code. |
| `components/tools/site-markups/measure-shapes.ts` | The measurement list hook. |
| `components/tools/site-markups/measure-panel.tsx` | Total, rows, mode, width, undo/clear. |
| `components/tools/site-markups/measure-label.ts` | The on-map label `OverlayView`. |
| `app/api/maps/resolve-link/route.ts` | Resolves `maps.app.goo.gl` share links. |
| `lib/maps/measure-export.ts` | The PNG render — Static Maps + sharp composite. |
| `app/api/maps/measure-export/route.ts` | The export endpoint. |

---

## The PNG export

**Server-side out of necessity, not preference.** Maps JS serves its tiles cross-origin, so
the live map's canvas is tainted and cannot be read back — there is no client-side
screenshot of it to be had at any price. So the export is a second, independent render
through the Maps **Static** API: `getCamera()` hands the server the live centre, zoom, map
type and viewport size, and `renderMeasureExport()` rebuilds that frame, draws the shapes
as polygons, and composites a north arrow, a numbered badge per shape and a legend with
`sharp`.

Consequences worth knowing:

- **It is a re-render, not a screenshot.** Resolution is half the on-screen map's (see the
  640 cap below), and POI pins *are* suppressed here — the Static API still honours
  `style=feature:poi|visibility:off`, unlike Maps JS.
- **Numbered badges are baked in.** The Building Markup tab deliberately strips its numbered
  pins from the client download; here the numbers are the legend's key, so without them the
  legend is a list of anonymous areas.
- **Shapes export in one flat orange.** The live map's steel/orange split means
  selected-vs-not, which a still has no notion of. Orange is also what reads over grass,
  bitumen and a tin roof alike.

### Traps specific to the export

- **Static Maps caps `size` at 640 per axis; the live map is routinely 1100+ CSS px wide.**
  Coverage at a zoom is a function of size in Static Maps "points", so `fitToViewport()`
  drops a zoom level and halves the requested size until it fits — identical framing, half
  the resolution — then `scale: 2` brings the pixel output back to roughly on-screen
  dimensions.
- **`latLngToPixel` works in LOGICAL pixels** — the pre-`scale` space Static Maps' own
  `size` describes. Feed it the scaled size and every badge lands at exactly half the right
  offset from centre, which looks like a plausible-but-wrong position rather than a bug.
  Project with the logical size, then multiply by `SCALE`.
- **The glyph atlas is printable ASCII only** (`lib/kml/overlay/glyph-atlas.ts`), so `²`,
  `·` and `×` all render as `?`. `textWithSuper()` composes "m²" from a raised, smaller
  real "2". Anything new in the legend has to stay inside ASCII or get the same treatment.
- **The legend panel is sized from measured glyph widths**, never a constant. The Building
  Markup legend was once 5px from clipping its longest label, and a legend that silently
  crops a figure is worse than one that's slightly wide.
- **`centroidOf` ignores a repeated closing vertex.** It used to average it in, which
  counted the first point twice and put a triangle's badge down by its bottom vertex.

## Traps

- **`draggable: false` on every overlay; `editable` only on the SELECTED one.** On a
  pannable map, dragging a shape's fill and panning the map are the same gesture on adjacent
  pixels, so measurements would get shoved around constantly — and translating a shape
  changes neither its area nor its length, so there is nothing to gain. Whole-shape drag was
  right on the static image; here it is a liability.
- **`clickableIcons: false` is load-bearing.** A POI pin under the cursor otherwise opens an
  info window and *eats* the click meant to place a point — and hybrid over an Australian
  suburb is covered in them.
- **The overlay's own `click` handler must `e.stop()` and then place the point itself.**
  Without it you cannot add a fourth point inside the triangle you just drew: the polygon's
  fill swallows the map click. Doing the same job either way means exactly one point however
  Google propagates the event.
- **`destroy()` must `clearInstanceListeners` on the path as well as the overlay.** The
  `MVCArray` holds its own listeners; miss it and every mode toggle leaves a handler writing
  into a dead shape's slot. Read the path **before** destroying, too, or a mode switch loses
  the points already placed.
- **`renderingType: RASTER` and no `mapId`.** A `mapId` switches the map to vector, which
  silently discards the `styles` that turn POI labels off, and puts a WebGL context on the
  page. It is also what `AdvancedMarkerElement` would have required — hence the labels being
  an `OverlayView`, whose div rides inside the map's own transformed pane and therefore moves
  with the imagery for free during a pan.
- **The label subclass must be built lazily.** `class X extends google.maps.OverlayView` at
  module scope throws at import, before the API script has run.
- **`MAX_POINTS = 100` here is not the Residential tab's `MAX_SHAPE_POINTS = 20`.** That 20
  exists because its shapes are percent-encoded into a Static Maps URL with a length limit.
  Do not unify them: one of the two would break.
- **StrictMode double-mounts everything in dev, four separate ways.** The loader is immune by
  construction (one module-scope promise). `new google.maps.Map(div)` **appends** its DOM and
  never clears, so cleanup calls `container.replaceChildren()` or the second mount stacks a
  live map on a dead grey one. The load is async, so a `cancelled` flag stops the discarded
  first mount building into the div the second is about to use. And `handlesRef` survives a
  remount, so cleanup must `.clear()` it as well as destroy — a stale key would make the
  "already exists" check skip creation and leave state with no overlays.
- **A self-intersecting area is silently wrong, so it's flagged.** `ringAreaSqm` is a signed
  spherical-excess sum wrapped in `Math.abs`; a symmetrical bowtie reports the *difference*
  of its two lobes, which is **0 m²**. `ringSelfIntersects()` catches it and both the panel
  and the on-map label say so instead of printing a number.
- **`/api/maps/resolve-link` is an allowlist, not a blocklist.** It fetches a URL the client
  supplied, so: the first hop must be a Google short-link host, every redirect is revalidated
  before being followed, and **the response body is never read** — only a lat/lng parsed out
  of the final URL leaves the route.

## Not built, on purpose

- **No persistence.** Nothing is saved. Measurements survive a tab switch, not a reload.
