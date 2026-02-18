// ============================================================================
// MapTypes.ts
// Types defining the structure of game maps: dimensions, zones, bomb sites,
// walls, cover objects, and the navigation grid used for pathfinding.
// ============================================================================

/**
 * MapData is the top-level interface describing an entire game map.
 * Contains the map metadata, spatial boundaries, spawn locations,
 * objectives, physical geometry, and the precomputed navigation grid.
 */
export interface MapData {
  /**
   * The display name of the map (e.g., "Sandstorm", "Frostbite", "Neon City").
   * Shown in the map selection screen and during the loading screen.
   */
  name: string;

  /**
   * The visual theme of the map, used to select the correct tileset and assets.
   * Examples: "desert", "arctic", "urban", "industrial", "jungle".
   * Determines skybox, ground textures, wall materials, and ambient effects.
   */
  theme: string;

  /**
   * The overall dimensions of the map in pixels.
   * Defines the bounding box for all map elements and the coordinate system.
   * All positions (soldiers, walls, cover) must fall within these dimensions.
   */
  dimensions: {
    /** Total map width in pixels (horizontal extent along the x-axis). */
    width: number;
    /** Total map height in pixels (vertical extent along the z-axis). */
    height: number;
  };

  /**
   * Spawn zones where each side soldiers appear at the start of a round.
   * Soldiers are placed randomly within their team spawn zone during setup.
   * Spawn zones must not overlap with walls, cover, or bomb sites.
   */
  spawnZones: {
    /** The rectangular zone where attacking soldiers spawn. */
    attacker: Zone;
    /** The rectangular zone where defending soldiers spawn. */
    defender: Zone;
  };

  /**
   * Array of bomb sites on the map where attackers can plant the bomb.
   * Standard maps have two bomb sites (typically labeled "A" and "B").
   * At least one bomb site is required for a valid map.
   * @see BombSite
   */
  bombSites: BombSite[];

  /**
   * Array of wall segments that block movement and line of sight.
   * Walls are axis-aligned rectangles with a 3D elevation for rendering.
   * Soldiers cannot walk through or shoot through walls.
   * @see Wall
   */
  walls: Wall[];

  /**
   * Array of cover objects that provide partial protection during firefights.
   * Cover objects block bullets but may be destructible.
   * Soldiers can crouch behind cover to reduce their exposure.
   * @see CoverObject
   */
  cover: CoverObject[];

  /**
   * 2D boolean grid used for pathfinding and movement validation.
   * True means the cell is walkable; false means it is blocked (wall or obstacle).
   * Generated at map load time by rasterizing walls and cover onto a grid.
   * Grid resolution is typically 1 cell per N pixels (defined by implementation).
   * Indexed as navGrid[z][x] (row-major order).
   */
  navGrid: boolean[][];
}

/**
 * Zone represents an axis-aligned rectangular region on the map.
 * Used for spawn areas, bomb site boundaries, and other spatial regions.
 * The zone is defined by its top-left corner (x, z) and its size (width, height).
 */
export interface Zone {
  /**
   * The x-coordinate of the zone left edge, in pixels.
   * Measured from the left edge of the map.
   */
  x: number;

  /**
   * The z-coordinate of the zone top edge, in pixels.
   * Measured from the top edge of the map.
   */
  z: number;

  /**
   * The width of the zone in pixels (horizontal extent).
   * The zone spans from x to (x + width).
   */
  width: number;

  /**
   * The height of the zone in pixels (vertical extent).
   * The zone spans from z to (z + height).
   */
  height: number;
}

/**
 * BombSite defines a plantable objective location on the map.
 * Each bomb site has a larger outer zone (the general site area)
 * and a smaller inner plantZone where the bomb can actually be placed.
 */
export interface BombSite {
  /**
   * Unique identifier for this bomb site.
   * Conventionally "A" or "B" for standard two-site maps.
   * Displayed on the HUD and minimap for player orientation.
   */
  id: string;

  /**
   * The overall rectangular area considered part of this bomb site.
   * Soldiers within this zone are considered "on site" for gameplay purposes.
   * Used for UI indicators and defender positioning logic.
   * @see Zone
   */
  zone: Zone;

  /**
   * The smaller rectangular area within the site where the bomb can be planted.
   * An attacking soldier must be standing inside this zone to begin planting.
   * Always contained entirely within the outer zone.
   * @see Zone
   */
  plantZone: Zone;
}

/**
 * Wall represents a solid, impassable rectangular barrier on the map.
 * Walls block both movement and line of sight completely.
 * They are axis-aligned (no rotation) and have a 3D elevation for rendering
 * purposes in the isometric or 3D view.
 */
export interface Wall {
  /**
   * The x-coordinate of the wall left edge, in pixels.
   * Measured from the left edge of the map.
   */
  x: number;

  /**
   * The z-coordinate of the wall top edge, in pixels.
   * Measured from the top edge of the map.
   */
  z: number;

  /**
   * The width of the wall in pixels (horizontal extent).
   * Combined with x, defines the wall horizontal span.
   */
  width: number;

  /**
   * The height of the wall in pixels (vertical extent, top-down).
   * Combined with z, defines the wall vertical span on the map.
   * Note: This is the 2D footprint height, NOT the 3D elevation.
   */
  height: number;

  /**
   * The 3D rendered height (elevation) of the wall in pixels.
   * Controls how tall the wall appears in the game rendered view.
   * Does not affect gameplay collision -- all walls fully block movement and sight.
   * @default 120
   */
  elevation: number;

  /**
   * The material or texture identifier used for rendering this wall.
   * Determines the visual appearance of the wall surface.
   * Examples: "concrete", "brick", "metal", "wood", "stone".
   * Must match a valid material key in the rendering engine asset registry.
   */
  material: string;
}

/**
 * CoverObject represents a smaller, partially protective object on the map.
 * Cover blocks bullets and may block movement, but is shorter than walls
 * (lower elevation). Some cover objects are destructible and can be eliminated
 * by sustained fire, removing the protection they provide.
 */
export interface CoverObject {
  /**
   * The x-coordinate of the cover object left edge, in pixels.
   * Measured from the left edge of the map.
   */
  x: number;

  /**
   * The z-coordinate of the cover object top edge, in pixels.
   * Measured from the top edge of the map.
   */
  z: number;

  /**
   * The width of the cover object in pixels (horizontal extent).
   * Combined with x, defines the object horizontal footprint.
   */
  width: number;

  /**
   * The height of the cover object in pixels (vertical extent, top-down).
   * Combined with z, defines the object vertical footprint on the map.
   * Note: This is the 2D footprint height, NOT the 3D elevation.
   */
  height: number;

  /**
   * The 3D rendered height (elevation) of the cover object in pixels.
   * Lower than walls (default 50 vs 120), allowing soldiers to peek over.
   * Affects rendering only; gameplay-wise, cover blocks bullets at any height.
   * @default 50
   */
  elevation: number;

  /**
   * Whether this cover object can be destroyed by weapon fire.
   * If true, the cover has a finite health pool and can be eliminated.
   * Once destroyed, the cover no longer blocks movement or bullets.
   * If false, the cover is permanent and indestructible for the round.
   */
  destructible: boolean;

  /**
   * The health points of this cover object (only relevant if destructible is true).
   * Reduced by incoming bullet damage. When health reaches 0, the cover is destroyed.
   * Indestructible cover objects should set this to a high value or Infinity.
   */
  health: number;
}
