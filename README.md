
## 2026-09-05 — Oversampled 2.5D Organic Print reconstruction

Organic Print no longer smooths the final low-resolution voxel mesh directly. The editable grid remains discrete, but the derived print surface now uses a higher-resolution 2.5D reconstruction:

1. Standard cubes are analysed layer-by-layer; Support cubes remain outside Organic Print.
2. Sparse authored line runs are converted to exact straight vector rectangles before rasterisation.
3. Every occupied Z layer is rasterised at 8× resolution for the live viewport and 12× for export.
4. A small strength-dependent morphological closing joins sub-voxel gaps without globally inflating the form.
5. The high-resolution binary layer is converted to a signed-distance field and filtered in XY.
6. Each filtered layer becomes an extruded level-set slab; neighboring slabs get only a small anisotropic Z blend.
7. The final continuous field is triangulated for the live Three.js preview / STL / OBJ / GLB output, with horizontal manufacturing planes kept flat.

The Control Deck and Export panel now call the shared 01–05 setting **SMOOTHNESS** because it controls this reconstruction (closing + SDF filtering + inter-layer transition), not only a junction radius.

This makes the 4×4–16×16 grid an authoring resolution rather than the final surface resolution: diagonal lines can be straight at sub-voxel precision, broad silhouettes become continuous, and the model can look more like a designed physical object while remaining editable as cubes in `.bil`.

# Digital Twin / Voxel Engine

Adjustable 4×4–16×16 physical voxel simulator for UX validation before / alongside the ESP32 hardware, with a separate custom Brick Maker tool.

## Run locally

Requires a current Node.js version supported by Vite 8.

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite (normally `http://localhost:5173`).

## Architecture

- `src/model/VoxelModel.js` — pure physical state + constraints. No Three.js code.
- `src/main.js` — Three.js scene, raycasting, history, layer view, Web Serial, file import/export, input adapter, and renderer sync.
- `src/style.css` — compact editorial UI styling.
- `index.html` — main Build It Live interface shell.
- `brickmaker.html` + `src/brickmaker.js` — separate draw/erase stud-layout tool with STL export.
- `vite.config.js` — multi-page Vite build entry for both tools.

## Physical rules

1. Adjustable active base from 4×4 up to the 16×16 hardware ceiling.
2. A z=0 block is supported by the base.
3. Any z>0 block requires another block at exactly `[x, y, z-1]`.
4. No cantilevers or unsupported overhangs.
5. Maximum stack height: 16 blocks (`z = 0..15`).
6. Erasing a middle block applies gravity: blocks above it drop by one level.

The live stats display current height / maximum height, for example `03/16`.

## Adjustable grid

The **Settings** icon in the top-right of the **LIVE DATA** card opens the **BUILD AREA SIZE** control, which resizes the usable build area from **4×4 to 16×16**. The base mesh, grid helper, raycasting, metrics, autosave metadata and JSON export all follow the active size. When shrinking a non-empty build, the simulator shifts the form back inside the smaller grid when its footprint fits; if the footprint is genuinely too large, the resize is rejected instead of deleting blocks.

## Real-time Organic Print rendering

Organic Print is no longer an export-only calculation. The editor has a **MODEL VIEW** switch with **BLOCKS / SMOOTH**.

- **VOXEL** shows the editable Standard / Support cube representation.
- **ORGANIC PRINT** derives a live smoothed surface from the current Standard cubes using the same line detection, straight-member reconstruction, and local junction blending used by export.
- The viewport uses a lower sampling density for responsiveness; export uses the same mathematics at higher sampling quality.
- The **JOIN BLEND 01–05** slider in the Control Deck is synchronized with the Export panel, so the mesh you export uses the same setting you previewed.
- Standard cubes remain available as invisible picking geometry while Organic Print is shown, so placement logic still comes from the editable voxel model rather than the smoothed surface. Support cubes remain visible as editing aids.
- Layer View temporarily shows voxel geometry because the live Organic Print surface represents the complete model. Returning Layer View to `ALL` restores the Organic Print view.

### Clean Organic Print surface pass

The live Organic Print renderer and final Organic Print export now share an additional CAD-clean surface pass. Interactive sampling is denser, broad voxel-body faces are snapped consistently to their exact grid planes on all relevant axes, and creased normals keep planar faces visually flat while allowing genuinely organic junction zones to shade smoothly. This removes the tile/cube embossing that could remain visible across large surfaces without changing the editable voxel source model.

## Native project workflow vs. export

The file pipeline now follows a CAD-style split:

### Save / Load Project

**SAVE PROJECT** downloads a native `.bil` file. The file is structured JSON, but `.bil` is the user-facing project format. It preserves:

- active grid size and maximum height
- exact Standard / Support block coordinates
- Organic Print / Voxel render mode
- Join Blend strength
- camera position and orbit target
- project metadata and physical 15 mm block scale

**LOAD PROJECT** prioritizes `.bil`. Legacy JSON / GLB / OBJ / STL recovery is still available so older work is not stranded, but those formats are no longer the recommended project workflow. `Ctrl/Cmd + S` saves a native `.bil` project directly.

### Export

**EXPORT** is separate and produces static geometry only:

- **STL** — strict slicer/Bambu-ready binary STL
- **GLB** — static 3D scene geometry
- **OBJ** — static geometry for modelling/CAD workflows

New exports intentionally do **not** carry editable Build It Live block state. To continue editing later, save the `.bil` project alongside the exported mesh. Older Build It Live files with embedded metadata are still readable through the legacy compatibility path.

## Brick Maker page

Open **BRICK MAKER** from the top bar to use the separate brick-layout workflow. It includes tap/drag Draw, Erase, Clear, a live interactive Three.js preview with full underside orbiting, live brick count, footprint, and printable STL export. Brick Maker now uses **`src/assets/buildingBlock.stl` as its single base-brick geometry** for both the live preview and STL export. The STL is treated as millimetres, normalized to the X/Y centre with Z=0 at its base, and its measured X/Y footprint defines the Brick Maker pitch. The main Build It Live voxel editor remains on its existing 15 mm grid.

## Undo / Redo

Digital edits and loaded models are stored as pure `VoxelModel` snapshots.

- **Undo:** `Ctrl/Cmd + Z`
- **Redo:** `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`
- Up to 100 model states are kept.
- Undo/Redo is disabled while the ESP32 is connected because the physical board is then the source of truth.
- When the ESP32 disconnects, the last received physical state becomes the new history baseline.

## Layer view

The **Layer View** slider is an inspection tool:

- `ALL` shows the complete model and allows editing.
- `01..16` shows that layer **plus every layer below it**. Example: `06` displays layers 01–06 and hides 07–16.
- While a cumulative layer view is active, placement/erase is disabled to avoid accidentally modifying hidden structure.
- Move the slider back to `ALL` to continue editing.

## ESP32 / Web Serial

The Control Deck can connect directly to an ESP32 using the browser Web Serial API.

Requirements:

- Chrome or Edge (desktop)
- Run the app from `localhost` via Vite or from HTTPS
- Default baud rate: **115200** (9600 and 57600 are also selectable)

Click **CONNECT ESP32**, choose the serial port, and send newline-delimited JSON (NDJSON), one JSON message per line.

### Full frame

```json
{"blocks":[
  {"x":2,"y":3,"z":0,"type":"standard"},
  {"x":2,"y":3,"z":1,"type":"support"}
]}
```

A bare JSON array is also accepted:

```json
[{"x":2,"y":3,"z":0,"type":"standard"}]
```

### Incremental events

Place:

```json
{"action":"place","x":2,"y":3,"z":0,"type":"standard"}
```

Remove:

```json
{"action":"remove","x":2,"y":3,"z":0}
```

Clear:

```json
{"action":"clear"}
```

`type` may be `"standard"`, `"support"`, `1`, or `2` (`2` maps to support; other values default to standard).

All hardware data still passes through the same pure `VoxelModel` physical constraints. When connected, mouse placement is locked so the physical interface remains the source of truth.

The public adapter remains available for testing from the browser console:

```js
window.digitalTwin.applyHardwareFrame([
  { x: 2, y: 3, z: 0, type: 'standard' },
  { x: 2, y: 3, z: 1, type: 'support' },
]);
```

## File commands

- **SAVE PROJECT** → native editable `.bil` project.
- **LOAD PROJECT** → native `.bil` first; legacy formats remain for migration/recovery.
- **EXPORT** → STL / GLB / OBJ static geometry.
- **Ctrl/Cmd + S** → saves the native project, not the export panel.

Legacy Organic Print STL files without recoverable original state are never auto-voxelized, because straightened geometry can occupy cells that were empty in the authored voxel project.

## STL / Bambu behavior

- New STL export is a strict **binary STL** with no trailing application data and no hidden editable project payload.
- The exporter validates triangle count and exact binary length before download.
- Support Cubes are omitted from Organic Print / print STL geometry.
- X/Y follow the active grid, Z is vertical, and one voxel remains 15 mm.
- A new static STL is intentionally not a project file. Loading it through the project loader gives a clear message to open the matching `.bil` file instead.
- Legacy STL readers remain in the code only to recover models created by older Build It Live versions when that recovery is safe.

## Autosave + Recent Models

The simulator now stores the latest editable voxel state in the browser using `localStorage`.

- Autosave can be toggled ON/OFF from the Control Deck, and that preference is remembered by the browser.
- When Autosave is ON, changes are saved after a short debounce, so refreshing or reopening the Vite page restores the latest model automatically.
- When Autosave is OFF, edits are not written automatically and the previous local autosave is not restored on refresh.
- The Control Deck shows the ON/OFF switch, current autosave status, and last save time.
- `RECENT MODELS` stores up to 24 browser-local autosaved models.
- Each model has a persistent ID. Opening a Recent Model makes that entry active; subsequent autosaves update that same entry instead of creating a duplicate.
- Clearing the build starts a new autosave identity, so the next non-empty build becomes a new Recent Model. Imported files also start as new model identities.
- Each Recent Model shows a smart model name plus higher-contrast date, block count, and live/max build height metadata. The currently active model is marked `ACTIVE`.
- Recent Models can be reopened, renamed inline, or deleted individually, and the list can be cleared. The list gets its own scrollbar when the history exceeds the modal height.
- Browser autosave is not a portable backup. Use SAVE PROJECT to create a portable `.bil` backup when the model should be moved to another computer/browser.
- Clearing browser/site storage also clears the autosave and recent-model list.

## Smart Recent Model Names

Autosaved Recent Models now receive a short geometry-derived title automatically. The naming logic uses the occupied footprint, current height, number of columns, peak count, density, symmetry, and height variation to produce descriptive names such as `TALL TOWER`, `TWIN COLUMNS`, `STEPPED FORM`, `LOW PLATFORM`, `COMPACT STACK`, or `SYMMETRIC FORM`.

The system intentionally describes geometry rather than pretending to semantically recognize objects. Similar generated names receive a small numeric suffix when needed. Each Recent Model also has a **RENAME** action; edit the name inline and press **Enter** or **SAVE** to keep a custom title. Custom titles are stored in browser localStorage with the Recent Model entry.

## Continuous Build / Erase

The Control Deck includes an optional **CONTINUOUS BUILD** switch.

When ON:

- **Standard / Support Cube:** hold the left mouse button and drag across the grid to paint blocks across rows or paths.
- Hold the pointer still over one column to keep stacking vertically until release or the 16-block maximum is reached.
- **Eraser:** hold and drag to remove blocks continuously; holding still keeps removing from the same column.
- **Alt + left-drag:** orbit the camera while Continuous Build is enabled.
- One complete press/drag/release gesture is stored as a single Undo history step.

When OFF, the original single-click placement and normal left-drag OrbitControls behavior is preserved.

## Organic Print geometry refinement (Sep 2026)
- Clear horizontal diagonal runs now require at least 3 uninterrupted corner-to-corner cells.
- Diagonal runs are exported as constant 15 mm-wide centerline strips rather than convex hulls of the cube footprints.
- Runs are split at dense/junction cells so a beam cannot pass through the middle of a filled body.
- Ordinary voxel columns remain exact planar geometry; no chamfer is applied to non-diagonal body surfaces.
- Edge Strength affects only the restrained linear chamfer on reconstructed diagonal strips.

## Organic Print — Vector Clean refinement (Sep 2026)
- Organic Print no longer treats the model as a collection of rounded/smoothed cubes. Sparse line-like branches are detected as authored paths and rebuilt as **straight 15 mm vector members**.
- Horizontal, vertical, true diagonal, short and staircase-approximated lines can all be straightened when their voxel path is sufficiently line-like. Interrupted pieces remain interrupted, but each piece is independently straight rather than falling back to a pixel chain.
- Dense body regions are excluded from line fitting and exported as one **greedy exposed-surface mesh**, removing internal cube faces and most unnecessary per-cell seams while preserving the authored voxel mass.
- Branches are split at junctions before fitting, so V/Y/cross structures are represented as separate straight members instead of one accidental diagonal.
- Edge Strength 01–05 only controls the small **linear** chamfer on vector members. It does not round or inflate the body.


## Organic Print — Organic Straight (latest)
- Straight/horizontal/vertical/diagonal authored line runs are reconstructed as clean 15 mm members.
- Straight spans remain planar; smoothing is restricted to local junctions where members meet the body or other members.
- JOIN BLEND 01–05 changes only that local transition radius.
- The final Organic Print result is emitted as one watertight implicit-union surface with a flat print-bed bottom.
- This avoids the earlier glued-bar look without reintroducing rounded/wavy line spans.

## Organic Print — realistic surface pass

The organic straight export now uses a higher-resolution implicit surface plus plane snapping. Straight member spans and large body faces are snapped back onto exact mathematical planes, while only the local junction band remains organically blended. This reduces the serrated/faceted edge artifacts visible in slicer previews without returning to global blob smoothing.

- adaptive 6–10 samples per voxel cell (model-size dependent)
- exact planar snapping for straight line members outside joins
- planar snapping for broad voxel-body faces outside joins
- organic blending restricted to beam/body and beam/beam junction zones
- flat Z=0 print-bed surface preserved


## Organic Print live preview + naming update (Sep 2026)

- The former **Soft 01** export mode is now presented as **Organic Print**. The Export Surface heading reads **BLOCKS / SMOOTH** while the internal `soft1` key remains unchanged for compatibility.
- When Organic Print is selected, the Save Model panel becomes vertically scrollable and uses a compact custom scrollbar.
- Join Blend 01–05 now drives a live representative 3D junction preview inside the Save Model panel, showing how a straight member transitions into the surrounding body at the selected level.
- Brick Maker navigation now links back to **Build It Live** instead of using the older Voxel Twin label.

### UI refinement — Join Blend preview
- Join Blend controls use a compact two-column layout: strength controls beside the live sample.
- The Organic Print sample is interactive: drag to orbit, wheel/pinch to zoom; keyboard arrows and +/- also work when focused.
- Save Model keeps its header fixed and scrolls only the content beneath it, giving Organic Print a shorter contained scrollbar.
## Legacy model compatibility (Sep 2026)
- Recent Models and Autosaves are migrated through the same block normalizer used by file imports.
- Legacy block aliases such as `standardCube`, `supportCube`, `blockType`, nested `position`, and numeric type `1/2` are accepted.
- Legacy JSON files can be raw block arrays or use historical containers such as `blocks`, `voxels`, `cells`, `model.blocks`, or `state.blocks`.
- Historical GLB/OBJ files restore exact block coordinates from saved object names/userData even when newer metadata wrappers are absent.
- Historical voxel STL files use a strict axis-aligned 15 mm-grid detector before reconstruction; Support cubes omitted by the old slicer exporter are recovered only where required beneath saved Standard cubes.
- Organic/smoothed geometry never enters this compatibility reconstruction automatically, preventing phantom cells.


## 2026-09-05 — Real-time rendering + native project architecture

- Organic Print geometry is now a live derived renderer in the main Three.js scene instead of an STL-export-only calculation.
- The live surface rebuild is debounced after edits and uses the same reconstruction algorithm as export at interactive sampling quality.
- View surface and Join Blend are shared state between the Control Deck and Export panel: export follows what the user previewed.
- Native `.bil` project files are the authoritative portable editable format.
- STL / GLB / OBJ are static export products and new exports intentionally contain no editable voxel payload.
- Legacy import paths remain only for backwards compatibility.


### Clean 45° / 90° Organic Print angles

Organic Print now recognises deliberate grid-direction turns and reconstructs them as CAD-style members:

- canonical 0° / 45° / 90° / 135° line directions are angle-locked when the authored run is already close to them;
- sparse paths with deliberate direction changes are split at their elbows so an L/V/U shape is not fitted as one curved or diagonal member;
- member-to-member 45° and 90° joints use a crisp hard/miter-style union rather than the organic smooth-min blend;
- member-to-body transitions still use Join Blend, preserving the integrated organic connection requested for the main structure;
- the exact same angle logic is used by the live Organic Print viewport and the final export geometry.

## 2026-09-15 — Organic inspection lock + Free Move

- Organic Print is now explicitly inspection/export-only: Standard Cube, Support Cube, Eraser, Continuous Build, and Layer View are disabled while Organic Print is active.
- Entering Organic Print automatically switches to a camera-only Free Move state; returning to Voxel restores the previous build tool unless Free Move was already active.
- Build Kit now includes a compact **FREE MOVE** pill (`M`) for orbiting the camera without accidental placement/erasing.
- The Export panel no longer contains an Export Surface selector or duplicate Organic controls. It only reports the current **MODEL VIEW** (`VOXEL`, `ORGANIC PRINT`, or `STATIC MESH`) and exports that active representation.

### Per-block color picker
Standard Cube now has a compact popup color palette. Each newly placed Standard Cube stores its own selected color; existing cubes keep their previous colors. Colors are preserved by editable Build It Live project/JSON state and GLB block metadata. STL remains geometry-only, as expected for the format.

### Themed custom color picker refinement
- The original Build It Live red (`#e93222`) is the **STANDARD / DEFAULT** block color and is permanently the first palette option.
- The `ANY` color control now opens a themed in-app editor rather than using the generic browser color-picker UI.
- The custom editor uses Build It Live's black/red visual language, with Hue / Color / Light sliders, a live preview, editable HEX value, and `USE COLOR` action.

## Source-morph menu motion
Export, Load Project, and Recent Models now use a source-origin pop transition: the panel grows from the button that opened it and collapses back toward that source on close. Backdrop blur is synchronized with the morph, with reduced-motion support retained.


## Layer View inspection lock
When Layer View is set to a specific height, Build It Live switches to a read-only inspection state. Standard/Support/Eraser tools, block colors, Continuous Build, Undo/Redo, Clear Build, Load Project/Recent Models, and Grid Settings are disabled until Layer View returns to ALL. Camera navigation, layer navigation, Save Project, and Export remain available.
