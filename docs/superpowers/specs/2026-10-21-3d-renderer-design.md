# Cairo Civ — 3D Renderer

**Date:** 2026-10-21
**Status:** design, awaiting approval. Performance questions closed by the parity spike (steady 60fps on target hardware, including stress).

## Intent

Replace the flat 2D canvas map in `ui/index.html` with a 3D rendered world,
so the game looks like a world you are looking down on rather than tokens on
a board.

The problem being solved is stated plainly by the project owner: the current
map reads as "pawns in a game." Terrain is one flat fill color per hex and
every unit is an emoji inside a colored circle. Nothing about the picture
says what kind of place a tile is, or what kind of soldier is standing on it.

Two things were asked for specifically, and they are the bar this work is
measured against:

1. **Terrain that looks like real land.** Ground with shape to it — hills
   that bulge, mountains with rock and snow, beaches where land meets sea,
   forests made of trees rather than a tree symbol.
2. **Units you can tell apart on sight,** that are not a circle with a logo
   on it. A warrior and an archer should be distinguishable without reading
   a label.

Both were prototyped and approved before this document was written. See
**Prior art** below.

## Why now

The gameplay, the contract, and the whole action pipeline are finished and
working (579 tests passing). The remaining gap between this and something
that feels like a game you would sit down and play is almost entirely
presentation.

## Goals

- Terrain rendered as real ground: elevation, per-vertex color variation,
  blended transitions between neighbouring terrain types, beaches, animated
  water, rivers along hex edges.
- Features rendered as objects: woods as trees, rainforest as jungle, marsh
  as reed pools, oasis as palms around water.
- Each of the 6 unit types visually distinct as a small 3D model, readable at
  normal play zoom without its label.
- Cities that visibly grow: a palace, houses, walls when the Walls building
  exists, a flag in the owner's color.
- Every gameplay affordance the 2D renderer provides today survives the port
  (full list under **Parity checklist**).
- Smooth on an ordinary laptop with integrated graphics at normal play zoom.

## Non-goals

- No change to the Cairo contract, `ui/server.js`, or any game rule. This is
  a rendering change only. `src/**` and `tests/**` are not touched.
- No new art pipeline. Everything is generated in code with three.js
  primitives. No texture files, no model files, no asset loading.
- No change to the DOM UI: lobby, sidebar, top bar, action bar, tech and
  production panels, toasts, turn report, replay bar all stay exactly as they
  are.
- Not implementing ZK fog of war (`design/phase2_zk_privacy/`). The existing
  client-side fog behaviour is ported as-is, nothing more.
- No mobile or touch support beyond what falls out for free. The game is
  desktop hotseat today.

## Anti-goals

Things that would make this a failure even if it technically renders:

- **Pretty but unplayable.** If a 3D camera makes it harder to see which
  tiles are in range, which unit is selected, or where a city's worked tiles
  are, the port has failed regardless of how the terrain looks. Readability
  of game state beats visual richness at every decision point.
- **Stutter.** A map that runs at 25fps on the owner's laptop is worse than
  the flat map that runs instantly. Frame rate is a correctness requirement,
  not a nice-to-have.
- **A second renderer to maintain.** The 2D main-map renderer is deleted, not
  kept behind a flag. (Decided by the owner; see **Decisions made**.)
- **A rewrite that breaks the game.** The action pipeline, optimistic
  updates, and validation currently work. If the port destabilises them, the
  work was not worth doing.

## Prior art

Two working prototypes exist and were approved. They are the visual and
performance reference for this work.

| Prototype | What it establishes |
|---|---|
| `civ3d-preview.html` — https://claude.ai/artifact/DZ3cxaAcjsq678R2rEaJw1 | The art direction. A 16×11 hand-built map with all terrain types, all features, 6 unit types as animated models, 2 cities, animals, improvements, a river, a fishing boat. |
| `civ3d-fullmap.html` — https://claude.ai/artifact/SjL5ji6stkUcW7WzUAkAFG | That same art at the real 32×20 / 640-tile map size, with the optimizations applied, plus a live frame-rate and draw-call readout. |

Both source files are in this session's scratchpad. **They are throwaway
spikes**, not the implementation. They prove the look and the performance
approach; the production renderer is written fresh against the real game
state, borrowing their geometry and color functions where useful.

### Measured on the full-size prototype

Measured in headless Chrome (software rendering, so draw calls and triangles
are real; frame rate from that run is meaningless and was not used).

| | Naive (preview, scaled to 640 tiles) | Optimized (full-map prototype) |
|---|---|---|
| Scene objects | ~7,000 estimated | **700** |
| Draw calls, normal play zoom | ~4,000 estimated | **277** |
| Draw calls, whole map on screen | ~4,000 estimated | **700** |
| Triangles | — | 162k play / 193k whole map |

The optimized numbers sit comfortably inside what integrated graphics handles
at 60fps. Triangle count was never the constraint; object count was.

### Measured on real hardware

The owner ran the full-map prototype and reported **a steady 60fps, with two
momentary dips to 56fps**. That is the target machine, and the result clears
the bar comfortably.

This settles two things. The quality setting (performance plan #5) is a
polish item for weaker machines, not the constraint the renderer has to be
designed around. And there is genuine headroom above the prototype's numbers
for the gameplay layer that has not been measured yet.

It does **not** settle whether the finished renderer holds 60fps, because
what was measured renders none of the gameplay layer. See the budget note
below. The parity spike stays in the plan.

## Constraints

- **Stack:** three.js r128 via cdnjs, loaded with a `<script>` tag, plus
  `OrbitControls` from the matching jsDelivr path. No build step, no bundler,
  no npm dependency added to `ui/package.json`. This matches how the project
  already works: `ui/index.html` is a single hand-written file with no build.
- **Single file.** `ui/index.html` is the whole UI today and that stays true.
  It is already ~4,020 lines and will grow substantially.
- **No network access for assets.** The game runs against a local Katana
  devnet; the renderer must not depend on anything but the two CDN scripts.
- **Hex geometry must not change.** The contract and all game logic use
  flat-top hexes in odd-q offset coordinates, with odd columns shifted down.
  Vertex 0 is due east, and edge *i* runs from vertex *i* to vertex
  *(i+1) % 6*. River edge bitmasks from the contract depend on this exactly.
  `hexCenter()` (index.html:1300) and the edge-neighbour tables
  (index.html:1360–1386) are load-bearing and their conventions carry over
  unchanged.

## The 2D renderer being replaced

A full inventory was taken. The relevant findings that shape this design:

- There are exactly **two** canvas contexts. Every 2D draw call in the file
  lives inside either `drawMap()` (1471–2089) or `drawMinimap()` (3228–3271).
- `drawMap()` is monolithic — terrain, territory, fog, overlays, cities,
  units, and all animation rendering in one 600-line function.
- **Rendering is event-driven, not looped.** `drawMap()` is called
  synchronously from about 30 sites. `animLoop` runs a rAF loop only while
  animations are active.
- `pixelToHex()` (1311–1320) is a brute-force nearest-centre scan over all
  640 tiles, run on every mouse move.
- Mouse listeners are on `#map-area` and `window`, **not** on the canvas
  element.
- Every icon is an emoji drawn with `fillText`. None of them port to 3D.
- Animations store **world pixel coordinates captured at creation time**,
  which couples the animation data model to the 2D coordinate frame.
- `resizeCanvas()` is called from a non-obvious place: `openPanel` and
  `closePanel` via `setTimeout(..., 50)`, because opening the right panel
  changes the map area's width.
- There is **no** `devicePixelRatio` handling today, so the map is blurry on
  HiDPI screens. The 3D renderer fixes this for free.

## Decisions made

These were decided by the project owner or by the author of this document, as
marked. Everything else is the builder's.

1. **The 3D view replaces the 2D main map entirely.** *(Owner's decision,
   asked and answered directly.)* The 2D main-map renderer is deleted. There
   is no toggle and no fallback renderer. A machine without WebGL gets a
   clear message, not a playable flat map.

2. **The minimap stays 2D.** *(Author's call.)* It is a separate 192×120
   canvas using its own rectangular grid approximation, it reads better flat,
   and a top-down overview is exactly what it should be. `drawMinimap()`
   survives untouched. Only `updateMinimapViewport()` is rewired, since it
   currently reads `camX/camY/zoom` which will no longer exist.

3. **Rendering becomes a persistent rAF loop with a dirty flag.** *(Author's
   call.)* The ~30 synchronous `drawMap()` call sites become
   `needsRender = true`. three.js wants a continuous loop, and the water,
   flags, and idle unit motion animate constantly anyway. The loop renders
   every frame while anything is animating and idles otherwise.

4. **Everything is generated in code.** *(Follows from the approved
   prototypes.)* No external assets.

5. **Labels are DOM elements positioned over the canvas, not 3D text.**
   *(Author's call, proven in both prototypes.)* City names, unit type
   labels, and HP bars are absolutely-positioned HTML updated from projected
   world coordinates each frame. This keeps text crisp, styleable in CSS, and
   consistent with the existing DOM overlay approach.

6. **Camera is OrbitControls with constraints.** *(Author's call.)* A clamped
   polar angle so the player cannot get under the terrain, and panning
   clamped to the map's bounds so the camera cannot drift off into empty
   ocean.

7. **Dragging pans; rotating is the secondary gesture.** *(Author's call,
   corrected after the owner asked whether the map could be moved.)*
   three.js defaults to left-drag-rotates, which is wrong for a map game.
   Left-drag pans, right-drag rotates, scroll zooms, arrow keys and WASD pan
   with speed scaled to zoom distance, one finger pans and pinch zooms. This
   matches both the current 2D game and Civ. `civ3d-fullmap.html` is the
   reference; the earlier art preview still has the old scheme and is not.

8. **The draw-call budget is a total, not a terrain budget.** *(Author's
   call.)* See **Performance plan** for what this implies about ordering.

9. **Fog of war is a separate overlay, never baked into chunk vertex data.**
   *(Author's call.)* Fog changes on nearly every unit move, and inverts
   across the entire map when the player presses `V` (`#fog-btn`,
   index.html:429). Baking it into merged chunk geometry would trigger
   constant full rebuilds. It gets its own instanced overlay layer whose
   per-tile visibility is cheap to update.

10. **The quality setting is a new control group beside `#fog-btn` in the top
    bar.** *(Author's call.)* The "no change to the DOM UI" non-goal means no
    redesign of the existing panels and no change to how they work. It does
    not forbid adding one small control group that the 3D renderer needs.

11. **Hex edges are drawn on the ground at all times.** *(Owner's request:
    "make the tiles a little more obvious so I could see them while
    playing.")* A visible outline on every hex, so the player can always read
    the grid they are playing on. Because the elevation falloff reaches zero
    at every tile boundary, tile edges are always flat, and a single merged
    flat ribbon sits exactly on the ground even across hills — the whole grid
    costs one draw call. It fades as the camera pulls back, so the whole-map
    view does not dissolve into 640 outlines, and it is not drawn on open
    ocean. Implemented and verified in `civ3d-fullmap.html`.

    This is the first concrete answer to the readability anti-goal, and the
    pattern generalises: when 3D makes game state harder to read than the
    flat map did, fix it with an explicit affordance rather than accepting
    the loss.

12. **Fog hides objects, not just ground — and the tooltip is part of the
    fog.** *(Owner found this in the spike; the first implementation was
    wrong.)* On a flat map, filling a hex with dark paint genuinely hides
    everything on it. In 3D it does not: a dark disc lies on the ground while
    trees, rocks, buildings and mountains stand up through it in plain sight.
    Fog is therefore three separate things that must agree:

    - a **ground layer** drawn above the tile edges, territory borders and
      every tile overlay, so none of them leak through;
    - **per-instance culling of scenery**, which means every instanced mesh
      has to record which tile each instance sits on, so unexplored tiles can
      drop theirs;
    - **units hidden** wherever the tile is not currently in sight, since
      remembered ground must not reveal who is standing on it now.

    The hover tooltip is the fourth. It reads the real tile data and will
    happily report terrain, resources and units on a tile the player has
    never scouted. Unexplored tiles must answer "Unexplored"; remembered
    tiles show the land but not its occupants.

    The general rule for the port: **anything that reveals game state has to
    respect fog, not just the terrain pass.** Overlays, labels, yield pills,
    tooltips and animations all qualify.

    **Two layers of defence, because one is not enough.** The owner found a
    second leak after the first fix: with the stress overlays on, unexplored
    tiles lit up in overlay colors and gave away that there was land there.
    The cause is worth stating plainly, because it will catch the builder
    too. *Transparent layers do not write depth.* Sitting physically lower
    than the fog does not put a layer behind it — draw order alone decides,
    and the overlay was drawing later. So fog needs both:

    - **ordering:** unexplored fog renders after every overlay, ring and
      highlight, as a backstop;
    - **filtering:** each layer independently refuses to draw on unexplored
      tiles, so a future layer added above the fog still cannot leak.

13. **A full-screen flash must never stack or repeat quickly.** *(Owner found
    this under stress: "it flickers white".)* Overlapping flashes read as a
    strobe, which is unpleasant and a genuine photosensitivity risk. One
    flash at a time, a cooldown between them, a modest peak opacity, and none
    at all under `prefers-reduced-motion`. The same caution applies to any
    other full-screen effect added later.

## Parity checklist

The port is not done until every one of these works as it does today. This
list is the acceptance criteria.

**Terrain and map**
- 13 terrain types, visually distinct
- 4 features: woods, rainforest, marsh, oasis
- 10 resources, each identifiable on its tile
- 5 improvements: farm, mine, quarry, pasture, lumber mill
- River edges, driven by the contract's 6-bit bitmask, on the correct edges
- Unexplored tiles hidden; explored-but-not-visible tiles dimmed (fog)

**Overlays** — each is currently drawn on the canvas and must have a 3D form
- Territory fill tint and territory borders in player colors
- Selection ring on the selected unit or city
- Movement range highlight
- Attack and ranged-attack range highlight
- Hover highlight
- City worked-tile highlights: blue locked, green auto
- Lock icon on locked tiles
- Tile yield pills (food/production/gold)
- Unworked-territory dashed dim overlay when a city is selected

**Cities**
- Name banner with capital star, population circle
- Production progress bar, HP bar when damaged, amenity status dot

**Units**
- 6 types as distinct models, owner color visible
- HP bar when damaged, unit name label, selection state

**Animations** — all 10 types, listed with their current creation sites
- `unitWalk`, `dustParticle`, `meleeCharge`, `clashSparks`, `unitShake`,
  `floatingText`, `screenFlash`, `archerFire`, `projectile`, `rangedImpact`,
  `cityFound`

**Interaction**
- Hover a tile → tooltip (`#tile-tip`) with terrain, yield, owner, units
- Click a tile → `handleClick(hex)` with all its existing behaviour
- Drag to pan; the existing < 4px drag-vs-click threshold is preserved
- Scroll to zoom
- Minimap click to recentre
- All keyboard shortcuts, including arrow-key pan, `+`/`-` zoom, and `Tab`
  to cycle units (which calls `panToHex`)
- `#zoom-controls` buttons and the zoom label
- Scenario replay, which calls `panToHex` during playback

## Performance plan

Five techniques, all validated in the full-map prototype.

1. **Merge terrain into chunks.** 4×4 tiles become one merged mesh with
   per-vertex colors. 640 tiles → 40 meshes. Chunks are rebuilt individually
   when a tile's *terrain* changes — improvement built, feature chopped.
   Anything that changes often (fog, territory ownership, every overlay) must
   live in its own layer rather than in chunk vertex data, or rebuilds will
   dominate the frame. See Decision 9.
2. **Instance every repeated object.** All pine trees are one draw call, all
   houses another, and so on, via `InstancedMesh`. This is what takes the
   scene from ~7,000 objects to 700.
3. **Frustum-cull chunks.** Off-screen chunks are skipped. This is what gets
   play zoom down to 277 draw calls.
4. **Replace `pixelToHex` with math.** Raycast against a ground plane, then
   compute the hex directly from world coordinates and check only the 9
   candidates around it. No 640-tile scan per mouse move.
5. **A quality setting.** Shadows on/off, small props on/off, pixel ratio
   capped at 1 or device. Exposed in the UI so a player on a weak machine can
   turn things down.

**Budget:** under ~800 draw calls in the worst case (whole map on screen),
under ~300 at normal play zoom. If a change pushes past that, instance or
merge something.

**This budget is a total, and a large part of it is already spoken for by
things that have never been measured.** The 277 / 700 figures come from a
prototype rendering terrain, props, cities, units, territory borders, water
and a single selection ring. It renders none of the following, all of which
are on the parity checklist:

- fog of war, across the whole map
- the seven overlay types (movement range, attack range, ranged range, hover,
  selection, worked-tile locked/auto, unworked-territory dim)
- per-frame DOM labels and HP bars for every unit and city
- tile yield pills and lock icons
- 8 of the 10 resources and 4 of the 5 improvements
- all 11 animation types

### Parity spike result

The spike was built: the full-map prototype was extended with fog of war, all
seven tile overlays, DOM labels and HP bars for every unit and city, yield
pills, the remaining resources and improvements, and all 11 animation types
running continuously. A "stress" mode lights every overlay on every land
tile, puts yield pills on all 640, and fires animations roughly eight times
as often as play would.

| Scene | Draw calls | Triangles | DOM labels | Live animations |
|---|---|---|---|---|
| Play zoom, no game layer *(earlier baseline)* | 277 | 162k | 0 | 0 |
| Play zoom, full game layer | **304** | 189k | 29 | 14 |
| Play zoom, stress | **320** | 190k | 121 | 48 |
| Whole map, full game layer | **739** | 221k | 6 | 14 |
| Whole map, stress | **773** | 222k | 6 | 48 |

**The whole game layer costs about 27 draw calls at play zoom and about 39 in
the worst case.** The architecture holds: fog is 2 instanced layers, all seven
overlays share 1 instanced layer with per-instance color, and labels are DOM
and cost no draw calls at all. Even the deliberately unrealistic stress case
stays inside the ~800 budget.

Two honest limits on this result. Frame rate still has to come from real
hardware, since the measuring environment renders in software. And the
whole-map rows show few labels because unit and yield labels hide beyond a
camera distance of 26 — by design, but it means the DOM worst case is the
121-label play-zoom row, not the whole-map one.

**Therefore the work opens with a parity spike,** not with production code:
extend the full-map prototype until it renders the complete parity set at
640 tiles, and re-measure. The chunk size, the instancing buckets, and the
layer structure are only locked in after that number exists. Discovering the
budget is blown after the architecture is settled means a rewrite, and
Decision 1 removed the 2D fallback that would otherwise absorb it.

## Risks

- **This is a large change to a working file.** `ui/index.html` holds the
  action pipeline, optimistic updates, and client-side validation, all of
  which currently work. The renderer is the part being replaced; the risk is
  collateral damage to the rest.
- **The animation data model is coupled to 2D pixel space.** Animations store
  world pixel coordinates captured at creation. This needs a deliberate
  conversion layer or a change to store hex coordinates instead — it is not a
  mechanical find-and-replace.
- **Overlay readability in 3D is genuinely harder.** Range highlights and
  worked-tile indicators are trivially readable on a flat top-down map and
  less so on tilted 3D terrain. This is the most likely place for the port to
  come out worse than what it replaces, and it deserves real attention rather
  than a direct translation.
- **The measured 60fps does not cover the gameplay layer.** The prototype
  that hit it renders no fog, no overlays, no labels or HP bars, and no
  animations. The headroom is real but unquantified, which is exactly what
  the parity spike exists to settle.

## Left to the builder

- How to structure the renderer within the single file (module pattern,
  function naming, where it sits relative to the existing code).
- The exact 3D form each overlay takes — decals on terrain, floating rings,
  edge geometry, emissive materials. The prototypes show one workable set of
  answers; better ones are welcome, judged on readability.
- How tile yield pills and the lock icon are drawn now that emoji and
  `fillText` are gone — DOM labels, canvas-texture sprites, or small 3D
  shapes.
- Whether animations keep their current data model with a conversion layer or
  are reworked to store hex coordinates.
- Chunk size, instancing buckets, and where exactly to spend the draw-call
  budget.
- Camera default angle, zoom limits, and how zoom maps to the existing
  `ZOOM_MIN`/`ZOOM_MAX` semantics used by the minimap viewport rectangle.
- Resource and improvement models, which the prototypes only sample
  (prototypes cover stone, wheat farm, mine, fishing boat, cattle, horses).
- The order of work and how to stage it so the game stays runnable.
- Testing approach. Note that `snforge` covers the contract only; there is no
  JS test harness in this project today, and this design does not require one
  to be built.
