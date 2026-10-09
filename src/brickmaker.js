import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const GRID = 16;
const BASE_BRICK_URL = new URL('./assets/buildingBlock.stl', import.meta.url).href;
const BASE_BRICK_FILENAME = 'buildingBlock(2).stl';
const COLORS = {
  paper: 0xf7f6f1,
  ink: 0x0f0f0f,
  accent: 0xe93222,
};

// The bundled STL is the single source of truth for Brick Maker geometry.
// STL files do not encode units, so this project treats its coordinates as mm.
let baseBrickReady = false;
let baseBrickGeometry = null; // Exact normalized source STL, Z-up.
let baseBrickSize = new THREE.Vector3(20, 20, 29); // Loading fallback; replaced from STL bounds.
let baseBodyTop = 24; // Top of the continuous body; estimated from the STL.

const grid = document.querySelector('#brickGrid');
const toolButtons = [...document.querySelectorAll('[data-brick-tool]')];
const clearButton = document.querySelector('#brickClear');
const studCount = document.querySelector('#studCount');
const footprint = document.querySelector('#brickFootprint');
const dimensions = document.querySelector('#brickDimensions');
const moduleSpec = document.querySelector('#brickModuleSpec');
const pitchSpec = document.querySelector('#brickPitchSpec');
const sourceSpec = document.querySelector('#brickSourceSpec');
const downloadButton = document.querySelector('#brickDownload');
const status = document.querySelector('#brickStatus');
const previewHost = document.querySelector('#brickPreview');
const previewFitButton = document.querySelector('#brickPreviewFit');

const cells = new Set();
let tool = 'draw';
let painting = false;
let paintValue = true;

function key(x, y) { return `${x},${y}`; }
function parseKey(value) { return value.split(',').map(Number); }
function formatMm(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function pitchX() { return baseBrickSize.x; }
function pitchY() { return baseBrickSize.y; }
function brickHeight() { return baseBrickSize.z; }
function bodyHeight() { return baseBodyTop; }

function getFootprintData() {
  if (!cells.size) return { width: 0, depth: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const coords = [...cells].map(parseKey);
  const xs = coords.map(([x]) => x);
  const ys = coords.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    width: maxX - minX + 1,
    depth: maxY - minY + 1,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function setTool(next) {
  tool = next;
  toolButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.brickTool === next));
  status.textContent = next === 'draw'
    ? 'DRAW active — tap or drag to place studs.'
    : 'ERASE active — tap or drag to remove studs.';
}

// ---------------------------------------------------------------------------
// LIVE 3D PREVIEW
// ---------------------------------------------------------------------------
const previewScene = new THREE.Scene();
previewScene.background = new THREE.Color(COLORS.paper);

const previewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 1200);
previewCamera.position.set(112, 92, 132);

const previewRenderer = new THREE.WebGLRenderer({ antialias: true });
previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
previewRenderer.toneMappingExposure = 1.05;
previewRenderer.shadowMap.enabled = true;
previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
previewHost.appendChild(previewRenderer.domElement);

const previewControls = new OrbitControls(previewCamera, previewRenderer.domElement);
previewControls.enableDamping = true;
previewControls.dampingFactor = 0.075;
previewControls.minDistance = 58;
previewControls.maxDistance = 720;
previewControls.minPolarAngle = 0.08;
previewControls.maxPolarAngle = Math.PI * 0.92;
previewControls.target.set(0, brickHeight() * 0.42, 0);
previewControls.update();

previewScene.add(new THREE.HemisphereLight(0xffffff, 0xaaa59a, 2.2));
const previewKey = new THREE.DirectionalLight(0xffffff, 3.2);
previewKey.position.set(90, 150, 95);
previewKey.castShadow = true;
previewKey.shadow.mapSize.set(1024, 1024);
previewScene.add(previewKey);
const previewFill = new THREE.DirectionalLight(0xffded6, 1.25);
previewFill.position.set(-90, 70, -65);
previewScene.add(previewFill);
const previewUnderFill = new THREE.DirectionalLight(0xffffff, 1.15);
previewUnderFill.position.set(55, -95, 38);
previewScene.add(previewUnderFill);

let previewGrid = null;
function rebuildPreviewGrid() {
  if (previewGrid) {
    previewScene.remove(previewGrid);
    previewGrid.geometry.dispose();
    previewGrid.material.dispose();
  }
  const gridSize = GRID * Math.max(pitchX(), pitchY());
  previewGrid = new THREE.GridHelper(gridSize, GRID, COLORS.ink, COLORS.ink);
  previewGrid.material.transparent = true;
  previewGrid.material.opacity = 0.12;
  previewGrid.position.y = -0.05;
  previewScene.add(previewGrid);
}
rebuildPreviewGrid();

const previewShellMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.52,
  metalness: 0.01,
  side: THREE.DoubleSide,
});
const previewSourceMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.44,
  metalness: 0.01,
  side: THREE.DoubleSide,
});
let previewShellMesh = null;
let previewSourceInstances = null;
let previewExactBrick = null;

const matrix = new THREE.Matrix4();
let lastFitSignature = '';

function hasCell(x, y) {
  return cells.has(key(x, y));
}

// For larger bricks, keep every source STL completely untouched and only bridge
// the narrow join zones between adjacent modules. Unlike the previous full outer
// shell, these bridges never cover the source cavity, pin holes, or interior.
function buildSeamBridgeGeometry(centerForPreview = false) {
  const positions = [];
  const bounds = getFootprintData();
  const centerX = centerForPreview && cells.size ? (bounds.minX + bounds.maxX) / 2 : null;
  const centerY = centerForPreview && cells.size ? (bounds.minY + bounds.maxY) / 2 : null;
  const halfX = pitchX() / 2;
  const halfY = pitchY() / 2;

  // The source STL has a small edge chamfer/rounding at each 20 mm module edge.
  // Cover only that join band. It stays far away from the actual bottom cavity
  // and the internal circular holes of buildingBlock(2).stl.
  const seamHalf = Math.min(0.85, Math.min(pitchX(), pitchY()) * 0.045);
  const eps = 0.035;
  const topZ = bodyHeight() + eps;
  const bottomZ = eps;

  function previewPoint(point) {
    if (!centerForPreview) return point;
    // Preview uses Y-up, while STL/export uses Z-up. Grid Y maps directly to
    // preview Z so the bridge follows the same logical cell positions as the
    // instanced source bricks.
    return [point[0], point[2], point[1]];
  }
  function addTri(a, b, c) {
    positions.push(...previewPoint(a), ...previewPoint(b), ...previewPoint(c));
  }
  function addQuad(a, b, c, d) {
    addTri(a, b, c);
    addTri(a, c, d);
  }
  function cellCenter(x, y) {
    return {
      x: centerForPreview ? (x - centerX) * pitchX() : (x + 0.5) * pitchX(),
      y: centerForPreview ? (y - centerY) * pitchY() : (y + 0.5) * pitchY(),
    };
  }

  for (const id of cells) {
    const [x, y] = parseKey(id);
    const c = cellCenter(x, y);

    // Horizontal neighbour: bridge only the x seam between the two exact STLs.
    if (hasCell(x + 1, y)) {
      const seamX = c.x + halfX;
      const y0 = c.y - halfY;
      const y1 = c.y + halfY;

      // Top and underside join strips. The underside strip is only at the module
      // boundary, well outside the STL's central cavity/hole region.
      addQuad(
        [seamX - seamHalf, y0, topZ],
        [seamX + seamHalf, y0, topZ],
        [seamX + seamHalf, y1, topZ],
        [seamX - seamHalf, y1, topZ],
      );
      addQuad(
        [seamX - seamHalf, y1, bottomZ],
        [seamX + seamHalf, y1, bottomZ],
        [seamX + seamHalf, y0, bottomZ],
        [seamX - seamHalf, y0, bottomZ],
      );

      // Only cover the visible seam on exposed perimeter faces. Do not make a
      // complete side wall: the exact STL remains responsible for its openings.
      if (!hasCell(x, y - 1) && !hasCell(x + 1, y - 1)) {
        addQuad(
          [seamX + seamHalf, y0 - eps, bottomZ],
          [seamX - seamHalf, y0 - eps, bottomZ],
          [seamX - seamHalf, y0 - eps, topZ],
          [seamX + seamHalf, y0 - eps, topZ],
        );
      }
      if (!hasCell(x, y + 1) && !hasCell(x + 1, y + 1)) {
        addQuad(
          [seamX - seamHalf, y1 + eps, bottomZ],
          [seamX + seamHalf, y1 + eps, bottomZ],
          [seamX + seamHalf, y1 + eps, topZ],
          [seamX - seamHalf, y1 + eps, topZ],
        );
      }
    }

    // Vertical neighbour: same treatment for the y seam.
    if (hasCell(x, y + 1)) {
      const seamY = c.y + halfY;
      const x0 = c.x - halfX;
      const x1 = c.x + halfX;

      addQuad(
        [x0, seamY - seamHalf, topZ],
        [x1, seamY - seamHalf, topZ],
        [x1, seamY + seamHalf, topZ],
        [x0, seamY + seamHalf, topZ],
      );
      addQuad(
        [x0, seamY + seamHalf, bottomZ],
        [x1, seamY + seamHalf, bottomZ],
        [x1, seamY - seamHalf, bottomZ],
        [x0, seamY - seamHalf, bottomZ],
      );

      if (!hasCell(x - 1, y) && !hasCell(x - 1, y + 1)) {
        addQuad(
          [x0 - eps, seamY - seamHalf, bottomZ],
          [x0 - eps, seamY + seamHalf, bottomZ],
          [x0 - eps, seamY + seamHalf, topZ],
          [x0 - eps, seamY - seamHalf, topZ],
        );
      }
      if (!hasCell(x + 1, y) && !hasCell(x + 1, y + 1)) {
        addQuad(
          [x1 + eps, seamY + seamHalf, bottomZ],
          [x1 + eps, seamY - seamHalf, bottomZ],
          [x1 + eps, seamY - seamHalf, topZ],
          [x1 + eps, seamY + seamHalf, topZ],
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (positions.length) {
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return geometry;
}

function rebuildPreviewSourceGeometry() {
  if (previewSourceInstances) {
    previewScene.remove(previewSourceInstances);
    previewSourceInstances.geometry.dispose();
    previewSourceInstances = null;
  }
  if (previewExactBrick) {
    previewScene.remove(previewExactBrick);
    previewExactBrick.geometry.dispose();
    previewExactBrick = null;
  }

  if (!baseBrickGeometry) return;

  // Full source geometry, not just the top: bottom + interior remain exact.
  const sourcePreviewGeometry = baseBrickGeometry.clone();
  sourcePreviewGeometry.rotateX(-Math.PI / 2); // source STL is Z-up; preview is Y-up
  sourcePreviewGeometry.computeBoundingBox();
  sourcePreviewGeometry.computeBoundingSphere();

  previewSourceInstances = new THREE.InstancedMesh(
    sourcePreviewGeometry,
    previewSourceMaterial,
    GRID * GRID,
  );
  previewSourceInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  previewSourceInstances.castShadow = true;
  previewSourceInstances.receiveShadow = true;
  previewSourceInstances.count = 0;
  previewScene.add(previewSourceInstances);

  const exactGeometry = baseBrickGeometry.clone();
  exactGeometry.rotateX(-Math.PI / 2);
  exactGeometry.computeBoundingBox();
  exactGeometry.computeBoundingSphere();
  previewExactBrick = new THREE.Mesh(exactGeometry, previewSourceMaterial);
  previewExactBrick.castShadow = true;
  previewExactBrick.receiveShadow = true;
  previewExactBrick.visible = false;
  previewScene.add(previewExactBrick);
}

function rebuildPreviewShell() {
  if (previewShellMesh) {
    previewScene.remove(previewShellMesh);
    previewShellMesh.geometry.dispose();
    previewShellMesh = null;
  }
  if (cells.size <= 1) return;

  const shellGeometry = buildSeamBridgeGeometry(true);
  if (!shellGeometry.getAttribute('position')?.count) {
    shellGeometry.dispose();
    return;
  }
  shellGeometry.computeBoundingBox();
  shellGeometry.computeBoundingSphere();
  previewShellMesh = new THREE.Mesh(shellGeometry, previewShellMaterial);
  previewShellMesh.castShadow = true;
  previewShellMesh.receiveShadow = true;
  previewScene.add(previewShellMesh);
}

function updatePreview() {
  const count = cells.size;
  const bounds = getFootprintData();
  const centerX = count ? (bounds.minX + bounds.maxX) / 2 : (GRID - 1) / 2;
  const centerY = count ? (bounds.minY + bounds.maxY) / 2 : (GRID - 1) / 2;

  // 1×1 is always the untouched uploaded STL.
  const showExact = count === 1 && Boolean(previewExactBrick);
  if (previewExactBrick) previewExactBrick.visible = showExact;

  if (previewSourceInstances) {
    let index = 0;
    if (!showExact) {
      for (const id of cells) {
        const [x, y] = parseKey(id);
        const worldX = (x - centerX) * pitchX();
        const worldZ = (y - centerY) * pitchY();
        matrix.makeTranslation(worldX, 0, worldZ);
        previewSourceInstances.setMatrixAt(index, matrix);
        index += 1;
      }
    }
    previewSourceInstances.count = showExact ? 0 : count;
    previewSourceInstances.instanceMatrix.needsUpdate = true;
  }

  // Add only narrow seam bridges. The uploaded STL itself remains fully visible,
  // including the underside cavity and the two real internal holes.
  rebuildPreviewShell();

  if (previewGrid) previewGrid.visible = count === 0;
}

function fitPreviewCamera(force = false) {
  const bounds = getFootprintData();
  const signature = `${bounds.width}x${bounds.depth}@${formatMm(pitchX())}x${formatMm(pitchY())}`;
  if (!force && signature === lastFitSignature) return;
  lastFitSignature = signature;

  const spanX = (bounds.width || 7) * pitchX();
  const spanY = (bounds.depth || 7) * pitchY();
  const span = Math.max(spanX, spanY, brickHeight() * 2.2);
  const distance = THREE.MathUtils.clamp(span * 1.22 + 58, 108, 620);
  const direction = previewCamera.position.clone().sub(previewControls.target);
  if (direction.lengthSq() < 0.001) direction.set(1, 0.78, 1.15);
  direction.normalize();

  previewControls.target.set(0, brickHeight() * 0.42, 0);
  previewCamera.position.copy(previewControls.target).addScaledVector(direction, distance);
  previewCamera.near = Math.max(0.1, distance / 1000);
  previewCamera.far = Math.max(900, distance * 5);
  previewCamera.updateProjectionMatrix();
  previewControls.update();
}

function resizePreview() {
  const width = Math.max(1, previewHost.clientWidth);
  const height = Math.max(1, previewHost.clientHeight);
  previewRenderer.setSize(width, height, false);
  previewCamera.aspect = width / height;
  previewCamera.updateProjectionMatrix();
}

const previewResizeObserver = new ResizeObserver(resizePreview);
previewResizeObserver.observe(previewHost);
resizePreview();

function animatePreview() {
  previewControls.update();
  previewRenderer.render(previewScene, previewCamera);
  requestAnimationFrame(animatePreview);
}
animatePreview();

previewFitButton.addEventListener('click', () => fitPreviewCamera(true));

function updateBrickSpecs() {
  const sizeText = `${formatMm(baseBrickSize.x)} × ${formatMm(baseBrickSize.y)} × ${formatMm(baseBrickSize.z)} mm`;
  if (moduleSpec) moduleSpec.textContent = sizeText;
  if (pitchSpec) pitchSpec.textContent = `${formatMm(pitchX())} × ${formatMm(pitchY())} mm`;
  if (sourceSpec) sourceSpec.textContent = BASE_BRICK_FILENAME;
}

function estimateBodyTopZ(geometry) {
  const position = geometry.getAttribute('position');
  const minZ = geometry.boundingBox.min.z;
  const maxZ = geometry.boundingBox.max.z;
  const height = maxZ - minZ;
  const bins = new Map();

  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    if (z < minZ + height * 0.55 || z > minZ + height * 0.92) continue;
    const rounded = Math.round(z * 20) / 20; // 0.05 mm bins
    bins.set(rounded, (bins.get(rounded) || 0) + 1);
  }

  let bestZ = minZ + height * 0.82;
  let bestScore = -Infinity;
  for (const [z, count] of bins) {
    const normalized = (z - minZ) / height;
    const score = count * (0.72 + normalized * 0.28);
    if (score > bestScore) {
      bestScore = score;
      bestZ = z;
    }
  }
  return bestZ - minZ;
}

function installBaseBrickGeometry(geometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error('The base STL has no valid bounds.');

  // Normalize the uploaded STL without changing its physical scale.
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  geometry.translate(-centerX, -centerY, -bounds.min.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();

  geometry.boundingBox.getSize(baseBrickSize);
  baseBodyTop = estimateBodyTopZ(geometry);

  baseBrickGeometry?.dispose();
  baseBrickGeometry = geometry;
  baseBrickReady = true;

  rebuildPreviewGrid();
  rebuildPreviewSourceGeometry();
  updateBrickSpecs();
  updateSummary();
  fitPreviewCamera(true);
  status.textContent = `Exact ${BASE_BRICK_FILENAME} loaded — real cavity and holes preserved for every module.`;
}

function loadBaseBrick() {
  status.textContent = `Loading ${BASE_BRICK_FILENAME}…`;
  const loader = new STLLoader();
  loader.load(
    BASE_BRICK_URL,
    (geometry) => {
      try {
        installBaseBrickGeometry(geometry);
      } catch (error) {
        console.error(error);
        geometry.dispose();
        status.textContent = 'Could not prepare the base brick STL.';
      }
    },
    undefined,
    (error) => {
      console.error('Failed to load base brick STL:', error);
      status.textContent = 'Could not load buildingBlock.stl.';
      downloadButton.disabled = true;
    },
  );
}

// ---------------------------------------------------------------------------
// 2D DRAWING + LIVE METRICS
// ---------------------------------------------------------------------------
function updateSummary() {
  const count = cells.size;
  const bounds = getFootprintData();
  studCount.textContent = String(count).padStart(3, '0');
  downloadButton.disabled = count === 0 || !baseBrickReady;

  if (!count) {
    footprint.textContent = '00×00';
    dimensions.textContent = '0 × 0 × 0 mm';
    updatePreview();
    return;
  }

  footprint.textContent = `${String(bounds.width).padStart(2, '0')}×${String(bounds.depth).padStart(2, '0')}`;
  dimensions.textContent = `${formatMm(bounds.width * pitchX())} × ${formatMm(bounds.depth * pitchY())} × ${formatMm(brickHeight())} mm`;

  updatePreview();
}

function paintCell(cell, force = null) {
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  const id = key(x, y);
  const next = force ?? (tool === 'draw');
  const currentlyOn = cells.has(id);
  if (next === currentlyOn) return;

  if (next) cells.add(id);
  else cells.delete(id);
  cell.classList.toggle('is-on', next);
  cell.setAttribute('aria-pressed', String(next));
  updateSummary();
}

for (let y = 0; y < GRID; y += 1) {
  for (let x = 0; x < GRID; x += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'brick-cell';
    button.dataset.x = x;
    button.dataset.y = y;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `Brick ${x + 1}, ${y + 1}`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      painting = true;
      paintValue = tool === 'draw';
      paintCell(button, paintValue);
    });
    button.addEventListener('pointerenter', () => {
      if (painting) paintCell(button, paintValue);
    });
    grid.appendChild(button);
  }
}

grid.addEventListener('pointermove', (event) => {
  if (!painting) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.brick-cell');
  if (target && grid.contains(target)) paintCell(target, paintValue);
});

function finishPainting() {
  if (!painting) return;
  painting = false;
  fitPreviewCamera();
}
window.addEventListener('pointerup', finishPainting);
window.addEventListener('pointercancel', finishPainting);

toolButtons.forEach((button) => button.addEventListener('click', () => setTool(button.dataset.brickTool)));
clearButton.addEventListener('click', () => {
  cells.clear();
  grid.querySelectorAll('.brick-cell').forEach((cell) => {
    cell.classList.remove('is-on');
    cell.setAttribute('aria-pressed', 'false');
  });
  updateSummary();
  fitPreviewCamera(true);
  status.textContent = 'Grid cleared.';
});

// ---------------------------------------------------------------------------
// STL EXPORT / HANDOFF
// ---------------------------------------------------------------------------
function buildBrickGroup() {
  if (!baseBrickReady || !baseBrickGeometry) return null;

  const group = new THREE.Group();
  group.name = cells.size === 1 ? 'ExactBuildingBlock' : 'MergedCustomBrickWithExactInterior';
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

  if (cells.size === 1) {
    // 1×1 is literally the uploaded STL.
    const brick = new THREE.Mesh(baseBrickGeometry, material);
    brick.position.set(pitchX() / 2, pitchY() / 2, 0);
    brick.name = 'exact_buildingBlock';
    group.add(brick);
    group.updateMatrixWorld(true);
    group.userData.dispose = () => material.dispose();
    return group;
  }

  // Preserve the COMPLETE source brick for every module. This retains underside,
  // cavity/interior, connector holes and all other physical details.
  for (const id of cells) {
    const [x, y] = parseKey(id);
    const brick = new THREE.Mesh(baseBrickGeometry, material);
    brick.position.set((x + 0.5) * pitchX(), (y + 0.5) * pitchY(), 0);
    brick.name = `source_full_${x}_${y}`;
    group.add(brick);
  }

  // Add only narrow join bridges at touching module edges. These do not cross
  // the source STL's cavity or its real internal holes.
  const shellGeometry = buildSeamBridgeGeometry(false);
  const shell = new THREE.Mesh(shellGeometry, material);
  shell.name = 'seam_bridges_only';
  group.add(shell);

  group.updateMatrixWorld(true);
  group.userData.dispose = () => {
    shellGeometry.dispose();
    material.dispose();
  };
  return group;
}

function downloadStl() {
  if (!cells.size || !baseBrickReady) return;
  const group = buildBrickGroup();
  if (!group) return;

  try {
    const stl = new STLExporter().parse(group);
    const blob = new Blob([stl], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = cells.size === 1 ? 'buildingBlock.stl' : `custom-merged-brick-${cells.size}.stl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    status.textContent = cells.size === 1
      ? '3D file saved — exact uploaded base brick.'
      : `3D file saved — joined brick with exact source cavities and holes preserved.`;
  } finally {
    group.userData.dispose?.();
  }
}

downloadButton.addEventListener('click', downloadStl);
window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const k = event.key.toLowerCase();
  if (k === 'd') setTool('draw');
  if (k === 'e') setTool('erase');
  if (k === 'c') clearButton.click();
});

setTool('draw');
updateBrickSpecs();
updateSummary();
fitPreviewCamera(true);
loadBaseBrick();
