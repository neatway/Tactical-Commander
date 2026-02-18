/**
 * @file ServerPathfinding.ts
 * @description Server-side A* pathfinding and path smoothing.
 *
 * This is a standalone implementation of A* pathfinding for the server
 * simulation. It mirrors the client's MovementSystem (client/src/simulation/Movement.ts)
 * but uses only local types — no dependency on client modules or @shared aliases.
 *
 * Architecture:
 *   ServerSimulation
 *     └── ServerPathfinding (this file)
 *           ├── Generates a navigation grid from wall data
 *           ├── Runs A* pathfinding with 8-directional movement
 *           └── Smooths paths by removing redundant waypoints
 *
 * The navigation grid divides the map into cells of CELL_SIZE (50px).
 * Each cell is either walkable (true) or blocked by a wall (false).
 * A* finds the shortest path through walkable cells using 8-directional
 * movement with Manhattan distance heuristic.
 */

// ============================================================================
// --- Types ---
// ============================================================================

/** 2D position in the game world */
interface Position {
  x: number;
  z: number;
}

/** Wall rectangle used for LOS checks and grid generation */
interface WallRect {
  x: number;
  z: number;
  width: number;
  height: number;
}

/** Node in the A* open set (priority queue) */
interface AStarNode {
  /** Column index in the navigation grid */
  col: number;
  /** Row index in the navigation grid */
  row: number;
  /** f-score = g-score + heuristic (total estimated cost) */
  f: number;
}

// ============================================================================
// --- Constants ---
// ============================================================================

/** Size of each pathfinding grid cell in game units (matches MAP.cellSize) */
const CELL_SIZE = 50;

/** Cost of moving diagonally (sqrt(2) ~= 1.414) */
const DIAGONAL_COST = 1.414;

/** Cost of moving in a cardinal direction (up/down/left/right) */
const CARDINAL_COST = 1.0;

/**
 * 8-directional neighbor offsets: [deltaCol, deltaRow, movementCost].
 * Cardinal moves cost 1.0, diagonal moves cost sqrt(2).
 */
const NEIGHBORS: [number, number, number][] = [
  [-1, -1, DIAGONAL_COST], /* Top-left */
  [ 0, -1, CARDINAL_COST], /* Top */
  [ 1, -1, DIAGONAL_COST], /* Top-right */
  [-1,  0, CARDINAL_COST], /* Left */
  [ 1,  0, CARDINAL_COST], /* Right */
  [-1,  1, DIAGONAL_COST], /* Bottom-left */
  [ 0,  1, CARDINAL_COST], /* Bottom */
  [ 1,  1, DIAGONAL_COST], /* Bottom-right */
];

// ============================================================================
// --- ServerPathfinding Class ---
// ============================================================================

/**
 * Server-side pathfinding system using A* on a navigation grid.
 *
 * One instance is created per map. The navigation grid is generated once
 * from the wall data and reused for all pathfinding queries.
 *
 * @example
 * ```ts
 * const pathfinder = new ServerPathfinding(3000, 2000, walls);
 * const path = pathfinder.findPath({ x: 100, z: 100 }, { x: 500, z: 300 });
 * ```
 */
export class ServerPathfinding {
  /** 2D boolean grid: true = walkable, false = blocked by wall */
  private navGrid: boolean[][];

  /** Number of columns in the navigation grid */
  private cols: number;

  /** Number of rows in the navigation grid */
  private rows: number;

  /** Reference to the map walls for LOS checks during path smoothing */
  private walls: WallRect[];

  /**
   * Create a new pathfinding system for the given map dimensions and walls.
   *
   * @param mapWidth - Map width in game units
   * @param mapHeight - Map height in game units
   * @param walls - Array of wall rectangles that block movement
   */
  constructor(mapWidth: number, mapHeight: number, walls: WallRect[]) {
    this.walls = walls;
    this.cols = Math.ceil(mapWidth / CELL_SIZE);
    this.rows = Math.ceil(mapHeight / CELL_SIZE);
    this.navGrid = this.generateNavGrid();
  }

  // --------------------------------------------------------------------------
  // Navigation Grid Generation
  // --------------------------------------------------------------------------

  /**
   * Generate the 2D navigation grid from wall data.
   *
   * For each cell, checks if the cell rectangle overlaps with any wall.
   * If so, the cell is marked as blocked. Otherwise, it is walkable.
   *
   * For a 3000x2000 map with cellSize=50: 60 cols x 40 rows = 2400 cells.
   *
   * @returns 2D boolean array where [row][col] = true means walkable
   */
  private generateNavGrid(): boolean[][] {
    const grid: boolean[][] = [];

    for (let row = 0; row < this.rows; row++) {
      grid[row] = [];
      for (let col = 0; col < this.cols; col++) {
        grid[row][col] = true; /* Assume walkable until proven otherwise */
      }
    }

    /* Check each cell against each wall for overlap */
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cellX = col * CELL_SIZE;
        const cellZ = row * CELL_SIZE;
        const cellRight = cellX + CELL_SIZE;
        const cellBottom = cellZ + CELL_SIZE;

        for (const wall of this.walls) {
          const wallRight = wall.x + wall.width;
          const wallBottom = wall.z + wall.height;

          /* AABB overlap test */
          const overlapX = cellX < wallRight && cellRight > wall.x;
          const overlapZ = cellZ < wallBottom && cellBottom > wall.z;

          if (overlapX && overlapZ) {
            grid[row][col] = false;
            break;
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
   * Algorithm:
   *   1. Convert world positions to grid coordinates
   *   2. Run A* with 8-directional movement and Manhattan heuristic
   *   3. Reconstruct path from cameFrom pointers
   *   4. Convert grid path back to world coordinates
   *   5. Apply path smoothing to remove unnecessary waypoints
   *
   * @param from - Starting world position
   * @param to - Target world position
   * @returns Array of world-position waypoints (empty if no path found)
   */
  findPath(from: Position, to: Position): Position[] {
    /* Convert world coordinates to grid coordinates */
    const startGrid = this.worldToGrid(from);
    const endGrid = this.worldToGrid(to);

    /* Validate bounds and walkability */
    if (!this.isValid(startGrid.col, startGrid.row) ||
        !this.isValid(endGrid.col, endGrid.row)) {
      return [];
    }
    if (!this.navGrid[startGrid.row][startGrid.col] ||
        !this.navGrid[endGrid.row][endGrid.col]) {
      return [];
    }

    /* Initialize A* data structures */
    const gScore: number[][] = [];
    const cameFrom: (null | { col: number; row: number })[][] = [];
    const closedSet: boolean[][] = [];

    for (let r = 0; r < this.rows; r++) {
      gScore[r] = new Array(this.cols).fill(Infinity);
      cameFrom[r] = new Array(this.cols).fill(null);
      closedSet[r] = new Array(this.cols).fill(false);
    }
    gScore[startGrid.row][startGrid.col] = 0;

    /* Heuristic: Manhattan distance to the goal */
    const heuristic = (col: number, row: number): number => {
      return Math.abs(col - endGrid.col) + Math.abs(row - endGrid.row);
    };

    /* Open set: sorted by f-score (ascending) */
    const openSet: AStarNode[] = [
      { col: startGrid.col, row: startGrid.row, f: heuristic(startGrid.col, startGrid.row) }
    ];

    /* Main A* loop */
    while (openSet.length > 0) {
      const current = openSet.shift()!;

      /* Check if we reached the goal */
      if (current.col === endGrid.col && current.row === endGrid.row) {
        return this.reconstructAndSmooth(cameFrom, endGrid, from, to);
      }

      closedSet[current.row][current.col] = true;

      /* Explore all 8 neighbors */
      for (const [dc, dr, cost] of NEIGHBORS) {
        const nc = current.col + dc;
        const nr = current.row + dr;

        if (!this.isValid(nc, nr)) continue;
        if (closedSet[nr][nc]) continue;
        if (!this.navGrid[nr][nc]) continue;

        /* Prevent diagonal corner-cutting through walls */
        if (dc !== 0 && dr !== 0) {
          if (!this.navGrid[current.row + dr][current.col] ||
              !this.navGrid[current.row][current.col + dc]) {
            continue;
          }
        }

        const tentativeG = gScore[current.row][current.col] + cost;

        if (tentativeG < gScore[nr][nc]) {
          gScore[nr][nc] = tentativeG;
          cameFrom[nr][nc] = { col: current.col, row: current.row };
          const f = tentativeG + heuristic(nc, nr);

          /* Insert into sorted open set */
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

    /* No path found */
    return [];
  }

  // --------------------------------------------------------------------------
  // Path Reconstruction and Smoothing
  // --------------------------------------------------------------------------

  /**
   * Reconstruct the A* path and apply smoothing.
   * Follows cameFrom pointers from goal to start, reverses, converts
   * to world coordinates, then smooths by checking line-of-sight.
   *
   * @param cameFrom - Parent pointer map from A*
   * @param endGrid - Goal grid coordinates
   * @param worldFrom - Original world start position
   * @param worldTo - Original world end position
   * @returns Smoothed array of world-position waypoints
   */
  private reconstructAndSmooth(
    cameFrom: (null | { col: number; row: number })[][],
    endGrid: { col: number; row: number },
    worldFrom: Position,
    worldTo: Position
  ): Position[] {
    /* Follow cameFrom pointers from goal to start */
    const gridPath: { col: number; row: number }[] = [];
    let current: { col: number; row: number } | null = endGrid;

    while (current !== null) {
      gridPath.push(current);
      current = cameFrom[current.row][current.col];
    }

    gridPath.reverse();

    /* Convert grid cells to world coordinates (center of each cell) */
    const worldPath: Position[] = gridPath.map(cell => this.gridToWorld(cell.col, cell.row));

    /* Replace first and last with exact world positions */
    if (worldPath.length > 0) {
      worldPath[0] = { ...worldFrom };
      worldPath[worldPath.length - 1] = { ...worldTo };
    }

    /* Apply path smoothing */
    return this.smoothPath(worldPath);
  }

  /**
   * Smooth a path by removing unnecessary intermediate waypoints.
   * For each waypoint, checks if we can skip the next one by verifying
   * line-of-sight (no walls blocking) to a farther waypoint.
   *
   * This reduces the zigzag pattern inherent in grid-based pathfinding.
   *
   * @param path - Raw path from A*
   * @returns Smoothed path with redundant waypoints removed
   */
  private smoothPath(path: Position[]): Position[] {
    if (path.length <= 2) return [...path];

    const smoothed: Position[] = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
      let farthestVisible = current + 1;

      /* Try to skip ahead as far as possible while maintaining LOS */
      for (let check = path.length - 1; check > current + 1; check--) {
        if (this.hasLOS(path[current], path[check])) {
          farthestVisible = check;
          break;
        }
      }

      smoothed.push(path[farthestVisible]);
      current = farthestVisible;
    }

    return smoothed;
  }

  /**
   * Check if there is clear line-of-sight between two positions.
   * Tests the line segment against all wall rectangles using Liang-Barsky.
   *
   * @param from - Start position
   * @param to - End position
   * @returns True if no walls block the line
   */
  private hasLOS(from: Position, to: Position): boolean {
    for (const wall of this.walls) {
      if (this.lineIntersectsRect(from, to, wall)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if a line segment intersects a rectangle.
   * Uses Liang-Barsky parametric line clipping.
   *
   * @param a - Start of line segment
   * @param b - End of line segment
   * @param rect - Rectangle to test against
   * @returns True if the line intersects the rectangle
   */
  private lineIntersectsRect(a: Position, b: Position, rect: WallRect): boolean {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.z;
    const bottom = rect.z + rect.height;

    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dz = b.z - a.z;

    const edges = [
      { p: -dx, q: a.x - left },
      { p: dx, q: right - a.x },
      { p: -dz, q: a.z - top },
      { p: dz, q: bottom - a.z },
    ];

    for (const { p, q } of edges) {
      if (Math.abs(p) < 1e-10) {
        if (q < 0) return false;
      } else {
        const r = q / p;
        if (p < 0) {
          t0 = Math.max(t0, r);
        } else {
          t1 = Math.min(t1, r);
        }
        if (t0 > t1) return false;
      }
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // Grid Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Convert a world position to grid coordinates.
   * Divides by cell size and floors to get the cell index.
   */
  private worldToGrid(pos: Position): { col: number; row: number } {
    return {
      col: Math.floor(pos.x / CELL_SIZE),
      row: Math.floor(pos.z / CELL_SIZE),
    };
  }

  /**
   * Convert grid coordinates back to world position.
   * Returns the center of the grid cell.
   */
  private gridToWorld(col: number, row: number): Position {
    return {
      x: col * CELL_SIZE + CELL_SIZE / 2,
      z: row * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  /**
   * Check if a grid cell index is within valid bounds.
   */
  private isValid(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }
}
