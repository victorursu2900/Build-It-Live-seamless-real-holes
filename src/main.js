import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { VoxelModel } from './model/VoxelModel.js';

// -----------------------------------------------------------------------------
// 1. ADJUSTABLE HARDWARE / SIMULATOR CONFIG
// -----------------------------------------------------------------------------
// The physical limits are centralized here. Change MAX_HEIGHT later if your
// analog divider becomes capable of reading taller stacks.
const CONFIG = {
  GRID_SIZE: 16, // hardware / simulator ceiling
  MIN_GRID_SIZE: 4,
  MAX_HEIGHT: 16,
  CELL_SIZE: 1,
  BLOCK_GAP: 0.055,
  BASE_HEIGHT: 0.28,

  // Physical cube size used for printable/portable geometry exports.
  // STL/OBJ are exported at 15 units per cell (intended as millimetres).
  // GLB follows glTF's metre convention, so one cell becomes 0.015 m.
  PHYSICAL_BLOCK_MM: 15,
};

const DEFAULT_BLOCK_COLOR = '#e93222';

const COLORS = {
  paper: 0xf1efe9,
  ink: 0x111111,
  accent: 0xe93222,
  support: 0xdde1df,
  invalid: 0xe93222,
  validGhost: 0x111111,
};

// -----------------------------------------------------------------------------
// 2. PURE DATA MODEL
// -----------------------------------------------------------------------------
const model = new VoxelModel({
  gridSize: CONFIG.GRID_SIZE,
  maxHeight: CONFIG.MAX_HEIGHT,
});

// Rendering never mutates blocks directly. Pointer input asks the model to
// mutate, then syncViewFromModel() redraws strictly from the model snapshot.
let selectedTool = 'standard';
let lastBuildTool = 'standard';
let selectedBlockColor = DEFAULT_BLOCK_COLOR;
let recolorTarget = 'new';
const recolorSelectedKeys = new Set();
let freeMoveBeforeOrganic = false;
let hoveredCandidate = null;
let lastPointerDown = null;

// Optional continuous editing mode. When enabled, left-click + hold paints blocks
// across columns; holding still stacks vertically. Eraser works continuously too.
let continuousBuildEnabled = false;
let continuousStrokeActive = false;
let continuousStrokeDirty = false;
let continuousPointerId = null;
let continuousCurrentColumn = null;
let continuousLastColumnKey = null;
let continuousLastPointer = null;
let continuousHoldTimeout = null;
let continuousHoldInterval = null;
const CONTINUOUS_HOLD_DELAY_MS = 360;
const CONTINUOUS_REPEAT_MS = 220;

// -----------------------------------------------------------------------------
// 3. DOM REFERENCES
// -----------------------------------------------------------------------------
const viewport = document.querySelector('#viewport');
const toolButtons = [...document.querySelectorAll('.tool-button')];
const freeMoveButton = document.querySelector('#freeMoveButton');
const standardToolButton = document.querySelector('[data-tool="standard"]');
const standardColorSwatch = document.querySelector('#standardColorSwatch');
const blockColorPopover = document.querySelector('#blockColorPopover');
const blockColorChoices = [...document.querySelectorAll('[data-block-color]')];
const blockColorName = document.querySelector('#blockColorName');
const blockColorHelp = document.querySelector('#blockColorHelp');
const customColorToggle = document.querySelector('#customColorToggle');
const customColorPanel = document.querySelector('#customColorPanel');
const customColorClose = document.querySelector('#customColorClose');
const customHue = document.querySelector('#customHue');
const customSaturation = document.querySelector('#customSaturation');
const customLightness = document.querySelector('#customLightness');
const customColorPreview = document.querySelector('#customColorPreview');
const customColorHex = document.querySelector('#customColorHex');
const customColorApply = document.querySelector('#customColorApply');
const recolorTargetButtons = [...document.querySelectorAll('[data-color-target]')];
const recolorSelectedCount = document.querySelector('#recolorSelectedCount');
const blockMetric = document.querySelector('#blockMetric');
const gridMetric = document.querySelector('#gridMetric');
const gridSizeSlider = document.querySelector('#gridSizeSlider');
const gridSizeValue = document.querySelector('#gridSizeValue');
const openGridSettingsButton = document.querySelector('#openGridSettings');
const closeGridSettingsButton = document.querySelector('#closeGridSettings');
const gridSettingsPopover = document.querySelector('#gridSettingsPopover');

// Keep Grid Settings in its own compositor layer. When nested inside Live Data,
// backdrop-filter mostly samples the parent card instead of the WebGL scene.
// Portaling the popover to <body> makes the frosted blur visibly match the
// other top-level popup cards.
if (gridSettingsPopover && gridSettingsPopover.parentElement !== document.body) {
  document.body.appendChild(gridSettingsPopover);
}
const heightMetric = document.querySelector('#heightMetric');
const feedbackCard = document.querySelector('.feedback-card');
const feedbackTitle = document.querySelector('#feedbackTitle');
const feedbackText = document.querySelector('#feedbackText');
const systemStatus = document.querySelector('#systemStatus');
const clearBuildButton = document.querySelector('#clearBuild');
const resetViewButton = document.querySelector('#resetView');
const saveBuildButton = document.querySelector('#saveBuild');
const loadBuildButton = document.querySelector('#loadBuild');
const exportBuildButton = document.querySelector('#exportBuild');
const loadBuildInput = document.querySelector('#loadBuildInput');
const saveModal = document.querySelector('#saveModal');
const saveModalBackdrop = document.querySelector('#saveModalBackdrop');
const closeSaveModalButton = document.querySelector('#closeSaveModal');
const exportFormatButtons = [...document.querySelectorAll('[data-export-format]')];
const exportSurfaceButtons = [...document.querySelectorAll('[data-export-surface]')];
const exportSurfaceDescription = document.querySelector('#exportSurfaceDescription');
const exportModelViewValue = document.querySelector('#exportModelViewValue');
const smoothingStrengthControl = document.querySelector('#smoothingStrengthControl');
const smoothingStrengthSlider = document.querySelector('#smoothingStrengthSlider');
const smoothingStrengthValue = document.querySelector('#smoothingStrengthValue');
const smoothingPreviewMount = document.querySelector('#smoothingPreview');
const smoothingPreviewLabel = document.querySelector('#smoothingPreviewLabel');
const realtimeSurfaceButtons = [...document.querySelectorAll('[data-live-surface]')];
const realtimeRenderStatus = document.querySelector('#realtimeRenderStatus');
const realtimeSmoothingControls = document.querySelector('#realtimeSmoothingControls');
const realtimeSmoothingSlider = document.querySelector('#realtimeSmoothingSlider');
const realtimeSmoothingValue = document.querySelector('#realtimeSmoothingValue');
const realtimeSmoothingState = document.querySelector('#realtimeSmoothingState');
const loadModal = document.querySelector('#loadModal');
const loadModalBackdrop = document.querySelector('#loadModalBackdrop');
const closeLoadModalButton = document.querySelector('#closeLoadModal');
const loadFormatButtons = [...document.querySelectorAll('[data-load-format]')];
const loadDropZone = document.querySelector('#loadDropZone');
const undoBuildButton = document.querySelector('#undoBuild');
const redoBuildButton = document.querySelector('#redoBuild');
const continuousToggle = document.querySelector('#continuousToggle');
const continuousStatus = document.querySelector('#continuousStatus');
const layerSlider = document.querySelector('#layerSlider');
const layerValue = document.querySelector('#layerValue');
const showAllLayersButton = document.querySelector('#showAllLayers');
const connectSerialButton = document.querySelector('#connectSerial');
const disconnectSerialButton = document.querySelector('#disconnectSerial');
const serialStatus = document.querySelector('#serialStatus');
const serialBaud = document.querySelector('#serialBaud');
const autosaveToggle = document.querySelector('#autosaveToggle');
const autosaveStatus = document.querySelector('#autosaveStatus');
const autosaveMeta = document.querySelector('#autosaveMeta');
const openRecentModelsButton = document.querySelector('#openRecentModels');
const recentModal = document.querySelector('#recentModal');
const recentModalBackdrop = document.querySelector('#recentModalBackdrop');
const closeRecentModalButton = document.querySelector('#closeRecentModal');
const clearRecentModelsButton = document.querySelector('#clearRecentModels');
const recentModelsList = document.querySelector('#recentModelsList');

// View-only layer filter. null = show the complete model.
let activeLayerView = null;
let exportSurfaceMode = 'voxel';
let smoothingStrength = 3;

// Undo/redo stores pure model snapshots, never Three.js objects.
const HISTORY_LIMIT = 100;
let history = [model.getBlocks()];
let historyIndex = 0;

// Browser persistence: latest autosave + a small rolling gallery of recent states.
const AUTOSAVE_STORAGE_KEY = 'digital-twin.autosave.v1';
const AUTOSAVE_PREF_STORAGE_KEY = 'digital-twin.autosave-enabled.v1';
const RECENT_MODELS_STORAGE_KEY = 'digital-twin.recent-models.v1';
const ACTIVE_RECENT_MODEL_STORAGE_KEY = 'digital-twin.active-recent-model-id.v1';
const STL_EXPORT_REGISTRY_STORAGE_KEY = 'digital-twin.stl-export-registry.v1';
const STL_EXPORT_REGISTRY_LIMIT = 16;
const RECENT_MODELS_LIMIT = 24;
const AUTOSAVE_DELAY_MS = 900;
let autosaveTimer = null;
let storageEnabled = true;
let autosaveEnabled = true;
let activeRecentModelId = null;

// Web Serial runtime state. Hardware messages update the same VoxelModel.
let serialPort = null;
let serialReader = null;
let serialReadTask = null;
let serialKeepReading = false;
let serialBuffer = '';
let serialConnected = false;

// Keep UI labels bound to the same config as the model.
gridMetric.textContent = `${model.gridSize}×${model.gridSize}`;
if (gridSizeSlider) gridSizeSlider.value = String(model.gridSize);
if (gridSizeValue) gridSizeValue.textContent = String(model.gridSize).padStart(2, '0');
heightMetric.textContent = `00/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')}`;

// -----------------------------------------------------------------------------
// 4. THREE.JS SCENE
// -----------------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.paper);
// Fog disabled so the grid remains crisp even when zoomed far out.
scene.fog = null;

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);

const defaultCameraPosition = new THREE.Vector3(16, 15, 19);
camera.position.copy(defaultCameraPosition);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 2.2, 0);
controls.minDistance = 9;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// Bright, soft illumination for an approachable prototype environment.
scene.add(new THREE.HemisphereLight(0xffffff, 0xaaa59a, 2.2));

const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
keyLight.position.set(10, 18, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -13;
keyLight.shadow.camera.right = 13;
keyLight.shadow.camera.top = 13;
keyLight.shadow.camera.bottom = -13;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffdfd7, 1.2);
fillLight.position.set(-12, 9, -8);
scene.add(fillLight);

// -----------------------------------------------------------------------------
// 5. BASE + GRID
// -----------------------------------------------------------------------------
const baseMaterial = new THREE.MeshStandardMaterial({
  color: 0xe6e2d9,
  roughness: 0.82,
  metalness: 0,
});

const baseMesh = new THREE.Mesh(
  new THREE.BoxGeometry(
    CONFIG.GRID_SIZE * CONFIG.CELL_SIZE + 0.28,
    CONFIG.BASE_HEIGHT,
    CONFIG.GRID_SIZE * CONFIG.CELL_SIZE + 0.28,
  ),
  baseMaterial,
);
baseMesh.position.y = -CONFIG.BASE_HEIGHT / 2;
baseMesh.receiveShadow = true;
baseMesh.userData.kind = 'base';
scene.add(baseMesh);

let gridHelper = new THREE.GridHelper(
  CONFIG.GRID_SIZE * CONFIG.CELL_SIZE,
  CONFIG.GRID_SIZE,
  COLORS.ink,
  COLORS.ink,
);
gridHelper.position.y = 0.004;
gridHelper.material.transparent = true;
gridHelper.material.opacity = 0.36;
scene.add(gridHelper);

function updateGridSceneGeometry() {
  const size = model.gridSize * CONFIG.CELL_SIZE;

  baseMesh.geometry.dispose();
  baseMesh.geometry = new THREE.BoxGeometry(
    size + 0.28,
    CONFIG.BASE_HEIGHT,
    size + 0.28,
  );

  scene.remove(gridHelper);
  gridHelper.geometry?.dispose?.();
  if (Array.isArray(gridHelper.material)) {
    gridHelper.material.forEach((material) => material.dispose?.());
  } else {
    gridHelper.material?.dispose?.();
  }

  gridHelper = new THREE.GridHelper(
    size,
    model.gridSize,
    COLORS.ink,
    COLORS.ink,
  );
  gridHelper.position.y = 0.004;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.36;
  scene.add(gridHelper);
}

// A large invisible-ish ground plane catches shadows without affecting picking.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.11 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -CONFIG.BASE_HEIGHT - 0.01;
ground.receiveShadow = true;
scene.add(ground);

// -----------------------------------------------------------------------------
// 6. BLOCK VISUALS
// -----------------------------------------------------------------------------
const blocksGroup = new THREE.Group();
scene.add(blocksGroup);

// Real-time Organic Print surface. This uses the same reconstruction math as
// export, but at an interactive sampling quality. The editable voxel model stays
// authoritative; this group is only a live rendering of that state.
const realtimeOrganicGroup = new THREE.Group();
realtimeOrganicGroup.name = 'RealtimeOrganicPrint';
scene.add(realtimeOrganicGroup);
let realtimeOrganicObject = null;
let realtimeSmoothTimer = null;
let realtimeSmoothRevision = 0;
const REALTIME_SMOOTH_DELAY_MS = 150;

// Standard cubes remain raycastable while Organic Print is visible, but their
// pixels are suppressed. This keeps editing interactions anchored to the voxel
// data model instead of trying to infer placement from the smoothed surface.
const hiddenPickingMaterial = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
});

// Exact STL round-trip mode. STL does not carry editable voxel metadata, so
// loading an STL keeps its triangle mesh verbatim instead of reconstructing
// cubes and changing the saved surface.
const exactStlGroup = new THREE.Group();
exactStlGroup.name = 'ExactImportedStl';
scene.add(exactStlGroup);
let exactImportedStl = null;
const exactStlMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.52,
  metalness: 0.01,
  flatShading: true,
});

const blockSize = CONFIG.CELL_SIZE - CONFIG.BLOCK_GAP;
const blockGeometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
const blockEdgesGeometry = new THREE.EdgesGeometry(blockGeometry);

const standardMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.58,
  metalness: 0.02,
});

const standardMaterialCache = new Map([[DEFAULT_BLOCK_COLOR, standardMaterial]]);

function normalizeStandardBlockColor(value, fallback = DEFAULT_BLOCK_COLOR) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
}

function modelBlockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function usesDarkSelectionOutline(color) {
  const hex = normalizeStandardBlockColor(color).slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.58;
}

function getStandardBlockMaterial(color) {
  const key = normalizeStandardBlockColor(color);
  if (standardMaterialCache.has(key)) return standardMaterialCache.get(key);
  const material = new THREE.MeshStandardMaterial({
    color: key,
    roughness: 0.58,
    metalness: 0.02,
  });
  standardMaterialCache.set(key, material);
  return material;
}

const supportMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.support,
  transparent: true,
  opacity: 0.25,
  roughness: 0.34,
  metalness: 0.02,
  depthWrite: false,
});

const supportEdgeMaterial = new THREE.LineBasicMaterial({
  color: COLORS.ink,
  transparent: true,
  opacity: 0.72,
});

const recolorSelectionDarkMaterial = new THREE.LineBasicMaterial({
  color: 0x111111,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});
const recolorSelectionLightMaterial = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.98,
  depthTest: false,
});

// Ghost = transparent fill + crisp outline.
const ghostMaterial = new THREE.MeshBasicMaterial({
  color: COLORS.validGhost,
  transparent: true,
  opacity: 0.075,
  depthWrite: false,
});

const ghostEdgeMaterial = new THREE.LineBasicMaterial({
  color: COLORS.validGhost,
  transparent: true,
  opacity: 0.95,
});

const ghost = new THREE.Group();
const ghostFill = new THREE.Mesh(blockGeometry, ghostMaterial);
const ghostEdges = new THREE.LineSegments(blockEdgesGeometry, ghostEdgeMaterial);
ghost.add(ghostFill, ghostEdges);
ghost.visible = false;
scene.add(ghost);

/** Model coordinates -> Three.js world coordinates.
 * Model z is vertical, while Three.js uses world Y as vertical.
 */
function modelToWorld(x, y, z) {
  const half = (model.gridSize - 1) / 2;
  return new THREE.Vector3(
    (x - half) * CONFIG.CELL_SIZE,
    z * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2,
    (y - half) * CONFIG.CELL_SIZE,
  );
}

function disposeExactStlDisplay() {
  exactStlGroup.traverse((object) => {
    if (object.isMesh && object.geometry) object.geometry.dispose();
  });
  exactStlGroup.clear();
}

function clearExactStlMode() {
  disposeExactStlDisplay();
  exactImportedStl?.rawGeometry?.dispose?.();
  exactImportedStl = null;
  blocksGroup.visible = true;
}

function activateExactStlMode({ buffer, geometry, gridSize }) {
  clearExactStlMode();

  geometry.computeBoundingBox();
  const box = geometry.boundingBox?.clone() ?? new THREE.Box3();
  const sizeMm = new THREE.Vector3();
  box.getSize(sizeMm);

  const displayGeometry = geometry.clone();
  const position = displayGeometry.getAttribute('position');
  const halfGrid = gridSize / 2;
  for (let index = 0; index < position.count; index += 1) {
    const xMm = position.getX(index);
    const yMm = position.getY(index);
    const zMm = position.getZ(index);
    // STL is Z-up and millimetres; the editor is Y-up and one unit per 15 mm.
    position.setXYZ(
      index,
      xMm / CONFIG.PHYSICAL_BLOCK_MM - halfGrid,
      zMm / CONFIG.PHYSICAL_BLOCK_MM,
      yMm / CONFIG.PHYSICAL_BLOCK_MM - halfGrid,
    );
  }
  position.needsUpdate = true;
  displayGeometry.deleteAttribute('normal');
  displayGeometry.computeVertexNormals();
  displayGeometry.computeBoundingBox();
  displayGeometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(displayGeometry, exactStlMaterial);
  mesh.name = 'exact_stl_mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kind = 'exact-stl';
  exactStlGroup.add(mesh);

  exactImportedStl = {
    originalBuffer: buffer.slice(0),
    rawGeometry: geometry,
    gridSize,
    heightMm: Math.max(0, sizeMm.z),
  };
  blocksGroup.visible = false;
  ghost.visible = false;
  hoveredCandidate = null;
}

/** World point on the base -> integer model grid coordinate. */
function worldToBaseCell(point) {
  const halfSize = (model.gridSize * CONFIG.CELL_SIZE) / 2;
  const x = Math.floor((point.x + halfSize) / CONFIG.CELL_SIZE);
  const y = Math.floor((point.z + halfSize) / CONFIG.CELL_SIZE);
  return { x, y, z: 0 };
}

function cloneBlocks(blocks = model.getBlocks()) {
  return blocks.map((block) => ({ ...block }));
}

function clampGridSize(value) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return model.gridSize;
  return Math.min(CONFIG.GRID_SIZE, Math.max(CONFIG.MIN_GRID_SIZE, numeric));
}

function getRequiredGridSize(blocks = []) {
  if (!blocks.length) return CONFIG.MIN_GRID_SIZE;
  const maxCoordinate = Math.max(...blocks.flatMap((block) => [Number(block.x) || 0, Number(block.y) || 0]));
  return clampGridSize(maxCoordinate + 1);
}

function fitBlocksIntoGrid(blocks, nextSize) {
  if (!blocks.length) return { fits: true, blocks: [] };

  const xs = blocks.map((block) => block.x);
  const ys = blocks.map((block) => block.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX + 1;
  const depth = maxY - minY + 1;

  if (width > nextSize || depth > nextSize) {
    return { fits: false, blocks };
  }

  let shiftX = 0;
  let shiftY = 0;

  if (maxX >= nextSize) shiftX = nextSize - 1 - maxX;
  if (maxY >= nextSize) shiftY = nextSize - 1 - maxY;
  if (minX + shiftX < 0) shiftX += -(minX + shiftX);
  if (minY + shiftY < 0) shiftY += -(minY + shiftY);

  return {
    fits: true,
    shifted: shiftX !== 0 || shiftY !== 0,
    blocks: blocks.map((block) => ({
      ...block,
      x: block.x + shiftX,
      y: block.y + shiftY,
    })),
  };
}

function setRangeProgress(slider) {
  if (!slider) return;
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const value = Number(slider.value);
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  slider.style.setProperty('--range-progress', `${THREE.MathUtils.clamp(progress, 0, 100)}%`);
}

function updateGridUi() {
  gridMetric.textContent = `${model.gridSize}×${model.gridSize}`;
  if (gridSizeSlider) {
    gridSizeSlider.value = String(model.gridSize);
    setRangeProgress(gridSizeSlider);
  }
  if (gridSizeValue) gridSizeValue.textContent = String(model.gridSize).padStart(2, '0');
}

function setActiveGridSize(value, { preserveBlocks = true, silent = false, autosave = true } = {}) {
  const nextSize = clampGridSize(value);
  if (exactImportedStl && preserveBlocks && nextSize !== model.gridSize) {
    updateGridUi();
    if (!silent) setFeedback('EXACT STL MODE', 'Grid size is locked while an exact STL mesh is loaded. Clear the build to return to voxel editing.', true);
    return false;
  }
  if (nextSize === model.gridSize) {
    updateGridUi();
    return true;
  }

  if (serialConnected && preserveBlocks) {
    updateGridUi();
    if (!silent) setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before resizing the digital build area.', true);
    return false;
  }

  const currentBlocks = cloneBlocks();
  const fitted = preserveBlocks ? fitBlocksIntoGrid(currentBlocks, nextSize) : { fits: true, blocks: currentBlocks };

  if (!fitted.fits) {
    updateGridUi();
    if (!silent) {
      setFeedback(
        'GRID TOO SMALL',
        `The current footprint does not fit inside ${nextSize}×${nextSize}. Erase or compact the build first.`,
        true,
      );
    }
    return false;
  }

  model.setGridSize(nextSize);
  if (preserveBlocks) model.replaceExact(fitted.blocks);

  updateGridSceneGeometry();
  updateGridUi();
  ghost.visible = false;
  hoveredCandidate = null;
  setLayerView(0);
  syncViewFromModel();

  if (preserveBlocks) resetHistoryToCurrent();
  if (autosave && preserveBlocks) scheduleAutosave();

  if (!silent) {
    systemStatus.textContent = `GRID ${nextSize}×${nextSize}`;
    setFeedback(
      'GRID RESIZED',
      fitted.shifted
        ? `Active build area is now ${nextSize}×${nextSize}; the existing form was shifted to stay inside the grid.`
        : `Active build area is now ${nextSize}×${nextSize}.`,
    );
  }

  return true;
}

function snapshotSignature(blocks) {
  return JSON.stringify(blocks);
}

function safeStorageRead(key, fallback = null) {
  if (!storageEnabled) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn('Browser storage unavailable:', error);
    storageEnabled = false;
    return fallback;
  }
}

function safeStorageWrite(key, value) {
  if (!storageEnabled) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn('Could not write browser storage:', error);
    storageEnabled = false;
    return false;
  }
}

function safeStorageRemove(key) {
  if (!storageEnabled) return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn('Could not clear browser storage:', error);
    storageEnabled = false;
  }
}

function getModelHeight(blocks = []) {
  return blocks.length > 0 ? Math.max(...blocks.map((block) => block.z)) + 1 : 0;
}

function formatAutosaveTime(isoString) {
  if (!isoString) return 'Waiting for changes';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Saved';
  return `Saved ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function makeStoredSnapshot(blocks = cloneBlocks()) {
  return {
    version: 3,
    modelId: activeRecentModelId,
    savedAt: new Date().toISOString(),
    gridSize: model.gridSize,
    maxHeight: CONFIG.MAX_HEIGHT,
    surfaceMode: exportSurfaceMode,
    smoothingStrength,
    blocks: cloneBlocks(blocks),
  };
}

/**
 * Generate a short, deterministic title from the voxel geometry.
 * This deliberately describes broad structural qualities rather than pretending
 * to recognize semantic objects such as a house or animal.
 */
function generateSmartModelName(blocks = []) {
  if (!blocks.length) return 'EMPTY BUILD';

  const xs = blocks.map((block) => block.x);
  const ys = blocks.map((block) => block.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX + 1;
  const depth = maxY - minY + 1;
  const height = getModelHeight(blocks);

  const columnMap = new Map();
  for (const block of blocks) {
    const key = `${block.x},${block.y}`;
    columnMap.set(key, Math.max(columnMap.get(key) ?? 0, block.z + 1));
  }

  const columns = [...columnMap.values()];
  const columnCount = columns.length;
  const peakCount = columns.filter((value) => value === height).length;
  const uniqueHeights = [...new Set(columns)].sort((a, b) => a - b);
  const volume = Math.max(1, width * depth * height);
  const density = blocks.length / volume;
  const footprintArea = Math.max(1, width * depth);
  const footprintDensity = columnCount / footprintArea;
  const longestSide = Math.max(width, depth);
  const shortestSide = Math.max(1, Math.min(width, depth));

  const mirroredOnX = [...columnMap.entries()].every(([key, value]) => {
    const [x, y] = key.split(',').map(Number);
    return columnMap.get(`${minX + maxX - x},${y}`) === value;
  });
  const mirroredOnY = [...columnMap.entries()].every(([key, value]) => {
    const [x, y] = key.split(',').map(Number);
    return columnMap.get(`${x},${minY + maxY - y}`) === value;
  });
  const symmetric = (mirroredOnX || mirroredOnY) && columnCount >= 4;

  if (columnCount === 1) return height >= 7 ? 'TALL COLUMN' : 'SINGLE COLUMN';
  if (peakCount === 2 && height >= 5 && columnCount <= 6) return 'TWIN COLUMNS';
  if (height >= longestSide * 1.8 && height >= 6) {
    return columnCount <= 4 ? 'TALL TOWER' : 'VERTICAL CLUSTER';
  }
  if (height <= 3 && longestSide >= 7) {
    return longestSide / shortestSide >= 2.2 ? 'LONG PLATFORM' : 'LOW PLATFORM';
  }
  if (uniqueHeights.length >= 4 && height >= 5) return 'STEPPED FORM';
  if (symmetric) return height >= 5 ? 'SYMMETRIC TOWER' : 'SYMMETRIC FORM';
  if (longestSide / shortestSide >= 2.5 && columnCount >= 4) return 'LONG FORM';
  if (width <= 3 && depth <= 3 && height >= 4) return 'COMPACT STACK';
  if (density >= 0.72 && footprintDensity >= 0.7) return 'SOLID MASS';
  if (columnCount >= 8 && footprintDensity <= 0.45) return 'OPEN CLUSTER';
  if (height > longestSide) return 'VERTICAL FORM';
  if (longestSide > height * 1.7) return 'WIDE FORM';
  return 'VOXEL FORM';
}

function makeUniqueSmartModelName(blocks, recents = []) {
  const base = generateSmartModelName(blocks);
  const names = recents.map((entry) => String(entry?.name ?? '').trim()).filter(Boolean);
  const matching = names.filter((name) => name === base || name.startsWith(`${base} / `));
  if (matching.length === 0) return base;

  let suffix = 2;
  while (names.includes(`${base} / ${String(suffix).padStart(2, '0')}`)) suffix += 1;
  return `${base} / ${String(suffix).padStart(2, '0')}`;
}

function makeUniqueDuplicateName(sourceName, blocks, recents = []) {
  const source = String(sourceName || generateSmartModelName(blocks)).trim();
  const names = new Set(recents.map((entry) => String(entry?.name ?? '').trim()).filter(Boolean));
  const base = `${source} / COPY`;
  if (!names.has(base)) return base;

  let suffix = 2;
  while (names.has(`${base} ${String(suffix).padStart(2, '0')}`)) suffix += 1;
  return `${base} ${String(suffix).padStart(2, '0')}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readRecentModels() {
  const stored = safeStorageRead(RECENT_MODELS_STORAGE_KEY, []);
  if (!Array.isArray(stored)) return [];

  let changed = false;
  const normalized = stored
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;

      const legacyBlocks = extractLegacyBlockArray(entry);
      if (!legacyBlocks) return null;
      const blocks = dedupeImportedBlocks(legacyBlocks);
      if (blocks.length === 0 && legacyBlocks.length > 0) return null;

      const id = entry.id || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
      const gridSize = getLegacyGridSize(entry, blocks);
      const migrated = {
        ...entry,
        id,
        gridSize,
        blocks,
      };

      if (!entry.id || entry.blocks !== legacyBlocks || JSON.stringify(entry.blocks ?? []) !== JSON.stringify(blocks) || entry.gridSize !== gridSize) {
        changed = true;
      }
      return migrated;
    })
    .filter(Boolean);

  if (changed) safeStorageWrite(RECENT_MODELS_STORAGE_KEY, normalized);
  return normalized;
}

function setActiveRecentModel(id, { persist = true } = {}) {
  activeRecentModelId = id ? String(id) : null;

  if (!persist || !storageEnabled) return;

  if (activeRecentModelId) {
    safeStorageWrite(ACTIVE_RECENT_MODEL_STORAGE_KEY, activeRecentModelId);
  } else {
    safeStorageRemove(ACTIVE_RECENT_MODEL_STORAGE_KEY);
  }
}

function initializeActiveRecentModel() {
  const storedId = safeStorageRead(ACTIVE_RECENT_MODEL_STORAGE_KEY, null);
  activeRecentModelId = storedId ? String(storedId) : null;

  if (activeRecentModelId) {
    const exists = readRecentModels().some((entry) => String(entry.id) === activeRecentModelId);
    if (!exists) setActiveRecentModel(null);
  }
}

function bindActiveModelFromSnapshot(snapshot) {
  const recents = readRecentModels();
  const requestedId = snapshot?.modelId ? String(snapshot.modelId) : null;

  if (requestedId && recents.some((entry) => String(entry.id) === requestedId)) {
    setActiveRecentModel(requestedId);
    return;
  }

  // Backward compatibility with autosaves created before model IDs were stored.
  if (Array.isArray(snapshot?.blocks) && snapshot.blocks.length > 0) {
    const signature = snapshotSignature(snapshot.blocks);
    const match = recents.find((entry) => snapshotSignature(entry.blocks) === signature);
    if (match?.id) {
      setActiveRecentModel(match.id);
      return;
    }
  }

  setActiveRecentModel(null);
}

function setAutosaveUi(state = 'saved', label = '') {
  if (!autosaveStatus || !autosaveMeta || !autosaveToggle) return;

  const isSaving = state === 'saving';
  const isError = state === 'error';
  const isOn = autosaveEnabled && !isError;

  autosaveToggle.classList.toggle('is-on', isOn);
  autosaveToggle.classList.toggle('is-saving', isSaving);
  autosaveToggle.classList.toggle('is-error', isError);
  autosaveToggle.setAttribute('aria-checked', String(isOn));
  autosaveStatus.textContent = isError ? 'ERROR' : isSaving ? 'SAVING' : isOn ? 'ON' : 'OFF';

  if (label) {
    autosaveMeta.textContent = label;
  } else if (isError) {
    autosaveMeta.textContent = 'Browser storage unavailable';
  } else if (!autosaveEnabled) {
    autosaveMeta.textContent = 'Autosave paused';
  } else {
    autosaveMeta.textContent = 'Autosave ready';
  }
}

function initializeAutosavePreference() {
  const storedPreference = safeStorageRead(AUTOSAVE_PREF_STORAGE_KEY, true);
  autosaveEnabled = storedPreference !== false;
  setAutosaveUi(autosaveEnabled ? 'saved' : 'disabled');
}

function setAutosaveEnabled(enabled) {
  if (!storageEnabled) {
    setAutosaveUi('error');
    return;
  }

  autosaveEnabled = Boolean(enabled);
  window.clearTimeout(autosaveTimer);
  autosaveTimer = null;

  if (!safeStorageWrite(AUTOSAVE_PREF_STORAGE_KEY, autosaveEnabled)) {
    setAutosaveUi('error');
    return;
  }

  if (autosaveEnabled) {
    setAutosaveUi('saving', 'Autosave enabled…');
    persistCurrentModel({ addRecent: false });
    systemStatus.textContent = 'AUTOSAVE ON';
  } else {
    setAutosaveUi('disabled', 'Autosave paused');
    systemStatus.textContent = 'AUTOSAVE OFF';
  }
}

function renderRecentModels() {
  if (!recentModelsList) return;
  const recents = readRecentModels();

  if (recents.length === 0) {
    recentModelsList.innerHTML = `
      <div class="recent-empty">
        <strong>NO RECENT MODELS YET</strong>
        <span>Build something and it will appear here automatically.</span>
      </div>`;
    return;
  }

  recentModelsList.innerHTML = recents.map((entry, index) => {
    const date = new Date(entry.savedAt);
    const dateText = Number.isNaN(date.getTime())
      ? 'Saved model'
      : `${date.toLocaleDateString([], { month: 'short', day: '2-digit' })} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const blocks = entry.blocks.length;
    const height = getModelHeight(entry.blocks);
    const name = String(entry.name || generateSmartModelName(entry.blocks)).trim();
    const id = String(entry.id ?? index);

    const isActive = activeRecentModelId && id === activeRecentModelId;

    return `
      <article class="recent-item${isActive ? ' is-active' : ''}" data-recent-index="${index}" data-recent-id="${escapeHtml(id)}">
        <div class="recent-item__index">${String(index + 1).padStart(2, '0')}</div>
        <div class="recent-item__copy">
          <strong class="recent-item__title">${escapeHtml(name)}</strong>
          <span class="recent-item__date">${escapeHtml(dateText)}</span>
          <span class="recent-item__meta">${String(blocks).padStart(3, '0')} BLOCKS · ${String(entry.gridSize ?? CONFIG.GRID_SIZE).padStart(2, '0')}×${String(entry.gridSize ?? CONFIG.GRID_SIZE).padStart(2, '0')} GRID · ${String(height).padStart(2, '0')}/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')} HEIGHT</span>
        </div>
        <button class="recent-open" data-recent-action="open" data-recent-index="${index}" type="button">OPEN</button>
        <button class="recent-rename" data-recent-action="rename" data-recent-index="${index}" type="button">RENAME</button>
        <button class="recent-duplicate" data-recent-action="duplicate" data-recent-index="${index}" type="button">DUPLICATE</button>
        <button class="recent-delete" data-recent-action="delete" data-recent-index="${index}" type="button" aria-label="Delete recent model ${index + 1}">×</button>
      </article>`;
  }).join('');

  // Bind actions directly after each render. This avoids any ambiguity with
  // nested modal elements and makes the Rename interaction reliable.
  recentModelsList.querySelectorAll('[data-recent-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(button.dataset.recentIndex);
      if (!Number.isInteger(index)) return;

      const action = button.dataset.recentAction;
      if (action === 'open') openRecentModel(index);
      if (action === 'rename') beginRenameRecentModel(index);
      if (action === 'rename-save') saveRecentModelRename(index);
      if (action === 'duplicate') duplicateRecentModel(index);
      if (action === 'delete') deleteRecentModel(index);
      if (action === 'rename-cancel') renderRecentModels();
    });
  });
}

function persistCurrentModel({ addRecent = true, force = false } = {}) {
  if (!autosaveEnabled && !force) {
    setAutosaveUi('disabled', 'Autosave paused');
    return;
  }

  if (!storageEnabled) {
    setAutosaveUi('error');
    return;
  }

  const snapshot = makeStoredSnapshot();
  setAutosaveUi('saving', 'Saving locally…');

  // Recent Models behave as persistent model entries, not a stream of duplicate
  // snapshots. If a recent model is active, autosave updates that same entry.
  if (addRecent && snapshot.blocks.length > 0) {
    const recents = readRecentModels();
    const activeIndex = activeRecentModelId
      ? recents.findIndex((entry) => String(entry.id) === String(activeRecentModelId))
      : -1;

    if (activeIndex >= 0) {
      const existing = recents[activeIndex];
      const otherRecents = recents.filter((_, index) => index !== activeIndex);
      const updated = {
        ...existing,
        ...snapshot,
        id: existing.id,
        modelId: existing.id,
        name: existing.customName
          ? existing.name
          : makeUniqueSmartModelName(snapshot.blocks, otherRecents),
        customName: Boolean(existing.customName),
      };

      // Most recently edited model goes to the top, but keeps its identity.
      recents.splice(activeIndex, 1);
      recents.unshift(updated);
      setActiveRecentModel(existing.id);
      snapshot.modelId = String(existing.id);
      safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents.slice(0, RECENT_MODELS_LIMIT));
    } else {
      const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      setActiveRecentModel(id);
      snapshot.modelId = String(id);
      recents.unshift({
        id,
        name: makeUniqueSmartModelName(snapshot.blocks, recents),
        customName: false,
        ...snapshot,
      });
      safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents.slice(0, RECENT_MODELS_LIMIT));
    }
  } else {
    snapshot.modelId = activeRecentModelId;
  }

  if (!safeStorageWrite(AUTOSAVE_STORAGE_KEY, snapshot)) {
    setAutosaveUi('error');
    return;
  }

  setAutosaveUi('saved', formatAutosaveTime(snapshot.savedAt));
  renderRecentModels();
}

function scheduleAutosave(options = {}) {
  if (!storageEnabled || !autosaveEnabled) return;
  window.clearTimeout(autosaveTimer);
  setAutosaveUi('saving', 'Changes pending…');
  autosaveTimer = window.setTimeout(() => persistCurrentModel(options), AUTOSAVE_DELAY_MS);
}

function restoreLatestAutosave() {
  if (!autosaveEnabled) {
    setAutosaveUi('disabled', 'Autosave paused');
    return false;
  }

  const snapshot = safeStorageRead(AUTOSAVE_STORAGE_KEY, null);
  const legacyBlocks = extractLegacyBlockArray(snapshot);
  if (!snapshot || !legacyBlocks) {
    setAutosaveUi(storageEnabled ? 'saved' : 'error', storageEnabled ? 'Autosave ready' : 'Browser storage unavailable');
    return false;
  }
  const restoredBlocks = dedupeImportedBlocks(legacyBlocks);

  clearExactStlMode();
  bindActiveModelFromSnapshot({ ...snapshot, blocks: restoredBlocks });
  setActiveGridSize(getLegacyGridSize(snapshot, restoredBlocks), { preserveBlocks: false, silent: true, autosave: false });
  const rejected = model.replaceExact(cloneBlocks(restoredBlocks));
  if (['voxel', 'soft1'].includes(snapshot.surfaceMode)) exportSurfaceMode = snapshot.surfaceMode;
  if (Number.isFinite(Number(snapshot.smoothingStrength))) {
    smoothingStrength = THREE.MathUtils.clamp(Math.round(Number(snapshot.smoothingStrength)), 1, 5);
  }
  setExportSurfaceMode(exportSurfaceMode, { rebuild: false });
  updateSmoothingStrengthUi(smoothingStrength);
  scheduleRealtimeOrganicSurface({ immediate: true });
  setAutosaveUi('saved', formatAutosaveTime(snapshot.savedAt));
  systemStatus.textContent = rejected.length ? 'AUTOSAVE PARTLY RESTORED' : 'AUTOSAVE RESTORED';
  setFeedback(
    rejected.length ? 'AUTOSAVE PARTLY RESTORED' : 'AUTOSAVE RESTORED',
    rejected.length
      ? `${model.getBlockCount()} block(s) restored; ${rejected.length} invalid saved block(s) rejected.`
      : `${model.getBlockCount()} block(s) restored from your latest browser autosave.`,
    rejected.length > 0,
  );
  return true;
}

function prepareSourceMorph(element, sourceElement, {
  xVar = '--modal-source-x',
  yVar = '--modal-source-y',
  scaleVar = '--modal-source-scale',
  travel = 0.68,
  minScale = 0.28,
  maxScale = 0.42,
  scaleBoost = 2.5,
} = {}) {
  if (!element || !sourceElement) return;

  const sourceRect = sourceElement.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const sourceCenterX = sourceRect.left + sourceRect.width / 2;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const elementCenterX = elementRect.left + elementRect.width / 2;
  const elementCenterY = elementRect.top + elementRect.height / 2;
  const elementWidth = Math.max(1, element.offsetWidth);
  const elementHeight = Math.max(1, element.offsetHeight);
  const sourceScale = Math.min(sourceRect.width / elementWidth, sourceRect.height / elementHeight) * 0.92;
  const clampedScale = Math.max(minScale, Math.min(maxScale, (sourceScale || minScale) * scaleBoost));

  element.style.setProperty(xVar, `${(sourceCenterX - elementCenterX) * travel}px`);
  element.style.setProperty(yVar, `${(sourceCenterY - elementCenterY) * travel}px`);
  element.style.setProperty(scaleVar, clampedScale.toFixed(4));
}

function prepareModalSourceMorph(modal, sourceElement) {
  const panel = modal?.querySelector('[class$="__panel"]');
  if (!modal || !panel || !sourceElement) return;
  prepareSourceMorph(panel, sourceElement, {
    xVar: '--modal-source-x',
    yVar: '--modal-source-y',
    scaleVar: '--modal-source-scale',
    travel: 0.64,
    minScale: 0.38,
    maxScale: 0.50,
    scaleBoost: 3.1,
  });
}

function preparePopoverSourceMorph(popover, sourceElement, options = {}) {
  if (!popover || !sourceElement) return;
  prepareSourceMorph(popover, sourceElement, {
    xVar: '--popover-source-x',
    yVar: '--popover-source-y',
    scaleVar: '--popover-source-scale',
    travel: 0.50,
    minScale: 0.78,
    maxScale: 0.94,
    scaleBoost: 2.15,
    ...options,
  });
}

function openRecentModal(sourceElement = openRecentModelsButton) {
  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before opening another saved build.', true);
    return;
  }
  renderRecentModels();
  recentModal.hidden = false;
  prepareModalSourceMorph(recentModal, sourceElement);
  document.body.classList.add('modal-open');
  controls.enabled = false;
  requestAnimationFrame(() => {
    recentModal.classList.add('is-open');
    recentModelsList.querySelector('.recent-open')?.focus();
  });
}

function closeRecentModal() {
  prepareModalSourceMorph(recentModal, openRecentModelsButton);
  recentModal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  controls.enabled = true;
  window.setTimeout(() => {
    recentModal.hidden = true;
  }, 560);
}

function openRecentModel(index) {
  if (serialConnected) {
    closeRecentModal();
    setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before restoring a recent digital model.', true);
    return;
  }

  const recents = readRecentModels();
  const entry = recents[index];
  if (!entry?.blocks) return;

  clearExactStlMode();

  // Switch identity first. Restoring an existing model must never create a new
  // Recent Models entry merely because it was opened.
  setActiveRecentModel(entry.id);
  setActiveGridSize(entry.gridSize ?? CONFIG.GRID_SIZE, { preserveBlocks: false, silent: true, autosave: false });
  const rejected = model.replaceExact(cloneBlocks(entry.blocks));
  if (['voxel', 'soft1'].includes(entry.surfaceMode)) exportSurfaceMode = entry.surfaceMode;
  if (Number.isFinite(Number(entry.smoothingStrength))) {
    smoothingStrength = THREE.MathUtils.clamp(Math.round(Number(entry.smoothingStrength)), 1, 5);
  }
  setExportSurfaceMode(exportSurfaceMode, { rebuild: false });
  updateSmoothingStrengthUi(smoothingStrength);
  resetHistoryToCurrent();
  setLayerView(0);
  syncViewFromModel();
  persistCurrentModel({ addRecent: false });
  closeRecentModal();
  systemStatus.textContent = rejected.length ? 'RECENT MODEL PARTLY RESTORED' : 'RECENT MODEL RESTORED';
  setFeedback(
    rejected.length ? 'RECENT MODEL PARTLY RESTORED' : 'RECENT MODEL RESTORED',
    `${model.getBlockCount()} block(s) loaded from browser history${rejected.length ? `; ${rejected.length} rejected` : ''}.`,
    rejected.length > 0,
  );
}

function duplicateRecentModel(index) {
  const recents = readRecentModels();
  const source = recents[index];
  if (!source?.blocks) return;

  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const savedAt = new Date().toISOString();
  const duplicate = {
    ...source,
    id,
    modelId: id,
    name: makeUniqueDuplicateName(source.name, source.blocks, recents),
    customName: true,
    savedAt,
    blocks: cloneBlocks(source.blocks),
  };

  // Keep the original model active. DUPLICATE creates a separate branch in the
  // browser gallery; the user can OPEN it explicitly when they want to edit it.
  recents.unshift(duplicate);
  if (!safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents.slice(0, RECENT_MODELS_LIMIT))) {
    systemStatus.textContent = 'DUPLICATE FAILED';
    setAutosaveUi('error', 'Could not duplicate recent model');
    return;
  }

  renderRecentModels();
  systemStatus.textContent = 'RECENT MODEL DUPLICATED';
  setAutosaveUi('saved', `Created ${duplicate.name}`);
}

function deleteRecentModel(index) {
  const recents = readRecentModels();
  const removed = recents[index];
  recents.splice(index, 1);
  safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents);
  if (removed?.id && String(removed.id) === String(activeRecentModelId)) {
    setActiveRecentModel(null);
  }
  renderRecentModels();
}

function beginRenameRecentModel(index) {
  const recents = readRecentModels();
  const entry = recents[index];
  const item = recentModelsList.querySelector(`[data-recent-index="${index}"]`);
  const copy = item?.querySelector('.recent-item__copy');
  const title = item?.querySelector('.recent-item__title');
  const renameButton = item?.querySelector('.recent-rename');
  if (!entry || !item || !copy || !title || !renameButton) return;

  // Prevent opening multiple rename editors in the same list.
  recentModelsList.querySelectorAll('.recent-item.is-renaming').forEach((otherItem) => {
    if (otherItem !== item) otherItem.classList.remove('is-renaming');
  });

  item.classList.add('is-renaming');

  const input = document.createElement('input');
  input.className = 'recent-rename-input';
  input.type = 'text';
  input.maxLength = 48;
  input.value = String(entry.name || generateSmartModelName(entry.blocks));
  input.setAttribute('aria-label', 'Rename recent model');
  input.autocomplete = 'off';
  input.spellcheck = false;
  title.replaceWith(input);

  renameButton.textContent = 'SAVE';
  renameButton.dataset.recentAction = 'rename-save';

  // Add a visible cancel affordance while renaming by reusing the open button.
  const openButton = item.querySelector('.recent-open');
  if (openButton) {
    openButton.textContent = 'CANCEL';
    openButton.dataset.recentAction = 'rename-cancel';
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRecentModelRename(index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      renderRecentModels();
    }
  });

  input.addEventListener('click', (event) => event.stopPropagation());

  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.select();
  });
}

function saveRecentModelRename(index) {
  const recents = readRecentModels();
  const entry = recents[index];
  const item = recentModelsList.querySelector(`[data-recent-index="${index}"]`);
  const input = item?.querySelector('.recent-rename-input');
  if (!entry || !input) return;

  const nextName = input.value.trim().replace(/\s+/g, ' ').slice(0, 48);
  entry.name = nextName || generateSmartModelName(entry.blocks);
  entry.customName = Boolean(nextName);

  if (!safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents)) {
    systemStatus.textContent = 'RENAME FAILED';
    setAutosaveUi('error', 'Could not save model name');
    return;
  }

  renderRecentModels();
  systemStatus.textContent = 'RECENT MODEL RENAMED';
  setAutosaveUi('saved', `Named ${entry.name}`);
}

function updateHistoryControls() {
  const lockedByHardware = serialConnected;
  const lockedByLayerView = activeLayerView !== null;
  const historyLocked = lockedByHardware || lockedByLayerView;
  undoBuildButton.disabled = historyLocked || historyIndex <= 0;
  redoBuildButton.disabled = historyLocked || historyIndex >= history.length - 1;
  undoBuildButton.title = lockedByHardware
    ? 'Disconnect ESP32 to use history'
    : lockedByLayerView
      ? 'Return Layer View to ALL to use Undo'
      : 'Undo (Ctrl/Cmd + Z)';
  redoBuildButton.title = lockedByHardware
    ? 'Disconnect ESP32 to use history'
    : lockedByLayerView
      ? 'Return Layer View to ALL to use Redo'
      : 'Redo (Ctrl/Cmd + Shift + Z)';
}

function recordHistory() {
  const snapshot = cloneBlocks();
  const current = history[historyIndex] ?? [];
  if (snapshotSignature(snapshot) === snapshotSignature(current)) {
    updateHistoryControls();
    return;
  }

  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);

  if (history.length > HISTORY_LIMIT) {
    history.shift();
  } else {
    historyIndex += 1;
  }

  historyIndex = history.length - 1;
  updateHistoryControls();
  scheduleAutosave();
}

function resetHistoryToCurrent() {
  history = [cloneBlocks()];
  historyIndex = 0;
  updateHistoryControls();
}

function applyHistorySnapshot(index, label) {
  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before using Undo / Redo.', true);
    return;
  }
  if (exactImportedStl) {
    setFeedback('EXACT STL MODE', 'Undo / Redo applies to editable voxel builds. Clear the imported STL first.', true);
    return;
  }
  if (serialConnected) {
    setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before using Undo / Redo.', true);
    return;
  }

  const snapshot = history[index];
  if (!snapshot) return;

  model.replaceExact(cloneBlocks(snapshot));
  historyIndex = index;
  syncViewFromModel();
  ghost.visible = false;
  hoveredCandidate = null;
  updateHistoryControls();
  systemStatus.textContent = label;
  setFeedback(label, `${model.getBlockCount()} block(s) in the restored model state.`);
  scheduleAutosave();
}

function undoBuild() {
  if (historyIndex <= 0) return;
  applyHistorySnapshot(historyIndex - 1, 'UNDO APPLIED');
}

function redoBuild() {
  if (historyIndex >= history.length - 1) return;
  applyHistorySnapshot(historyIndex + 1, 'REDO APPLIED');
}

function setLayerView(value) {
  if (exportSurfaceMode === 'soft1' && Number(value) > 0) {
    activeLayerView = null;
    layerSlider.value = '0';
    layerSlider.classList.remove('is-active');
    setRangeProgress(layerSlider);
    showAllLayersButton.classList.add('is-active');
    layerValue.textContent = 'ALL';
    setFeedback('SMOOTH VIEW', 'Layer View is disabled while Smooth is active. Switch to Blocks to inspect individual layers.', true);
    return;
  }
  if (exactImportedStl) {
    activeLayerView = null;
    layerSlider.value = '0';
    layerSlider.classList.remove('is-active');
    setRangeProgress(layerSlider);
    showAllLayersButton.classList.add('is-active');
    layerValue.textContent = 'ALL';
    return;
  }
  const numeric = Number(value);
  activeLayerView = numeric <= 0 ? null : numeric - 1;
  const sliderValue = activeLayerView === null ? 0 : activeLayerView + 1;
  layerSlider.value = String(sliderValue);
  layerSlider.classList.toggle('is-active', activeLayerView !== null);
  setRangeProgress(layerSlider);
  showAllLayersButton.classList.toggle('is-active', activeLayerView === null);
  layerValue.textContent = activeLayerView === null
    ? 'ALL'
    : `${String(activeLayerView + 1).padStart(2, '0')}/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')}`;

  ghost.visible = false;
  hoveredCandidate = null;
  syncViewFromModel();
  updateOrganicEditingLocks();
  updateHistoryControls();

  if (activeLayerView === null) {
    setFeedback('ALL LAYERS', 'Full model visible. Building controls are active.');
  } else {
    setFeedback(
      `LAYERS 01–${String(activeLayerView + 1).padStart(2, '0')}`,
      'Showing the build from the base up to this layer. Set the slider to ALL to edit the build.',
    );
  }
}

/**
 * STRICT render pass: destroy the previous block view and recreate it only from
 * model.getBlocks(). This is intentionally simple and reliable for UX testing.
 */
function syncViewFromModel() {
  blocksGroup.clear();

  if (exactImportedStl) {
    blocksGroup.visible = false;
    realtimeOrganicGroup.visible = false;
    window.clearTimeout(realtimeSmoothTimer);
    blockMetric.textContent = 'MESH';
    const liveHeight = Math.min(CONFIG.MAX_HEIGHT, Math.ceil(exactImportedStl.heightMm / CONFIG.PHYSICAL_BLOCK_MM));
    heightMetric.textContent = `${String(liveHeight).padStart(2, '0')}/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')}`;
    applyRealtimeSurfaceVisibility();
    return;
  }

  blocksGroup.visible = true;

  for (const block of model.getBlocks()) {
    if (activeLayerView !== null && block.z > activeLayerView) continue;

    const material = block.type === 'support' ? supportMaterial : getStandardBlockMaterial(block.color);
    const mesh = new THREE.Mesh(blockGeometry, material);
    mesh.position.copy(modelToWorld(block.x, block.y, block.z));
    mesh.castShadow = block.type !== 'support';
    mesh.receiveShadow = true;
    mesh.userData = {
      kind: 'block',
      x: block.x,
      y: block.y,
      z: block.z,
      type: block.type,
      ...(block.type === 'standard' ? { color: normalizeStandardBlockColor(block.color) } : {}),
    };

    if (block.type === 'support') {
      const edges = new THREE.LineSegments(blockEdgesGeometry, supportEdgeMaterial);
      mesh.add(edges);
    } else if (recolorSelectedKeys.has(modelBlockKey(block.x, block.y, block.z))) {
      const outline = new THREE.LineSegments(
        blockEdgesGeometry,
        usesDarkSelectionOutline(block.color) ? recolorSelectionDarkMaterial : recolorSelectionLightMaterial,
      );
      outline.scale.setScalar(1.045);
      outline.renderOrder = 12;
      outline.userData.kind = 'recolor-selection';
      mesh.add(outline);
    }

    blocksGroup.add(mesh);
  }

  const blocks = model.getBlocks();
  const liveHeight = blocks.length > 0
    ? Math.max(...blocks.map((block) => block.z)) + 1
    : 0;

  blockMetric.textContent = String(model.getBlockCount()).padStart(3, '0');
  heightMetric.textContent = `${String(liveHeight).padStart(2, '0')}/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')}`;
  applyRealtimeSurfaceVisibility();
  scheduleRealtimeOrganicSurface();
}

// -----------------------------------------------------------------------------
// 7. RAYCASTING + PHYSICAL PLACEMENT PREVIEW
// -----------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getClosestInteractiveIntersection(event) {
  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  // Base + currently rendered block meshes are the only interactive surfaces.
  const targets = [baseMesh, ...blocksGroup.children];
  return raycaster.intersectObjects(targets, false)[0] ?? null;
}

/**
 * Convert a hit surface into the candidate cell next to that surface.
 * This is what lets a side-face hover visibly demonstrate an invalid overhang.
 */
function intersectionToCandidate(intersection) {
  if (!intersection) return null;

  if (intersection.object.userData.kind === 'base') {
    return worldToBaseCell(intersection.point);
  }

  if (intersection.object.userData.kind === 'block') {
    const { x, y, z } = intersection.object.userData;
    const normal = intersection.face?.normal ?? new THREE.Vector3(0, 1, 0);

    // Blocks are never rotated, so local face normal maps directly to world axes.
    // world X -> model X, world Z -> model Y, world Y -> model Z.
    return {
      x: x + Math.round(normal.x),
      y: y + Math.round(normal.z),
      z: z + Math.round(normal.y),
    };
  }

  return null;
}

function setFeedback(title, text, invalid = false) {
  feedbackTitle.textContent = title;
  feedbackText.textContent = text;
  feedbackCard.classList.toggle('is-invalid', invalid);
}

function setGhostColor(valid) {
  if (valid && selectedTool === 'standard') {
    ghostMaterial.color.set(selectedBlockColor);
    ghostEdgeMaterial.color.set(selectedBlockColor);
  } else {
    const color = valid ? COLORS.validGhost : COLORS.invalid;
    ghostMaterial.color.setHex(color);
    ghostEdgeMaterial.color.setHex(color);
  }
  ghostMaterial.opacity = valid ? 0.12 : 0.18;
  ghostEdgeMaterial.opacity = 1;
}

function updateHover(event) {
  if (exactImportedStl) {
    ghost.visible = false;
    hoveredCandidate = null;
    setFeedback('EXACT STL MESH', 'The saved STL surface is displayed exactly. Clear the build to return to editable voxels.');
    return;
  }

  if (recolorTarget === 'selected') {
    ghost.visible = false;
    hoveredCandidate = null;
    const intersection = getClosestInteractiveIntersection(event);
    if (intersection?.object.userData.kind === 'block' && intersection.object.userData.type === 'standard') {
      const { x, y, z } = intersection.object.userData;
      const key = modelBlockKey(x, y, z);
      const action = recolorSelectedKeys.has(key) ? 'deselect' : 'select';
      setFeedback('SELECT MODEL COLOR', `Click Standard Cube [${x}, ${y}, ${z}] to ${action} it · ${String(recolorSelectedKeys.size).padStart(2, '0')} selected.`);
    } else {
      setFeedback('SELECT MODEL COLOR', `Select Standard Cubes in the model, then choose a color · ${String(recolorSelectedKeys.size).padStart(2, '0')} selected.`);
    }
    return;
  }

  if (exportSurfaceMode === 'soft1' || selectedTool === 'free') {
    ghost.visible = false;
    hoveredCandidate = null;
    return;
  }

  if (activeLayerView !== null) {
    ghost.visible = false;
    hoveredCandidate = null;
    setFeedback(
      `LAYERS 01–${String(activeLayerView + 1).padStart(2, '0')}`,
      'Cumulative layer view is inspection-only. Return to ALL layers to place or erase blocks.',
    );
    return;
  }

  if (serialConnected) {
    ghost.visible = false;
    hoveredCandidate = null;
    setFeedback('HARDWARE MODE', 'ESP32 is the source of truth. Disconnect it to edit with the mouse.');
    return;
  }

  const intersection = getClosestInteractiveIntersection(event);

  if (selectedTool === 'eraser') {
    hoveredCandidate = null;
    ghost.visible = false;

    if (intersection?.object.userData.kind === 'block') {
      const { x, y, z } = intersection.object.userData;
      ghost.position.copy(modelToWorld(x, y, z));
      setGhostColor(false);
      ghost.visible = true;
      setFeedback('ERASE BLOCK', `Remove [${x}, ${y}, ${z}] and apply gravity to its stack.`);
    } else {
      setFeedback('ERASER ACTIVE', 'Hover an existing block to remove it.');
    }
    return;
  }

  const candidate = intersectionToCandidate(intersection);
  hoveredCandidate = candidate;

  if (!candidate) {
    ghost.visible = false;
    setFeedback('PLACE ON BASE', 'Hover a cell or block face to preview a physically valid placement.');
    return;
  }

  const validation = model.validatePlacement(candidate.x, candidate.y, candidate.z);
  ghost.position.copy(modelToWorld(candidate.x, candidate.y, candidate.z));
  setGhostColor(validation.valid);
  ghost.visible = true;

  if (validation.valid) {
    setFeedback(
      'VALID PLACEMENT',
      `[${candidate.x}, ${candidate.y}, ${candidate.z}] · ${validation.reason}`,
      false,
    );
  } else {
    setFeedback(
      'PHYSICAL CONSTRAINT',
      `[${candidate.x}, ${candidate.y}, ${candidate.z}] · ${validation.reason}`,
      true,
    );
  }
}

// -----------------------------------------------------------------------------
// 8. INPUT -> MODEL MUTATION -> RENDER SYNC
// -----------------------------------------------------------------------------
function handleCanvasAction(event) {
  if (exactImportedStl) {
    setFeedback('EXACT STL MODE', 'This STL is preserved as an exact mesh. Clear it before starting a new editable voxel build.', true);
    return;
  }

  if (recolorTarget === 'selected') {
    const intersection = getClosestInteractiveIntersection(event);
    if (intersection?.object.userData.kind !== 'block' || intersection.object.userData.type !== 'standard') {
      setFeedback('SELECT MODEL COLOR', 'Only Standard Cubes can be selected for recoloring.');
      return;
    }
    const { x, y, z } = intersection.object.userData;
    const key = modelBlockKey(x, y, z);
    if (recolorSelectedKeys.has(key)) recolorSelectedKeys.delete(key);
    else recolorSelectedKeys.add(key);
    updateRecolorTargetUi();
    syncViewFromModel();
    setFeedback('SELECT MODEL COLOR', `${String(recolorSelectedKeys.size).padStart(2, '0')} Standard Cube(s) selected · choose a color in the open color panel.`);
    return;
  }

  if (exportSurfaceMode === 'soft1') {
    setFeedback('SMOOTH VIEW', 'Editing is disabled in Smooth view. Switch Model View to Blocks to place or erase cubes.', true);
    return;
  }

  if (selectedTool === 'free') {
    return;
  }

  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Cumulative layer view is inspection-only. Return to ALL layers before editing the build.', true);
    return;
  }

  if (serialConnected) {
    setFeedback('HARDWARE MODE', 'ESP32 is connected. Disconnect it before using mouse placement.', true);
    return;
  }

  const intersection = getClosestInteractiveIntersection(event);

  if (selectedTool === 'eraser') {
    if (intersection?.object.userData.kind !== 'block') return;

    const { x, y, z } = intersection.object.userData;
    const result = model.removeBlockAndApplyGravity(x, y, z);
    if (result.removed) recordHistory();
    syncViewFromModel();
    ghost.visible = false;
    systemStatus.textContent = result.reason;
    setFeedback('STACK UPDATED', result.reason);
    return;
  }

  const candidate = intersectionToCandidate(intersection);
  if (!candidate) return;

  const result = model.placeBlock(
    candidate.x,
    candidate.y,
    candidate.z,
    selectedTool,
    selectedTool === 'standard' ? selectedBlockColor : null,
  );

  if (!result.valid) {
    systemStatus.textContent = result.reason;
    setFeedback('PLACEMENT BLOCKED', result.reason, true);
    return;
  }

  recordHistory();
  syncViewFromModel();
  systemStatus.textContent = 'MODEL STATE UPDATED';

  // Re-evaluate hover after placement because the surface under the pointer changed.
  updateHover(event);
}

// -----------------------------------------------------------------------------
// CONTINUOUS BUILD / ERASE
// -----------------------------------------------------------------------------
// In Continuous Build mode, the canvas behaves like a paint surface:
// - Hold + drag with Standard/Support to place one block on top of each column.
// - Hold still to keep stacking the same column upward.
// - Eraser removes continuously while dragging/holding.
// - Alt + left-drag is reserved for OrbitControls while the mode is enabled.
// A whole press/drag/release stroke is recorded as ONE Undo step.
function canUseDigitalEditing() {
  return recolorTarget === 'new' && exportSurfaceMode !== 'soft1' && selectedTool !== 'free' && activeLayerView === null && !serialConnected && !exactImportedStl;
}

function findNextStackLevel(x, y) {
  let z = 0;
  while (z < CONFIG.MAX_HEIGHT && model.has(x, y, z)) z += 1;
  return z;
}

function getContinuousColumnFromEvent(event) {
  const intersection = getClosestInteractiveIntersection(event);
  if (!intersection) return null;

  if (intersection.object.userData.kind === 'block') {
    const { x, y } = intersection.object.userData;
    return { x, y };
  }

  if (intersection.object.userData.kind === 'base') {
    const cell = worldToBaseCell(intersection.point);
    return model.isInsideBase(cell.x, cell.y) ? { x: cell.x, y: cell.y } : null;
  }

  return null;
}

function markContinuousMutation(label, message) {
  continuousStrokeDirty = true;
  syncViewFromModel();
  systemStatus.textContent = label;
  setFeedback('CONTINUOUS EDIT', message);
}

function applyContinuousAtPointer(event, { fromHold = false } = {}) {
  if (!continuousStrokeActive || !canUseDigitalEditing()) return false;

  continuousLastPointer = { clientX: event.clientX, clientY: event.clientY };

  if (selectedTool === 'eraser') {
    const intersection = getClosestInteractiveIntersection(event);
    if (intersection?.object.userData.kind !== 'block') return false;

    const { x, y, z } = intersection.object.userData;
    const columnKey = `${x},${y}`;
    continuousCurrentColumn = { x, y };

    // During a drag, erase once per entered column. Holding still bypasses this
    // guard so the column can be removed progressively.
    if (!fromHold && continuousLastColumnKey === columnKey) return false;
    continuousLastColumnKey = columnKey;

    const result = model.removeBlockAndApplyGravity(x, y, z);
    if (!result.removed) return false;

    markContinuousMutation('CONTINUOUS ERASE', `Removed [${x}, ${y}, ${z}] · hold or drag to continue.`);
    return true;
  }

  const column = getContinuousColumnFromEvent(event);
  if (!column) return false;

  const columnKey = `${column.x},${column.y}`;
  continuousCurrentColumn = column;

  // Dragging paints a single block per entered column. Holding still is what
  // intentionally repeats the same column vertically.
  if (!fromHold && continuousLastColumnKey === columnKey) return false;
  continuousLastColumnKey = columnKey;

  const z = findNextStackLevel(column.x, column.y);
  if (z >= CONFIG.MAX_HEIGHT) {
    setFeedback('MAX HEIGHT', `Column [${column.x}, ${column.y}] is already ${CONFIG.MAX_HEIGHT} blocks high.`, true);
    return false;
  }

  const result = model.placeBlock(
    column.x,
    column.y,
    z,
    selectedTool,
    selectedTool === 'standard' ? selectedBlockColor : null,
  );
  if (!result.valid) {
    setFeedback('PLACEMENT BLOCKED', result.reason, true);
    return false;
  }

  markContinuousMutation(
    selectedTool === 'support' ? 'SUPPORT PAINT' : 'STANDARD PAINT',
    `Placed ${selectedTool} at [${column.x}, ${column.y}, ${z}] · hold still to stack upward.`,
  );
  return true;
}

function clearContinuousHoldTimers() {
  if (continuousHoldTimeout) clearTimeout(continuousHoldTimeout);
  if (continuousHoldInterval) clearInterval(continuousHoldInterval);
  continuousHoldTimeout = null;
  continuousHoldInterval = null;
}

function startContinuousHoldTimers() {
  clearContinuousHoldTimers();
  if (!continuousStrokeActive || !continuousLastPointer) return;

  continuousHoldTimeout = setTimeout(() => {
    if (!continuousStrokeActive || !continuousLastPointer) return;

    const repeat = () => {
      if (!continuousStrokeActive || !continuousLastPointer) return;
      applyContinuousAtPointer(continuousLastPointer, { fromHold: true });
    };

    repeat();
    continuousHoldInterval = setInterval(repeat, CONTINUOUS_REPEAT_MS);
  }, CONTINUOUS_HOLD_DELAY_MS);
}

function beginContinuousStroke(event) {
  if (!canUseDigitalEditing()) {
    if (activeLayerView !== null) {
      setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before continuous editing.', true);
    } else if (serialConnected) {
      setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before continuous editing.', true);
    }
    return;
  }

  continuousStrokeActive = true;
  continuousStrokeDirty = false;
  continuousPointerId = event.pointerId;
  continuousCurrentColumn = null;
  continuousLastColumnKey = null;
  continuousLastPointer = { clientX: event.clientX, clientY: event.clientY };
  lastPointerDown = null;

  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is a convenience; continuous editing still works without it.
  }

  applyContinuousAtPointer(event);
  startContinuousHoldTimers();
}

function finishContinuousStroke(event = null) {
  if (!continuousStrokeActive) return;

  clearContinuousHoldTimers();

  if (continuousStrokeDirty) {
    // One whole paint/erase gesture = one history entry.
    recordHistory();
  }

  if (continuousPointerId !== null) {
    try {
      renderer.domElement.releasePointerCapture(continuousPointerId);
    } catch {
      // Ignore if the browser already released capture.
    }
  }

  continuousStrokeActive = false;
  continuousStrokeDirty = false;
  continuousPointerId = null;
  continuousCurrentColumn = null;
  continuousLastColumnKey = null;
  continuousLastPointer = null;
  controls.enabled = true;

  if (event) updateHover(event);
}

function setContinuousBuildEnabled(enabled) {
  if (enabled && activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Continuous Build is disabled while inspecting layers. Return to ALL to edit.', true);
    return;
  }
  if (enabled && exportSurfaceMode === 'soft1') {
    setFeedback('SMOOTH VIEW', 'Continuous Build is disabled while Smooth is active. Switch to Blocks to edit.', true);
    return;
  }
  if (enabled && selectedTool === 'free') {
    setFeedback('FREE MOVE', 'Camera-only mode is active. Choose a cube or eraser tool before enabling Continuous Build.', true);
    return;
  }
  if (!enabled && continuousStrokeActive) finishContinuousStroke();

  continuousBuildEnabled = Boolean(enabled);
  continuousToggle.classList.toggle('is-on', continuousBuildEnabled);
  continuousToggle.setAttribute('aria-checked', String(continuousBuildEnabled));
  continuousStatus.textContent = continuousBuildEnabled ? 'ON' : 'OFF';

  if (continuousBuildEnabled) {
    systemStatus.textContent = 'CONTINUOUS BUILD ON';
    setFeedback(
      'CONTINUOUS BUILD',
      selectedTool === 'eraser'
        ? 'Hold / drag to erase continuously. Hold still to keep removing from the same column.'
        : 'Hold / drag to paint a row or path. Hold still to stack a vertical column. Alt + drag orbits.',
    );
  } else {
    systemStatus.textContent = 'CONTINUOUS BUILD OFF';
    setFeedback('SINGLE BUILD', 'Click to place or erase one block. Drag normally to orbit the model.');
  }
}

// Capture phase runs before OrbitControls. In continuous mode we temporarily
// disable left-drag orbit for a paint stroke, while Alt+drag keeps orbit active.
renderer.domElement.addEventListener('pointerdown', (event) => {
  const shouldPaint = continuousBuildEnabled
    && event.button === 0
    && !event.altKey
    && canUseDigitalEditing();

  if (shouldPaint) controls.enabled = false;
}, { capture: true });

renderer.domElement.addEventListener('pointermove', (event) => {
  if (continuousStrokeActive) {
    const previous = continuousLastPointer;
    const moved = !previous || Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) > 3;

    applyContinuousAtPointer(event);
    if (moved) startContinuousHoldTimers();
    updateHover(event);
    return;
  }

  updateHover(event);
});

renderer.domElement.addEventListener('pointerleave', () => {
  if (continuousStrokeActive) return;
  ghost.visible = false;
  hoveredCandidate = null;
});

// Normal mode keeps the original click-vs-orbit behavior. Continuous mode uses
// press/drag/release instead, with Alt+drag reserved for camera orbit.
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (continuousBuildEnabled && event.button === 0 && !event.altKey && canUseDigitalEditing()) {
    beginContinuousStroke(event);
    return;
  }

  lastPointerDown = { x: event.clientX, y: event.clientY, skipAction: Boolean(event.altKey) };
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (continuousStrokeActive) {
    finishContinuousStroke(event);
    return;
  }

  if (!lastPointerDown) return;

  const distance = Math.hypot(
    event.clientX - lastPointerDown.x,
    event.clientY - lastPointerDown.y,
  );

  if (distance <= 4 && event.button === 0 && !lastPointerDown.skipAction) {
    handleCanvasAction(event);
  }

  lastPointerDown = null;
});

renderer.domElement.addEventListener('pointercancel', (event) => {
  if (continuousStrokeActive) finishContinuousStroke(event);
  lastPointerDown = null;
});

// -----------------------------------------------------------------------------
// 9. TOOL UI
// -----------------------------------------------------------------------------
let blockColorCloseTimer = null;

function getFriendlyColorName(color) {
  const normalized = normalizeStandardBlockColor(color);
  const preset = blockColorChoices.find((button) => normalizeStandardBlockColor(button.dataset.blockColor) === normalized);
  return preset?.dataset.colorName?.toUpperCase() ?? 'CUSTOM';
}

function hexToHsl(hex) {
  const normalized = normalizeStandardBlockColor(hex).slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * (((b - r) / delta) + 2);
    else h = 60 * (((r - g) / delta) + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(sat * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, Number(s))) / 100;
  const light = Math.max(0, Math.min(100, Number(l))) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (hue < 60) [rp, gp, bp] = [c, x, 0];
  else if (hue < 120) [rp, gp, bp] = [x, c, 0];
  else if (hue < 180) [rp, gp, bp] = [0, c, x];
  else if (hue < 240) [rp, gp, bp] = [0, x, c];
  else if (hue < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  const toHex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(rp)}${toHex(gp)}${toHex(bp)}`;
}

function updateCustomColorPanel(color = selectedBlockColor) {
  const normalized = normalizeStandardBlockColor(color);
  const hsl = hexToHsl(normalized);
  if (customHue) customHue.value = String(hsl.h);
  if (customSaturation) customSaturation.value = String(hsl.s);
  if (customLightness) customLightness.value = String(Math.max(8, Math.min(92, hsl.l)));
  if (customColorHex) customColorHex.value = normalized.toUpperCase();
  const hueColor = hslToHex(hsl.h, 100, 50);
  if (customColorPanel) {
    customColorPanel.style.setProperty('--custom-color', normalized);
    customColorPanel.style.setProperty('--custom-hue-color', hueColor);
  }
  if (customColorPreview) customColorPreview.style.background = normalized;
}

function getCustomColorFromControls() {
  return hslToHex(customHue?.value ?? 0, customSaturation?.value ?? 80, customLightness?.value ?? 50);
}

function syncCustomColorFromControls() {
  const color = normalizeStandardBlockColor(getCustomColorFromControls());
  const hueColor = hslToHex(customHue?.value ?? 0, 100, 50);
  if (customColorHex) customColorHex.value = color.toUpperCase();
  if (customColorPanel) {
    customColorPanel.style.setProperty('--custom-color', color);
    customColorPanel.style.setProperty('--custom-hue-color', hueColor);
  }
  if (customColorPreview) customColorPreview.style.background = color;
  return color;
}

function setCustomColorPanelOpen(open, { focus = false } = {}) {
  if (!customColorPanel || !customColorToggle) return;
  const next = Boolean(open);
  customColorToggle.setAttribute('aria-expanded', String(next));
  if (blockColorHelp) {
    const isPreset = blockColorChoices.some((button) => normalizeStandardBlockColor(button.dataset.blockColor) === normalizeStandardBlockColor(selectedBlockColor));
    blockColorHelp.hidden = next || !isPreset;
  }
  if (next) {
    updateCustomColorPanel(selectedBlockColor);
    customColorPanel.hidden = false;
    requestAnimationFrame(() => {
      customColorPanel.classList.add('is-open');
      positionBlockColorPopover();
    });
    if (focus) requestAnimationFrame(() => customHue?.focus());
    return;
  }
  customColorPanel.classList.remove('is-open');
  window.setTimeout(() => {
    if (!customColorPanel.classList.contains('is-open')) {
      customColorPanel.hidden = true;
      positionBlockColorPopover();
    }
  }, 580);
}

function updateBlockColorUi() {
  const color = normalizeStandardBlockColor(selectedBlockColor);
  selectedBlockColor = color;
  if (standardColorSwatch) standardColorSwatch.style.background = color;
  if (blockColorName) blockColorName.textContent = getFriendlyColorName(color);
  if (blockColorHelp) {
    const isPreset = blockColorChoices.some((button) => normalizeStandardBlockColor(button.dataset.blockColor) === color);
    const customEditorOpen = Boolean(customColorPanel && !customColorPanel.hidden && customColorPanel.classList.contains('is-open'));
    blockColorHelp.hidden = !isPreset || customEditorOpen;
  }
  for (const button of blockColorChoices) {
    const active = normalizeStandardBlockColor(button.dataset.blockColor) === color;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (!customColorPanel || customColorPanel.hidden) updateCustomColorPanel(color);
}

function positionBlockColorPopover() {
  if (!blockColorPopover || !standardToolButton) return;
  const buildKit = standardToolButton.closest('.tool-panel');
  const buttonRect = standardToolButton.getBoundingClientRect();
  const panelRect = buildKit?.getBoundingClientRect() ?? buttonRect;
  const gap = 12;
  const edge = 12;
  const width = blockColorPopover.offsetWidth || 286;
  const height = blockColorPopover.offsetHeight || 240;

  let left = panelRect.right + gap;
  let top = buttonRect.top;

  // If there is not enough room beside Build Kit, keep the popup on-screen
  // underneath the Standard Cube row rather than covering Live Data.
  if (left + width > window.innerWidth - edge) {
    left = Math.max(edge, Math.min(window.innerWidth - width - edge, panelRect.left));
    top = buttonRect.bottom + gap;
  }

  top = Math.max(edge, Math.min(top, window.innerHeight - height - edge));
  blockColorPopover.style.left = `${Math.round(left)}px`;
  blockColorPopover.style.top = `${Math.round(top)}px`;
}

function setBlockColorPopoverOpen(open, { focus = false } = {}) {
  if (!blockColorPopover || !standardToolButton) return;
  window.clearTimeout(blockColorCloseTimer);
  blockColorCloseTimer = null;
  const canOpen = Boolean(open) && exportSurfaceMode !== 'soft1' && !standardToolButton.disabled;
  standardToolButton.setAttribute('aria-expanded', String(canOpen));
  if (!canOpen) {
    setCustomColorPanelOpen(false);
    if (recolorTarget !== 'new') setRecolorTarget('new', { announce: false });
  }
  if (canOpen) {
    blockColorPopover.hidden = false;
    positionBlockColorPopover();
    requestAnimationFrame(() => {
      positionBlockColorPopover();
      preparePopoverSourceMorph(blockColorPopover, standardToolButton, {
        travel: window.innerWidth <= 980 ? 0.46 : 0.54,
        minScale: window.innerWidth <= 980 ? 0.86 : 0.76,
        maxScale: 0.94,
        scaleBoost: 2.0,
      });
      blockColorPopover.classList.add('is-open');
    });
    if (focus) requestAnimationFrame(() => blockColorChoices[0]?.focus());
    return;
  }
  blockColorPopover.classList.remove('is-open');
  blockColorCloseTimer = window.setTimeout(() => {
    if (!blockColorPopover.classList.contains('is-open')) blockColorPopover.hidden = true;
    blockColorCloseTimer = null;
  }, 580);
}

function updateRecolorTargetUi() {
  if (recolorSelectedCount) recolorSelectedCount.textContent = String(recolorSelectedKeys.size).padStart(2, '0');
  for (const button of recolorTargetButtons) {
    const active = button.dataset.colorTarget === recolorTarget;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function clearRecolorSelection({ sync = true } = {}) {
  if (!recolorSelectedKeys.size) return;
  recolorSelectedKeys.clear();
  updateRecolorTargetUi();
  if (sync) syncViewFromModel();
}

function setRecolorTarget(target, { announce = true } = {}) {
  const next = ['new', 'selected', 'all'].includes(target) ? target : 'new';

  if (next === 'selected') {
    if (exactImportedStl || exportSurfaceMode === 'soft1' || activeLayerView !== null || serialConnected) {
      recolorTarget = 'new';
      clearRecolorSelection({ sync: false });
      updateRecolorTargetUi();
      if (announce) setFeedback('MODEL COLOR', 'Selection recoloring is available in Blocks view with ALL layers visible and hardware disconnected.', true);
      return;
    }
    if (continuousBuildEnabled) setContinuousBuildEnabled(false);
    recolorTarget = 'selected';
    ghost.visible = false;
    hoveredCandidate = null;
    updateRecolorTargetUi();
    syncViewFromModel();
    if (announce) setFeedback('SELECT MODEL COLOR', `Click Standard Cubes to select them · ${String(recolorSelectedKeys.size).padStart(2, '0')} selected · then choose a color.`);
    return;
  }

  if (recolorTarget === 'selected') clearRecolorSelection({ sync: false });
  recolorTarget = next;
  updateRecolorTargetUi();
  syncViewFromModel();

  if (!announce) return;
  if (next === 'all') setFeedback('MODEL COLOR / ALL', 'Choose a color to recolor every Standard Cube already in the model.');
  else setFeedback('BLOCK COLOR / NEW', 'Choose the color used by newly placed Standard Cubes.');
}

function chooseBlockColor(color, { close = true, announce = true } = {}) {
  const normalized = normalizeStandardBlockColor(color);

  if (recolorTarget === 'new') {
    selectedBlockColor = normalized;
    updateBlockColorUi();
    if (close) setBlockColorPopoverOpen(false);
    if (announce) setFeedback('BLOCK COLOR', `${getFriendlyColorName(selectedBlockColor)} selected. New Standard Cubes will use this color.`);
    return;
  }

  if (recolorTarget === 'all') {
    const standardCount = model.getBlocks().filter((block) => block.type === 'standard').length;
    if (!standardCount) {
      setFeedback('MODEL COLOR / ALL', 'Add at least one Standard Cube before recoloring the model.', true);
      return;
    }
    const result = model.setAllStandardColor(normalized);
    if (result.changed) recordHistory();
    syncViewFromModel();
    setFeedback('MODEL COLOR / ALL', `${String(standardCount).padStart(2, '0')} Standard Cube(s) now use ${getFriendlyColorName(normalized)}.`);
    recolorTarget = 'new';
    updateRecolorTargetUi();
    if (close) setBlockColorPopoverOpen(false);
    return;
  }

  if (!recolorSelectedKeys.size) {
    setFeedback('SELECT MODEL COLOR', 'Select at least one Standard Cube in the viewport before choosing a color.', true);
    return;
  }

  const selectedCount = recolorSelectedKeys.size;
  const result = model.setStandardBlocksColor([...recolorSelectedKeys], normalized);
  if (result.changed) recordHistory();
  recolorSelectedKeys.clear();
  recolorTarget = 'new';
  updateRecolorTargetUi();
  syncViewFromModel();
  if (close) setBlockColorPopoverOpen(false);
  if (announce) setFeedback('MODEL COLOR / SELECTED', `${String(selectedCount).padStart(2, '0')} selected Standard Cube(s) now use ${getFriendlyColorName(normalized)}.`);
}

updateBlockColorUi();
updateRecolorTargetUi();
function selectTool(tool, { announce = true } = {}) {
  const nextTool = ['standard', 'support', 'eraser', 'free'].includes(tool) ? tool : 'standard';

  if (nextTool !== 'free' && activeLayerView !== null) {
    if (announce) {
      setFeedback('LAYER VIEW ONLY', 'Cube tools and Eraser are disabled while inspecting layers. Return to ALL to edit.', true);
    }
    return;
  }

  if (nextTool !== 'free' && exportSurfaceMode === 'soft1') {
    if (announce) {
      setFeedback('SMOOTH VIEW', 'Cube tools and Eraser are disabled while Smooth is active. Switch to Blocks to edit.', true);
    }
    return;
  }

  if (nextTool !== 'standard') {
    if (recolorTarget !== 'new') setRecolorTarget('new', { announce: false });
    setBlockColorPopoverOpen(false);
  }

  if (nextTool === 'free') {
    if (continuousBuildEnabled) setContinuousBuildEnabled(false);
    selectedTool = 'free';
  } else {
    selectedTool = nextTool;
    lastBuildTool = nextTool;
  }

  for (const button of toolButtons) {
    button.classList.toggle('is-active', button.dataset.tool === selectedTool);
  }
  if (freeMoveButton) {
    const active = selectedTool === 'free';
    freeMoveButton.classList.toggle('is-active', active);
    freeMoveButton.setAttribute('aria-pressed', String(active));
  }

  ghost.visible = false;
  hoveredCandidate = null;

  const names = {
    standard: `STANDARD CUBE / ${getFriendlyColorName(selectedBlockColor)}`,
    support: 'SUPPORT CUBE SELECTED',
    eraser: 'ERASER SELECTED',
    free: 'FREE MOVE SELECTED',
  };
  systemStatus.textContent = names[selectedTool];

  if (!announce) return;

  if (selectedTool === 'free') {
    setFeedback('FREE MOVE', 'Camera-only mode. Drag to orbit the model without placing or erasing cubes.');
  } else if (exactImportedStl) {
    setFeedback('EXACT STL MESH', 'Tool selection is paused while an exact STL is loaded. Clear the build to edit voxels again.');
  } else if (activeLayerView !== null) {
    setFeedback(
      `LAYERS 01–${String(activeLayerView + 1).padStart(2, '0')}`,
      'Cumulative layer view is inspection-only. Return to ALL layers to edit.',
    );
  } else if (serialConnected) {
    setFeedback('HARDWARE MODE', 'ESP32 is connected and controls the model state.');
  } else if (continuousBuildEnabled && selectedTool === 'eraser') {
    setFeedback('CONTINUOUS ERASE', 'Hold / drag to erase blocks. Hold still to keep removing from the same column.');
  } else if (continuousBuildEnabled) {
    setFeedback('CONTINUOUS BUILD', 'Hold / drag to paint a row or path. Hold still to stack a vertical column. Alt + drag orbits.');
  } else if (selectedTool === 'eraser') {
    setFeedback('ERASER ACTIVE', 'Click a block. Higher blocks in that column drop down.');
  } else {
    setFeedback('PLACE ON BASE', 'Hover a cell or block face to preview a physically valid placement.');
  }
}

toolButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const tool = button.dataset.tool;
    if (tool === 'standard') {
      const alreadyStandard = selectedTool === 'standard';
      selectTool('standard');
      if (selectedTool === 'standard') {
        setBlockColorPopoverOpen(alreadyStandard ? blockColorPopover?.hidden || !blockColorPopover?.classList.contains('is-open') : true);
      }
      return;
    }
    selectTool(tool);
  });
});

for (const button of recolorTargetButtons) {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setCustomColorPanelOpen(false);
    setRecolorTarget(button.dataset.colorTarget);
  });
}

for (const button of blockColorChoices) {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setCustomColorPanelOpen(false);
    chooseBlockColor(button.dataset.blockColor);
  });
}
customColorToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = customColorPanel?.hidden || !customColorPanel?.classList.contains('is-open');
  setCustomColorPanelOpen(open, { focus: open });
});
customColorClose?.addEventListener('click', (event) => {
  event.stopPropagation();
  setCustomColorPanelOpen(false);
  customColorToggle?.focus();
});
for (const control of [customHue, customSaturation, customLightness]) {
  control?.addEventListener('input', syncCustomColorFromControls);
}
customColorHex?.addEventListener('input', (event) => {
  const raw = String(event.target.value || '').trim();
  const candidate = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) return;
  updateCustomColorPanel(candidate);
});
customColorHex?.addEventListener('blur', () => {
  const raw = String(customColorHex.value || '').trim();
  const candidate = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9a-fA-F]{6}$/.test(candidate)) updateCustomColorPanel(candidate);
  else updateCustomColorPanel(selectedBlockColor);
});
customColorApply?.addEventListener('click', (event) => {
  event.stopPropagation();
  const raw = String(customColorHex?.value || '').trim();
  const candidate = raw.startsWith('#') ? raw : `#${raw}`;
  const color = /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : getCustomColorFromControls();
  chooseBlockColor(color, { close: true, announce: true });
});
blockColorPopover?.addEventListener('pointerdown', (event) => event.stopPropagation());
window.addEventListener('resize', () => {
  if (blockColorPopover && !blockColorPopover.hidden) positionBlockColorPopover();
});
window.addEventListener('pointerdown', (event) => {
  if (!blockColorPopover || blockColorPopover.hidden) return;
  if (blockColorPopover.contains(event.target) || standardToolButton?.contains(event.target)) return;
  if (recolorTarget === 'selected' && renderer.domElement.contains(event.target)) return;
  setBlockColorPopoverOpen(false);
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && customColorPanel && !customColorPanel.hidden) {
    setCustomColorPanelOpen(false);
    customColorToggle?.focus();
    return;
  }
  if (event.key === 'Escape' && recolorTarget === 'selected') {
    setRecolorTarget('new', { announce: false });
    setFeedback('MODEL COLOR', 'Selection recoloring cancelled.');
    return;
  }
  if (event.key === 'Escape' && blockColorPopover && !blockColorPopover.hidden) {
    setBlockColorPopoverOpen(false);
    standardToolButton?.focus();
  }
});

freeMoveButton?.addEventListener('click', () => {
  if (selectedTool === 'free' && exportSurfaceMode !== 'soft1') selectTool(lastBuildTool);
  else selectTool('free');
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && gridSettingsPopover && !gridSettingsPopover.hidden) {
    setGridSettingsOpen(false);
    return;
  }
  if (event.key === '1') selectTool('standard');
  if (event.key === '2') selectTool('support');
  if (event.key.toLowerCase() === 'e') selectTool('eraser');
  if (event.key.toLowerCase() === 'm') {
    if (selectedTool === 'free' && exportSurfaceMode !== 'soft1') selectTool(lastBuildTool);
    else selectTool('free');
  }
});

clearBuildButton.addEventListener('click', () => {
  if (exactImportedStl) {
    setActiveRecentModel(null);
    clearExactStlMode();
    model.clear();
    resetHistoryToCurrent();
    syncViewFromModel();
    systemStatus.textContent = 'STL CLEARED';
    setFeedback('EMPTY GRID', `Exact STL removed. The ${model.gridSize}×${model.gridSize} voxel grid is editable again.`);
    return;
  }

  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Cumulative layer view is inspection-only. Return to ALL layers before clearing the build.', true);
    return;
  }

  if (serialConnected) {
    setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before clearing the digital model.', true);
    return;
  }

  if (model.getBlockCount() === 0) return;
  // Clearing starts a new build branch. The old autosaved model remains in
  // Recent Models and the next placed block creates a fresh model entry.
  setActiveRecentModel(null);
  model.clear();
  recordHistory();
  syncViewFromModel();
  ghost.visible = false;
  systemStatus.textContent = 'BUILD CLEARED';
  setFeedback('EMPTY GRID', `The ${model.gridSize}×${model.gridSize} active grid has been reset.`);
});

resetViewButton.addEventListener('click', () => {
  camera.position.copy(defaultCameraPosition);
  controls.target.set(0, 2.2, 0);
  controls.update();
  systemStatus.textContent = 'CAMERA RESET';
});

undoBuildButton.addEventListener('click', undoBuild);
redoBuildButton.addEventListener('click', redoBuild);
continuousToggle.addEventListener('click', () => setContinuousBuildEnabled(!continuousBuildEnabled));

layerSlider.addEventListener('input', () => setLayerView(layerSlider.value));
showAllLayersButton.addEventListener('click', () => setLayerView(0));

let gridSettingsCloseTimer = null;
let gridSettingsIsOpen = false;

function positionGridSettingsPopover() {
  if (!gridSettingsPopover || !openGridSettingsButton || gridSettingsPopover.hidden) return;
  const statsPanel = openGridSettingsButton.closest('.stats-panel');
  const anchorRect = statsPanel?.getBoundingClientRect() ?? openGridSettingsButton.getBoundingClientRect();
  const buttonRect = openGridSettingsButton.getBoundingClientRect();
  const gap = 12;
  const edge = 12;
  const width = gridSettingsPopover.offsetWidth || 258;
  const height = gridSettingsPopover.offsetHeight || 220;

  // Preserve the old visual placement: beside Live Data, bottom-aligned.
  let left = anchorRect.right + gap;
  let top = anchorRect.bottom - height;
  let originX = 'left';
  let originY = 'bottom';

  if (left + width > window.innerWidth - edge) {
    const leftCandidate = anchorRect.left - gap - width;
    if (leftCandidate >= edge) {
      left = leftCandidate;
      originX = 'right';
    } else {
      left = Math.max(edge, Math.min(window.innerWidth - width - edge, buttonRect.left + buttonRect.width - width));
      top = buttonRect.bottom + gap;
      originX = 'right';
      originY = 'top';
    }
  }

  top = Math.max(edge, Math.min(top, window.innerHeight - height - edge));
  gridSettingsPopover.style.left = `${Math.round(left)}px`;
  gridSettingsPopover.style.top = `${Math.round(top)}px`;
  gridSettingsPopover.style.right = 'auto';
  gridSettingsPopover.style.bottom = 'auto';
  gridSettingsPopover.style.transformOrigin = `${originX} ${originY}`;
}

function setGridSettingsOpen(open) {
  if (!gridSettingsPopover || !openGridSettingsButton) return;
  if (open && activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before changing the build area size.', true);
    return;
  }
  if (gridSettingsCloseTimer) {
    window.clearTimeout(gridSettingsCloseTimer);
    gridSettingsCloseTimer = null;
  }

  gridSettingsIsOpen = open;
  openGridSettingsButton.classList.toggle('is-active', open);
  openGridSettingsButton.setAttribute('aria-expanded', String(open));

  if (open) {
    gridSettingsPopover.hidden = false;
    positionGridSettingsPopover();
    // Two frames guarantee the browser paints the resting state before the
    // opening transform, so the compact settings card eases into place.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!gridSettingsPopover.hidden) {
          positionGridSettingsPopover();
          preparePopoverSourceMorph(gridSettingsPopover, openGridSettingsButton, {
            travel: 0.52,
            minScale: 0.74,
            maxScale: 0.92,
            scaleBoost: 2.0,
          });
          gridSettingsPopover.classList.add('is-open');
        }
      });
    });
    return;
  }

  gridSettingsPopover.classList.remove('is-open');
  gridSettingsCloseTimer = window.setTimeout(() => {
    if (!gridSettingsPopover.classList.contains('is-open')) gridSettingsPopover.hidden = true;
    gridSettingsCloseTimer = null;
  }, 580);
}

openGridSettingsButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  setGridSettingsOpen(!gridSettingsIsOpen);
});

closeGridSettingsButton?.addEventListener('click', () => setGridSettingsOpen(false));
gridSettingsPopover?.addEventListener('click', (event) => event.stopPropagation());
window.addEventListener('resize', () => {
  if (gridSettingsPopover && !gridSettingsPopover.hidden) positionGridSettingsPopover();
});
window.addEventListener('pointerdown', (event) => {
  if (gridSettingsPopover?.hidden) return;
  if (openGridSettingsButton?.contains(event.target) || gridSettingsPopover?.contains(event.target)) return;
  setGridSettingsOpen(false);
});

if (gridSizeSlider) {
  gridSizeSlider.addEventListener('input', () => {
    if (gridSizeValue) gridSizeValue.textContent = String(clampGridSize(gridSizeSlider.value)).padStart(2, '0');
    setRangeProgress(gridSizeSlider);
  });
  gridSizeSlider.addEventListener('change', () => setActiveGridSize(gridSizeSlider.value));
}

// -----------------------------------------------------------------------------
// 10. SAVE / EXPORT / LOAD MODEL FILES
// -----------------------------------------------------------------------------
// Native .BIL is the authoritative editable project format: exact x/y/z +
// Standard/Support semantics, workspace settings, live surface settings, and
// camera state. STL / GLB / OBJ are static export products. Legacy readers for
// older JSON/GLB/OBJ/STL files remain below only for backwards compatibility.
const MODEL_FILE_FORMAT = 'digital-twin-voxel-model';
const MODEL_FILE_VERSION = 1;
const PROJECT_FILE_FORMAT = 'build-it-live-project';
const PROJECT_FILE_VERSION = 1;

function makeProjectDocument() {
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    app: 'Build It Live',
    savedAt: new Date().toISOString(),
    project: {
      name: generateSmartModelName(model.getBlocks()),
      units: 'mm',
      physicalBlockMm: CONFIG.PHYSICAL_BLOCK_MM,
    },
    workspace: {
      gridSize: model.gridSize,
      maxHeight: CONFIG.MAX_HEIGHT,
      selectedBlockColor,
    },
    model: {
      blocks: cloneBlocks(),
    },
    render: {
      surfaceMode: exportSurfaceMode,
      smoothingStrength,
      layerView: activeLayerView === null ? 0 : activeLayerView + 1,
    },
    camera: {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    },
  };
}

function makeModelDocument() {
  return {
    format: MODEL_FILE_FORMAT,
    version: MODEL_FILE_VERSION,
    createdAt: new Date().toISOString(),
    simulator: {
      gridSize: model.gridSize,
      maxHeight: CONFIG.MAX_HEIGHT,
      physicalBlockMm: CONFIG.PHYSICAL_BLOCK_MM,
    },
    blocks: cloneBlocks(),
  };
}

function makeTimestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function makeDownloadFilename(extension) {
  return `voxel-model-${makeTimestampForFilename()}.${extension}`;
}

function normalizeExportRegistryName(name = '') {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d+\)(?=\.[^.]+$)/, '');
}

function registerStlExport(filename, blob, { exportId = null, token = null } = {}) {
  if (!filename || !blob) return;
  const registry = safeStorageRead(STL_EXPORT_REGISTRY_STORAGE_KEY, []);
  const entries = Array.isArray(registry) ? registry : [];
  const normalizedName = normalizeExportRegistryName(filename);
  const snapshot = {
    gridSize: model.gridSize,
    blocks: cloneBlocks(),
  };
  const next = [
    {
      name: normalizedName,
      size: Number(blob.size) || 0,
      savedAt: new Date().toISOString(),
      exportId,
      token,
      // Store the editable state directly. The export ID is only a lookup key
      // avoids making a successful local round-trip depend on token decoding.
      state: snapshot,
    },
    ...entries.filter((entry) => !(entry?.name === normalizedName && Number(entry?.size) === Number(blob.size))),
  ].slice(0, STL_EXPORT_REGISTRY_LIMIT);
  safeStorageWrite(STL_EXPORT_REGISTRY_STORAGE_KEY, next);
}

function recoverRegisteredStlState(file, exportId = null) {
  const registry = safeStorageRead(STL_EXPORT_REGISTRY_STORAGE_KEY, []);
  if (!Array.isArray(registry) || !file) return null;
  const normalizedName = normalizeExportRegistryName(file.name);
  const byId = exportId ? registry.find((entry) => entry?.exportId === exportId) : null;
  const exact = registry.find((entry) => entry?.name === normalizedName && Number(entry?.size) === Number(file.size));
  const sameName = registry.find((entry) => entry?.name === normalizedName);
  const entry = byId ?? exact ?? sameName;
  if (!entry) return null;

  if (Array.isArray(entry?.state?.blocks) && entry.state.blocks.length > 0) {
    return {
      gridSize: clampGridSize(entry.state.gridSize ?? getRequiredGridSize(entry.state.blocks)),
      blocks: cloneBlocks(entry.state.blocks),
    };
  }

  if (!entry?.token) return null;
  const decoded = decodeCompactStateToken(entry.token);
  return decoded?.blocks?.length ? decoded : null;
}


function getStandardBlockBounds(blocks = []) {
  const standard = blocks.filter((block) => block?.type !== 'support');
  if (standard.length === 0) return null;
  const xs = standard.map((block) => Number(block.x));
  const ys = standard.map((block) => Number(block.y));
  const zs = standard.map((block) => Number(block.z));
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };
}

function getStlCellBounds(geometry, scale = CONFIG.PHYSICAL_BLOCK_MM) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) return null;
  const snapMin = (value) => Math.round(value / scale);
  const snapMax = (value) => Math.round(value / scale) - 1;
  return {
    minX: snapMin(box.min.x), maxX: snapMax(box.max.x),
    minY: snapMin(box.min.y), maxY: snapMax(box.max.y),
    minZ: snapMin(box.min.z), maxZ: snapMax(box.max.z),
  };
}

function sameBounds(a, b) {
  if (!a || !b) return false;
  return ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].every((key) => a[key] === b[key]);
}

function parseVoxelExportTime(name = '') {
  const match = String(name).match(/voxel-model-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '30'] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(date.getTime()) ? null : date;
}

function recoverLegacyStlStateFromRecents(file, geometry) {
  // Compatibility rescue for STL files exported by older builds of this app
  // before the redundant registry existed. We only attempt this for the app's
  // own generated filename pattern, and only when the printable Standard-cube
  // bounding box matches a locally saved editable snapshot exactly.
  if (!/^voxel-model-\d{8}-\d{4,6}(?:\s*\(\d+\))?\.stl$/i.test(String(file?.name ?? ''))) return null;

  const stlBounds = getStlCellBounds(geometry);
  if (!stlBounds) return null;
  const exportedAt = parseVoxelExportTime(file.name);
  const recent = readRecentModels();
  const autosave = safeStorageRead(AUTOSAVE_STORAGE_KEY, null);
  const snapshots = [...recent];
  if (Array.isArray(autosave?.blocks)) snapshots.push(autosave);

  const candidates = snapshots
    .filter((entry) => Array.isArray(entry?.blocks) && entry.blocks.length > 0)
    .map((entry) => {
      const savedAt = new Date(entry.savedAt ?? 0);
      const delta = exportedAt && !Number.isNaN(savedAt.getTime())
        ? Math.abs(savedAt.getTime() - exportedAt.getTime())
        : Number.POSITIVE_INFINITY;
      return {
        entry,
        delta,
        boundsMatch: sameBounds(getStandardBlockBounds(entry.blocks), stlBounds),
      };
    })
    .sort((a, b) => {
      if (a.boundsMatch !== b.boundsMatch) return a.boundsMatch ? -1 : 1;
      return a.delta - b.delta;
    });

  if (candidates.length === 0) return null;
  const best = candidates[0];

  // Prefer an exact printable-bounds match. For older Organic Print files, however,
  // chamfering/straight-diagonal geometry can move the raw triangle bounds by a
  // fraction of a cell. In that case the app-generated timestamp is a stronger
  // recovery key: use a uniquely close local snapshot from the same session.
  const closeByTime = Number.isFinite(best.delta) && best.delta <= 15 * 60 * 1000;
  if (!best.boundsMatch && !closeByTime) return null;

  return {
    gridSize: clampGridSize(best.entry.gridSize ?? getRequiredGridSize(best.entry.blocks)),
    blocks: cloneBlocks(best.entry.blocks),
  };
}

function downloadBlob(blob, extension, { filename = null, registerStlState = false, stlExportId = null, stlToken = null } = {}) {
  const resolvedFilename = filename ?? makeDownloadFilename(extension);
  if (registerStlState && String(extension).toLowerCase() === 'stl') {
    registerStlExport(resolvedFilename, blob, { exportId: stlExportId, token: stlToken });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = resolvedFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return resolvedFilename;
}

function saveNativeProject() {
  if (exactImportedStl) {
    throw new Error('A STATIC STL MESH IS NOT AN EDITABLE PROJECT / LOAD OR CREATE A VOXEL PROJECT FIRST');
  }
  const document = makeProjectDocument();
  const json = JSON.stringify(document, null, 2);
  const safeName = String(document.project.name || 'BUILD-IT-LIVE')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'build-it-live';
  const filename = `${safeName}-${makeTimestampForFilename()}.bil`;
  downloadBlob(new Blob([json], { type: 'application/json' }), 'bil', { filename });
  return filename;
}

function saveJsonModel() {
  if (exactImportedStl) throw new Error('EXACT STL HAS NO EDITABLE VOXEL DATA / SAVE STL TO KEEP THE SAME SURFACE');
  const json = JSON.stringify(makeModelDocument(), null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), 'json');
}

/**
 * Build a temporary export-only scene directly from the pure data model.
 * This is deliberately NOT cloned from the visible Three.js scene, so exports
 * never contain the grid, base, hover ghost, UI helpers, shadows, or camera.
 *
 * exportScale:
 * - STL / OBJ: 15 units per cell, intended as 15 mm cubes.
 * - GLB: 0.015 metres per cell, following the glTF metre convention.
 *
 * Export cubes touch exactly. The small visual BLOCK_GAP used on screen is not
 * included, because it would make stacked STL voxels physically disconnected.
 */
function makeGeometryExportGroup(exportScale = 1) {
  const group = new THREE.Group();
  group.name = 'DigitalTwinVoxelModel';

  const geometry = new THREE.BoxGeometry(exportScale, exportScale, exportScale);
  const standardExportMaterials = new Map();
  const getExportColorMaterial = (color) => {
    const key = normalizeStandardBlockColor(color);
    if (!standardExportMaterials.has(key)) {
      standardExportMaterials.set(key, new THREE.MeshStandardMaterial({
        name: `BuildBlock_${key.slice(1).toUpperCase()}`,
        color: key,
        roughness: 0.58,
      }));
    }
    return standardExportMaterials.get(key);
  };
  const supportExportMaterial = new THREE.MeshStandardMaterial({
    name: 'SupportCube',
    color: COLORS.support,
    roughness: 0.42,
    transparent: true,
    opacity: 0.55,
  });

  const half = (model.gridSize - 1) / 2;

  for (const block of model.getBlocks()) {
    const mesh = new THREE.Mesh(
      geometry,
      block.type === 'support' ? supportExportMaterial : getExportColorMaterial(block.color),
    );

    mesh.name = block.type === 'support' ? 'support_geometry' : 'voxel_geometry';
    mesh.userData = { ...block };
    mesh.position.set(
      (block.x - half) * exportScale,
      block.z * exportScale + exportScale / 2,
      (block.y - half) * exportScale,
    );
    group.add(mesh);
  }

  group.updateMatrixWorld(true);

  group.userData.disposeExportResources = () => {
    geometry.dispose();
    for (const material of standardExportMaterials.values()) material.dispose();
    supportExportMaterial.dispose();
  };

  return group;
}

/**
 * Build a slicer-oriented export group.
 *
 * IMPORTANT COORDINATE CONVENTION:
 * Three.js renders with Y-up, but STL/CAD slicers expect Z-up. For STL/OBJ we
 * therefore map the pure voxel model directly to:
 *   X = grid column
 *   Y = grid row
 *   Z = stack height
 *
 * We also keep the 16×16 grid anchored at (0, 0) instead of centering the
 * geometry around the origin. With 15 mm voxels this means the physical grid
 * occupies 0..240 mm in X/Y, so a slicer such as Bambu Studio receives the
 * model at the same grid position as the web simulator.
 *
 * STL has no materials or transparency. To keep Support Cubes distinct, they
 * are exported as printable open frame cubes rather than ordinary solid cubes.
 */
function makeSlicerExportGroup(exportScale = 1, { includeSupportFrames = true } = {}) {
  const group = new THREE.Group();
  group.name = 'DigitalTwinSlicerModel';

  const standardGeometry = new THREE.BoxGeometry(exportScale, exportScale, exportScale);
  const exportMaterial = new THREE.MeshStandardMaterial({
    name: 'STLGeometry',
    color: COLORS.accent,
    roughness: 0.58,
  });

  // About 2.1 mm when a voxel is 15 mm: visibly different, still printable.
  const frameThickness = exportScale * 0.14;
  const beamGeometry = new THREE.BoxGeometry(1, 1, 1);
  const zAxis = new THREE.Vector3(0, 1, 0); // beam geometry's long axis before rotation

  const resources = [standardGeometry, beamGeometry];

  const blockCenter = (block) => new THREE.Vector3(
    (block.x + 0.5) * exportScale,
    (block.y + 0.5) * exportScale,
    (block.z + 0.5) * exportScale,
  );

  const addBeam = (parent, start, end, thickness = frameThickness) => {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    if (length <= 0) return;

    const beam = new THREE.Mesh(beamGeometry, exportMaterial);
    beam.name = parent.name ? `${parent.name}_part` : 'support_part';
    beam.position.copy(start).add(end).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(zAxis, direction.clone().normalize());
    beam.scale.set(thickness, length, thickness);
    parent.add(beam);
  };

  const addSupportFrame = (block) => {
    const frame = new THREE.Group();
    frame.name = `support_${block.x}_${block.y}_${block.z}`;

    const center = blockCenter(block);
    const h = exportScale / 2;
    const inset = h - frameThickness / 2;

    const addAxisBar = (offsetX, offsetY, offsetZ, sizeX, sizeY, sizeZ) => {
      const bar = new THREE.Mesh(beamGeometry, exportMaterial);
      bar.name = `${frame.name}_part`;
      bar.position.copy(center).add(new THREE.Vector3(offsetX, offsetY, offsetZ));
      bar.scale.set(sizeX, sizeY, sizeZ);
      frame.add(bar);
    };

    // 12 edge bars, all kept inside the 15 mm voxel envelope.
    for (const sy of [-inset, inset]) {
      for (const sz of [-inset, inset]) {
        addAxisBar(0, sy, sz, exportScale, frameThickness, frameThickness);
      }
    }
    for (const sx of [-inset, inset]) {
      for (const sz of [-inset, inset]) {
        addAxisBar(sx, 0, sz, frameThickness, exportScale, frameThickness);
      }
    }
    for (const sx of [-inset, inset]) {
      for (const sy of [-inset, inset]) {
        addAxisBar(sx, sy, 0, frameThickness, frameThickness, exportScale);
      }
    }

    // X-braces on front/back vertical faces, matching the support-cube UI icon.
    const braceThickness = frameThickness * 0.78;
    const frontY = center.y - inset;
    const backY = center.y + inset;
    const x0 = center.x - inset;
    const x1 = center.x + inset;
    const z0 = center.z - inset;
    const z1 = center.z + inset;

    addBeam(frame, new THREE.Vector3(x0, frontY, z0), new THREE.Vector3(x1, frontY, z1), braceThickness);
    addBeam(frame, new THREE.Vector3(x1, frontY, z0), new THREE.Vector3(x0, frontY, z1), braceThickness);
    addBeam(frame, new THREE.Vector3(x0, backY, z0), new THREE.Vector3(x1, backY, z1), braceThickness);
    addBeam(frame, new THREE.Vector3(x1, backY, z0), new THREE.Vector3(x0, backY, z1), braceThickness);

    frame.userData = { ...block, exportGeometry: 'support-frame' };
    group.add(frame);
  };

  for (const block of model.getBlocks()) {
    if (block.type === 'support') {
      // STL/Bambu export can deliberately omit support cubes completely.
      // Other slicer-oriented formats may still request the printable frame form.
      if (includeSupportFrames) addSupportFrame(block);
      continue;
    }

    const mesh = new THREE.Mesh(standardGeometry, exportMaterial);
    mesh.name = `standard_${block.x}_${block.y}_${block.z}`;
    mesh.position.copy(blockCenter(block));
    mesh.userData = { ...block, exportGeometry: 'solid-cube' };
    group.add(mesh);
  }

  group.updateMatrixWorld(true);
  group.userData.disposeExportResources = () => {
    for (const geometry of resources) geometry.dispose();
    exportMaterial.dispose();
  };

  return group;
}

function createLinearChamferPrismGeometry(width, depth, height, chamfer, {
  chamferBottom = false,
  chamferTop = true,
} = {}) {
  const safeWidth = Math.max(0.001, Number(width) || 0.001);
  const safeDepth = Math.max(0.001, Number(depth) || 0.001);
  const safeHeight = Math.max(0.001, Number(height) || 0.001);
  const maxChamfer = Math.min(safeWidth, safeDepth, safeHeight) * 0.22;
  const c = THREE.MathUtils.clamp(Number(chamfer) || 0, 0, maxChamfer);

  const rings = [];
  const addRing = (z, inset) => {
    const halfW = Math.max(0.0005, safeWidth / 2 - inset);
    const halfD = Math.max(0.0005, safeDepth / 2 - inset);
    rings.push({
      z,
      points: [
        [-halfW, -halfD],
        [ halfW, -halfD],
        [ halfW,  halfD],
        [-halfW,  halfD],
      ],
    });
  };

  if (chamferBottom && c > 1e-6) {
    addRing(0, c);
    addRing(c, 0);
  } else {
    addRing(0, 0);
  }

  if (chamferTop && c > 1e-6) {
    const shoulderZ = Math.max(rings[rings.length - 1].z + 1e-5, safeHeight - c);
    if (shoulderZ > rings[rings.length - 1].z + 1e-5) addRing(shoulderZ, 0);
    addRing(safeHeight, c);
  } else if (safeHeight > rings[rings.length - 1].z + 1e-5) {
    addRing(safeHeight, 0);
  }

  const positions = [];
  const indices = [];
  for (const ring of rings) {
    for (const [x, y] of ring.points) positions.push(x, y, ring.z);
  }

  // Side surfaces. Ring points are CCW when viewed from +Z.
  for (let r = 0; r < rings.length - 1; r += 1) {
    const lower = r * 4;
    const upper = (r + 1) * 4;
    for (let edge = 0; edge < 4; edge += 1) {
      const next = (edge + 1) % 4;
      indices.push(
        lower + edge, lower + next, upper + next,
        lower + edge, upper + next, upper + edge,
      );
    }
  }

  // Bottom cap faces down; top cap faces up.
  indices.push(0, 2, 1, 0, 3, 2);
  const top = (rings.length - 1) * 4;
  indices.push(top, top + 1, top + 2, top, top + 2, top + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingBox();
  flat.computeBoundingSphere();
  return flat;
}

function cross2D(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull2D(points = []) {
  const unique = new Map();
  for (const point of points) {
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    unique.set(`${x.toFixed(6)},${y.toFixed(6)}`, new THREE.Vector2(x, y));
  }

  const sorted = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 3) return sorted;

  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross2D(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-9) lower.pop();
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross2D(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-9) upper.pop();
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function insetConvexPolygon(points, distance) {
  if (distance <= 1e-8 || points.length < 3) return points.map((point) => point.clone());
  const result = [];
  const lineIntersection = (p1, d1, p2, d2) => {
    const denominator = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denominator) < 1e-9) return null;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const t = (dx * d2.y - dy * d2.x) / denominator;
    return new THREE.Vector2(p1.x + d1.x * t, p1.y + d1.y * t);
  };

  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];

    const dPrev = curr.clone().sub(prev).normalize();
    const dNext = next.clone().sub(curr).normalize();
    const nPrev = new THREE.Vector2(-dPrev.y, dPrev.x).multiplyScalar(distance);
    const nNext = new THREE.Vector2(-dNext.y, dNext.x).multiplyScalar(distance);
    const a = prev.clone().add(nPrev);
    const b = curr.clone().add(nNext);
    const intersection = lineIntersection(a, dPrev, b, dNext);
    result.push(intersection ?? curr.clone());
  }
  return result;
}

function createLinearChamferPolygonPrismGeometry(points, height, chamfer) {
  let polygon = convexHull2D(points);
  if (polygon.length < 3) throw new Error('DIAGONAL RUN HAS NO VALID POLYGON');

  const signedArea = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (signedArea < 0) polygon = polygon.reverse();

  const safeHeight = Math.max(0.001, Number(height) || 0.001);
  const c = THREE.MathUtils.clamp(Number(chamfer) || 0, 0, safeHeight * 0.2);
  const topPolygon = insetConvexPolygon(polygon, c);
  const rings = [{ z: 0, points: polygon }];
  if (c > 1e-6 && safeHeight > c + 1e-6) rings.push({ z: safeHeight - c, points: polygon });
  rings.push({ z: safeHeight, points: c > 1e-6 ? topPolygon : polygon });

  const positions = [];
  const indices = [];
  const n = polygon.length;
  for (const ring of rings) {
    for (const point of ring.points) positions.push(point.x, point.y, ring.z);
  }

  for (let r = 0; r < rings.length - 1; r += 1) {
    const lower = r * n;
    const upper = (r + 1) * n;
    for (let i = 0; i < n; i += 1) {
      const next = (i + 1) % n;
      indices.push(lower + i, lower + next, upper + next, lower + i, upper + next, upper + i);
    }
  }

  const bottomTriangles = THREE.ShapeUtils.triangulateShape(rings[0].points, []);
  for (const triangle of bottomTriangles) indices.push(triangle[0], triangle[2], triangle[1]);
  const topOffset = (rings.length - 1) * n;
  const topTriangles = THREE.ShapeUtils.triangulateShape(rings[rings.length - 1].points, []);
  for (const triangle of topTriangles) indices.push(topOffset + triangle[0], topOffset + triangle[1], topOffset + triangle[2]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingBox();
  flat.computeBoundingSphere();
  return flat;
}

function canonicalEdgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Organic Print is intentionally CAD-biased on the XY grid. When an authored
// run is already close to a canonical grid angle, lock it to an exact 45°
// increment. This keeps 0° / 45° / 90° / 135° members mathematically straight
// in both the live preview and exported mesh instead of leaving tiny PCA drift.
function snapDirectionToCadAngle(direction) {
  const rawAngle = Math.atan2(direction.y, direction.x);
  const step = Math.PI / 4;
  let snappedAngle = Math.round(rawAngle / step) * step;
  let angularError = Math.abs(Math.atan2(Math.sin(rawAngle - snappedAngle), Math.cos(rawAngle - snappedAngle)));
  angularError = Math.min(angularError, Math.PI - angularError);

  // Only lock lines that are already authored close to a canonical direction.
  // Arbitrary staircase lines can still use their fitted vector direction.
  if (angularError > THREE.MathUtils.degToRad(8)) {
    return { direction: direction.clone(), cadAngle: false, cadAngleDeg: null };
  }

  let snapped = new THREE.Vector2(Math.cos(snappedAngle), Math.sin(snappedAngle)).normalize();
  if (snapped.x < -1e-8 || (Math.abs(snapped.x) <= 1e-8 && snapped.y < 0)) snapped.multiplyScalar(-1);
  snappedAngle = Math.atan2(snapped.y, snapped.x);
  const normalizedDeg = ((Math.round(THREE.MathUtils.radToDeg(snappedAngle)) % 180) + 180) % 180;
  return { direction: snapped, cadAngle: true, cadAngleDeg: normalizedDeg };
}

function splitChainAtGridTurns(blocks) {
  if (!Array.isArray(blocks) || blocks.length < 3) return { segments: [blocks], turnCount: 0 };

  const stepKey = (a, b) => {
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    return `${dx},${dy}`;
  };

  const turnIndices = [];
  let previous = stepKey(blocks[0], blocks[1]);
  for (let i = 2; i < blocks.length; i += 1) {
    const current = stepKey(blocks[i - 1], blocks[i]);
    if (current !== previous) turnIndices.push(i - 1);
    previous = current;
  }

  if (!turnIndices.length) return { segments: [blocks], turnCount: 0 };

  // A real elbow/V/U has only a small number of deliberate direction changes.
  // A staircase approximation of an arbitrary straight line alternates direction
  // repeatedly, so leave those for the PCA line fitter instead of turning them
  // into a zig-zag of small beams.
  const maxDeliberateTurns = Math.max(2, Math.floor((blocks.length - 1) * 0.3));
  if (turnIndices.length > maxDeliberateTurns) return { segments: [blocks], turnCount: turnIndices.length };

  const segments = [];
  let start = 0;
  for (const turnIndex of turnIndices) {
    const segment = blocks.slice(start, turnIndex + 1);
    if (segment.length >= 2) segments.push(segment);
    start = turnIndex;
  }
  const tail = blocks.slice(start);
  if (tail.length >= 2) segments.push(tail);
  return { segments: segments.length ? segments : [blocks], turnCount: turnIndices.length };
}

function fitVectorLine(blocks, { allowShort = true } = {}) {
  if (!blocks || blocks.length < 2) return null;

  const points = blocks.map((block) => new THREE.Vector2(block.x + 0.5, block.y + 0.5));
  const mean = points.reduce((acc, point) => acc.add(point), new THREE.Vector2()).multiplyScalar(1 / points.length);

  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  xx /= points.length;
  xy /= points.length;
  yy /= points.length;

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle)).normalize();
  // Canonical orientation keeps signatures stable from one layer to the next.
  if (direction.x < -1e-8 || (Math.abs(direction.x) <= 1e-8 && direction.y < 0)) {
    direction.multiplyScalar(-1);
  }
  const cadLock = snapDirectionToCadAngle(direction);
  direction = cadLock.direction;
  const normal = new THREE.Vector2(-direction.y, direction.x);

  const projections = points.map((point) => point.dot(direction));
  const perpendiculars = points.map((point) => point.dot(normal));
  const minProjection = Math.min(...projections);
  const maxProjection = Math.max(...projections);
  const meanPerpendicular = perpendiculars.reduce((sum, value) => sum + value, 0) / perpendiculars.length;
  const maxDeviation = Math.max(...perpendiculars.map((value) => Math.abs(value - meanPerpendicular)));

  const trace = xx + yy;
  const determinant = xx * yy - xy * xy;
  const discriminant = Math.max(0, trace * trace * 0.25 - determinant);
  const major = trace * 0.5 + Math.sqrt(discriminant);
  const minor = Math.max(0, trace * 0.5 - Math.sqrt(discriminant));
  const aspect = major / Math.max(0.02, minor);

  // Exact grid lines (horizontal / vertical / true diagonals) are accepted even
  // when they contain only two control voxels. A staircase approximation to an
  // arbitrary angle needs a longer authored run before it is vectorised.
  const essentiallyCollinear = maxDeviation <= 0.08;
  if (!essentiallyCollinear && (!allowShort || blocks.length < 4)) return null;
  if (!essentiallyCollinear && maxDeviation > 0.52) return null;
  if (!essentiallyCollinear && aspect < 4.0) return null;

  const centerProjection = (minProjection + maxProjection) * 0.5;
  const center = direction.clone().multiplyScalar(centerProjection)
    .add(normal.clone().multiplyScalar(meanPerpendicular));

  return {
    blocks,
    direction,
    normal,
    angle: Math.atan2(direction.y, direction.x),
    center,
    minProjection,
    maxProjection,
    maxDeviation,
    essentiallyCollinear,
    cadAngle: cadLock.cadAngle,
    cadAngleDeg: cadLock.cadAngleDeg,
  };
}

function findVectorLineRuns(blocks) {
  const blocksByLayer = new Map();
  for (const block of blocks) {
    if (!blocksByLayer.has(block.z)) blocksByLayer.set(block.z, new Map());
    blocksByLayer.get(block.z).set(`${block.x},${block.y}`, block);
  }

  const lines = [];
  const excluded = new Set();
  const neighborOffsets = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx || dy) neighborOffsets.push([dx, dy]);
    }
  }
  const orthogonalOffsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (const [z, layer] of blocksByLayer.entries()) {
    // Line candidates deliberately exclude dense body cells. Edge/corner cells
    // may still participate, which lets a vector member terminate cleanly into
    // a larger voxel mass without vectorising that mass itself.
    const candidates = new Map();
    for (const block of layer.values()) {
      const n8 = neighborOffsets.reduce((count, [dx, dy]) => count + Number(layer.has(`${block.x + dx},${block.y + dy}`)), 0);
      const n4 = orthogonalOffsets.reduce((count, [dx, dy]) => count + Number(layer.has(`${block.x + dx},${block.y + dy}`)), 0);
      if (n8 <= 4 && n4 <= 2) candidates.set(`${block.x},${block.y}`, block);
    }

    const graph = new Map();
    for (const [key, block] of candidates.entries()) {
      const neighbors = [];
      for (const [dx, dy] of neighborOffsets) {
        const neighborKey = `${block.x + dx},${block.y + dy}`;
        if (candidates.has(neighborKey)) neighbors.push(neighborKey);
      }
      graph.set(key, neighbors);
    }

    const visitedEdges = new Set();
    const chains = [];
    const traceFrom = (startKey, nextKey) => {
      const chainKeys = [startKey];
      let previous = startKey;
      let current = nextKey;
      visitedEdges.add(canonicalEdgeKey(previous, current));

      while (true) {
        chainKeys.push(current);
        const neighbors = graph.get(current) ?? [];
        if (neighbors.length !== 2) break;
        const following = neighbors[0] === previous ? neighbors[1] : neighbors[0];
        const edgeKey = canonicalEdgeKey(current, following);
        if (visitedEdges.has(edgeKey)) break;
        visitedEdges.add(edgeKey);
        previous = current;
        current = following;
      }
      return chainKeys;
    };

    // Split sparse networks at endpoints and junctions. Each branch is fitted
    // independently, so a V/Y/cross does not get collapsed into one diagonal.
    for (const [key, neighbors] of graph.entries()) {
      if (neighbors.length === 2) continue;
      for (const neighborKey of neighbors) {
        const edgeKey = canonicalEdgeKey(key, neighborKey);
        if (visitedEdges.has(edgeKey)) continue;
        chains.push(traceFrom(key, neighborKey));
      }
    }

    // Components with degree 2 everywhere are closed loops. They are already
    // cleanly handled by the merged voxel surface, so do not force-fit them.

    for (const chainKeys of chains) {
      const chainBlocks = chainKeys.map((key) => candidates.get(key)).filter(Boolean);
      const split = splitChainAtGridTurns(chainBlocks);

      // Prefer deliberate 45°/90° elbows as separate exact members. If the
      // chain changes direction repeatedly (a raster staircase approximating a
      // single arbitrary line), keep the original one-line PCA fit instead.
      const deliberateCorner = split.turnCount > 0 && split.segments.length > 1;
      const pieces = deliberateCorner ? split.segments : [chainBlocks];
      let accepted = false;

      for (const piece of pieces) {
        const fitted = fitVectorLine(piece, { allowShort: true });
        if (!fitted) continue;
        fitted.z = z;
        fitted.cellSignature = [...new Set(piece.map((block) => `${block.x},${block.y}`))].sort().join(';');
        lines.push(fitted);
        accepted = true;
        for (const block of piece) excluded.add(`${block.x},${block.y},${block.z}`);
      }

      // If a tentative corner split did not produce valid members, fall back to
      // the original fitter so older arbitrary-angle authored lines still work.
      if (!accepted && deliberateCorner) {
        const fitted = fitVectorLine(chainBlocks, { allowShort: true });
        if (!fitted) continue;
        fitted.z = z;
        fitted.cellSignature = [...new Set(chainBlocks.map((block) => `${block.x},${block.y}`))].sort().join(';');
        lines.push(fitted);
        for (const block of chainBlocks) excluded.add(`${block.x},${block.y},${block.z}`);
      }
    }

    // Recover interrupted authored lines: isolated/short sparse pieces that are
    // exactly collinear across a small gap are kept as separate straight pieces
    // rather than being left as pixel cubes. The gap itself remains a gap.
    const unclaimed = [...candidates.values()].filter((block) => !excluded.has(`${block.x},${block.y},${block.z}`));
    const directionFamilies = [
      [1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [2, -1], [1, 2], [1, -2],
    ];
    const usedFallback = new Set();
    for (const [dx0, dy0] of directionFamilies) {
      const len = Math.hypot(dx0, dy0);
      const dx = dx0 / len;
      const dy = dy0 / len;
      const nx = -dy;
      const ny = dx;
      const bins = new Map();
      for (const block of unclaimed) {
        const key = `${block.x},${block.y}`;
        if (usedFallback.has(key)) continue;
        const cx = block.x + 0.5;
        const cy = block.y + 0.5;
        const offset = Math.round((cx * nx + cy * ny) * 1000) / 1000;
        const binKey = `${offset}`;
        if (!bins.has(binKey)) bins.set(binKey, []);
        bins.get(binKey).push(block);
      }
      for (const group of bins.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) => ((a.x + 0.5) * dx + (a.y + 0.5) * dy) - ((b.x + 0.5) * dx + (b.y + 0.5) * dy));
        let segment = [group[0]];
        const flush = () => {
          if (segment.length < 2) return;
          const fitted = fitVectorLine(segment, { allowShort: true });
          if (!fitted || !fitted.essentiallyCollinear) return;
          fitted.z = z;
          fitted.cellSignature = segment.map((block) => `${block.x},${block.y}`).sort().join(';');
          lines.push(fitted);
          for (const block of segment) {
            usedFallback.add(`${block.x},${block.y}`);
            excluded.add(`${block.x},${block.y},${block.z}`);
          }
        };
        for (let i = 1; i < group.length; i += 1) {
          const a = group[i - 1];
          const b = group[i];
          const delta = Math.hypot(b.x - a.x, b.y - a.y);
          if (delta > len * 2.1 + 1e-6) {
            flush();
            segment = [b];
          } else {
            segment.push(b);
          }
        }
        flush();
      }
    }
  }

  return { lines, excluded };
}

function groupVectorLinesVertically(lines) {
  const bySignature = new Map();
  for (const line of lines) {
    // Cell membership is more stable than floating-point angle/center values.
    const signature = line.cellSignature;
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(line);
  }

  const grouped = [];
  for (const sameLines of bySignature.values()) {
    sameLines.sort((a, b) => a.z - b.z);
    let current = null;
    for (const line of sameLines) {
      if (!current || line.z !== current.zEnd + 1) {
        if (current) grouped.push(current);
        current = { ...line, zStart: line.z, zEnd: line.z };
      } else {
        current.zEnd = line.z;
      }
    }
    if (current) grouped.push(current);
  }
  return grouped;
}

function greedyRectangles(cells) {
  const remaining = new Set(cells);
  const rectangles = [];
  const parse = (key) => key.split(',').map(Number);

  while (remaining.size) {
    let seed = null;
    for (const key of remaining) {
      const [u, v] = parse(key);
      if (!seed || v < seed.v || (v === seed.v && u < seed.u)) seed = { key, u, v };
    }
    const { u, v } = seed;
    let width = 1;
    while (remaining.has(`${u + width},${v}`)) width += 1;

    let height = 1;
    outer: while (true) {
      for (let du = 0; du < width; du += 1) {
        if (!remaining.has(`${u + du},${v + height}`)) break outer;
      }
      height += 1;
    }

    for (let dv = 0; dv < height; dv += 1) {
      for (let du = 0; du < width; du += 1) remaining.delete(`${u + du},${v + dv}`);
    }
    rectangles.push({ u, v, width, height });
  }
  return rectangles;
}

function createGreedyVoxelSurfaceGeometry(blocks, scale) {
  if (!blocks.length) return null;
  const occupied = new Set(blocks.map((block) => `${block.x},${block.y},${block.z}`));
  const faces = new Map();
  const addFace = (orientation, plane, u, v) => {
    const key = `${orientation}:${plane}`;
    if (!faces.has(key)) faces.set(key, new Set());
    faces.get(key).add(`${u},${v}`);
  };

  for (const block of blocks) {
    const { x, y, z } = block;
    if (!occupied.has(`${x + 1},${y},${z}`)) addFace('px', x + 1, y, z);
    if (!occupied.has(`${x - 1},${y},${z}`)) addFace('nx', x, y, z);
    if (!occupied.has(`${x},${y + 1},${z}`)) addFace('py', y + 1, x, z);
    if (!occupied.has(`${x},${y - 1},${z}`)) addFace('ny', y, x, z);
    if (!occupied.has(`${x},${y},${z + 1}`)) addFace('pz', z + 1, x, y);
    if (!occupied.has(`${x},${y},${z - 1}`)) addFace('nz', z, x, y);
  }

  const positions = [];
  const indices = [];
  const pushQuad = (a, b, c, d) => {
    const base = positions.length / 3;
    for (const point of [a, b, c, d]) positions.push(point[0] * scale, point[1] * scale, point[2] * scale);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (const [faceKey, cells] of faces.entries()) {
    const separator = faceKey.indexOf(':');
    const orientation = faceKey.slice(0, separator);
    const plane = Number(faceKey.slice(separator + 1));
    for (const rect of greedyRectangles(cells)) {
      const u0 = rect.u;
      const v0 = rect.v;
      const u1 = u0 + rect.width;
      const v1 = v0 + rect.height;
      if (orientation === 'px') pushQuad([plane, u0, v0], [plane, u1, v0], [plane, u1, v1], [plane, u0, v1]);
      else if (orientation === 'nx') pushQuad([plane, u0, v0], [plane, u0, v1], [plane, u1, v1], [plane, u1, v0]);
      else if (orientation === 'py') pushQuad([u0, plane, v0], [u0, plane, v1], [u1, plane, v1], [u1, plane, v0]);
      else if (orientation === 'ny') pushQuad([u0, plane, v0], [u1, plane, v0], [u1, plane, v1], [u0, plane, v1]);
      else if (orientation === 'pz') pushQuad([u0, v0, plane], [u1, v0, plane], [u1, v1, plane], [u0, v1, plane]);
      else if (orientation === 'nz') pushQuad([u0, v0, plane], [u0, v1, plane], [u1, v1, plane], [u1, v0, plane]);
    }
  }

  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingBox();
  flat.computeBoundingSphere();
  return flat;
}

function sdfBoxLocal(px, py, pz, cx, cy, cz, hx, hy, hz) {
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const qz = Math.abs(pz - cz) - hz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const outside = Math.hypot(ox, oy, oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return outside + inside;
}

function smoothMinDistance(a, b, radius) {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  const k = Math.max(0, Number(radius) || 0);
  if (k <= 1e-7) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k * 0.25);
}

function createOrganicVectorSurfaceGeometry(bodyBlocks, vectorLines, allBlocks, scale, blendRadiusCells, { quality = 'export' } = {}) {
  if (!allBlocks.length) return null;

  const occupied = new Set(bodyBlocks.map((block) => `${block.x},${block.y},${block.z}`));
  const beamDescriptors = vectorLines.map((line) => {
    const layers = line.zEnd - line.zStart + 1;
    const halfFootprintAlongLine = 0.5 * (Math.abs(line.direction.x) + Math.abs(line.direction.y));
    const lengthCells = Math.max(1, (line.maxProjection - line.minProjection) + 2 * halfFootprintAlongLine);
    const cos = Math.cos(line.angle);
    const sin = Math.sin(line.angle);
    return {
      cx: line.center.x,
      cy: line.center.y,
      cz: line.zStart + layers * 0.5,
      halfLength: lengthCells * 0.5,
      halfWidth: 0.5,
      halfHeight: layers * 0.5,
      cos,
      sin,
      angle: line.angle,
      cadAngle: Boolean(line.cadAngle),
      cadAngleDeg: line.cadAngleDeg,
    };
  });

  const minBlockX = Math.min(...allBlocks.map((block) => block.x));
  const minBlockY = Math.min(...allBlocks.map((block) => block.y));
  const minBlockZ = Math.min(...allBlocks.map((block) => block.z));
  const maxBlockX = Math.max(...allBlocks.map((block) => block.x + 1));
  const maxBlockY = Math.max(...allBlocks.map((block) => block.y + 1));
  const maxBlockZ = Math.max(...allBlocks.map((block) => block.z + 1));

  // A small exterior margin is enough because the zero-isosurface cannot move
  // farther than the local blend radius. Keep z below zero so the marching pass
  // can close the mesh against the print-bed plane exactly.
  const margin = Math.max(0.45, blendRadiusCells + 0.22);
  const bounds = {
    minX: minBlockX - margin,
    minY: minBlockY - margin,
    minZ: Math.min(-0.35, minBlockZ - margin),
    maxX: maxBlockX + margin,
    maxY: maxBlockY + margin,
    maxZ: maxBlockZ + margin,
  };

  // High-resolution implicit sampling is the main surface-quality control.
  // Earlier versions used 4-5 samples/cell, which left visible saw-tooth facets
  // in Bambu Studio. Start much denser and only step down for genuinely large
  // builds so exported beams read as manufactured parts rather than voxel mesh.
  const realtimeQuality = quality === 'preview';
  let samplesPerCell = realtimeQuality ? 6 : 10;
  const countFor = (spc) => {
    const nx = Math.ceil((bounds.maxX - bounds.minX) * spc) + 1;
    const ny = Math.ceil((bounds.maxY - bounds.minY) * spc) + 1;
    const nz = Math.ceil((bounds.maxZ - bounds.minZ) * spc) + 1;
    return { nx, ny, nz, total: nx * ny * nz };
  };
  let dims = countFor(samplesPerCell);
  const maxSamples = realtimeQuality ? 950000 : 2800000;
  const qualitySteps = realtimeQuality ? [5, 4, 3] : [9, 8, 7, 6];
  for (const candidate of qualitySteps) {
    if (dims.total <= maxSamples) break;
    samplesPerCell = candidate;
    dims = countFor(samplesPerCell);
  }
  const { nx, ny, nz } = dims;
  const step = 1 / samplesPerCell;
  const field = new Float32Array(nx * ny * nz);
  const indexOf = (ix, iy, iz) => ix + nx * (iy + ny * iz);

  const bodyDistanceAt = (px, py, pz) => {
    if (!occupied.size) return Number.POSITIVE_INFINITY;
    const fx = Math.floor(px);
    const fy = Math.floor(py);
    const fz = Math.floor(pz);
    let best = Number.POSITIVE_INFINITY;
    // Only local cells can influence the zero surface. This keeps a dense model
    // fast while preserving the exact union of its axis-aligned voxel boxes.
    for (let z = fz - 2; z <= fz + 2; z += 1) {
      for (let y = fy - 2; y <= fy + 2; y += 1) {
        for (let x = fx - 2; x <= fx + 2; x += 1) {
          if (!occupied.has(`${x},${y},${z}`)) continue;
          const distance = sdfBoxLocal(px, py, pz, x + 0.5, y + 0.5, z + 0.5, 0.5, 0.5, 0.5);
          if (distance < best) best = distance;
        }
      }
    }
    return best;
  };

  const beamAngleDelta = (beamA, beamB) => {
    if (!beamA || !beamB) return Number.POSITIVE_INFINITY;
    let delta = Math.abs(beamA.angle - beamB.angle) % Math.PI;
    if (delta > Math.PI / 2) delta = Math.PI - delta;
    return Math.abs(delta);
  };

  const isCadBeamCorner = (beamA, beamB) => {
    const delta = beamAngleDelta(beamA, beamB);
    const tolerance = THREE.MathUtils.degToRad(3.5);
    return Math.abs(delta - Math.PI / 4) <= tolerance || Math.abs(delta - Math.PI / 2) <= tolerance;
  };

  const sampleBeamDistances = (px, py, pz) => beamDescriptors.map((beam) => {
    const dx = px - beam.cx;
    const dy = py - beam.cy;
    const lx = dx * beam.cos + dy * beam.sin;
    const ly = -dx * beam.sin + dy * beam.cos;
    const d = sdfBoxLocal(lx, ly, pz, 0, 0, beam.cz, beam.halfLength, beam.halfWidth, beam.halfHeight);
    return { beam, lx, ly, d, ad: Math.abs(d) };
  });

  const beamDistanceAt = (px, py, pz) => {
    if (!beamDescriptors.length) return Number.POSITIVE_INFINITY;
    const samples = sampleBeamDistances(px, py, pz);
    const byAbs = [...samples].sort((a, b) => a.ad - b.ad);
    const hardDistance = Math.min(...samples.map((entry) => entry.d));

    // Canonical 45° and 90° member-to-member corners are deliberate CAD
    // geometry. Keep those unions hard/miter-like instead of melting them with
    // the organic smooth-min. Other junctions can still use the local blend.
    const beamJoinRadius = blendRadiusCells * 0.72;
    if (byAbs.length > 1
      && byAbs[0].ad < beamJoinRadius * 2.2
      && byAbs[1].ad < beamJoinRadius * 2.2
      && isCadBeamCorner(byAbs[0].beam, byAbs[1].beam)) {
      return hardDistance;
    }

    let distance = Number.POSITIVE_INFINITY;
    for (const entry of samples) distance = smoothMinDistance(distance, entry.d, beamJoinRadius);
    return distance;
  };

  const beamInfoAt = (px, py, pz) => {
    const samples = sampleBeamDistances(px, py, pz).sort((a, b) => a.ad - b.ad);
    const nearest = samples[0] ?? null;
    const second = samples[1] ?? null;
    return {
      nearest,
      second,
      nearestAbs: nearest?.ad ?? Number.POSITIVE_INFINITY,
      secondAbs: second?.ad ?? Number.POSITIVE_INFINITY,
      cadCorner: Boolean(nearest && second && isCadBeamCorner(nearest.beam, second.beam)),
    };
  };

  // Keep manufactured-looking planes away from junctions. The implicit union is
  // only allowed to own the transition zone; everywhere else its vertices are
  // snapped back onto the exact beam/body planes. This removes the serrated
  // marching-tetrahedra edge without making the join hard or disconnected.
  const refineSurfacePoint = (point) => {
    const bodyDistance = bodyDistanceAt(point.x, point.y, point.z);
    const info = beamInfoAt(point.x, point.y, point.z);
    const beamDistance = info.nearest?.d ?? Number.POSITIVE_INFINITY;
    const transitionBand = Math.max(blendRadiusCells * 1.75, step * 2.2);
    const bodyBeamJoin = Number.isFinite(bodyDistance) && Number.isFinite(beamDistance)
      && Math.abs(bodyDistance - beamDistance) < transitionBand
      && Math.min(Math.abs(bodyDistance), Math.abs(beamDistance)) < transitionBand * 1.25;
    const beamBeamJoin = info.secondAbs < transitionBand * 1.15;
    const cadBeamCorner = beamBeamJoin && info.cadCorner;
    const nearBed = point.z < step * 1.4;
    // Organic blending still owns body/member transitions. A 45° or 90°
    // member-to-member corner is different: allow the normal beam-plane snap
    // below to clean it into a crisp manufactured elbow instead of leaving a
    // faceted implicit-surface patch.
    if (bodyBeamJoin || (beamBeamJoin && !cadBeamCorner) || nearBed) {
      if (nearBed) point.z = Math.max(0, point.z);
      return point;
    }

    if (info.nearest && info.nearestAbs <= Math.abs(bodyDistance) + step * 0.7) {
      const { beam, lx, ly } = info.nearest;
      let lz = point.z - beam.cz;
      const faceTolerance = step * 1.65;
      const candidates = [
        { axis: 'x', distance: Math.abs(Math.abs(lx) - beam.halfLength) },
        { axis: 'y', distance: Math.abs(Math.abs(ly) - beam.halfWidth) },
        { axis: 'z', distance: Math.abs(Math.abs(lz) - beam.halfHeight) },
      ];
      const minFace = Math.min(...candidates.map((entry) => entry.distance));
      let sx = lx;
      let sy = ly;
      for (const face of candidates) {
        if (face.distance > Math.min(faceTolerance, minFace + step * 0.42)) continue;
        if (face.axis === 'x') sx = (lx < 0 ? -1 : 1) * beam.halfLength;
        if (face.axis === 'y') sy = (ly < 0 ? -1 : 1) * beam.halfWidth;
        if (face.axis === 'z') lz = (lz < 0 ? -1 : 1) * beam.halfHeight;
      }
      point.x = beam.cx + sx * beam.cos - sy * beam.sin;
      point.y = beam.cy + sx * beam.sin + sy * beam.cos;
      point.z = beam.cz + lz;
      return point;
    }

    if (Number.isFinite(bodyDistance)) {
      // A voxel body is a union of axis-aligned cells, so every manufactured
      // exterior face lies on an integer grid plane. Snap *all* coordinates
      // that are already close to such a plane rather than only the closest
      // one. Snapping a single axis left tiny chamfer-like terraces around
      // every cell in the live Organic Print view, making the cubes visible
      // through what should read as one clean skin.
      const snapTolerance = step * 1.58;
      const px = Math.round(point.x);
      const py = Math.round(point.y);
      const pz = Math.round(point.z);
      if (Math.abs(point.x - px) < snapTolerance) point.x = px;
      if (Math.abs(point.y - py) < snapTolerance) point.y = py;
      if (Math.abs(point.z - pz) < snapTolerance) point.z = pz;
    }
    return point;
  };

  for (let iz = 0; iz < nz; iz += 1) {
    const pz = bounds.minZ + iz * step;
    for (let iy = 0; iy < ny; iy += 1) {
      const py = bounds.minY + iy * step;
      for (let ix = 0; ix < nx; ix += 1) {
        const px = bounds.minX + ix * step;
        const bodyDistance = bodyDistanceAt(px, py, pz);
        const beamDistance = beamDistanceAt(px, py, pz);
        let distance = smoothMinDistance(bodyDistance, beamDistance, blendRadiusCells);
        // Never let the smooth union bulge below the print bed. This clips the
        // whole result against z >= 0 and guarantees one flat printable base.
        distance = Math.max(distance, -pz);
        field[indexOf(ix, iy, iz)] = Number.isFinite(distance) ? distance : 10;
      }
    }
  }

  const positions = [];
  const cubeCorners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  // Six tetrahedra sharing the 0 -> 6 diagonal. This decomposition is stable
  // across adjacent cells and avoids the ambiguous cases of marching cubes.
  const tetrahedra = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
  ];

  const interpolate = (pa, pb, va, vb) => {
    const denominator = va - vb;
    const t = Math.abs(denominator) < 1e-8 ? 0.5 : THREE.MathUtils.clamp(va / denominator, 0, 1);
    return new THREE.Vector3(
      THREE.MathUtils.lerp(pa.x, pb.x, t),
      THREE.MathUtils.lerp(pa.y, pb.y, t),
      THREE.MathUtils.lerp(pa.z, pb.z, t),
    );
  };

  const addTriangle = (a, b, c, outwardHint) => {
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    const normal = ab.cross(ac);
    if (normal.lengthSq() < 1e-12) return;
    if (outwardHint && normal.dot(outwardHint) < 0) {
      const tmp = b;
      b = c;
      c = tmp;
    }
    for (const point of [a, b, c]) {
      const refined = refineSurfacePoint(point.clone());
      positions.push(refined.x * scale, refined.y * scale, refined.z * scale);
    }
  };

  for (let iz = 0; iz < nz - 1; iz += 1) {
    for (let iy = 0; iy < ny - 1; iy += 1) {
      for (let ix = 0; ix < nx - 1; ix += 1) {
        const points = cubeCorners.map(([dx, dy, dz]) => new THREE.Vector3(
          bounds.minX + (ix + dx) * step,
          bounds.minY + (iy + dy) * step,
          bounds.minZ + (iz + dz) * step,
        ));
        const values = cubeCorners.map(([dx, dy, dz]) => field[indexOf(ix + dx, iy + dy, iz + dz)]);
        const allOutside = values.every((value) => value >= 0);
        const allInside = values.every((value) => value < 0);
        if (allOutside || allInside) continue;

        for (const tetra of tetrahedra) {
          const inside = tetra.filter((corner) => values[corner] < 0);
          const outside = tetra.filter((corner) => values[corner] >= 0);
          if (inside.length === 0 || inside.length === 4) continue;

          if (inside.length === 1) {
            const i0 = inside[0];
            const p0 = interpolate(points[i0], points[outside[0]], values[i0], values[outside[0]]);
            const p1 = interpolate(points[i0], points[outside[1]], values[i0], values[outside[1]]);
            const p2 = interpolate(points[i0], points[outside[2]], values[i0], values[outside[2]]);
            const outsideCenter = points[outside[0]].clone().add(points[outside[1]]).add(points[outside[2]]).multiplyScalar(1 / 3);
            const insidePoint = points[i0];
            addTriangle(p0, p1, p2, outsideCenter.sub(insidePoint));
          } else if (inside.length === 3) {
            const o0 = outside[0];
            const p0 = interpolate(points[o0], points[inside[0]], values[o0], values[inside[0]]);
            const p1 = interpolate(points[o0], points[inside[1]], values[o0], values[inside[1]]);
            const p2 = interpolate(points[o0], points[inside[2]], values[o0], values[inside[2]]);
            const insideCenter = points[inside[0]].clone().add(points[inside[1]]).add(points[inside[2]]).multiplyScalar(1 / 3);
            addTriangle(p0, p1, p2, points[o0].clone().sub(insideCenter));
          } else {
            const [ia, ib] = inside;
            const [oa, ob] = outside;
            const pac = interpolate(points[ia], points[oa], values[ia], values[oa]);
            const pad = interpolate(points[ia], points[ob], values[ia], values[ob]);
            const pbc = interpolate(points[ib], points[oa], values[ib], values[oa]);
            const pbd = interpolate(points[ib], points[ob], values[ib], values[ob]);
            const insideCenter = points[ia].clone().add(points[ib]).multiplyScalar(0.5);
            const outsideCenter = points[oa].clone().add(points[ob]).multiplyScalar(0.5);
            const hint = outsideCenter.sub(insideCenter);
            addTriangle(pac, pad, pbd, hint);
            addTriangle(pac, pbd, pbc, hint);
          }
        }
      }
    }
  }

  if (!positions.length) return null;
  const rawGeometry = new THREE.BufferGeometry();
  rawGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  // Creased normals give the two surface types the shading they need:
  // broad/straight CAD planes keep crisp highlights, while triangles inside a
  // genuinely organic transition share a smooth normal field. Plain
  // computeVertexNormals() on the non-indexed marching mesh made every small
  // triangle visible and exaggerated the underlying voxel pattern.
  const geometry = toCreasedNormals(rawGeometry, THREE.MathUtils.degToRad(48));
  if (geometry !== rawGeometry) rawGeometry.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}


// -----------------------------------------------------------------------------
// OVERSAMPLED 2.5D ORGANIC RECONSTRUCTION
// -----------------------------------------------------------------------------
// The editor is deliberately low-resolution (4..16 cells). Organic Print treats
// that grid as an authoring resolution rather than a final surface resolution:
// each occupied Z layer is rasterised at a much higher XY resolution, converted
// to a signed-distance field, lightly morphologically closed / filtered, then
// extruded as a thin level-set slab. Adjacent slabs are joined with a small
// anisotropic blend. This produces continuous silhouettes without globally
// melting the model in Z. Sparse authored lines are rasterised as exact vector
// rectangles before the distance transform, so diagonal members remain straight.
function rasterMorph(mask, width, height, radius, mode) {
  const r = Math.max(0, Math.round(radius));
  if (r <= 0) return new Uint8Array(mask);
  const out = new Uint8Array(mask.length);
  const wantAny = mode === 'dilate';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = wantAny ? 0 : 1;
      outer: for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          if (ox * ox + oy * oy > r * r) continue;
          const sx = x + ox;
          const sy = y + oy;
          const sample = sx >= 0 && sx < width && sy >= 0 && sy < height
            ? mask[sx + width * sy]
            : 0;
          if (wantAny && sample) { value = 1; break outer; }
          if (!wantAny && !sample) { value = 0; break outer; }
        }
      }
      out[x + width * y] = value;
    }
  }
  return out;
}

function closeRasterMask(mask, width, height, radius) {
  if (radius <= 0) return new Uint8Array(mask);
  return rasterMorph(rasterMorph(mask, width, height, radius, 'dilate'), width, height, radius, 'erode');
}

function chamferDistanceTo(mask, width, height, targetValue) {
  const INF = 1e9;
  const SQRT2 = Math.SQRT2;
  const d = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) d[i] = mask[i] === targetValue ? 0 : INF;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = x + width * y;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) v = Math.min(v, d[i - width] + 1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - width - 1] + SQRT2);
      if (x + 1 < width && y > 0) v = Math.min(v, d[i - width + 1] + SQRT2);
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = x + width * y;
      let v = d[i];
      if (x + 1 < width) v = Math.min(v, d[i + 1] + 1);
      if (y + 1 < height) v = Math.min(v, d[i + width] + 1);
      if (x + 1 < width && y + 1 < height) v = Math.min(v, d[i + width + 1] + SQRT2);
      if (x > 0 && y + 1 < height) v = Math.min(v, d[i + width - 1] + SQRT2);
      d[i] = v;
    }
  }
  return d;
}

function blurScalarField2D(input, width, height, passes = 1) {
  const kernel = [1, 4, 6, 4, 1];
  const norm = 16;
  let src = new Float32Array(input);
  const tmp = new Float32Array(input.length);
  const out = new Float32Array(input.length);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -2; k <= 2; k += 1) {
          const sx = THREE.MathUtils.clamp(x + k, 0, width - 1);
          sum += src[sx + width * y] * kernel[k + 2];
        }
        tmp[x + width * y] = sum / norm;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -2; k <= 2; k += 1) {
          const sy = THREE.MathUtils.clamp(y + k, 0, height - 1);
          sum += tmp[x + width * sy] * kernel[k + 2];
        }
        out[x + width * y] = sum / norm;
      }
    }
    src = new Float32Array(out);
  }
  return src;
}

function makeRasterLineDescriptor(line) {
  const halfFootprintAlongLine = 0.5 * (Math.abs(line.direction.x) + Math.abs(line.direction.y));
  const lengthCells = Math.max(1, (line.maxProjection - line.minProjection) + 2 * halfFootprintAlongLine);
  return {
    z: line.z,
    cx: line.center.x,
    cy: line.center.y,
    cos: Math.cos(line.angle),
    sin: Math.sin(line.angle),
    halfLength: lengthCells * 0.5,
    halfWidth: 0.5,
  };
}

function createOversampledLayerSdfGeometry(standardBlocks, scale, strength, { quality = 'export' } = {}) {
  if (!standardBlocks.length) return null;

  const preview = quality === 'preview';
  const rasterFactor = preview ? 8 : 12;
  const surfaceSamplesPerCell = preview ? 5 : 8;
  const strengthT = THREE.MathUtils.clamp((strength - 1) / 4, 0, 1);
  const closeRadiusPx = Math.round(THREE.MathUtils.lerp(0, 2, strengthT));
  const blurPasses = strength <= 2 ? 1 : strength <= 4 ? 2 : 3;
  const verticalBlend = THREE.MathUtils.lerp(0.035, 0.15, strengthT);

  const { lines, excluded } = findVectorLineRuns(standardBlocks);
  const linesByLayer = new Map();
  for (const line of lines) {
    if (!linesByLayer.has(line.z)) linesByLayer.set(line.z, []);
    linesByLayer.get(line.z).push(makeRasterLineDescriptor(line));
  }

  const minX = Math.max(-1, Math.min(...standardBlocks.map((b) => b.x)) - 1);
  const minY = Math.max(-1, Math.min(...standardBlocks.map((b) => b.y)) - 1);
  const maxX = Math.min(model.gridSize + 1, Math.max(...standardBlocks.map((b) => b.x + 1)) + 1);
  const maxY = Math.min(model.gridSize + 1, Math.max(...standardBlocks.map((b) => b.y + 1)) + 1);
  const minZ = Math.min(...standardBlocks.map((b) => b.z));
  const maxZ = Math.max(...standardBlocks.map((b) => b.z));
  const rasterW = Math.max(4, Math.ceil((maxX - minX) * rasterFactor));
  const rasterH = Math.max(4, Math.ceil((maxY - minY) * rasterFactor));

  const blocksByLayer = new Map();
  for (const block of standardBlocks) {
    if (excluded.has(`${block.x},${block.y},${block.z}`)) continue;
    if (!blocksByLayer.has(block.z)) blocksByLayer.set(block.z, new Set());
    blocksByLayer.get(block.z).add(`${block.x},${block.y}`);
  }

  const layers = new Map();
  for (let z = minZ; z <= maxZ; z += 1) {
    const mask = new Uint8Array(rasterW * rasterH);
    const body = blocksByLayer.get(z) ?? new Set();
    const lineDescriptors = linesByLayer.get(z) ?? [];

    for (let py = 0; py < rasterH; py += 1) {
      const y = minY + (py + 0.5) / rasterFactor;
      for (let px = 0; px < rasterW; px += 1) {
        const x = minX + (px + 0.5) / rasterFactor;
        const bx = Math.floor(x);
        const by = Math.floor(y);
        let inside = body.has(`${bx},${by}`);
        if (!inside) {
          for (const line of lineDescriptors) {
            const dx = x - line.cx;
            const dy = y - line.cy;
            const lx = dx * line.cos + dy * line.sin;
            const ly = -dx * line.sin + dy * line.cos;
            if (Math.abs(lx) <= line.halfLength && Math.abs(ly) <= line.halfWidth) {
              inside = true;
              break;
            }
          }
        }
        if (inside) mask[px + rasterW * py] = 1;
      }
    }

    const closed = closeRasterMask(mask, rasterW, rasterH, closeRadiusPx);
    const distInside = chamferDistanceTo(closed, rasterW, rasterH, 1);
    const distOutside = chamferDistanceTo(closed, rasterW, rasterH, 0);
    const sdf = new Float32Array(closed.length);
    for (let i = 0; i < closed.length; i += 1) {
      sdf[i] = (closed[i] ? -distOutside[i] : distInside[i]) / rasterFactor;
    }
    // Filtering the distance field rather than the binary occupancy acts like
    // anti-aliasing on a physical contour: straight vectorised spans remain
    // straight, while one-cell raster stair-steps become continuous curves.
    const filtered = blurScalarField2D(sdf, rasterW, rasterH, blurPasses);
    layers.set(z, filtered);
  }

  const sampleLayerSdf = (z, x, y) => {
    const sdf = layers.get(z);
    if (!sdf) return 10;
    const fx = (x - minX) * rasterFactor - 0.5;
    const fy = (y - minY) * rasterFactor - 0.5;
    if (fx < -1 || fy < -1 || fx > rasterW || fy > rasterH) return 10;
    const x0 = THREE.MathUtils.clamp(Math.floor(fx), 0, rasterW - 1);
    const y0 = THREE.MathUtils.clamp(Math.floor(fy), 0, rasterH - 1);
    const x1 = Math.min(rasterW - 1, x0 + 1);
    const y1 = Math.min(rasterH - 1, y0 + 1);
    const tx = THREE.MathUtils.clamp(fx - Math.floor(fx), 0, 1);
    const ty = THREE.MathUtils.clamp(fy - Math.floor(fy), 0, 1);
    const a = THREE.MathUtils.lerp(sdf[x0 + rasterW * y0], sdf[x1 + rasterW * y0], tx);
    const b = THREE.MathUtils.lerp(sdf[x0 + rasterW * y1], sdf[x1 + rasterW * y1], tx);
    return THREE.MathUtils.lerp(a, b, ty);
  };

  const fieldAt = (x, y, zWorld) => {
    let d = Number.POSITIVE_INFINITY;
    for (let layer = minZ; layer <= maxZ; layer += 1) {
      const dxy = sampleLayerSdf(layer, x, y);
      if (dxy > 3) continue;
      const dz = Math.abs(zWorld - (layer + 0.5)) - 0.5;
      const slab = Math.max(dxy, dz);
      d = smoothMinDistance(d, slab, verticalBlend);
    }
    // Exact print-bed plane: XY smoothing is allowed, under-side rounding is not.
    return Math.max(d, -zWorld);
  };

  const margin = 0.45;
  const bounds = {
    minX: minX - margin,
    minY: minY - margin,
    minZ: -0.30,
    maxX: maxX + margin,
    maxY: maxY + margin,
    maxZ: maxZ + 1 + margin,
  };
  const step = 1 / surfaceSamplesPerCell;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step) + 1;
  const ny = Math.ceil((bounds.maxY - bounds.minY) / step) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  const indexOf = (ix, iy, iz) => ix + nx * (iy + ny * iz);
  for (let iz = 0; iz < nz; iz += 1) {
    const z = bounds.minZ + iz * step;
    for (let iy = 0; iy < ny; iy += 1) {
      const y = bounds.minY + iy * step;
      for (let ix = 0; ix < nx; ix += 1) {
        const x = bounds.minX + ix * step;
        field[indexOf(ix, iy, iz)] = fieldAt(x, y, z);
      }
    }
  }

  const positions = [];
  const cubeCorners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tetrahedra = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
  ];
  const interpolate = (pa, pb, va, vb) => {
    const denom = va - vb;
    const t = Math.abs(denom) < 1e-9 ? 0.5 : THREE.MathUtils.clamp(va / denom, 0, 1);
    return new THREE.Vector3(
      THREE.MathUtils.lerp(pa.x, pb.x, t),
      THREE.MathUtils.lerp(pa.y, pb.y, t),
      THREE.MathUtils.lerp(pa.z, pb.z, t),
    );
  };
  const addTriangle = (a, b, c, outwardHint) => {
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.lengthSq() < 1e-12) return;
    if (outwardHint && normal.dot(outwardHint) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      // Preserve horizontal manufacturing planes. XY contours remain sub-voxel
      // continuous; only Z faces close to authored layer boundaries are snapped.
      const zi = Math.round(p.z);
      if (Math.abs(p.z - zi) < step * 0.42) p.z = Math.max(0, zi);
      positions.push(p.x * scale, p.y * scale, p.z * scale);
    }
  };

  for (let iz = 0; iz < nz - 1; iz += 1) {
    for (let iy = 0; iy < ny - 1; iy += 1) {
      for (let ix = 0; ix < nx - 1; ix += 1) {
        const points = cubeCorners.map(([dx, dy, dz]) => new THREE.Vector3(
          bounds.minX + (ix + dx) * step,
          bounds.minY + (iy + dy) * step,
          bounds.minZ + (iz + dz) * step,
        ));
        const values = cubeCorners.map(([dx, dy, dz]) => field[indexOf(ix + dx, iy + dy, iz + dz)]);
        if (values.every((v) => v >= 0) || values.every((v) => v < 0)) continue;
        for (const tetra of tetrahedra) {
          const inside = tetra.filter((corner) => values[corner] < 0);
          const outside = tetra.filter((corner) => values[corner] >= 0);
          if (!inside.length || inside.length === 4) continue;
          if (inside.length === 1) {
            const i0 = inside[0];
            const p0 = interpolate(points[i0], points[outside[0]], values[i0], values[outside[0]]);
            const p1 = interpolate(points[i0], points[outside[1]], values[i0], values[outside[1]]);
            const p2 = interpolate(points[i0], points[outside[2]], values[i0], values[outside[2]]);
            const hint = points[outside[0]].clone().add(points[outside[1]]).add(points[outside[2]]).multiplyScalar(1 / 3).sub(points[i0]);
            addTriangle(p0, p1, p2, hint);
          } else if (inside.length === 3) {
            const o0 = outside[0];
            const p0 = interpolate(points[o0], points[inside[0]], values[o0], values[inside[0]]);
            const p1 = interpolate(points[o0], points[inside[1]], values[o0], values[inside[1]]);
            const p2 = interpolate(points[o0], points[inside[2]], values[o0], values[inside[2]]);
            const hint = points[o0].clone().sub(points[inside[0]].clone().add(points[inside[1]]).add(points[inside[2]]).multiplyScalar(1 / 3));
            addTriangle(p0, p1, p2, hint);
          } else {
            const [ia, ib] = inside;
            const [oa, ob] = outside;
            const pac = interpolate(points[ia], points[oa], values[ia], values[oa]);
            const pad = interpolate(points[ia], points[ob], values[ia], values[ob]);
            const pbc = interpolate(points[ib], points[oa], values[ib], values[oa]);
            const pbd = interpolate(points[ib], points[ob], values[ib], values[ob]);
            const hint = points[oa].clone().add(points[ob]).multiplyScalar(0.5)
              .sub(points[ia].clone().add(points[ib]).multiplyScalar(0.5));
            addTriangle(pac, pad, pbd, hint);
            addTriangle(pac, pbd, pbc, hint);
          }
        }
      }
    }
  }

  if (!positions.length) return null;
  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const geometry = toCreasedNormals(raw, THREE.MathUtils.degToRad(52));
  if (geometry !== raw) raw.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    reconstruction: 'oversampled-2.5d-raster-sdf',
    rasterFactor,
    closeRadiusPx,
    blurPasses,
    verticalBlend,
  };
  return geometry;
}

function addSmoothBlockColors(geometry, standardBlocks, exportScale = 1) {
  const scale = Math.max(1e-6, Number(exportScale) || 1);
  const blockMap = new Map();
  const palette = [];
  const paletteIndex = new Map();

  for (const block of standardBlocks) {
    const color = normalizeStandardBlockColor(block.color);
    blockMap.set(modelBlockKey(block.x, block.y, block.z), { ...block, color });
    if (!paletteIndex.has(color)) {
      paletteIndex.set(color, palette.length);
      palette.push(color);
    }
  }

  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return { palette, triangleColorIndices: [] };

  const nearestBlockColor = (cx, cy, cz) => {
    const gx = cx / scale;
    const gy = cy / scale;
    const gz = cz / scale;
    const baseX = Math.floor(gx);
    const baseY = Math.floor(gy);
    const baseZ = Math.floor(gz);
    let best = null;
    let bestDistance = Infinity;

    for (let radius = 0; radius <= 2 && !best; radius += 1) {
      for (let z = baseZ - radius; z <= baseZ + radius; z += 1) {
        for (let y = baseY - radius; y <= baseY + radius; y += 1) {
          for (let x = baseX - radius; x <= baseX + radius; x += 1) {
            const block = blockMap.get(modelBlockKey(x, y, z));
            if (!block) continue;
            const dx = gx - (x + 0.5);
            const dy = gy - (y + 0.5);
            const dz = gz - (z + 0.5);
            const distance = dx * dx + dy * dy + dz * dz;
            if (distance < bestDistance) {
              bestDistance = distance;
              best = block;
            }
          }
        }
      }
    }

    return best?.color ?? palette[0] ?? DEFAULT_BLOCK_COLOR;
  };

  const vertexColors = new Float32Array(position.count * 3);
  const triangleColorIndices = [];
  const colorValue = new THREE.Color();

  for (let i = 0; i + 2 < position.count; i += 3) {
    const cx = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
    const cy = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    const cz = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
    const color = nearestBlockColor(cx, cy, cz);
    const pIndex = paletteIndex.get(color) ?? 0;
    triangleColorIndices.push(pIndex);
    colorValue.set(color);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = (i + vertex) * 3;
      vertexColors[offset] = colorValue.r;
      vertexColors[offset + 1] = colorValue.g;
      vertexColors[offset + 2] = colorValue.b;
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
  geometry.userData.colorPalette = palette;
  geometry.userData.triangleColorIndices = triangleColorIndices;
  return { palette, triangleColorIndices };
}

function makeSmoothExportGroup(exportScale = 1, { yUp = false, quality = 'export' } = {}) {
  const standardBlocks = model.getBlocks().filter((block) => block.type !== 'support');
  if (standardBlocks.length === 0) {
    throw new Error('NO STANDARD CUBES TO TREAT / SUPPORT CUBES ARE OMITTED');
  }

  const strength = THREE.MathUtils.clamp(Math.round(Number(smoothingStrength) || 3), 1, 5);

  const group = new THREE.Group();
  group.name = 'BuildItLiveOrganicRasterModel';
  let geometry = createOversampledLayerSdfGeometry(standardBlocks, exportScale, strength, { quality });
  if (!geometry) throw new Error('SMOOTH MODEL COULD NOT BUILD A PRINTABLE SURFACE');
  if (geometry.index) {
    const nonIndexed = geometry.toNonIndexed();
    geometry.dispose();
    geometry = nonIndexed;
  }
  addSmoothBlockColors(geometry, standardBlocks, exportScale);

  const material = new THREE.MeshStandardMaterial({
    name: 'OrganicRasterSdfSurface',
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.58,
    metalness: 0.0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'organic_oversampled_surface';
  mesh.userData.exportGeometry = 'oversampled-2.5d-raster-sdf-layer-reconstruction';
  group.add(mesh);
  group.userData = {
    surface: 'organic-print',
    joinBlend: strength,
    edgeTreatment: 'oversampled-layer-raster_distance-field_anisotropic-z-loft',
  };

  if (yUp) {
    group.rotation.x = -Math.PI / 2;
    group.position.x = -(model.gridSize * exportScale) / 2;
    group.position.z = (model.gridSize * exportScale) / 2;
  }

  group.updateMatrixWorld(true);
  group.userData.disposeExportResources = () => {
    geometry.dispose();
    material.dispose();
  };
  return group;
}

function disposeExportObject(object) {
  object.userData.disposeExportResources?.();
}

function disposeExportGroup(group) {
  group.userData.disposeExportResources?.();
}

// -----------------------------------------------------------------------------
// REAL-TIME ORGANIC PRINT RENDERING
// -----------------------------------------------------------------------------
// The voxel model remains the editable source of truth. Organic Print is a live
// derived render generated with the same line detection, straight-member math,
// and local-junction SDF used by the export pipeline. Preview quality changes
// sampling density only; it does not use a different smoothing algorithm.
function disposeRealtimeOrganicSurface() {
  if (realtimeOrganicObject) {
    realtimeOrganicGroup.remove(realtimeOrganicObject);
    disposeExportGroup(realtimeOrganicObject);
    realtimeOrganicObject = null;
  }
  realtimeOrganicGroup.clear();
}

function isRealtimeOrganicVisible() {
  return exportSurfaceMode === 'soft1' && !exactImportedStl && activeLayerView === null;
}

function setRealtimeSmoothingState(label) {
  if (realtimeSmoothingState) realtimeSmoothingState.textContent = label;
}

function applyRealtimeSurfaceVisibility() {
  const organic = isRealtimeOrganicVisible();
  realtimeOrganicGroup.visible = organic;

  blocksGroup.traverse((object) => {
    if (!object.isMesh || object.userData?.kind !== 'block') return;
    if (object.userData.type === 'support') {
      object.material = supportMaterial;
      object.castShadow = false;
      return;
    }
    object.material = organic ? hiddenPickingMaterial : getStandardBlockMaterial(object.userData.color);
    object.castShadow = !organic;
  });

  if (realtimeRenderStatus) {
    realtimeRenderStatus.textContent = exactImportedStl
      ? 'STATIC MESH'
      : exportSurfaceMode === 'soft1' && activeLayerView !== null
        ? 'BLOCKS / LAYER'
        : exportSurfaceMode === 'soft1' ? 'SMOOTH' : 'BLOCKS';
  }
}

function rebuildRealtimeOrganicSurface(revision) {
  if (revision !== realtimeSmoothRevision || !isRealtimeOrganicVisible()) return;

  const standardCount = model.getBlocks().filter((block) => block.type !== 'support').length;
  if (standardCount === 0) {
    disposeRealtimeOrganicSurface();
    setRealtimeSmoothingState('EMPTY');
    applyRealtimeSurfaceVisibility();
    return;
  }

  setRealtimeSmoothingState('BUILDING…');
  try {
    const nextObject = makeSmoothExportGroup(1, { quality: 'preview' });
    nextObject.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    if (revision !== realtimeSmoothRevision) {
      disposeExportGroup(nextObject);
      return;
    }

    // Organic geometry is authored in model coordinates (X, grid-Y, height-Z).
    // The editor is Three.js Y-up, so map it to (X, height, grid-Y) while keeping
    // the same centered grid footprint as the editable cubes.
    nextObject.scale.set(1, -1, 1);
    nextObject.rotation.x = -Math.PI / 2;
    nextObject.position.set(-model.gridSize / 2, 0, -model.gridSize / 2);
    nextObject.updateMatrixWorld(true);

    disposeRealtimeOrganicSurface();
    realtimeOrganicObject = nextObject;
    realtimeOrganicGroup.add(nextObject);
    realtimeOrganicGroup.visible = true;
    setRealtimeSmoothingState('LIVE');
    applyRealtimeSurfaceVisibility();
  } catch (error) {
    console.warn('Live Organic Print render failed:', error);
    disposeRealtimeOrganicSurface();
    setRealtimeSmoothingState('UNAVAILABLE');
    // Keep the voxel representation visible if the derived preview cannot build.
    realtimeOrganicGroup.visible = false;
    blocksGroup.traverse((object) => {
      if (object.isMesh && object.userData?.kind === 'block' && object.userData.type !== 'support') {
        object.material = getStandardBlockMaterial(object.userData.color);
        object.castShadow = true;
      }
    });
  }
}

function scheduleRealtimeOrganicSurface({ immediate = false } = {}) {
  realtimeSmoothRevision += 1;
  const revision = realtimeSmoothRevision;
  window.clearTimeout(realtimeSmoothTimer);
  realtimeSmoothTimer = null;

  applyRealtimeSurfaceVisibility();
  if (!isRealtimeOrganicVisible()) {
    if (exportSurfaceMode !== 'soft1') disposeRealtimeOrganicSurface();
    setRealtimeSmoothingState(exportSurfaceMode === 'soft1' ? 'LAYER VIEW' : 'READY');
    return;
  }

  setRealtimeSmoothingState('UPDATING…');
  realtimeSmoothTimer = window.setTimeout(
    () => rebuildRealtimeOrganicSurface(revision),
    immediate ? 0 : REALTIME_SMOOTH_DELAY_MS,
  );
}

function makeObjMetadataHeader() {
  const lines = [
    `# DIGITAL_TWIN_VOXEL_MODEL ${MODEL_FILE_VERSION}`,
    `# GRID_SIZE ${model.gridSize}`,
    `# MAX_HEIGHT ${CONFIG.MAX_HEIGHT}`,
  ];

  for (const block of model.getBlocks()) {
    lines.push(`# DIGITAL_TWIN_BLOCK ${block.type} ${block.x} ${block.y} ${block.z}`);
  }

  return `${lines.join('\n')}\n`;
}

function encodeCompactStlMetadata() {
  const gridSize = model.gridSize;
  const maxHeight = CONFIG.MAX_HEIGHT;
  const cellCount = gridSize * gridSize * maxHeight;
  const bytes = new Uint8Array(2 + Math.ceil(cellCount * 2 / 8));
  bytes[0] = gridSize;
  bytes[1] = maxHeight;

  for (const block of model.getBlocks()) {
    if (block.x < 0 || block.x >= gridSize || block.y < 0 || block.y >= gridSize || block.z < 0 || block.z >= maxHeight) continue;
    const value = block.type === 'support' ? 2 : 1;
    const index = (block.z * gridSize * gridSize) + (block.y * gridSize) + block.x;
    const bit = index * 2;
    const byteIndex = 2 + Math.floor(bit / 8);
    const shift = bit % 8;
    bytes[byteIndex] |= value << shift;
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `DTWIN1_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

function decodeCompactStateToken(token = '') {
  const cleanToken = String(token).match(/DTWIN1_[A-Za-z0-9_-]+/i)?.[0];
  if (!cleanToken) return null;

  try {
    const encoded = cleanToken.slice('DTWIN1_'.length).replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.length < 3) return null;

    const gridSize = clampGridSize(bytes[0]);
    const maxHeight = Number(bytes[1]) || CONFIG.MAX_HEIGHT;
    const blocks = [];
    const cellCount = gridSize * gridSize * maxHeight;
    const requiredBytes = 2 + Math.ceil(cellCount * 2 / 8);
    if (bytes.length < requiredBytes) return null;

    for (let index = 0; index < cellCount; index += 1) {
      const bit = index * 2;
      const byteIndex = 2 + Math.floor(bit / 8);
      const shift = bit % 8;
      const value = (bytes[byteIndex] >> shift) & 0b11;
      if (value !== 1 && value !== 2) continue;
      const z = Math.floor(index / (gridSize * gridSize));
      const rem = index % (gridSize * gridSize);
      const y = Math.floor(rem / gridSize);
      const x = rem % gridSize;
      blocks.push({ x, y, z, type: value === 2 ? 'support' : 'standard' });
    }

    return { gridSize, blocks };
  } catch (error) {
    console.warn('Could not decode Digital Twin STL metadata', error);
    return null;
  }
}

function decodeCompactStlMetadata(text = '') {
  const match = String(text).match(/DTWIN1_[A-Za-z0-9_-]+/i);
  return match ? decodeCompactStateToken(match[0]) : null;
}

function attachCompactStlMetadata(stlText, token = encodeCompactStlMetadata()) {
  if (typeof stlText !== 'string') return stlText;
  let result = stlText;
  if (/^solid[^\r\n]*/i.test(result)) {
    result = result.replace(/^solid[^\r\n]*/i, `solid ${token}`);
  } else {
    result = `solid ${token}\n${result}`;
  }
  if (/endsolid[^\r\n]*\s*$/i.test(result)) {
    result = result.replace(/endsolid[^\r\n]*\s*$/i, `endsolid ${token}`);
  }
  return result;
}

const STL_TRAILER_PREFIX = 'DTWIN2_BEGIN';
const STL_TRAILER_SUFFIX = 'DTWIN2_END';
const STL_HEADER_ID_PREFIX = 'DTWIN3:';

function makeStlExportId() {
  const timePart = Date.now().toString(36).toUpperCase();
  let randomPart = '';
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(2);
    globalThis.crypto.getRandomValues(values);
    randomPart = [...values].map((value) => value.toString(36).toUpperCase().padStart(7, '0')).join('');
  } else {
    randomPart = Math.random().toString(36).slice(2, 16).toUpperCase();
  }
  return `${timePart}-${randomPart}`.slice(0, 52);
}

function getBinaryStlBytes(binaryStl) {
  if (binaryStl instanceof DataView) {
    return new Uint8Array(binaryStl.buffer, binaryStl.byteOffset, binaryStl.byteLength);
  }
  if (binaryStl instanceof ArrayBuffer) return new Uint8Array(binaryStl);
  if (ArrayBuffer.isView(binaryStl)) {
    return new Uint8Array(binaryStl.buffer, binaryStl.byteOffset, binaryStl.byteLength);
  }
  throw new Error('STL EXPORTER DID NOT RETURN BINARY DATA');
}

function crc16Ccitt(bytes, end = bytes.length) {
  let crc = 0xffff;
  for (let i = 0; i < end; i += 1) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function encodeBinaryVoxelState(blocks = model.getBlocks(), gridSize = model.gridSize) {
  const clean = [];
  const seen = new Set();
  for (const raw of blocks) {
    const x = Math.round(Number(raw?.x));
    const y = Math.round(Number(raw?.y));
    const z = Math.round(Number(raw?.z));
    const type = raw?.type === 'support' ? 'support' : 'standard';
    if (![x, y, z].every(Number.isFinite)) continue;
    if (x < 0 || x > 15 || y < 0 || y > 15 || z < 0 || z > 15) continue;
    const key = `${x},${y},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ x, y, z, type });
  }

  clean.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const bytes = new Uint8Array(7 + clean.length * 2);
  bytes[0] = 0x42; // B
  bytes[1] = 0x34; // 4 — Build It Live binary voxel state v4
  bytes[2] = clampGridSize(gridSize);
  const view = new DataView(bytes.buffer);
  view.setUint16(3, clean.length, true);
  let offset = 5;
  for (const block of clean) {
    const packed =
      (block.x & 0x0f) |
      ((block.y & 0x0f) << 4) |
      ((block.z & 0x0f) << 8) |
      ((block.type === 'support' ? 1 : 0) << 12);
    view.setUint16(offset, packed, true);
    offset += 2;
  }
  view.setUint16(offset, crc16Ccitt(bytes, offset), true);
  return bytes;
}

function decodeBinaryVoxelState(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 7) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x34) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gridSize = clampGridSize(bytes[2]);
  const count = view.getUint16(3, true);
  const expected = 7 + count * 2;
  if (bytes.length !== expected) return null;
  const storedCrc = view.getUint16(expected - 2, true);
  if (storedCrc !== crc16Ccitt(bytes, expected - 2)) return null;

  const blocks = [];
  let offset = 5;
  for (let i = 0; i < count; i += 1) {
    const packed = view.getUint16(offset, true);
    offset += 2;
    blocks.push({
      x: packed & 0x0f,
      y: (packed >> 4) & 0x0f,
      z: (packed >> 8) & 0x0f,
      type: ((packed >> 12) & 0x01) ? 'support' : 'standard',
    });
  }
  return { gridSize, blocks };
}

function embedVoxelStateInBinaryStl(output, payload) {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const triangleCount = view.getUint32(80, true);
  const nibbleCount = payload.length * 2;
  const capacity = triangleCount * 3;
  if (nibbleCount > capacity) {
    throw new Error(`STL GEOMETRY IS TOO SIMPLE TO CARRY EDITABLE STATE (${payload.length} B > ${Math.floor(capacity / 2)} B CAPACITY)`);
  }

  // Store four payload bits in the least-significant four bits of each normal
  // float. Vertex coordinates and triangle topology are untouched, so slicers
  // receive exactly the same printable geometry. The normal perturbation is
  // only a few ULPs and is visually/geometrically negligible.
  for (let nibbleIndex = 0; nibbleIndex < nibbleCount; nibbleIndex += 1) {
    const byte = payload[Math.floor(nibbleIndex / 2)];
    const nibble = (nibbleIndex % 2 === 0) ? (byte & 0x0f) : ((byte >> 4) & 0x0f);
    const triangle = Math.floor(nibbleIndex / 3);
    const component = nibbleIndex % 3;
    const normalOffset = 84 + triangle * 50 + component * 4;
    const bits = view.getUint32(normalOffset, true);
    view.setUint32(normalOffset, (bits & 0xfffffff0) | nibble, true);
  }
}

function extractVoxelStateFromBinaryStl(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 84) return null;
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder().decode(bytes.subarray(0, 80)).replace(/\0/g, '').trim();
  const match = header.match(/BIL4:([A-Z0-9-]+):([0-9A-Z]+)/i);
  if (!match) return null;
  const payloadLength = Number.parseInt(match[2], 36);
  if (!Number.isFinite(payloadLength) || payloadLength < 7) return null;

  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  if (payloadLength * 2 > triangleCount * 3) return null;

  const payload = new Uint8Array(payloadLength);
  for (let nibbleIndex = 0; nibbleIndex < payloadLength * 2; nibbleIndex += 1) {
    const triangle = Math.floor(nibbleIndex / 3);
    const component = nibbleIndex % 3;
    const normalOffset = 84 + triangle * 50 + component * 4;
    const nibble = view.getUint32(normalOffset, true) & 0x0f;
    const byteIndex = Math.floor(nibbleIndex / 2);
    if (nibbleIndex % 2 === 0) payload[byteIndex] = nibble;
    else payload[byteIndex] |= nibble << 4;
  }
  return decodeBinaryVoxelState(payload);
}

function stampStandardBinaryStl(binaryStl, exportId = makeStlExportId(), voxelState = encodeBinaryVoxelState()) {
  const source = getBinaryStlBytes(binaryStl);
  if (source.byteLength < 84) throw new Error('STL EXPORT CONTAINS NO GEOMETRY DATA');

  const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const triangleCount = sourceView.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;
  if (triangleCount < 1 || source.byteLength < expectedLength) {
    throw new Error('STL EXPORT CONTAINS NO VALID TRIANGLE GEOMETRY');
  }

  // Strict standard binary STL: no trailing bytes, no non-standard attributes.
  // The editable voxel state is hidden only in insignificant normal-vector LSBs;
  // all vertex geometry remains byte-for-byte identical to the slicer export.
  const output = new Uint8Array(expectedLength);
  output.set(source.subarray(0, expectedLength));
  const payload = voxelState instanceof Uint8Array ? voxelState : encodeBinaryVoxelState();
  embedVoxelStateInBinaryStl(output, payload);

  output.fill(0, 0, 80);
  const headerText = new TextEncoder().encode(`BIL4:${exportId}:${payload.length.toString(36).toUpperCase()}`);
  output.set(headerText.subarray(0, 80), 0);
  return { buffer: output.buffer, exportId, triangleCount, embeddedStateBytes: payload.length };
}

function makeStaticBinaryStl(binaryStl) {
  const source = getBinaryStlBytes(binaryStl);
  if (source.byteLength < 84) throw new Error('STL EXPORT CONTAINS NO GEOMETRY DATA');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const triangleCount = view.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;
  if (triangleCount < 1 || source.byteLength < expectedLength) {
    throw new Error('STL EXPORT CONTAINS NO VALID TRIANGLE GEOMETRY');
  }

  // Native project state deliberately does NOT travel inside exports anymore.
  // Keep a strict, conventional STL payload for slicers and downstream tools.
  const output = new Uint8Array(expectedLength);
  output.set(source.subarray(0, expectedLength));
  output.fill(0, 0, 80);
  const header = new TextEncoder().encode('BUILD IT LIVE / STATIC STL EXPORT');
  output.set(header.subarray(0, 80), 0);
  return { buffer: output.buffer, triangleCount };
}

function extractStlExportId(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength));
  const header = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
  const modern = header.match(/BIL4:([A-Z0-9-]+):/i);
  if (modern) return modern[1];
  const legacy = header.match(/DTWIN3:([A-Z0-9-]+)/i);
  return legacy?.[1] ?? null;
}

function decodeCompactStlMetadataFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);

  // Backwards compatibility only: older experimental builds appended state
  // after the binary STL payload. New exports never do this because some
  // slicers (including Bambu Studio) reject trailing bytes.
  const tailStart = Math.max(0, bytes.byteLength - 65536);
  const tailText = new TextDecoder().decode(bytes.subarray(tailStart));
  const trailerIndex = tailText.lastIndexOf(STL_TRAILER_PREFIX);
  if (trailerIndex >= 0) {
    const trailerText = tailText.slice(trailerIndex);
    const decoded = decodeCompactStlMetadata(trailerText);
    if (decoded?.blocks?.length) return decoded;
  }

  // Backwards compatibility for the previous ASCII solid-name metadata.
  const headText = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 16384)));
  return decodeCompactStlMetadata(headText) ?? decodeCompactStlMetadata(tailText);
}

function makeExactStlExportGroup({ yUp = false, metres = false } = {}) {
  if (!exactImportedStl?.rawGeometry) throw new Error('NO EXACT STL MESH LOADED');
  const geometry = exactImportedStl.rawGeometry.clone();
  if (metres) geometry.scale(0.001, 0.001, 0.001);
  const material = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.52, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.name = 'ExactImportedStlExport';
  group.add(mesh);
  if (yUp) group.rotation.x = -Math.PI / 2;
  group.updateMatrixWorld(true);
  group.userData.disposeExportResources = () => {
    geometry.dispose();
    material.dispose();
  };
  return group;
}

function crc32Bytes(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function makeStoredZip(files) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  const u16 = (view, offset, value) => view.setUint16(offset, value, true);
  const u32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = content instanceof Uint8Array ? content : encoder.encode(String(content));
    const crc = crc32Bytes(data);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20);
    u16(localView, 6, 0);
    u16(localView, 8, 0); // stored / no compression
    u16(localView, 10, 0);
    u16(localView, 12, 0);
    u32(localView, 14, crc);
    u32(localView, 18, data.length);
    u32(localView, 22, data.length);
    u16(localView, 26, nameBytes.length);
    u16(localView, 28, 0);
    localChunks.push(localHeader, nameBytes, data);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    u32(centralView, 0, 0x02014b50);
    u16(centralView, 4, 20);
    u16(centralView, 6, 20);
    u16(centralView, 8, 0);
    u16(centralView, 10, 0);
    u16(centralView, 12, 0);
    u16(centralView, 14, 0);
    u32(centralView, 16, crc);
    u32(centralView, 20, data.length);
    u32(centralView, 24, data.length);
    u16(centralView, 28, nameBytes.length);
    u16(centralView, 30, 0);
    u16(centralView, 32, 0);
    u16(centralView, 34, 0);
    u16(centralView, 36, 0);
    u32(centralView, 38, 0);
    u32(centralView, 42, localOffset);
    centralChunks.push(centralHeader, nameBytes);

    localOffset += localHeader.length + nameBytes.length + data.length;
  }

  const localData = concatUint8Arrays(localChunks);
  const centralData = concatUint8Arrays(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50);
  u16(endView, 4, 0);
  u16(endView, 6, 0);
  u16(endView, 8, Object.keys(files).length);
  u16(endView, 10, Object.keys(files).length);
  u32(endView, 12, centralData.length);
  u32(endView, 16, localData.length);
  u16(endView, 20, 0);

  return concatUint8Arrays([localData, centralData, end]);
}

function getThreeMfVoxelMesh(exportScale = CONFIG.PHYSICAL_BLOCK_MM) {
  const blocks = model.getBlocks().filter((block) => block.type === 'standard');
  if (!blocks.length) throw new Error('NO STANDARD CUBES TO EXPORT / SUPPORT CUBES ARE OMITTED');

  const palette = [];
  const paletteIndex = new Map();
  const vertices = [];
  const triangles = [];
  const cubeTriangles = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ];

  for (const block of blocks) {
    const color = normalizeStandardBlockColor(block.color);
    if (!paletteIndex.has(color)) {
      paletteIndex.set(color, palette.length);
      palette.push(color);
    }
    const materialIndex = paletteIndex.get(color);
    const base = vertices.length;
    const x0 = block.x * exportScale;
    const x1 = (block.x + 1) * exportScale;
    const y0 = block.y * exportScale;
    const y1 = (block.y + 1) * exportScale;
    const z0 = block.z * exportScale;
    const z1 = (block.z + 1) * exportScale;
    vertices.push(
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    );
    for (const [a, b, c] of cubeTriangles) triangles.push([base + a, base + b, base + c, materialIndex]);
  }

  return { vertices, triangles, palette };
}

function getThreeMfSmoothMesh(exportScale = CONFIG.PHYSICAL_BLOCK_MM) {
  const group = makeSmoothExportGroup(exportScale);
  try {
    const mesh = group.children.find((child) => child.isMesh);
    if (!mesh?.geometry) throw new Error('SMOOTH 3MF GEOMETRY IS UNAVAILABLE');
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) throw new Error('SMOOTH 3MF HAS NO VERTEX DATA');

    const vertices = [];
    for (let i = 0; i < position.count; i += 1) {
      vertices.push([position.getX(i), position.getY(i), position.getZ(i)]);
    }

    const palette = [...(geometry.userData.colorPalette ?? [])];
    if (!palette.length) palette.push(DEFAULT_BLOCK_COLOR);
    const triangleColors = geometry.userData.triangleColorIndices ?? [];
    const triangles = [];
    for (let i = 0, triangle = 0; i + 2 < position.count; i += 3, triangle += 1) {
      triangles.push([i, i + 1, i + 2, triangleColors[triangle] ?? 0]);
    }
    return { vertices, triangles, palette };
  } finally {
    disposeExportGroup(group);
  }
}

function makeThreeMfXml({ vertices, triangles, palette }) {
  const materials = palette.map((color, index) => (
    `<base name="Build It Live ${normalizeStandardBlockColor(color).toUpperCase()}" displaycolor="${normalizeStandardBlockColor(color).toUpperCase()}FF"/>`
  )).join('');
  const vertexXml = vertices.map(([x, y, z]) => `<vertex x="${Number(x).toFixed(5)}" y="${Number(y).toFixed(5)}" z="${Number(z).toFixed(5)}"/>`).join('');
  const triangleXml = triangles.map(([v1, v2, v3, material]) => (
    `<triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="1" p1="${material}" p2="${material}" p3="${material}"/>`
  )).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n  <metadata name="Application">Build It Live</metadata>\n  <metadata name="Title">${exportSurfaceMode === 'soft1' ? 'Build It Live Smooth Multicolor' : 'Build It Live Blocks Multicolor'}</metadata>\n  <resources>\n    <basematerials id="1">${materials}</basematerials>\n    <object id="2" type="model" pid="1" pindex="0">\n      <mesh>\n        <vertices>${vertexXml}</vertices>\n        <triangles>${triangleXml}</triangles>\n      </mesh>\n    </object>\n  </resources>\n  <build><item objectid="2"/></build>\n</model>`;
}

function makeBambuThreeMfBlob() {
  if (exactImportedStl) throw new Error('MULTICOLOR 3MF NEEDS EDITABLE STANDARD CUBE COLOR DATA / EXACT STL HAS NO CUBE COLORS');
  const meshData = exportSurfaceMode === 'soft1'
    ? getThreeMfSmoothMesh(CONFIG.PHYSICAL_BLOCK_MM)
    : getThreeMfVoxelMesh(CONFIG.PHYSICAL_BLOCK_MM);
  const modelXml = makeThreeMfXml(meshData);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>`;
  const archive = makeStoredZip({
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': relationships,
    '3D/3dmodel.model': modelXml,
  });
  return new Blob([archive], { type: 'model/3mf' });
}

async function exportModel(format) {
  const normalizedFormat = String(format).toLowerCase();

  if (normalizedFormat !== 'json' && model.getBlockCount() === 0 && !exactImportedStl) {
    throw new Error('ADD AT LEAST ONE BLOCK BEFORE EXPORTING 3D GEOMETRY');
  }

  if (normalizedFormat === 'json') {
    saveJsonModel();
    return 'EDITABLE JSON MODEL SAVED';
  }

  if (normalizedFormat === '3mf') {
    const blob = makeBambuThreeMfBlob();
    downloadBlob(blob, '3mf');
    const colorCount = new Set(model.getBlocks()
      .filter((block) => block.type === 'standard')
      .map((block) => normalizeStandardBlockColor(block.color))).size;
    return exportSurfaceMode === 'soft1'
      ? `3MF EXPORTED / BAMBU MULTICOLOR / ${String(colorCount).padStart(2, '0')} COLOR(S) / SMOOTH · ${String(smoothingStrength).padStart(2, '0')}`
      : `3MF EXPORTED / BAMBU MULTICOLOR / ${String(colorCount).padStart(2, '0')} COLOR(S) / BLOCKS`;
  }

  if (exactImportedStl && normalizedFormat === 'stl') {
    downloadBlob(new Blob([exactImportedStl.originalBuffer.slice(0)], { type: 'model/stl' }), 'stl');
    return 'STL SAVED / EXACT IMPORTED MESH PRESERVED';
  }

  if (exactImportedStl && normalizedFormat === 'obj') {
    const group = makeExactStlExportGroup();
    try {
      const obj = new OBJExporter().parse(group);
      downloadBlob(new Blob([obj], { type: 'text/plain' }), 'obj');
      return 'OBJ SAVED / EXACT STL SURFACE CONVERTED';
    } finally { disposeExportGroup(group); }
  }

  if (exactImportedStl && normalizedFormat === 'glb') {
    const group = makeExactStlExportGroup({ yUp: true, metres: true });
    try {
      const glb = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(group, resolve, reject, { binary: true, onlyVisible: true });
      });
      downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), 'glb');
      return 'GLB SAVED / EXACT STL SURFACE CONVERTED';
    } finally { disposeExportGroup(group); }
  }

  if (normalizedFormat === 'stl') {
    const standardBlockCount = model.getBlocks().filter((block) => block.type !== 'support').length;
    if (standardBlockCount === 0) {
      throw new Error('NO STANDARD CUBES TO EXPORT / SUPPORT CUBES ARE OMITTED FROM STL');
    }

    const slicerGroup = exportSurfaceMode === 'voxel'
      ? makeSlicerExportGroup(CONFIG.PHYSICAL_BLOCK_MM, { includeSupportFrames: false })
      : makeSmoothExportGroup(CONFIG.PHYSICAL_BLOCK_MM);
    try {
      const binaryStl = new STLExporter().parse(slicerGroup, { binary: true });
      const staticStl = makeStaticBinaryStl(binaryStl);
      const stlBlob = new Blob([staticStl.buffer], { type: 'model/stl' });
      downloadBlob(stlBlob, 'stl');
      return exportSurfaceMode === 'voxel'
        ? `STL EXPORTED / ${staticStl.triangleCount} TRIANGLES / STATIC PRINT GEOMETRY`
        : `STL EXPORTED / ${staticStl.triangleCount} TRIANGLES / SMOOTH · ${String(smoothingStrength).padStart(2, '0')} / STATIC PRINT GEOMETRY`;
    } finally {
      disposeExportGroup(slicerGroup);
    }
  }

  if (normalizedFormat === 'obj') {
    const slicerGroup = exportSurfaceMode === 'voxel'
      ? makeSlicerExportGroup(CONFIG.PHYSICAL_BLOCK_MM)
      : makeSmoothExportGroup(CONFIG.PHYSICAL_BLOCK_MM);
    try {
      const obj = new OBJExporter().parse(slicerGroup);
      downloadBlob(new Blob([obj], { type: 'text/plain' }), 'obj');
      return exportSurfaceMode === 'voxel'
        ? 'OBJ SAVED / Z-UP / SUPPORT = FRAME'
        : `OBJ SAVED / SMOOTH · ${String(smoothingStrength).padStart(2, '0')} / STRAIGHT MEMBERS + SMOOTH JOINS`;
    } finally {
      disposeExportGroup(slicerGroup);
    }
  }

  if (normalizedFormat === 'glb') {
    // glTF uses metres, so a physical 15 mm block is 0.015 scene units.
    const group = exportSurfaceMode === 'voxel'
      ? makeGeometryExportGroup(CONFIG.PHYSICAL_BLOCK_MM / 1000)
      : makeSmoothExportGroup(CONFIG.PHYSICAL_BLOCK_MM / 1000, { yUp: true });
    try {
      const glb = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(
          group,
          resolve,
          reject,
          {
            binary: true,
            onlyVisible: true,
          },
        );
      });

      downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), 'glb');
      return exportSurfaceMode === 'voxel'
        ? 'GLB SAVED / MATERIALS + PHYSICAL SCALE'
        : `GLB SAVED / SMOOTH · ${String(smoothingStrength).padStart(2, '0')} / STRAIGHT MEMBERS + SMOOTH JOINS`;
    } finally {
      disposeExportGroup(group);
    }
  }

  throw new Error(`UNSUPPORTED EXPORT FORMAT: ${format}`);
}

// -----------------------------------------------------------------------------
// ORGANIC PRINT / REPRESENTATIVE LIVE JOIN PREVIEW
// -----------------------------------------------------------------------------
// This preview deliberately uses a small representative body-to-member junction
// instead of rebuilding the full current model on every slider tick. The result
// is immediate and makes the 01-05 local blend change legible without blocking
// the editor with a full implicit-surface export pass.
let smoothingPreviewRenderer = null;
let smoothingPreviewScene = null;
let smoothingPreviewCamera = null;
let smoothingPreviewMesh = null;
let smoothingPreviewControls = null;
let smoothingPreviewObserver = null;

function getOrganicStrengthLabel(strength) {
  return ['TIGHT', 'CLEAN', 'BALANCED', 'SOFT', 'ORGANIC'][THREE.MathUtils.clamp(strength, 1, 5) - 1];
}

function createOrganicJoinPreviewGeometry(strength) {
  const normalized = (THREE.MathUtils.clamp(strength, 1, 5) - 1) / 4;
  const bodyLeft = -1.55;
  const bodyRight = 0.42;
  const bodyHalfHeight = 1.08;
  const beamHalfWidth = 0.34;
  const beamEnd = 2.55;
  const blendLength = THREE.MathUtils.lerp(0.14, 0.78, normalized);
  const joinEnd = bodyRight + blendLength;
  const shoulderControl = bodyRight + blendLength * THREE.MathUtils.lerp(0.08, 0.4, normalized);

  const shape = new THREE.Shape();
  shape.moveTo(bodyLeft, -bodyHalfHeight);
  shape.lineTo(bodyRight, -bodyHalfHeight);
  shape.quadraticCurveTo(shoulderControl, -bodyHalfHeight, joinEnd, -beamHalfWidth);
  shape.lineTo(beamEnd, -beamHalfWidth);
  shape.lineTo(beamEnd, beamHalfWidth);
  shape.lineTo(joinEnd, beamHalfWidth);
  shape.quadraticCurveTo(shoulderControl, bodyHalfHeight, bodyRight, bodyHalfHeight);
  shape.lineTo(bodyLeft, bodyHalfHeight);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.82,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

function resizeSmoothingPreview() {
  if (!smoothingPreviewRenderer || !smoothingPreviewMount || !smoothingPreviewCamera) return;
  const width = Math.max(1, Math.round(smoothingPreviewMount.clientWidth));
  const height = Math.max(1, Math.round(smoothingPreviewMount.clientHeight));
  if (width <= 1 || height <= 1) return;
  smoothingPreviewRenderer.setSize(width, height, false);
  smoothingPreviewCamera.aspect = width / height;
  smoothingPreviewCamera.updateProjectionMatrix();
  smoothingPreviewRenderer.render(smoothingPreviewScene, smoothingPreviewCamera);
}

function ensureSmoothingPreview() {
  if (smoothingPreviewRenderer || !smoothingPreviewMount) return;

  smoothingPreviewScene = new THREE.Scene();
  smoothingPreviewCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  smoothingPreviewCamera.position.set(4.5, -5.1, 3.5);
  smoothingPreviewCamera.lookAt(0.35, 0, 0);

  smoothingPreviewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  smoothingPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  smoothingPreviewRenderer.setClearColor(0x000000, 0);
  smoothingPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  smoothingPreviewMount.appendChild(smoothingPreviewRenderer.domElement);

  // Keep the preview genuinely inspectable: drag rotates, wheel/pinch zooms.
  // Pan stays disabled so the sample cannot be accidentally lost off-canvas.
  smoothingPreviewControls = new OrbitControls(smoothingPreviewCamera, smoothingPreviewRenderer.domElement);
  smoothingPreviewControls.enablePan = false;
  smoothingPreviewControls.enableDamping = false;
  smoothingPreviewControls.rotateSpeed = 0.7;
  smoothingPreviewControls.zoomSpeed = 0.85;
  smoothingPreviewControls.minDistance = 3.35;
  smoothingPreviewControls.maxDistance = 8.5;
  smoothingPreviewControls.minPolarAngle = 0.08;
  smoothingPreviewControls.maxPolarAngle = Math.PI - 0.08;
  smoothingPreviewControls.target.set(0.25, 0, 0);
  smoothingPreviewControls.update();
  smoothingPreviewControls.addEventListener('change', () => {
    if (smoothingPreviewRenderer && smoothingPreviewScene && smoothingPreviewCamera) {
      smoothingPreviewRenderer.render(smoothingPreviewScene, smoothingPreviewCamera);
    }
  });

  smoothingPreviewScene.add(new THREE.HemisphereLight(0xffffff, 0x8f8b82, 2.25));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(4, -3, 6);
  smoothingPreviewScene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.35);
  fill.position.set(-4, 4, 2);
  smoothingPreviewScene.add(fill);

  smoothingPreviewMount.addEventListener('keydown', (event) => {
    if (!smoothingPreviewCamera || !smoothingPreviewControls) return;
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(key)) return;
    event.preventDefault();

    const offset = smoothingPreviewCamera.position.clone().sub(smoothingPreviewControls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const rotateStep = THREE.MathUtils.degToRad(8);
    if (key === 'ArrowLeft') spherical.theta -= rotateStep;
    if (key === 'ArrowRight') spherical.theta += rotateStep;
    if (key === 'ArrowUp') spherical.phi = Math.max(0.08, spherical.phi - rotateStep);
    if (key === 'ArrowDown') spherical.phi = Math.min(Math.PI - 0.08, spherical.phi + rotateStep);
    if (key === '+' || key === '=') spherical.radius = Math.max(3.35, spherical.radius * 0.9);
    if (key === '-' || key === '_') spherical.radius = Math.min(8.5, spherical.radius * 1.1);

    smoothingPreviewCamera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(smoothingPreviewControls.target));
    smoothingPreviewCamera.lookAt(smoothingPreviewControls.target);
    smoothingPreviewControls.update();
  });

  if (typeof ResizeObserver !== 'undefined') {
    smoothingPreviewObserver = new ResizeObserver(() => resizeSmoothingPreview());
    smoothingPreviewObserver.observe(smoothingPreviewMount);
  }
}

function renderSmoothingPreview() {
  if (!smoothingPreviewMount || exportSurfaceMode !== 'soft1' || saveModal.hidden) return;
  ensureSmoothingPreview();
  if (!smoothingPreviewRenderer || !smoothingPreviewScene) return;

  if (smoothingPreviewMesh) {
    smoothingPreviewScene.remove(smoothingPreviewMesh);
    smoothingPreviewMesh.geometry.dispose();
    smoothingPreviewMesh.material.dispose();
  }

  const geometry = createOrganicJoinPreviewGeometry(smoothingStrength);
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.accent,
    roughness: 0.58,
    metalness: 0,
  });
  smoothingPreviewMesh = new THREE.Mesh(geometry, material);
  smoothingPreviewMesh.rotation.x = -0.08;
  smoothingPreviewMesh.rotation.z = -0.08;
  smoothingPreviewScene.add(smoothingPreviewMesh);

  if (smoothingPreviewLabel) {
    smoothingPreviewLabel.textContent = `${String(smoothingStrength).padStart(2, '0')} / ${getOrganicStrengthLabel(smoothingStrength)}`;
  }
  resizeSmoothingPreview();
}

function updateSmoothingStrengthUi(nextValue = smoothingStrength) {
  smoothingStrength = THREE.MathUtils.clamp(Math.round(Number(nextValue) || 3), 1, 5);

  for (const slider of [smoothingStrengthSlider, realtimeSmoothingSlider]) {
    if (!slider) continue;
    slider.value = String(smoothingStrength);
    slider.classList.toggle('is-active', exportSurfaceMode === 'soft1');
    setRangeProgress(slider);
  }

  if (smoothingStrengthValue) smoothingStrengthValue.textContent = String(smoothingStrength).padStart(2, '0');
  if (realtimeSmoothingValue) realtimeSmoothingValue.textContent = String(smoothingStrength).padStart(2, '0');
  renderSmoothingPreview();
  scheduleRealtimeOrganicSurface();
}

function updateOrganicEditingLocks() {
  const organicLocked = exportSurfaceMode === 'soft1';
  const layerLocked = activeLayerView !== null;
  const editingLocked = organicLocked || layerLocked;

  if (editingLocked) setBlockColorPopoverOpen(false);
  if (layerLocked && gridSettingsIsOpen) setGridSettingsOpen(false);
  if (editingLocked && continuousBuildEnabled) setContinuousBuildEnabled(false);

  for (const button of toolButtons) {
    button.disabled = editingLocked;
    button.setAttribute('aria-disabled', String(editingLocked));
    button.title = layerLocked
      ? 'Return Layer View to ALL to edit blocks'
      : organicLocked
        ? 'Smooth view is inspection-only. Switch to Blocks to edit.'
        : '';
  }

  continuousToggle.disabled = editingLocked;

  // Smooth view cannot use Layer View at all. In Layer View itself, these
  // controls stay active so the child can inspect another layer or return ALL.
  layerSlider.disabled = organicLocked;
  showAllLayersButton.disabled = organicLocked;

  // Layer View is a read-only inspection state. Prevent controls that alter
  // the current build, but keep Save / Export / camera navigation available.
  clearBuildButton.disabled = layerLocked;
  loadBuildButton.disabled = layerLocked;
  openRecentModelsButton.disabled = layerLocked;
  if (openGridSettingsButton) {
    openGridSettingsButton.disabled = layerLocked;
    openGridSettingsButton.setAttribute('aria-disabled', String(layerLocked));
    openGridSettingsButton.title = layerLocked ? 'Return Layer View to ALL to change build area size' : 'Grid settings';
  }

  document.querySelector('.tool-stack')?.classList.toggle('is-organic-locked', editingLocked);
  document.querySelector('.continuous-controls')?.classList.toggle('is-organic-locked', editingLocked);
  document.querySelector('.layer-controls')?.classList.toggle('is-organic-locked', organicLocked);
  document.querySelector('.stats-panel')?.classList.toggle('is-layer-locked', layerLocked);
  clearBuildButton.closest('.panel-actions')?.classList.toggle('is-layer-locked', layerLocked);
  loadBuildButton.closest('.project-file-actions')?.classList.toggle('is-layer-locked', layerLocked);
  document.querySelector('.autosave-controls')?.classList.toggle('is-layer-locked', layerLocked);

  if (freeMoveButton) {
    freeMoveButton.disabled = false;
    freeMoveButton.title = editingLocked
      ? layerLocked
        ? 'Layer View is inspection-only. Drag to orbit the model.'
        : 'Smooth view is inspection-only. Drag to orbit the model.'
      : 'Camera-only mode. Drag to orbit without placing or erasing blocks.';
  }
}

function setExportSurfaceMode(mode, { rebuild = true } = {}) {
  const next = ['voxel', 'soft1'].includes(mode) ? mode : 'voxel';
  const previous = exportSurfaceMode;

  if (next === 'soft1' && previous !== 'soft1') {
    freeMoveBeforeOrganic = selectedTool === 'free';
    if (continuousBuildEnabled) setContinuousBuildEnabled(false);
    if (activeLayerView !== null) setLayerView(0);
  }

  exportSurfaceMode = next;

  for (const button of exportSurfaceButtons) {
    const active = button.dataset.exportSurface === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of realtimeSurfaceButtons) {
    const active = button.dataset.liveSurface === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  if (next === 'soft1') {
    selectTool('free', { announce: false });
  } else if (previous === 'soft1') {
    if (freeMoveBeforeOrganic) selectTool('free', { announce: false });
    else selectTool(lastBuildTool, { announce: false });
  }

  if (smoothingStrengthControl) smoothingStrengthControl.hidden = next !== 'soft1';
  if (realtimeSmoothingControls) realtimeSmoothingControls.hidden = next !== 'soft1';
  saveModal.classList.remove('has-organic-preview');

  if (exportModelViewValue) {
    exportModelViewValue.textContent = exactImportedStl
      ? 'STATIC MESH'
      : next === 'soft1' ? 'SMOOTH' : 'BLOCKS';
  }

  updateOrganicEditingLocks();
  updateSmoothingStrengthUi(smoothingStrength);
  applyRealtimeSurfaceVisibility();
  if (rebuild) scheduleRealtimeOrganicSurface({ immediate: next === 'soft1' });
}

function openSaveModal(sourceElement = exportBuildButton) {
  saveModal.hidden = false;
  prepareModalSourceMorph(saveModal, sourceElement);
  document.body.classList.add('modal-open');
  controls.enabled = false;

  if (exportModelViewValue) {
    exportModelViewValue.textContent = exactImportedStl
      ? 'STATIC MESH'
      : exportSurfaceMode === 'soft1' ? 'SMOOTH' : 'BLOCKS';
  }

  // Prevent accidental geometry exports from an empty build while still
  // allowing an empty JSON state to be saved if needed.
  for (const button of exportFormatButtons) {
    const format = button.dataset.exportFormat;
    const is3D = format !== 'json';
    button.disabled = exactImportedStl
      ? ['json', '3mf'].includes(format)
      : (is3D && model.getBlockCount() === 0);
  }

  requestAnimationFrame(() => {
    saveModal.classList.add('is-open');
    exportFormatButtons.find((button) => !button.disabled)?.focus();
  });
}

function closeSaveModal() {
  prepareModalSourceMorph(saveModal, exportBuildButton);
  saveModal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  controls.enabled = true;
  window.setTimeout(() => {
    saveModal.hidden = true;
  }, 560);
}

function openLoadModal(sourceElement = loadBuildButton) {
  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before loading another project.', true);
    return;
  }
  loadModal.hidden = false;
  prepareModalSourceMorph(loadModal, sourceElement);
  document.body.classList.add('modal-open');
  controls.enabled = false;

  // Keep the hidden input ready to accept every format until the user
  // deliberately chooses one of the format cards below.
  loadBuildInput.accept = '.bil,.json,.stl,.glb,.obj';

  requestAnimationFrame(() => {
    loadModal.classList.add('is-open');
    loadFormatButtons[0]?.focus();
  });
}

function closeLoadModal() {
  prepareModalSourceMorph(loadModal, loadBuildButton);
  loadModal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  controls.enabled = true;
  window.setTimeout(() => {
    loadModal.hidden = true;
  }, 560);
}

function chooseLoadFormat(format = '') {
  const normalized = String(format).toLowerCase();
  const supported = ['bil', 'json', 'stl', 'glb', 'obj'];
  loadBuildInput.accept = supported.includes(normalized)
    ? `.${normalized}`
    : '.bil,.json,.stl,.glb,.obj';
  loadBuildInput.value = '';
  loadBuildInput.click();
}

function isSupportedLoadFile(file) {
  const extension = file?.name?.split('.').pop()?.toLowerCase();
  return ['bil', 'json', 'stl', 'glb', 'obj'].includes(extension);
}

function extractLegacyBlockArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const candidates = [
    data.blocks,
    data.voxels,
    data.cells,
    data.model?.blocks,
    data.model?.voxels,
    data.state?.blocks,
    data.state?.voxels,
    data.snapshot?.blocks,
    data.data?.blocks,
  ];

  return candidates.find(Array.isArray) ?? null;
}

function getLegacyGridSize(data, blocks = []) {
  if (!data || typeof data !== 'object') {
    return clampGridSize(getRequiredGridSize(blocks));
  }

  const candidates = [
    data?.workspace?.gridSize,
    data?.simulator?.gridSize,
    data?.gridSize,
    data?.settings?.gridSize,
    data?.state?.gridSize,
    data?.model?.gridSize,
    typeof data?.grid === 'number' ? data.grid : null,
    data?.grid?.size,
  ];
  const explicit = candidates.map(Number).find(Number.isFinite);
  // Files old enough to omit grid size came from the original fixed 16×16
  // simulator, so preserve that historical base instead of shrinking to the
  // smallest footprint that happens to contain the blocks.
  return clampGridSize(explicit ?? CONFIG.GRID_SIZE);
}

function normalizeLoadedModel(data) {
  // Backward compatibility: every historical Build It Live JSON variant that
  // contains a block array is accepted, even if it predates the format/version
  // wrapper or used `voxels`, `cells`, `model.blocks`, etc.
  const blocks = extractLegacyBlockArray(data);
  if (!blocks) {
    if (!data || typeof data !== 'object') throw new Error('INVALID MODEL FILE');
    throw new Error('MODEL FILE HAS NO BLOCK ARRAY');
  }

  // Future explicit versions are rejected only when they use our canonical
  // format. Missing/older wrappers are treated as legacy files and migrated.
  if (
    data && !Array.isArray(data) &&
    data.format === MODEL_FILE_FORMAT &&
    Number.isFinite(Number(data.version)) &&
    Number(data.version) > MODEL_FILE_VERSION
  ) {
    throw new Error(`UNSUPPORTED FILE VERSION ${data.version}`);
  }

  return blocks;
}

function parseBlockName(name = '') {
  const text = String(name).trim();
  const match = text.match(/(?:^|\b)(standard(?:cube)?|support(?:cube)?)[_\- ]+(\d+)[_\- ]+(\d+)[_\- ]+(\d+)/i);
  if (!match) return null;

  return {
    type: match[1].toLowerCase().startsWith('support') ? 'support' : 'standard',
    x: Number(match[2]),
    y: Number(match[3]),
    z: Number(match[4]),
  };
}

function normalizeLegacyBlockType(value) {
  if (typeof value === 'number') {
    if (value === 2) return 'support';
    if (value === 1 || value === 0) return 'standard';
  }

  const text = String(value ?? '').trim().toLowerCase().replace(/[ _-]+/g, '');
  if (['support', 'supportcube', 'frame', 'supportframe', 'scaffold'].includes(text)) return 'support';
  if (['standard', 'standardcube', 'cube', 'block', 'solid', 'normal', 'voxel'].includes(text)) return 'standard';
  return null;
}

function normalizeImportedBlock(block) {
  if (!block || typeof block !== 'object') return null;

  const type = normalizeLegacyBlockType(
    block.type ?? block.blockType ?? block.kind ?? block.material ?? block.block ?? block.value,
  );
  const position = block.position ?? block.pos ?? block.coords ?? block.coordinate ?? block.gridPosition ?? {};
  const x = Number(block.x ?? block.gridX ?? block.ix ?? position.x ?? position[0]);
  const y = Number(block.y ?? block.gridY ?? block.iy ?? position.y ?? position[1]);
  const z = Number(block.z ?? block.gridZ ?? block.iz ?? position.z ?? position[2]);

  if (!type) return null;
  if (![x, y, z].every(Number.isFinite)) return null;

  const color = type === 'standard' ? normalizeStandardBlockColor(block.color, null) : null;
  return {
    type,
    x: Math.round(x),
    y: Math.round(y),
    z: Math.round(z),
    ...(color ? { color } : {}),
  };
}

function dedupeImportedBlocks(blocks = []) {
  const byCell = new Map();

  for (const rawBlock of blocks) {
    const block = normalizeImportedBlock(rawBlock);
    if (!block) continue;

    const key = `${block.x},${block.y},${block.z}`;
    const previous = byCell.get(key);

    // If duplicate semantic metadata targets the same cell, a solid Standard
    // Cube wins over Support metadata.
    if (!previous || block.type === 'standard') {
      byCell.set(key, block);
    }
  }

  return [...byCell.values()].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

async function loadBilProject(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || data.format !== PROJECT_FILE_FORMAT) {
    throw new Error('NOT A BUILD IT LIVE .BIL PROJECT');
  }
  if (Number.isFinite(Number(data.version)) && Number(data.version) > PROJECT_FILE_VERSION) {
    throw new Error(`UNSUPPORTED PROJECT VERSION ${data.version}`);
  }

  const blocks = dedupeImportedBlocks(extractLegacyBlockArray(data) ?? []);
  const cameraPosition = Array.isArray(data?.camera?.position) && data.camera.position.length >= 3
    ? data.camera.position.slice(0, 3).map(Number)
    : null;
  const cameraTarget = Array.isArray(data?.camera?.target) && data.camera.target.length >= 3
    ? data.camera.target.slice(0, 3).map(Number)
    : null;

  return {
    blocks,
    gridSize: getLegacyGridSize(data, blocks),
    exactState: true,
    note: 'NATIVE .BIL PROJECT RESTORED / EDITABLE STATE PRESERVED',
    projectState: {
      surfaceMode: ['voxel', 'soft1'].includes(data?.render?.surfaceMode) ? data.render.surfaceMode : 'voxel',
      smoothingStrength: THREE.MathUtils.clamp(Math.round(Number(data?.render?.smoothingStrength) || 3), 1, 5),
      layerView: THREE.MathUtils.clamp(Math.round(Number(data?.render?.layerView) || 0), 0, CONFIG.MAX_HEIGHT),
      cameraPosition: cameraPosition?.every(Number.isFinite) ? cameraPosition : null,
      cameraTarget: cameraTarget?.every(Number.isFinite) ? cameraTarget : null,
      selectedBlockColor: normalizeStandardBlockColor(data?.workspace?.selectedBlockColor),
    },
  };
}

async function loadJsonBlocks(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const blocks = dedupeImportedBlocks(normalizeLoadedModel(data));
  if (blocks.length === 0 && extractLegacyBlockArray(data)?.length) {
    throw new Error('LEGACY MODEL BLOCK DATA COULD NOT BE MIGRATED');
  }
  const isCanonical = !Array.isArray(data) && data?.format === MODEL_FILE_FORMAT;
  return {
    blocks,
    gridSize: getLegacyGridSize(data, blocks),
    note: isCanonical ? 'EDITABLE JSON STATE RESTORED' : 'LEGACY JSON MODEL MIGRATED + RESTORED',
    exactState: true,
  };
}

async function loadGlbBlocks(file) {
  const buffer = await file.arrayBuffer();
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });

  const blocks = [];
  let embeddedGridSize = null;
  let hasEmbeddedState = false;
  gltf.scene.updateMatrixWorld(true);

  gltf.scene.traverse((object) => {
    if (Array.isArray(object.userData?.digitalTwinBlocks)) {
      blocks.push(...object.userData.digitalTwinBlocks);
      hasEmbeddedState = true;
      embeddedGridSize = embeddedGridSize ?? (Number(object.userData.digitalTwinGridSize) || null);
    }

    const userBlock = normalizeImportedBlock(object.userData);
    if (userBlock) {
      blocks.push(userBlock);
      return;
    }

    const namedBlock = parseBlockName(object.name);
    if (namedBlock) blocks.push(namedBlock);
  });

  const result = dedupeImportedBlocks(blocks);
  if (result.length === 0) {
    throw new Error('NO DIGITAL TWIN BLOCK DATA FOUND IN GLB');
  }

  return {
    blocks: result,
    gridSize: clampGridSize(embeddedGridSize ?? getRequiredGridSize(result)),
    note: 'GLB BLOCK TYPES + GRID COORDINATES RESTORED',
    // Named/userData block coordinates in historical GLB exports are already
    // authored Digital Twin state, so restore them losslessly as well.
    exactState: true,
  };
}

function parseObjGridSize(text) {
  const match = String(text).match(/^#\s*GRID_SIZE\s+(\d+)\s*$/im);
  return match ? clampGridSize(Number(match[1])) : null;
}

function parseObjMetadata(text) {
  const blocks = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /^#\s*DIGITAL_TWIN_BLOCK\s+(standard|support)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/i,
    );

    if (!match) continue;
    blocks.push({
      type: match[1].toLowerCase(),
      x: Number(match[2]),
      y: Number(match[3]),
      z: Number(match[4]),
    });
  }

  return dedupeImportedBlocks(blocks);
}


function collectNamedBlocksFromObject(root) {
  const blocks = [];
  root?.traverse?.((object) => {
    const named = parseBlockName(object?.name);
    if (named) blocks.push(named);
    const userBlock = normalizeImportedBlock(object?.userData);
    if (userBlock) blocks.push(userBlock);
  });
  return dedupeImportedBlocks(blocks);
}
function inferBlocksFromObjGeometry(root, scale = CONFIG.PHYSICAL_BLOCK_MM) {
  const blocks = [];
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  root.updateMatrixWorld(true);

  root.traverse((object) => {
    const namedBlock = parseBlockName(object.name);
    if (namedBlock) {
      blocks.push(namedBlock);
      return;
    }

    if (!object.isMesh || !object.geometry) return;

    box.setFromObject(object);
    if (box.isEmpty()) return;

    box.getCenter(center);
    box.getSize(size);

    const x = Math.floor(center.x / scale);
    const y = Math.floor(center.y / scale);
    const z = Math.floor(center.z / scale);

    // Full-size 15×15×15 geometry is a Standard Cube. Narrow beams / braces
    // are the legacy Support Cube frame export.
    const isFullCube =
      size.x >= scale * 0.82 &&
      size.y >= scale * 0.82 &&
      size.z >= scale * 0.82;

    blocks.push({ x, y, z, type: isFullCube ? 'standard' : 'support' });
  });

  return dedupeImportedBlocks(blocks);
}

async function loadObjBlocks(file) {
  const text = await file.text();

  // New OBJ exports contain non-destructive comment metadata, ignored by 3D
  // software but used here to recover the exact editable Digital Twin state.
  const metadataBlocks = parseObjMetadata(text);
  if (metadataBlocks.length > 0) {
    return {
      blocks: metadataBlocks,
      gridSize: parseObjGridSize(text) ?? getRequiredGridSize(metadataBlocks),
      note: 'OBJ DIGITAL TWIN METADATA RESTORED',
      exactState: true,
    };
  }

  // Historical OBJ exports predate comment metadata but Three.js OBJExporter
  // preserved each authored block name (standard_x_y_z / support_x_y_z).
  // Those names are lossless and safe to restore; no geometry guessing needed.
  const root = new OBJLoader().parse(text);
  const namedBlocks = collectNamedBlocksFromObject(root);
  if (namedBlocks.length > 0) {
    return {
      blocks: namedBlocks,
      gridSize: CONFIG.GRID_SIZE,
      note: 'LEGACY OBJ BLOCK NAMES RESTORED EXACTLY',
      exactState: true,
    };
  }

  // Do not infer editable cubes from arbitrary OBJ geometry. Organic/straight
  // export geometry can cross authored empty cells just like STL, so geometric
  // reconstruction can create phantom blocks. Exact metadata is required.
  throw new Error('THIS LEGACY OBJ HAS GEOMETRY ONLY / EXACT BLOCK DATA IS NOT PRESENT. No cubes were guessed or added.');
}

function inferStandardBlocksFromStlGeometry(geometry, scale = CONFIG.PHYSICAL_BLOCK_MM) {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return [];

  const occupied = new Set();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const epsilon = scale * 1e-4;

  const component = (vector, axis) => {
    if (axis === 0) return vector.x;
    if (axis === 1) return vector.y;
    return vector.z;
  };

  for (let index = 0; index + 2 < position.count; index += 3) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);
    c.fromBufferAttribute(position, index + 2);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    if (normal.lengthSq() < 1e-12) continue;
    normal.normalize();

    const absoluteNormal = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
    const axis = absoluteNormal.indexOf(Math.max(...absoluteNormal));

    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const coords = [centroid.x, centroid.y, centroid.z];
    const cell = coords.map((value) => Math.floor((value + epsilon) / scale));

    const planeCoordinate =
      (component(a, axis) + component(b, axis) + component(c, axis)) / 3;
    const planeIndex = Math.round(planeCoordinate / scale);
    const normalDirection = component(normal, axis);
    cell[axis] = normalDirection > 0 ? planeIndex - 1 : planeIndex;

    const [x, y, z] = cell;
    if (
      x >= 0 && x < CONFIG.GRID_SIZE &&
      y >= 0 && y < CONFIG.GRID_SIZE &&
      z >= 0 && z < CONFIG.MAX_HEIGHT
    ) {
      occupied.add(`${x},${y},${z}`);
    }
  }

  return [...occupied].map((key) => {
    const [x, y, z] = key.split(',').map(Number);
    return { x, y, z, type: 'standard' };
  });
}


function isClearlyLegacyVoxelStl(geometry, scale = CONFIG.PHYSICAL_BLOCK_MM) {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3 || position.count % 3 !== 0) return false;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const planeTolerance = Math.max(0.015, scale * 0.0025);
  const axisTolerance = 0.9995;

  const nearGridPlane = (value) => {
    const snapped = Math.round(value / scale) * scale;
    return Math.abs(value - snapped) <= planeTolerance;
  };

  let nonDegenerateTriangles = 0;
  for (let index = 0; index + 2 < position.count; index += 3) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);
    c.fromBufferAttribute(position, index + 2);

    // Historical voxel STL exports were boxes placed exactly on 15 mm planes.
    // Requiring every vertex to stay on those planes prevents Organic Print
    // diagonals/chamfers from being mistaken for authored voxel cells.
    if (![a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].every(nearGridPlane)) {
      return false;
    }

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    if (normal.lengthSq() < 1e-12) continue;
    nonDegenerateTriangles += 1;
    normal.normalize();

    const dominant = Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
    if (dominant < axisTolerance) return false;
  }

  return nonDegenerateTriangles > 0;
}

function restoreMissingSupportsForLegacyStl(standardBlocks) {
  const byCell = new Map();
  for (const block of standardBlocks) {
    byCell.set(`${block.x},${block.y},${block.z}`, { ...block, type: 'standard' });
  }

  let reconstructedSupports = 0;
  for (const block of standardBlocks) {
    for (let z = 0; z < block.z; z += 1) {
      const key = `${block.x},${block.y},${z}`;
      if (byCell.has(key)) continue;
      byCell.set(key, { x: block.x, y: block.y, z, type: 'support' });
      reconstructedSupports += 1;
    }
  }

  return {
    blocks: dedupeImportedBlocks([...byCell.values()]),
    reconstructedSupports,
  };
}


async function loadStlBlocks(file) {
  // Read once so the same bytes can be used for Digital Twin metadata recovery
  // and, when necessary, editable geometric reconstruction.
  const buffer = await file.arrayBuffer();
  const stlHeader = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength))).replace(/\0/g, '').trim();
  if (stlHeader.startsWith('BUILD IT LIVE / STATIC STL EXPORT')) {
    throw new Error('THIS STL IS A STATIC EXPORT, NOT AN EDITABLE PROJECT / LOAD THE MATCHING .BIL PROJECT FILE');
  }

  // Legacy Build It Live STL generations may still carry recoverable editable
  // state. Those readers remain only for backwards compatibility; new exports
  // are deliberately static and the native editable workflow is .BIL.
  const embeddedBinary = extractVoxelStateFromBinaryStl(buffer);
  const embeddedLegacy = decodeCompactStlMetadataFromBuffer(buffer);
  const exportId = extractStlExportId(buffer);
  const registered = embeddedBinary ?? embeddedLegacy ?? recoverRegisteredStlState(file, exportId);
  if (registered?.blocks?.length) {
    return {
      blocks: dedupeImportedBlocks(registered.blocks),
      gridSize: registered.gridSize,
      exactState: true,
      note: embeddedBinary
        ? 'BUILD IT LIVE STL STATE RESTORED EXACTLY / NO GEOMETRY-TO-VOXEL GUESSING'
        : embeddedLegacy
          ? 'LEGACY STL DIGITAL TWIN STATE RESTORED EXACTLY / STANDARD + SUPPORT PRESERVED'
          : exportId
            ? 'STL EXPORT ID MATCHED / STANDARD + SUPPORT RESTORED EXACTLY'
            : 'STL LOCAL EXPORT STATE RESTORED EXACTLY / STANDARD + SUPPORT PRESERVED',
    };
  }

  const geometry = new STLLoader().parse(buffer);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) {
    geometry.dispose();
    throw new Error('NO TRIANGLE GEOMETRY FOUND IN STL');
  }

  // Rescue STL files made by older versions using the closest local Recent /
  // Autosave snapshot before attempting geometric reconstruction.
  const legacyRecovered = recoverLegacyStlStateFromRecents(file, geometry);
  if (legacyRecovered?.blocks?.length) {
    geometry.dispose();
    return {
      blocks: dedupeImportedBlocks(legacyRecovered.blocks),
      gridSize: legacyRecovered.gridSize,
      exactState: true,
      note: 'LEGACY STL MATCHED TO LOCAL EDITABLE STATE / STANDARD + SUPPORT PRESERVED',
    };
  }

  // Safe backwards compatibility for the original Build It Live STL exporter:
  // those files contain only axis-aligned Standard cubes on exact 15 mm planes.
  // This path is deliberately gated by strict geometry checks, so Organic Print
  // beams/chamfers never enter the voxel reconstruction that caused phantom cubes.
  if (isClearlyLegacyVoxelStl(geometry)) {
    const standardBlocks = inferStandardBlocksFromStlGeometry(geometry);
    if (standardBlocks.length > 0) {
      const restored = restoreMissingSupportsForLegacyStl(standardBlocks);
      geometry.dispose();
      return {
        blocks: restored.blocks,
        gridSize: CONFIG.GRID_SIZE,
        exactState: true,
        note: restored.reconstructedSupports > 0
          ? `LEGACY VOXEL STL RESTORED / ${restored.reconstructedSupports} SUPPORT BLOCK(S) RECOVERED`
          : 'LEGACY VOXEL STL RESTORED EXACTLY',
      };
    }
  }

  geometry.dispose();

  // Never invent editable cubes from an STL surface automatically. Organic Print
  // deliberately replaces staircase voxels with straight geometry, so geometric
  // voxelisation cannot know which original cells existed and will add false
  // cubes. Exact editable restoration is only allowed from embedded/local state.
  // The current editor remains untouched because decoding fails before replaceExact().
  if (exportId) {
    throw new Error('EDITABLE STATE NOT FOUND FOR THIS BUILD IT LIVE STL / NO CUBES WERE ADDED. Re-export it with this version, or load its JSON/GLB project state.');
  }
  throw new Error('THIS STL HAS GEOMETRY ONLY / AUTOMATIC VOXEL GUESSING IS DISABLED TO PREVENT EXTRA CUBES. Load a Build It Live project file for exact editing.');
}

async function decodeModelFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'bil') return loadBilProject(file);
  if (extension === 'json') return loadJsonBlocks(file);
  if (extension === 'glb') return loadGlbBlocks(file);
  if (extension === 'obj') return loadObjBlocks(file);
  if (extension === 'stl') return loadStlBlocks(file);

  throw new Error('SUPPORTED PROJECT / LEGACY FORMATS: BIL / JSON / STL / GLB / OBJ');
}

async function loadModelFromFile(file) {
  if (!file) return;

  try {
    systemStatus.textContent = `LOADING ${file.name.split('.').pop()?.toUpperCase() ?? 'MODEL'}`;

    const imported = await decodeModelFile(file);
    // An imported file is a separate model, not an edit of the currently active
    // autosave entry. Its first autosave receives a fresh Recent Models ID.
    setActiveRecentModel(null);

    if (imported.exactStl) {
      clearExactStlMode();
      setActiveGridSize(imported.gridSize ?? CONFIG.GRID_SIZE, { preserveBlocks: false, silent: true, autosave: false });
      model.clear();
      resetHistoryToCurrent();
      activateExactStlMode(imported.exactStl);
      syncViewFromModel();
      ghost.visible = false;
      hoveredCandidate = null;
      systemStatus.textContent = 'EXACT STL LOADED';
      setFeedback('EXACT STL RESTORED', `${file.name} is displayed from its original triangle mesh. Saving as STL again preserves the exact loaded surface.`);
      return;
    }

    clearExactStlMode();
    setActiveGridSize(imported.gridSize ?? getRequiredGridSize(imported.blocks), { preserveBlocks: false, silent: true, autosave: false });
    const rejected = imported.exactState
      ? model.replaceExact(imported.blocks)
      : model.replaceFromFrame(imported.blocks);
    resetHistoryToCurrent();
    scheduleAutosave();

    syncViewFromModel();
    ghost.visible = false;
    hoveredCandidate = null;

    if (imported.projectState) {
      if (imported.projectState.selectedBlockColor) {
        selectedBlockColor = normalizeStandardBlockColor(imported.projectState.selectedBlockColor);
        updateBlockColorUi();
      }
      smoothingStrength = imported.projectState.smoothingStrength;
      setExportSurfaceMode(imported.projectState.surfaceMode, { rebuild: false });
      updateSmoothingStrengthUi(smoothingStrength);
      setLayerView(imported.projectState.layerView || 0);
      if (imported.projectState.cameraPosition) camera.position.fromArray(imported.projectState.cameraPosition);
      if (imported.projectState.cameraTarget) controls.target.fromArray(imported.projectState.cameraTarget);
      controls.update();
      scheduleRealtimeOrganicSurface({ immediate: true });
    }

    if (rejected.length > 0) {
      systemStatus.textContent = `MODEL LOADED / ${rejected.length} REJECTED`;
      setFeedback(
        'MODEL PARTLY LOADED',
        `${model.getBlockCount()} blocks restored. ${rejected.length} invalid block(s) were rejected. ${imported.note}`,
        true,
      );
    } else {
      systemStatus.textContent = 'MODEL LOADED';
      setFeedback(
        'MODEL RESTORED',
        `${model.getBlockCount()} blocks loaded from ${file.name}. ${imported.note}`,
      );
    }
  } catch (error) {
    console.error(error);
    systemStatus.textContent = 'LOAD FAILED';
    setFeedback(
      'COULD NOT LOAD MODEL',
      error instanceof Error ? error.message : 'INVALID MODEL FILE',
      true,
    );
  } finally {
    // Reset so the same file can be selected twice in a row.
    loadBuildInput.value = '';
  }
}

saveBuildButton.addEventListener('click', () => {
  try {
    const filename = saveNativeProject();
    systemStatus.textContent = 'PROJECT SAVED';
    setFeedback('PROJECT SAVED', `${filename} keeps the editable grid, block types, live render mode, Smoothness, and camera state.`);
  } catch (error) {
    console.error(error);
    systemStatus.textContent = 'PROJECT SAVE FAILED';
    setFeedback('COULD NOT SAVE PROJECT', error instanceof Error ? error.message : 'PROJECT SAVE FAILED', true);
  }
});

exportBuildButton?.addEventListener('click', () => openSaveModal(exportBuildButton));

closeSaveModalButton.addEventListener('click', closeSaveModal);
saveModalBackdrop.addEventListener('click', closeSaveModal);

if (smoothingStrengthSlider) {
  smoothingStrengthSlider.addEventListener('input', () => updateSmoothingStrengthUi(smoothingStrengthSlider.value));
}
if (realtimeSmoothingSlider) {
  realtimeSmoothingSlider.addEventListener('input', () => updateSmoothingStrengthUi(realtimeSmoothingSlider.value));
}

exportSurfaceButtons.forEach((button) => {
  button.addEventListener('click', () => setExportSurfaceMode(button.dataset.exportSurface));
});
realtimeSurfaceButtons.forEach((button) => {
  button.addEventListener('click', () => setExportSurfaceMode(button.dataset.liveSurface));
});
setExportSurfaceMode(exportSurfaceMode, { rebuild: false });

exportFormatButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const format = button.dataset.exportFormat;
    const previousText = button.querySelector('.format-action')?.textContent;

    try {
      button.disabled = true;
      button.classList.add('is-exporting');
      const action = button.querySelector('.format-action');
      if (action) action.textContent = 'EXPORTING…';

      systemStatus.textContent = `EXPORTING ${format.toUpperCase()}`;
      const message = await exportModel(format);
      systemStatus.textContent = message;
      setFeedback('MODEL EXPORTED', message);
      closeSaveModal();
    } catch (error) {
      console.error(error);
      systemStatus.textContent = 'EXPORT FAILED';
      setFeedback(
        'EXPORT FAILED',
        error instanceof Error ? error.message : 'COULD NOT EXPORT MODEL',
        true,
      );
    } finally {
      button.classList.remove('is-exporting');
      const action = button.querySelector('.format-action');
      if (action && previousText) action.textContent = previousText;
      button.disabled = false;
    }
  });
});

loadBuildButton.addEventListener('click', () => openLoadModal(loadBuildButton));

closeLoadModalButton.addEventListener('click', closeLoadModal);
loadModalBackdrop.addEventListener('click', closeLoadModal);

loadFormatButtons.forEach((button) => {
  button.addEventListener('click', () => {
    chooseLoadFormat(button.dataset.loadFormat);
  });
});

loadBuildInput.addEventListener('change', () => {
  const file = loadBuildInput.files?.[0];
  if (!file) return;
  closeLoadModal();
  loadModelFromFile(file);
});

// Drag-and-drop import: useful during repeated UX testing when models are
// frequently saved and reopened from the desktop.
['dragenter', 'dragover'].forEach((eventName) => {
  loadDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    loadDropZone.classList.add('is-dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  loadDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    loadDropZone.classList.remove('is-dragging');
  });
});

loadDropZone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  if (!isSupportedLoadFile(file)) {
    systemStatus.textContent = 'LOAD FAILED';
    setFeedback('COULD NOT LOAD PROJECT', 'SUPPORTED PROJECT / LEGACY FORMATS: BIL / JSON / STL / GLB / OBJ', true);
    return;
  }

  closeLoadModal();
  loadModelFromFile(file);
});

loadDropZone.addEventListener('click', () => chooseLoadFormat());
loadDropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    chooseLoadFormat();
  }
});

// -----------------------------------------------------------------------------
// 11. ESP32 WEB SERIAL CONNECTION
// -----------------------------------------------------------------------------
// Protocol: newline-delimited JSON (NDJSON). Each line may be either:
//   [{"x":0,"y":0,"z":0,"type":"standard"}, ...]     // full frame
//   {"blocks":[...]}                                      // full frame
//   {"action":"place","x":0,"y":0,"z":0,"type":"support"}
//   {"action":"remove","x":0,"y":0,"z":0}
//   {"action":"clear"}
// Hardware state intentionally does not create Undo entries. On disconnect,
// the current physical state becomes the new digital-history baseline.
function setSerialStatus(label, state = 'offline') {
  serialStatus.classList.toggle('is-connected', state === 'connected');
  serialStatus.classList.toggle('is-error', state === 'error');
  serialStatus.innerHTML = `<i></i> ${label}`;
}

function updateSerialControls() {
  const supported = 'serial' in navigator && window.isSecureContext;
  connectSerialButton.disabled = !supported || serialConnected;
  disconnectSerialButton.disabled = !serialConnected;
  serialBaud.disabled = serialConnected;

  if (!supported) {
    setSerialStatus('UNSUPPORTED', 'error');
    connectSerialButton.title = 'Web Serial requires Chrome/Edge on localhost or HTTPS.';
  } else if (serialConnected) {
    setSerialStatus('CONNECTED', 'connected');
  } else {
    setSerialStatus('OFFLINE', 'offline');
  }

  updateHistoryControls();
}

function normalizeHardwareType(value) {
  return value === 'support' || value === 2 || value === '2' ? 'support' : 'standard';
}

function normalizeHardwareBlock(block) {
  if (!block || typeof block !== 'object') return null;

  const x = Number(block.x);
  const y = Number(block.y);
  const z = Number(block.z);

  if (![x, y, z].every(Number.isInteger)) return null;

  return {
    x,
    y,
    z,
    type: normalizeHardwareType(block.type),
  };
}

function applyHardwareFrame(blocks, label = 'ESP32 FRAME') {
  if (exactImportedStl) clearExactStlMode();
  if (!Array.isArray(blocks)) {
    throw new Error('HARDWARE FRAME MUST CONTAIN A BLOCK ARRAY');
  }

  const normalized = [];
  const malformed = [];

  blocks.forEach((block) => {
    const parsed = normalizeHardwareBlock(block);
    if (parsed) normalized.push(parsed);
    else malformed.push({ ...block, reason: 'INVALID BLOCK COORDINATES' });
  });

  const rejectedByPhysics = model.replaceFromFrame(normalized);
  const rejected = [...malformed, ...rejectedByPhysics];

  syncViewFromModel();
  ghost.visible = false;
  hoveredCandidate = null;
  scheduleAutosave();

  systemStatus.textContent = rejected.length
    ? `${label} / ${rejected.length} REJECTED`
    : `${label} RECEIVED`;

  setFeedback(
    'ESP32 FRAME',
    rejected.length
      ? `${model.getBlockCount()} block(s) accepted; ${rejected.length} invalid reading(s) rejected.`
      : `${model.getBlockCount()} block(s) synchronized from the physical interface.`,
    rejected.length > 0,
  );

  return rejected;
}

function applyHardwareEvent(payload) {
  if (Array.isArray(payload)) {
    return applyHardwareFrame(payload);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('SERIAL MESSAGE MUST BE JSON');
  }

  if (Array.isArray(payload.blocks)) {
    return applyHardwareFrame(payload.blocks);
  }

  if (Array.isArray(payload.frame)) {
    return applyHardwareFrame(payload.frame);
  }

  const action = String(payload.action ?? '').toLowerCase();

  if (action === 'clear') {
    if (exactImportedStl) clearExactStlMode();
    model.clear();
    syncViewFromModel();
    scheduleAutosave({ addRecent: false });
    ghost.visible = false;
    systemStatus.textContent = 'ESP32 BUILD CLEARED';
    setFeedback('HARDWARE UPDATE', 'Physical model reported an empty grid.');
    return [];
  }

  if (action === 'place' || (!action && 'x' in payload && 'y' in payload && 'z' in payload)) {
    if (exactImportedStl) clearExactStlMode();
    const block = normalizeHardwareBlock(payload);
    if (!block) throw new Error('INVALID ESP32 PLACE EVENT');

    const result = model.placeBlock(block.x, block.y, block.z, block.type);
    syncViewFromModel();
    if (result.valid) scheduleAutosave();
    systemStatus.textContent = result.valid ? 'ESP32 BLOCK PLACED' : result.reason;
    setFeedback(
      result.valid ? 'HARDWARE UPDATE' : 'HARDWARE READING REJECTED',
      result.valid ? `Placed [${block.x}, ${block.y}, ${block.z}] from ESP32.` : result.reason,
      !result.valid,
    );
    return result.valid ? [] : [{ ...block, reason: result.reason }];
  }

  if (action === 'remove' || action === 'erase') {
    if (exactImportedStl) clearExactStlMode();
    const block = normalizeHardwareBlock({ ...payload, type: 'standard' });
    if (!block) throw new Error('INVALID ESP32 REMOVE EVENT');

    const result = model.removeBlockAndApplyGravity(block.x, block.y, block.z);
    syncViewFromModel();
    if (result.removed) scheduleAutosave();
    systemStatus.textContent = result.reason;
    setFeedback('HARDWARE UPDATE', result.reason, !result.removed);
    return result.removed ? [] : [{ ...block, reason: result.reason }];
  }

  throw new Error('UNKNOWN ESP32 MESSAGE FORMAT');
}

function processSerialLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

  try {
    const payload = JSON.parse(trimmed);
    applyHardwareEvent(payload);
  } catch (error) {
    console.warn('Serial message rejected:', trimmed, error);
    systemStatus.textContent = 'SERIAL MESSAGE REJECTED';
    setFeedback(
      'SERIAL DATA ERROR',
      error instanceof Error ? error.message : 'INVALID SERIAL DATA',
      true,
    );
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoder();

  try {
    if (!serialPort?.readable) throw new Error('SERIAL PORT IS NOT READABLE');
    serialReader = serialPort.readable.getReader();

    while (serialKeepReading) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (!value) continue;

      serialBuffer += decoder.decode(value, { stream: true });

      let newlineIndex = serialBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = serialBuffer.slice(0, newlineIndex);
        serialBuffer = serialBuffer.slice(newlineIndex + 1);
        processSerialLine(line);
        newlineIndex = serialBuffer.indexOf('\n');
      }
    }
  } catch (error) {
    if (serialKeepReading) {
      console.error('Serial read error:', error);
      serialKeepReading = false;
      serialConnected = false;
      setSerialStatus('CONNECTION LOST', 'error');
      setFeedback(
        'ESP32 DISCONNECTED',
        error instanceof Error ? error.message : 'SERIAL CONNECTION LOST',
        true,
      );
    }
  } finally {
    if (serialReader) {
      try { serialReader.releaseLock(); } catch { /* already released */ }
      serialReader = null;
    }

    // If the cable/board vanished unexpectedly, close any remaining port handle
    // and rebase Undo/Redo on the last physical state we successfully received.
    if (!serialConnected && serialPort) {
      try { await serialPort.close(); } catch { /* port may already be gone */ }
      serialPort = null;
      resetHistoryToCurrent();
    }

    updateSerialControls();
  }
}

async function connectSerial() {
  if (!('serial' in navigator) || !window.isSecureContext) {
    setFeedback(
      'WEB SERIAL UNAVAILABLE',
      'Use Chrome or Edge and open the Vite localhost URL (or HTTPS).',
      true,
    );
    return;
  }

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: Number(serialBaud.value) || 115200 });

    serialConnected = true;
    serialKeepReading = true;
    serialBuffer = '';
    updateSerialControls();

    systemStatus.textContent = 'ESP32 CONNECTED';
    setFeedback(
      'HARDWARE MODE',
      `ESP32 connected at ${serialBaud.value} baud. Incoming NDJSON now drives the VoxelModel.`,
    );

    serialReadTask = readSerialLoop();
  } catch (error) {
    console.error(error);
    serialPort = null;
    serialConnected = false;
    serialKeepReading = false;
    setSerialStatus('CONNECT FAILED', 'error');
    setFeedback(
      'ESP32 CONNECTION FAILED',
      error instanceof Error ? error.message : 'COULD NOT OPEN SERIAL PORT',
      true,
    );
    updateSerialControls();
  }
}

async function disconnectSerial({ silent = false } = {}) {
  serialKeepReading = false;

  if (serialReader) {
    try { await serialReader.cancel(); } catch { /* port may already be gone */ }
  }

  if (serialReadTask) {
    try { await serialReadTask; } catch { /* handled by read loop */ }
    serialReadTask = null;
  }

  if (serialPort) {
    try { await serialPort.close(); } catch { /* already disconnected */ }
  }

  serialPort = null;
  serialReader = null;
  serialConnected = false;
  serialBuffer = '';
  resetHistoryToCurrent();
  updateSerialControls();

  if (!silent) {
    systemStatus.textContent = 'ESP32 DISCONNECTED';
    setFeedback('DIGITAL MODE', 'ESP32 disconnected. Mouse editing and Undo / Redo are active again.');
  }
}

connectSerialButton.addEventListener('click', connectSerial);
disconnectSerialButton.addEventListener('click', () => disconnectSerial());

autosaveToggle.addEventListener('click', () => setAutosaveEnabled(!autosaveEnabled));

openRecentModelsButton.addEventListener('click', () => openRecentModal(openRecentModelsButton));
closeRecentModalButton.addEventListener('click', closeRecentModal);
recentModalBackdrop.addEventListener('click', closeRecentModal);
clearRecentModelsButton.addEventListener('click', () => {
  safeStorageRemove(RECENT_MODELS_STORAGE_KEY);
  setActiveRecentModel(null);
  renderRecentModels();
  setAutosaveUi('saved', 'Recent models cleared');
});

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    try {
      const filename = saveNativeProject();
      systemStatus.textContent = 'PROJECT SAVED';
      setFeedback('PROJECT SAVED', `${filename} is an editable Build It Live project.`);
    } catch (error) {
      setFeedback('COULD NOT SAVE PROJECT', error instanceof Error ? error.message : 'PROJECT SAVE FAILED', true);
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redoBuild();
    else undoBuild();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redoBuild();
  }

  if (event.key === 'Escape' && !saveModal.hidden) {
    closeSaveModal();
  }

  if (event.key === 'Escape' && !loadModal.hidden) {
    closeLoadModal();
  }

  if (event.key === 'Escape' && !recentModal.hidden) {
    closeRecentModal();
  }
});

// -----------------------------------------------------------------------------
// 11. FUTURE ESP32 / SERIAL ADAPTER HOOK
// -----------------------------------------------------------------------------
// This public adapter makes the separation visible while prototyping.
// Later your serial parser can call:
//   window.digitalTwin.applyHardwareFrame([...blocksFromESP32])
// without touching any Three.js placement code.
window.digitalTwin = {
  getState: () => model.toJSON(),
  getProjectDocument: () => makeProjectDocument(),
  getLegacySaveDocument: () => makeModelDocument(),
  saveProject: () => saveNativeProject(),
  exportModel: (format = 'stl') => exportModel(format),
  openExportPanel: () => openSaveModal(),
  openLoadProjectPanel: () => openLoadModal(),
  applyHardwareFrame: (blocks) => applyHardwareFrame(blocks, 'HARDWARE FRAME'),
  connectSerial: () => connectSerial(),
  disconnectSerial: () => disconnectSerial(),
  setLayerView: (layer = 0) => setLayerView(layer),
  setGridSize: (size) => setActiveGridSize(size),
  setExportSurface: (mode) => setExportSurfaceMode(mode),
  undo: () => undoBuild(),
  redo: () => redoBuild(),
  autosaveNow: () => persistCurrentModel({ force: true }),
  setAutosaveEnabled: (enabled) => setAutosaveEnabled(enabled),
  openRecentModels: () => openRecentModal(),
  config: { ...CONFIG },
};

// -----------------------------------------------------------------------------
// 12. RESIZE + RENDER LOOP
// -----------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

initializeAutosavePreference();
initializeActiveRecentModel();
restoreLatestAutosave();
resetHistoryToCurrent();
renderRecentModels();
updateSerialControls();
updateHistoryControls();
syncViewFromModel();
