/**
 * @file FogOfWar.ts
 * @description Texture-based fog of war rendering system.
 *
 * Creates a semi-transparent overlay that hides parts of the map the
 * player cannot currently see. Visibility is determined by:
 *   - Soldier positions: each alive soldier reveals a circle around them
 *   - Detection radius: based on the soldier's AWR stat
 *   - Previously explored areas: shown in a darker shade (explored but not visible)
 *
 * Implementation:
 *   - Uses a 2D canvas to paint the fog texture (much faster than GPU for this use case)
 *   - The canvas is mapped onto a Three.js plane that sits above the map geometry
 *   - Updated once per simulation tick (5 times/second), not every frame
 *   - Resolution is intentionally low (1 pixel per FOG_CELL_SIZE world units)
 *     for performance, which also creates a natural soft-edge effect
 *
 * Fog states for each pixel:
 *   - UNEXPLORED: fully opaque black (never been seen)
 *   - EXPLORED:   semi-transparent dark (seen before but not currently visible)
 *   - VISIBLE:    transparent (currently in a soldier's vision)
 */

import * as THREE from 'three';
import { calculateDetectionRadius } from '@shared/constants/StatFormulas';
import type { SoldierRuntimeState, Position } from '../game/GameState';

// ============================================================================
// --- Constants ---
// ============================================================================

/**
 * Size of each fog cell in world units (pixels).
 * Lower values = higher resolution fog but more expensive to compute.
 * 20px per cell gives 150x100 cells for the 3000x2000 Bazaar map.
 */
const FOG_CELL_SIZE = 20;

/**
 * Alpha value for unexplored fog (fully opaque black).
 * 0.0 = transparent, 1.0 = fully opaque.
 */
const UNEXPLORED_ALPHA = 0.85;

/**
 * Alpha value for explored-but-not-visible fog (dark semi-transparent).
 * This lets the player see the terrain they've previously explored
 * but obscures enemy positions.
 */
const EXPLORED_ALPHA = 0.45;

/**
 * How much above the map geometry the fog plane is rendered.
 * Must be high enough to be above all map objects but below the camera.
 */
const FOG_Y_OFFSET = 150;

/**
 * Extra radius beyond the base detection radius that each soldier reveals.
 * This ensures soldiers always have some minimum visibility around them
 * even with low AWR stats.
 */
const MIN_REVEAL_RADIUS = 100;

// ============================================================================
// --- FogOfWar Class ---
// ============================================================================

/**
 * Manages the fog of war overlay for the tactical game.
 *
 * Lifecycle:
 *   1. constructor() — Creates the fog canvas, texture, and Three.js plane
 *   2. update() — Called each simulation tick with current soldier positions
 *   3. The Three.js plane automatically renders with the scene
 *
 * @example
 * ```ts
 * const fog = new FogOfWar(scene, 3000, 2000);
 * // Each tick:
 * fog.update(mySoldiers);
 * ```
 */
export class FogOfWar {
  /** 2D canvas used to paint the fog texture */
  private canvas: HTMLCanvasElement;
  /** 2D rendering context for the fog canvas */
  private ctx: CanvasRenderingContext2D;
  /** Three.js texture created from the fog canvas */
  private texture: THREE.CanvasTexture;
  /** Three.js mesh (plane) displaying the fog overlay */
  private mesh: THREE.Mesh;

  /** Map width in world units */
  private mapWidth: number;
  /** Map height in world units */
  private mapHeight: number;
  /** Fog canvas width in cells (mapWidth / FOG_CELL_SIZE) */
  private fogWidth: number;
  /** Fog canvas height in cells (mapHeight / FOG_CELL_SIZE) */
  private fogHeight: number;

  /**
   * Tracks which cells have ever been explored.
   * Once a cell is explored, it stays in the "explored" state even when
   * no longer directly visible. True = explored at some point.
   */
  private exploredGrid: boolean[][];

  /**
   * Create the fog of war system for a map.
   *
   * @param scene - The Three.js scene to add the fog overlay to
   * @param mapWidth - Total map width in world units
   * @param mapHeight - Total map height in world units
   */
  constructor(scene: THREE.Scene, mapWidth: number, mapHeight: number) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    /* Calculate fog grid dimensions */
    this.fogWidth = Math.ceil(mapWidth / FOG_CELL_SIZE);
    this.fogHeight = Math.ceil(mapHeight / FOG_CELL_SIZE);

    /* Create the offscreen canvas for fog painting */
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.fogWidth;
    this.canvas.height = this.fogHeight;
    this.ctx = this.canvas.getContext('2d')!;

    /* Initialize explored grid (all unexplored) */
    this.exploredGrid = [];
    for (let z = 0; z < this.fogHeight; z++) {
      this.exploredGrid[z] = new Array(this.fogWidth).fill(false);
    }

    /* Create Three.js texture from the canvas */
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;

    /**
     * Create a plane mesh covering the entire map.
     * The plane is positioned above all map geometry so it renders on top.
     * Uses a transparent material so only the fog areas are visible.
     */
    const geometry = new THREE.PlaneGeometry(mapWidth, mapHeight);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,       /* Don't write to depth buffer (overlay) */
      depthTest: false,        /* Always render on top */
      side: THREE.DoubleSide,  /* Visible from both sides (camera looks down) */
    });

    this.mesh = new THREE.Mesh(geometry, material);

    /**
     * Position the fog plane:
     *   - X: centred on the map (mapWidth/2)
     *   - Y: above map geometry
     *   - Z: centred on the map (mapHeight/2)
     *
     * Rotation: -PI/2 on X makes the plane horizontal (facing up toward camera).
     */
    this.mesh.position.set(mapWidth / 2, FOG_Y_OFFSET, mapHeight / 2);
    this.mesh.rotation.x = -Math.PI / 2;

    /**
     * Set render order to ensure fog renders after map and soldiers.
     * Higher render order = rendered later = appears on top.
     */
    this.mesh.renderOrder = 100;

    /* Add to scene */
    scene.add(this.mesh);

    /* Paint initial state (all fog) */
    this.paintFullFog();

    console.log(
      `[FogOfWar] Initialized: ${this.fogWidth}x${this.fogHeight} cells` +
      ` (${FOG_CELL_SIZE}px per cell) for ${mapWidth}x${mapHeight} map`
    );
  }

  // --------------------------------------------------------------------------
  // Update (called each simulation tick)
  // --------------------------------------------------------------------------

  /**
   * Update the fog of war based on current soldier positions.
   *
   * Algorithm:
   *   1. Fill the entire canvas with fog (unexplored or explored alpha)
   *   2. For each alive friendly soldier, reveal a circle around them
   *   3. Mark newly revealed cells as explored
   *   4. Upload the updated texture to the GPU
   *
   * @param friendlySoldiers - The local player's alive soldiers
   */
  update(friendlySoldiers: SoldierRuntimeState[]): void {
    /* Step 1: Paint base fog layer */
    this.paintBaseFog();

    /* Step 2: Reveal circles around each alive friendly soldier */
    for (const soldier of friendlySoldiers) {
      if (!soldier.alive) continue;

      /**
       * Calculate the reveal radius for this soldier.
       * Based on their AWR (Awareness) stat via the detection radius formula.
       * Add a minimum radius so soldiers always see something around them.
       */
      const detectionRadius = calculateDetectionRadius(soldier.stats.AWR);
      const revealRadius = Math.max(detectionRadius, MIN_REVEAL_RADIUS);

      this.revealCircle(soldier.position, revealRadius);
    }

    /* Step 3: Upload the updated canvas to the GPU texture */
    this.texture.needsUpdate = true;
  }

  // --------------------------------------------------------------------------
  // Fog Painting
  // --------------------------------------------------------------------------

  /**
   * Fill the entire canvas with full opaque fog.
   * Used for initial state (everything hidden).
   */
  private paintFullFog(): void {
    this.ctx.fillStyle = `rgba(0, 0, 0, ${UNEXPLORED_ALPHA})`;
    this.ctx.fillRect(0, 0, this.fogWidth, this.fogHeight);
    this.texture.needsUpdate = true;
  }

  /**
   * Paint the base fog layer using the explored grid.
   *
   * - Unexplored cells get full opacity fog (UNEXPLORED_ALPHA)
   * - Previously explored cells get lighter fog (EXPLORED_ALPHA)
   *
   * This is done with ImageData for performance (direct pixel manipulation).
   */
  private paintBaseFog(): void {
    const imageData = this.ctx.createImageData(this.fogWidth, this.fogHeight);
    const data = imageData.data;

    for (let z = 0; z < this.fogHeight; z++) {
      for (let x = 0; x < this.fogWidth; x++) {
        const i = (z * this.fogWidth + x) * 4;

        /* RGB = black (0, 0, 0) */
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;

        /* Alpha depends on whether this cell has been explored */
        const alpha = this.exploredGrid[z][x]
          ? EXPLORED_ALPHA
          : UNEXPLORED_ALPHA;
        data[i + 3] = Math.round(alpha * 255);
      }
    }

    this.ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Reveal a circular area around a position.
   *
   * Sets all fog cells within the radius to transparent (alpha=0),
   * and marks them as explored in the explored grid.
   *
   * Uses a simple circle-fill algorithm: for each cell in the bounding box,
   * check if the cell centre is within the radius of the reveal position.
   *
   * @param worldPos - Centre of the reveal circle in world coordinates
   * @param radius - Radius of the reveal circle in world units
   */
  private revealCircle(worldPos: Position, radius: number): void {
    /* Convert world position to fog grid coordinates */
    const centerCellX = worldPos.x / FOG_CELL_SIZE;
    const centerCellZ = worldPos.z / FOG_CELL_SIZE;

    /* Convert radius to fog grid cells */
    const radiusCells = radius / FOG_CELL_SIZE;
    const radiusSq = radiusCells * radiusCells;

    /* Calculate the bounding box of the circle in fog grid coordinates */
    const minX = Math.max(0, Math.floor(centerCellX - radiusCells));
    const maxX = Math.min(this.fogWidth - 1, Math.ceil(centerCellX + radiusCells));
    const minZ = Math.max(0, Math.floor(centerCellZ - radiusCells));
    const maxZ = Math.min(this.fogHeight - 1, Math.ceil(centerCellZ + radiusCells));

    /**
     * Use globalCompositeOperation 'destination-out' to erase fog.
     * Drawing with this mode removes alpha from the existing pixels,
     * effectively making them transparent (revealing what's underneath).
     */
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        /* Check if this cell's centre is within the circle radius */
        const dx = x + 0.5 - centerCellX;
        const dz = z + 0.5 - centerCellZ;
        const distSq = dx * dx + dz * dz;

        if (distSq <= radiusSq) {
          /**
           * Calculate a soft edge: cells near the edge of the circle
           * are partially transparent (soft falloff) for a nicer look.
           */
          const distRatio = Math.sqrt(distSq) / radiusCells;
          const edgeFade = distRatio > 0.7
            ? 1.0 - (distRatio - 0.7) / 0.3  /* Fade from 70% to 100% of radius */
            : 1.0;

          /* Erase the fog at this cell (alpha=fade means how much to erase) */
          this.ctx.fillStyle = `rgba(0, 0, 0, ${edgeFade})`;
          this.ctx.fillRect(x, z, 1, 1);

          /* Mark this cell as explored (permanent) */
          this.exploredGrid[z][x] = true;
        }
      }
    }

    this.ctx.restore();
  }

  // --------------------------------------------------------------------------
  // Visibility Queries
  // --------------------------------------------------------------------------

  /**
   * Check if a world position is currently visible to the local player.
   * Used for hiding enemy soldier renderers that are in fog.
   *
   * @param worldPos - The world position to check
   * @param friendlySoldiers - The player's alive soldiers
   * @returns True if any friendly soldier can see this position
   */
  isPositionVisible(
    worldPos: Position,
    friendlySoldiers: SoldierRuntimeState[]
  ): boolean {
    for (const soldier of friendlySoldiers) {
      if (!soldier.alive) continue;

      const detectionRadius = calculateDetectionRadius(soldier.stats.AWR);
      const revealRadius = Math.max(detectionRadius, MIN_REVEAL_RADIUS);

      const dx = worldPos.x - soldier.position.x;
      const dz = worldPos.z - soldier.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= revealRadius) {
        return true;
      }
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Reset the fog for a new round (everything back to unexplored).
   */
  reset(): void {
    /* Clear explored grid */
    for (let z = 0; z < this.fogHeight; z++) {
      this.exploredGrid[z].fill(false);
    }

    /* Paint full fog */
    this.paintFullFog();

    console.log('[FogOfWar] Reset for new round');
  }

  /**
   * Show or hide the fog overlay.
   * @param visible - Whether the fog should be visible
   */
  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /**
   * Remove the fog mesh from the scene and dispose of resources.
   * @param scene - The Three.js scene to remove from
   */
  destroy(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
