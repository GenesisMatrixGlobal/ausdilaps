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
| Zoom | Normal Google behaviour — fractional, so the wheel is smooth rather than jumping a whole 2x level per notch. |
| Insert a point | Drag the faint midpoint handle between two points. |
| Delete a point | Right-click it. |
| Finish a shape | `Esc`, or click the selected row in the panel. The next map click starts a new measurement. |
| Undo a point | `⌫` / `Cmd+Z`, or the Undo button. |
| Switch line ↔ area | The toggle on the selected row. Points already placed carry across. |
| Line width | 3–30 m in half-metre steps. It is metres **on the ground**, not a stroke width — it re-buffers the ribbon, which changes the area. |
| Navigate | Type an address or suburb, or paste a Google Maps URL / a `-27.4698, 153.0251` pair. |
| More screen | The map's own fullscreen button, top right. |
| Export | **Download .png** — the frame you're looking at, every shape, a north arrow, and a compact legend: each badge number, its area, and the total. |
| Save / reopen | **Save .json** writes the measurements plus the frame they were drawn on. **Open .json** restores them and flies back to that frame, so a set can be adjusted instead of redrawn. |

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
| `lib/maps/measure-file.ts` | The .json save format, and a defensive parser for reading one back. |

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
- **A LINE's badge is nudged perpendicular to the run of the line; an AREA's stays at the
  centroid.** A ribbon's centroid sits ON the ribbon, and at any zoom wide enough to hold a
  whole road the ribbon is thinner than the badge — a real 4km-wide export had a 10m ribbon
  at 2.5 output px against a 30px badge, which erased the shape it was labelling. The badge
  is also small (12px radius) and translucent for the same reason. The nudge is skipped if
  it would push the badge out of frame, since a dropped badge leaves a legend row with
  nothing to match it to.
- **At a wide zoom Google's attribution grows a longer provider list** ("Airbus, CNES /
  Airbus, Landsat / Copernicus, Maxar Technologies, Vexcel Imaging US, Inc") and overflows
  the image width, clipping at the left. That's Google's own rendering inside the image it
  returns; nothing here controls it.
- **Shapes are one flat orange, on screen and in the export.** Selection used to swap a
  shape to steel blue, which was too dark to pick out against imagery — the shapes you
  weren't editing vanished into the photo. Selection is signalled instead by the things that
  actually mean editable: Google's vertex handles (only the selected overlay is `editable`,
  so its dots are the only ones on screen), a heavier stroke and the orange label.

### Traps specific to the export

- **The export frames from `getBounds()`, never from centre+zoom.** The live map allows
  FRACTIONAL zoom (17.5 is a real state) and Static Maps only accepts integers, so rounding
  the zoom would move the frame by up to 40% of its area. `fitToBounds()` takes the largest
  integer zoom at which the box still fits inside Static Maps' 640-per-axis cap and requests
  exactly the size the box occupies there; `scale: 2` doubles the pixel output.
- **The frame includes an `ATTRIBUTION_PAD_PX` strip of extra ground at the bottom.**
  Google draws its "Google / Map data ©… Airbus, Maxar…" bar OVER the imagery, ~30 output px
  tall at scale 2, so without the pad it occludes the bottom of the live view and swallows
  any measurement near the bottom edge. Framing extra ground is the only fix available: the
  bar scales WITH `scale`, so no size/scale combination shrinks it relative to the map, and
  cropping or shrinking it is what the Maps Platform terms forbid. The centre is shifted
  south by half the pad so the space lands at the bottom rather than being split.
- **`fitToBounds()` spends the WHOLE 640 budget** by widening the geographic frame at the
  chosen zoom until the limiting axis hits the cap. Integer zoom levels otherwise waste up to
  38% of the resolution: the zoom picked is the largest that fits, so the frame lands
  somewhere between 320 and 640 px and the rest is thrown away — a real export came out
  790x494 for want of this, and now comes out 1280x778.
  ⚠️ Note precisely what that does. The image gets bigger (up to just under 2x linearly) and
  Google's fixed-size attribution therefore covers proportionally less of it (7.1% of height
  down to 4.5%). Ground DETAIL is unchanged — same zoom, same metres per pixel — so the
  export is not *sharper*, it shows more surrounding context at the same crispness.
- **1280x1280 is a hard per-request ceiling.** Verified: `size` is silently clamped to
  640/axis and **`scale=4` is silently clamped to 2** — no error, just a smaller image than
  asked for. Genuinely finer detail needs a deeper zoom, which exceeds the cap, so it would
  mean stitching several requests and cropping Google's attribution off the inner tiles —
  considered and declined 2026-09-07 rather than take on that terms question.
- **`mercatorSpan()` computes the box centre in world-pixel space, not by averaging
  latitudes.** Mercator is non-linear in latitude, so the mean of north and south is not the
  centre of the frame, and using it shifts the export vertically against the live map.
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
- **Badge numbers are RIGHT-aligned to the label column's edge**, so the space between a
  number and its area is exactly `GAP` on every row. Left-aligning them puts that space at
  the mercy of the widest LEFT item: "Total" is 45px against a 10px "1", and with the areas
  right-aligned to the panel edge the difference showed up as 75px of dead space between
  "1" and its figure, on a panel only 162px wide.
- **The legend is badge number + area + total, and nothing else.** No title, no mode, no
  width, no length — each of those widened the panel over the very map it describes, and a
  "MEASUREMENTS" heading was on its own wider than every row. Width and length stay in the
  tool's on-screen panel. Adding a column back costs map, so weigh it.
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

- **No automatic persistence.** Nothing is written to a database or restored on reload —
  saving is an explicit **Save .json** to the operator's own disk. Deliberate: these are
  scratch measurements taken while scoping, and a silently-restored set from last week is a
  worse default than an empty map. Measurements do survive a tab switch within a session.

## The .json save file

`lib/maps/measure-file.ts`. `{ kind, version, savedAt, label, bounds, mapType, measurements }`,
where each measurement is just `{ mode, widthMetres, points }`.

- **Only geometry is stored — never a derived area or length.** A stored figure is a second
  source of truth that silently disagrees with `measureShape()` the moment the maths
  improves. Areas are always recomputed on open.
- **Ids are regenerated on open**, not trusted from the file: a duplicated id would collide
  React keys and the map's handle map.
- **`kind` is checked before anything else**, so a stray .json picked out of a folder is
  rejected with a useful message instead of loading as an empty set. A file from a *newer*
  version is refused rather than half-read.
- **A bad field drops its own shape, not the whole set** — the parser is reading a file off
  someone's disk, possibly hand-edited. It reports how many it skipped. An out-of-range
  width is clamped rather than dropped, because it still describes a real ribbon.
- **Bump `version` only for a breaking change, and keep reading the old one.** A saved file
  is someone's work; a version bump that orphans it is a data-loss bug.
