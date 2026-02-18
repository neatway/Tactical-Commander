/**
 * @file Movement.ts
 * @description Pathfinding and movement system for the tactical simulation.
 * Implements A* pathfinding on a navigation grid derived from the map walls,
 * plus a movement function that moves soldiers along their waypoint paths.
 *
 * The navigation grid divides the map into cells of size MAP.cellSize (50px).
 * Each cell is either walkable (true) or blocked by a wall (false).
 * A* finds the shortest path through walkable cells using 8-directional
 * movement with Manhattan distance heuristic.
 *
 * Path smoothing removes unnecessary zigzag by checking line-of-sight
 * between non-adjacent waypoints and skipping intermediate ones.
 */

import type { Vec2 } from "../../../../shared/types/SoldierTypes";
import type { MapData, Wall } from "../../../../shared/types/MapTypes";
import { distance, angleBetween, lineIntersectsRect } from "../../../../shared/util/MathUtils";
import { MAP } from "../../../../shared/constants/GameConstants";
import type { ClientSoldier } from "./Soldier";

// ============================================================================
// --- Constants ---
// ============================================================================

/**
 * Distance threshold for arriving at a waypoint.
 * When a soldier is within this many game units of a waypoint,
 * they are considered to have "arrived" and advance to the next one.
 */
const WAYPOINT_ARRIVAL_DISTANCE = 5;

/**
 * Cost of moving diagonally (sqrt(2) approx 1.414).
 * Used in A* to correctly weight diagonal movement.
 */
const DIAGONAL_COST = 1.414;

/**
 * Cost of moving in a cardinal direction (up/down/left/right).
 */
const CARDINAL_COST = 1.0;

// ============================================================================
// --- A* Priority Queue Node ---
// ============================================================================

/**
 * Represents a node in the A* open set (priority queue).
 * Stores grid coordinates and the f-score used for priority ordering.
 */
interface AStarNode {
  /** Column index in the navigation grid */
  col: number;
  /** Row index in the navigation grid */
  row: number;
  /** f-score = g-score + h-score (total estimated cost) */
  f: number;
}

// ============================================================================
// --- MovementSystem Class ---
// ============================================================================

/**
 * Handles pathfinding (A*) and navigation grid generation.
 * One instance is created per map and reused for all pathfinding queries.
 *
 * @example
 * 
 */
export class MovementSystem {  /** 2D boolean grid: true = walkable, false = blocked by wall */
  private navGrid: boolean[][];

  /** Number of columns in the navigation grid */
  private cols: number;

  /** Number of rows in the navigation grid */
  private rows: number;

  /** Size of each grid cell in game units (from MAP.cellSize) */
  private cellSize: number;

  /** Reference to the map walls for LOS checks during path smoothing */
  private walls: Wall[];

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  /**
   * Create a new MovementSystem for the given map.
   * Generates the navigation grid by checking which cells overlap walls.
   *
   * @param mapData - The complete map data including walls and dimensions
   */
  constructor(mapData: MapData) {
    this.cellSize = MAP.cellSize;
    this.walls = mapData.walls;
    this.cols = Math.ceil(mapData.width / this.cellSize);
    this.rows = Math.ceil(mapData.height / this.cellSize);
    this.navGrid = this.generateNavGrid(mapData);
  }

  // --------------------------------------------------------------------------
  // Navigation Grid Generation
  // --------------------------------------------------------------------------

  /**
   * Generate the 2D navigation grid from map wall data.
   *
   * For each cell in the grid, we check if the cell rectangle overlaps
   * with any wall rectangle. If it does, the cell is marked as blocked (false).
   * Otherwise, it is walkable (true).
   *
   * Grid dimensions: cols = ceil(mapWidth / cellSize), rows = ceil(mapHeight / cellSize)
   * For a 3000x2000 map with cellSize=50: 60 cols x 40 rows = 2400 cells.
   *
   * @param mapData - Map data containing walls array and dimensions
   * @returns 2D boolean array where [row][col] = true means walkable
   */
  private generateNavGrid(mapData: MapData): boolean[][] {
    /** Initialize grid with all cells walkable */
    const grid: boolean[][] = [];
    for (let row = 0; row < this.rows; row++) {
      grid[row] = [];
      for (let col = 0; col < this.cols; col++) {
        grid[row][col] = true; /* Assume walkable until proven otherwise */
      }
    }

    /**
     * For each cell, check overlap with every wall.
     * A cell is blocked if its rectangle overlaps any wall rectangle.
     * Two axis-aligned rectangles overlap if they overlap on both axes.
     */
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        /* Calculate the cell bounding box in world coordinates */
        const cellX = col * this.cellSize;
        const cellZ = row * this.cellSize;
        const cellRight = cellX + this.cellSize;
        const cellBottom = cellZ + this.cellSize;

        /* Check against each wall */
        for (const wall of mapData.walls) {
          const wallRight = wall.x + wall.width;
          const wallBottom = wall.z + wall.height;

          /**
           * AABB overlap test: two rectangles overlap if and only if
           * they overlap on BOTH the X axis and Z axis simultaneously.
           */
          const overlapX = cellX < wallRight && cellRight > wall.x;
          const overlapZ = cellZ < wallBottom && cellBottom > wall.z;

          if (overlapX && overlapZ) {
            grid[row][col] = false; /* Cell is blocked */
            break; /* No need to check more walls for this cell */
          }
        }
      }
    }

    return grid;
  }
  // --------------------------------------------------------------------------
  // A* Pathfinding
  // --------------------------------------------------------------------------

  /**
   * Find the shortest path from one world position to another using A*.
   *
   * A* Algorithm Overview:
   * 1. Convert world positions to grid coordinates
   * 2. Initialize open set (priority queue) with the start node
   * 3. While open set is not empty:
   *    a. Pop the node with the lowest f-score
   *    b. If it is the goal, reconstruct and return the path
   *    c. For each walkable neighbor (8 directions):
   *       - Calculate tentative g-score
   *       - If better than known g-score, update and add to open set
   * 4. If open set empties without reaching goal, no path exists
   *
   * Uses Manhattan distance as the heuristic (admissible for grid pathfinding).
   * The open set is a simple sorted array (sufficient for grids < 2400 cells).
   *
   * @param from - Starting world position
   * @param to - Target world position
   * @returns Array of world-position waypoints (empty if no path found)
   */
  findPath(from: Vec2, to: Vec2): Vec2[] {
    /* Step 1: Convert world coordinates to grid coordinates */
    const startGrid = this.worldToGrid(from);
    const endGrid = this.worldToGrid(to);

    /* Validate that start and end are within bounds and walkable */
    if (!this.isGridCellValid(startGrid.col, startGrid.row) ||
        !this.isGridCellValid(endGrid.col, endGrid.row)) {
      return []; /* Cannot pathfind to/from invalid cells */
    }
    if (!this.navGrid[startGrid.row][startGrid.col] ||
        !this.navGrid[endGrid.row][endGrid.col]) {
      return []; /* Start or end is inside a wall */
    }

    /* Step 2: Initialize A* data structures */

    /**
     * gScore[row][col] = cost of the cheapest known path from start to (row, col).
     * Initialize all to Infinity (unexplored).
     */
    const gScore: number[][] = [];
    for (let r = 0; r < this.rows; r++) {
      gScore[r] = new Array(this.cols).fill(Infinity);
    }
    gScore[startGrid.row][startGrid.col] = 0;

    /**
     * cameFrom[row][col] stores the previous cell on the optimal path.
     * Used to reconstruct the path once we reach the goal.
     */
    const cameFrom: (null | { col: number; row: number })[][] = [];
    for (let r = 0; r < this.rows; r++) {
      cameFrom[r] = new Array(this.cols).fill(null);
    }

    /**
     * closedSet tracks cells we have already fully explored.
     * Once a cell is in the closed set, we never revisit it.
     */
    const closedSet: boolean[][] = [];
    for (let r = 0; r < this.rows; r++) {
      closedSet[r] = new Array(this.cols).fill(false);
    }

    /**
     * Open set: priority queue of nodes to explore next.
     * We use a simple sorted array (insert in order, pop from front).
     * For our grid size (~2400 cells), this is fast enough.
     */
    const openSet: AStarNode[] = [];

    /** Calculate the heuristic (Manhattan distance) from a cell to the goal */
    const heuristic = (col: number, row: number): number => {
      return Math.abs(col - endGrid.col) + Math.abs(row - endGrid.row);
    };

    /* Add start node to open set with f = 0 + heuristic */
    const startH = heuristic(startGrid.col, startGrid.row);
    openSet.push({ col: startGrid.col, row: startGrid.row, f: startH });
    /**
     * 8-directional neighbors: cardinal + diagonal.
     * Each entry: [deltaCol, deltaRow, movementCost]
     * Cardinal moves cost 1.0, diagonal moves cost sqrt(2) ~= 1.414.
     */
    const neighbors: [number, number, number][] = [
      [-1, -1, DIAGONAL_COST], /* Top-left */
      [ 0, -1, CARDINAL_COST], /* Top */
      [ 1, -1, DIAGONAL_COST], /* Top-right */
      [-1,  0, CARDINAL_COST], /* Left */
      [ 1,  0, CARDINAL_COST], /* Right */
      [-1,  1, DIAGONAL_COST], /* Bottom-left */
      [ 0,  1, CARDINAL_COST], /* Bottom */
      [ 1,  1, DIAGONAL_COST], /* Bottom-right */
    ];

    /* Step 3: Main A* loop */
    while (openSet.length > 0) {
      /**
       * Pop the node with the lowest f-score from the open set.
       * Since the array is sorted by f-score (ascending), this is index 0.
       */
      const current = openSet.shift()!;

      /* Check if we have reached the goal */
      if (current.col === endGrid.col && current.row === endGrid.row) {
        /* Reconstruct the path by following cameFrom pointers back to start */
        return this.reconstructPath(cameFrom, endGrid, from, to);
      }

      /* Mark current cell as fully explored */
      closedSet[current.row][current.col] = true;

      /* Explore all 8 neighbors */
      for (const [dc, dr, cost] of neighbors) {
        const nc = current.col + dc;
        const nr = current.row + dr;

        /* Skip if out of bounds */
        if (!this.isGridCellValid(nc, nr)) continue;

        /* Skip if already fully explored */
        if (closedSet[nr][nc]) continue;

        /* Skip if not walkable (blocked by wall) */
        if (!this.navGrid[nr][nc]) continue;

        /**
         * For diagonal movement, also check that both adjacent cardinal
         * cells are walkable. This prevents cutting through wall corners.
         */
        if (dc !== 0 && dr !== 0) {
          if (!this.navGrid[current.row + dr][current.col] ||
              !this.navGrid[current.row][current.col + dc]) {
            continue; /* Cannot cut through wall corners diagonally */
          }
        }

        /* Calculate tentative g-score for reaching this neighbor */
        const tentativeG = gScore[current.row][current.col] + cost;

        /* If this path to neighbor is better than any previously known path */
        if (tentativeG < gScore[nr][nc]) {
          /* Update the best known path to this neighbor */
          gScore[nr][nc] = tentativeG;
          cameFrom[nr][nc] = { col: current.col, row: current.row };

          /* Calculate f-score and insert into open set (sorted by f) */
          const f = tentativeG + heuristic(nc, nr);

          /**
           * Insert into the sorted open set at the correct position.
           * We use binary search-like insertion to maintain sort order.
           */
          let inserted = false;
          for (let i = 0; i < openSet.length; i++) {
            if (f <= openSet[i].f) {
              openSet.splice(i, 0, { col: nc, row: nr, f });
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            openSet.push({ col: nc, row: nr, f });
          }
        }
      }
    }

    /* Step 4: Open set is empty and goal was never reached - no path exists */
    return [];
  }
  /**
   * Reconstruct the path from the cameFrom map after A* reaches the goal.
   * Follows parent pointers from goal back to start, then reverses.
   * Converts grid coordinates back to world positions.
   * Preserves the exact start and end world positions for precision.
   *
   * @param cameFrom - Parent pointer map from A*
   * @param endGrid - Goal grid coordinates
   * @param worldFrom - Original world start position (used as first waypoint)
   * @param worldTo - Original world end position (used as last waypoint)
   * @returns Array of world-position waypoints from start to end
   */
  private reconstructPath(
    cameFrom: (null | { col: number; row: number })[][],
    endGrid: { col: number; row: number },
    worldFrom: Vec2,
    worldTo: Vec2
  ): Vec2[] {
    /* Follow cameFrom pointers from goal back to start */
    const gridPath: { col: number; row: number }[] = [];
    let current: { col: number; row: number } | null = endGrid;

    while (current !== null) {
      gridPath.push(current);
      current = cameFrom[current.row][current.col];
    }

    /* Reverse so path goes from start to end */
    gridPath.reverse();

    /* Convert grid cells to world coordinates (center of each cell) */
    const worldPath: Vec2[] = gridPath.map(cell => this.gridToWorld(cell.col, cell.row));

    /* Replace first and last with exact world positions for precision */
    if (worldPath.length > 0) {
      worldPath[0] = { ...worldFrom };
      worldPath[worldPath.length - 1] = { ...worldTo };
    }

    return worldPath;
  }

  // --------------------------------------------------------------------------
  // Path Smoothing
  // --------------------------------------------------------------------------

  /**
   * Smooth a path by removing unnecessary intermediate waypoints.
   * For each waypoint, check if we can skip the next one by verifying
   * line-of-sight (no walls) to the waypoint after it.
   *
   * This reduces the zigzag pattern inherent in grid-based pathfinding,
   * producing more natural-looking soldier movement.
   *
   * @param path - Raw path from A* (array of waypoints)
   * @returns Smoothed path with redundant waypoints removed
   */
  smoothPath(path: Vec2[]): Vec2[] {
    /* Paths with 2 or fewer points cannot be simplified */
    if (path.length <= 2) return [...path];

    /** Build the smoothed path starting with the first waypoint */
    const smoothed: Vec2[] = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
      /**
       * Try to skip as far ahead as possible while maintaining LOS.
       * Start from the farthest point and work backward.
       */
      let farthestVisible = current + 1;

      for (let check = path.length - 1; check > current + 1; check--) {
        /* Test if there is clear line-of-sight between current and check */
        if (this.hasLOS(path[current], path[check])) {
          farthestVisible = check;
          break;
        }
      }

      /* Add the farthest visible point to the smoothed path */
      smoothed.push(path[farthestVisible]);
      current = farthestVisible;
    }

    return smoothed;
  }

  /**
   * Check if there is clear line-of-sight between two world positions.
   * Tests the line segment against all wall rectangles.
   *
   * @param from - Start position
   * @param to - End position
   * @returns True if no walls block the line
   */
  private hasLOS(from: Vec2, to: Vec2): boolean {
    for (const wall of this.walls) {
      if (lineIntersectsRect(
        from.x, from.z, to.x, to.z,
        wall.x, wall.z, wall.width, wall.height
      )) {
        return false; /* Wall blocks the line */
      }
    }
    return true; /* No walls in the way */
  }
  // --------------------------------------------------------------------------
  // Grid Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Check if a world position is in a walkable grid cell.
   *
   * @param worldX - X coordinate in world space
   * @param worldZ - Z coordinate in world space
   * @returns True if the position is walkable
   */
  isWalkable(worldX: number, worldZ: number): boolean {
    const grid = this.worldToGrid({ x: worldX, z: worldZ });
    if (!this.isGridCellValid(grid.col, grid.row)) return false;
    return this.navGrid[grid.row][grid.col];
  }

  /**
   * Convert a world position to grid coordinates.
   * Simply divides by cell size and floors to get the cell index.
   *
   * @param worldPos - Position in world coordinates
   * @returns Grid cell indices { col, row }
   */
  worldToGrid(worldPos: Vec2): { col: number; row: number } {
    return {
      col: Math.floor(worldPos.x / this.cellSize),
      row: Math.floor(worldPos.z / this.cellSize),
    };
  }

  /**
   * Convert grid coordinates back to world position.
   * Returns the center of the grid cell.
   *
   * @param col - Column index
   * @param row - Row index
   * @returns World position at the center of the cell
   */
  gridToWorld(col: number, row: number): Vec2 {
    return {
      x: col * this.cellSize + this.cellSize / 2,
      z: row * this.cellSize + this.cellSize / 2,
    };
  }

  /**
   * Check if a grid cell index is within the valid grid bounds.
   *
   * @param col - Column index to check
   * @param row - Row index to check
   * @returns True if the cell is within bounds
   */
  private isGridCellValid(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }
}

// ============================================================================
// --- Soldier Movement Function ---
// ============================================================================

/**
 * Move a soldier toward their current waypoint at their calculated speed.
 * This function is called once per simulation tick for each moving soldier.
 *
 * Movement logic:
 * 1. If the soldier has no waypoints, stop moving.
 * 2. Get the current (first) waypoint from the queue.
 * 3. Calculate the direction vector from soldier to waypoint.
 * 4. Move the soldier toward the waypoint at speed * deltaTime.
 * 5. If soldier arrives within WAYPOINT_ARRIVAL_DISTANCE, advance to next waypoint.
 * 6. Update the soldiers rotation to face movement direction.
 * 7. Set isMoving flag accordingly.
 *
 * @param soldier - The soldier to move
 * @param deltaTime - Time elapsed since last tick in seconds
 */
export function moveSoldier(soldier: ClientSoldier, deltaTime: number): void {
  /* If the soldier is dead, do not move */
  if (!soldier.isAlive()) {
    soldier.isMoving = false;
    return;
  }

  /* Get the current target waypoint */
  const waypoint = soldier.getCurrentWaypoint();

  /* If no waypoints remain, the soldier stops */
  if (waypoint === null) {
    soldier.isMoving = false;
    return;
  }

  /* Calculate distance to the current waypoint */
  const dist = distance(soldier.position, waypoint);

  /* Check if we have arrived at the waypoint */
  if (dist <= WAYPOINT_ARRIVAL_DISTANCE) {
    /* Snap to waypoint position and advance to the next one */
    soldier.position.x = waypoint.x;
    soldier.position.z = waypoint.z;
    soldier.advanceWaypoint();

    /* Check if there are more waypoints; if not, stop */
    if (!soldier.hasWaypoints()) {
      soldier.isMoving = false;
      return;
    }
  }

  /* Calculate movement direction (unit vector toward waypoint) */
  const dx = waypoint.x - soldier.position.x;
  const dz = waypoint.z - soldier.position.z;
  const magnitude = Math.sqrt(dx * dx + dz * dz);

  /* Safety check: avoid division by zero if somehow exactly at waypoint */
  if (magnitude === 0) return;

  const dirX = dx / magnitude;
  const dirZ = dz / magnitude;

  /* Calculate movement distance for this tick */
  const speed = soldier.getSpeed();
  const moveDistance = speed * deltaTime;

  /**
   * Move the soldier. If the movement distance exceeds the remaining
   * distance to the waypoint, clamp to the waypoint position.
   */
  if (moveDistance >= magnitude) {
    soldier.position.x = waypoint.x;
    soldier.position.z = waypoint.z;
  } else {
    soldier.position.x += dirX * moveDistance;
    soldier.position.z += dirZ * moveDistance;
  }

  /* Update the soldiers rotation to face the direction of movement */
  soldier.rotation = angleBetween(soldier.position, waypoint);

  /* Soldier is actively moving */
  soldier.isMoving = true;
}
