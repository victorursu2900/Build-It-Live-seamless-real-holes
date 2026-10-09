/**
 * VoxelModel
 * ----------
 * The physical "brain" of the simulator.
 *
 * IMPORTANT:
 * - This file has ZERO Three.js imports.
 * - It knows nothing about meshes, materials, cameras, mouse events, etc.
 * - All physical constraints live here so the same model can later consume
 *   ESP32 / serial measurements instead of browser pointer input.
 *
 * Coordinates:
 *   x = grid column, 0..gridSize-1
 *   y = grid row,    0..gridSize-1
 *   z = vertical level, 0..maxHeight-1
 */
export class VoxelModel {
  constructor({ gridSize = 16, maxHeight = 5 } = {}) {
    this.gridSize = gridSize;
    this.maxHeight = maxHeight;

    // Coordinate map: "x,y,z" -> { type, color? }
    // Standard blocks may carry an optional per-block display color.
    this.grid = new Map();
  }

  key(x, y, z) {
    return `${x},${y},${z}`;
  }

  has(x, y, z) {
    return this.grid.has(this.key(x, y, z));
  }

  get(x, y, z) {
    return this.grid.get(this.key(x, y, z))?.type ?? null;
  }

  getBlock(x, y, z) {
    return this.grid.get(this.key(x, y, z)) ?? null;
  }

  isInsideBase(x, y) {
    return x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize;
  }

  setGridSize(gridSize) {
    const numeric = Math.round(Number(gridSize));
    if (!Number.isFinite(numeric) || numeric < 1) {
      throw new Error('INVALID GRID SIZE');
    }
    this.gridSize = numeric;
  }

  /**
   * Single source of truth for placement legality.
   * Change the physical rules here — the renderer does not need to change.
   */
  validatePlacement(x, y, z) {
    if (!this.isInsideBase(x, y)) {
      return { valid: false, reason: `OUTSIDE ${this.gridSize}×${this.gridSize} BASE` };
    }

    if (z < 0) {
      return { valid: false, reason: 'BELOW BASE' };
    }

    if (z >= this.maxHeight) {
      return { valid: false, reason: `MAX HEIGHT = ${this.maxHeight}` };
    }

    if (this.has(x, y, z)) {
      return { valid: false, reason: 'CELL OCCUPIED' };
    }

    // Gravity + no-cantilever rule:
    // every block above z=0 must have a block DIRECTLY underneath it.
    if (z > 0 && !this.has(x, y, z - 1)) {
      return { valid: false, reason: 'NO DIRECT SUPPORT BELOW' };
    }

    return { valid: true, reason: z === 0 ? 'SUPPORTED BY BASE' : 'DIRECTLY SUPPORTED' };
  }

  placeBlock(x, y, z, type = 'standard', color = null) {
    const validation = this.validatePlacement(x, y, z);
    if (!validation.valid) return validation;

    const normalizedType = type === 'support' ? 'support' : 'standard';
    const normalizedColor = normalizedType === 'standard' && /^#[0-9a-f]{6}$/i.test(String(color ?? ''))
      ? String(color).toLowerCase()
      : null;
    this.grid.set(this.key(x, y, z), { type: normalizedType, ...(normalizedColor ? { color: normalizedColor } : {}) });
    return { valid: true, reason: 'BLOCK PLACED' };
  }

  setStandardBlockColor(x, y, z, color) {
    const block = this.getBlock(x, y, z);
    if (!block || block.type !== 'standard') {
      return { changed: false, reason: 'STANDARD CUBE REQUIRED' };
    }

    const normalizedColor = /^#[0-9a-f]{6}$/i.test(String(color ?? ''))
      ? String(color).toLowerCase()
      : null;
    if (!normalizedColor) return { changed: false, reason: 'INVALID COLOR' };
    if (block.color === normalizedColor) return { changed: false, reason: 'COLOR UNCHANGED' };

    this.grid.set(this.key(x, y, z), { ...block, color: normalizedColor });
    return { changed: true, reason: 'BLOCK COLOR UPDATED' };
  }

  setStandardBlocksColor(keys = [], color) {
    const normalizedColor = /^#[0-9a-f]{6}$/i.test(String(color ?? ''))
      ? String(color).toLowerCase()
      : null;
    if (!normalizedColor) return { changed: 0, reason: 'INVALID COLOR' };

    let changed = 0;
    for (const key of keys) {
      const block = this.grid.get(String(key));
      if (!block || block.type !== 'standard' || block.color === normalizedColor) continue;
      this.grid.set(String(key), { ...block, color: normalizedColor });
      changed += 1;
    }
    return { changed, reason: changed ? 'BLOCK COLORS UPDATED' : 'COLOR UNCHANGED' };
  }

  setAllStandardColor(color) {
    return this.setStandardBlocksColor(
      [...this.grid.entries()].filter(([, block]) => block.type === 'standard').map(([key]) => key),
      color,
    );
  }

  /**
   * Erasing a block from the middle of a real stack would make blocks above
   * it fall. We mimic that by shifting every higher block down by one level.
   * This guarantees the model never contains floating voxels after deletion.
   */
  removeBlockAndApplyGravity(x, y, z) {
    if (!this.has(x, y, z)) {
      return { removed: false, reason: 'NO BLOCK HERE' };
    }

    const blocksAbove = [];

    for (let level = z + 1; level < this.maxHeight; level += 1) {
      const block = this.getBlock(x, y, level);
      if (block) blocksAbove.push({ level, block: { ...block } });
    }

    // Remove selected block and all old positions above it.
    for (let level = z; level < this.maxHeight; level += 1) {
      this.grid.delete(this.key(x, y, level));
    }

    // Drop higher blocks by exactly one level.
    for (const item of blocksAbove) {
      this.grid.set(this.key(x, y, item.level - 1), item.block);
    }

    return {
      removed: true,
      reason: blocksAbove.length ? 'BLOCK REMOVED / STACK DROPPED' : 'BLOCK REMOVED',
    };
  }

  clear() {
    this.grid.clear();
  }

  getBlockCount() {
    return this.grid.size;
  }

  /**
   * Renderer-friendly snapshot. The renderer only reads this array and draws it.
   */
  getBlocks() {
    const blocks = [];

    for (const [key, block] of this.grid.entries()) {
      const [x, y, z] = key.split(',').map(Number);
      blocks.push({ x, y, z, type: block.type, ...(block.color ? { color: block.color } : {}) });
    }

    return blocks.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  }

  /**
   * Useful later for ESP32 / Web Serial integration.
   * Input example:
   * [{ x: 0, y: 0, z: 0, type: 'standard' }, ...]
   *
   * Frames are rebuilt bottom-up and still pass through the same physical rules.
   */
  replaceFromFrame(blocks = []) {
    this.clear();

    const ordered = [...blocks].sort((a, b) => a.z - b.z);
    const rejected = [];

    for (const block of ordered) {
      const result = this.placeBlock(block.x, block.y, block.z, block.type, block.color);
      if (!result.valid) rejected.push({ ...block, reason: result.reason });
    }

    return rejected;
  }

  /**
   * Lossless restore path for states that were already created by this app.
   * Unlike replaceFromFrame(), this does not re-run gravity/placement rules,
   * so saved Standard/Support semantics and coordinates cannot drift on load.
   * Bounds and block types are still validated.
   */
  replaceExact(blocks = []) {
    this.clear();
    const rejected = [];

    for (const raw of blocks) {
      const x = Math.round(Number(raw?.x));
      const y = Math.round(Number(raw?.y));
      const z = Math.round(Number(raw?.z));
      const type = String(raw?.type ?? '').toLowerCase();
      const color = type === 'standard' && /^#[0-9a-f]{6}$/i.test(String(raw?.color ?? ''))
        ? String(raw.color).toLowerCase()
        : null;

      if (![x, y, z].every(Number.isFinite)) {
        rejected.push({ ...raw, reason: 'INVALID COORDINATES' });
        continue;
      }
      if (!['standard', 'support'].includes(type)) {
        rejected.push({ ...raw, reason: 'INVALID BLOCK TYPE' });
        continue;
      }
      if (!this.isInsideBase(x, y) || z < 0 || z >= this.maxHeight) {
        rejected.push({ ...raw, reason: 'OUTSIDE MODEL BOUNDS' });
        continue;
      }

      this.grid.set(this.key(x, y, z), { type, ...(color ? { color } : {}) });
    }

    return rejected;
  }

  toJSON() {
    return this.getBlocks();
  }
}
