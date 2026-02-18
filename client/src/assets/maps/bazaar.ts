/**
 * @file bazaar.ts
 * @description Map data for "Bazaar" - a Middle Eastern marketplace town.
 * Inspired by the classic Dust 2 layout with three main lanes,
 * two bomb sites, and key choke points for tactical gameplay.
 *
 * MAP LAYOUT OVERVIEW (3000 x 2000 game units):
 * ===============================================
 *
 *   T Spawn (left)              CT Spawn (right)
 *   x:100-400                    x:2500-2800
 *
 *   +---------+  A SITE  +----------+
 *   | T Spawn |--A Long--| CT Spawn |
 *   |         |          |          |
 *   |    +----|---MID----|----+     |
 *   |    |    |          |    |     |
 *   |         |--B Tun---|          |
 *   +---------+  B SITE  +----------+
 *
 * Three lanes:
 *   - A Long (top): Wide, long sightlines, leads to Site A
 *   - Mid (center): Narrow corridor with some cover
 *   - B Tunnels (bottom): Tight alleys leading to Site B
 *
 * Connectors:
 *   - T connector: links T side of Mid to T side of A/B
 *   - CT connector: links CT side of A to CT side of B
 *   - Catwalk: elevated connector near A site
 *
 * @see MapData type in shared/types/MapTypes.ts
 */

import type { MapData } from '@shared/types/MapTypes';

// ============================================================================
// --- Bazaar Map Data ---
// ============================================================================

/**
 * Complete map data for the Bazaar map.
 * All coordinates use the top-down coordinate system:
 *   X: 0 (left) to 3000 (right)
 *   Z: 0 (top) to 2000 (bottom)
 * Wall/cover dimensions: {x, z} = top-left corner, {width, height} = extent.
 */
export const BAZAAR_MAP: MapData = {
  /** Display name shown in map selection */
  name: "Bazaar",

  /** Visual theme for asset selection */
  theme: "desert",

  /** Map dimensions in game units */
  dimensions: {
    width: 3000,
    height: 2000,
  },

  /**
   * Spawn zones for each team.
   * Attackers (T) spawn on the left side, defenders (CT) on the right.
   */
  spawnZones: {
    attacker: { x: 100, z: 200, width: 300, height: 1600 },
    defender: { x: 2550, z: 200, width: 300, height: 1600 },
  },

  // ==========================================================================
  // BOMB SITES
  // Each bomb site has a larger zone (the general area) and a smaller
  // plantZone (where the bomb can actually be placed).
  // ==========================================================================
  bombSites: [
    {
      /** Bomb Site A - Upper courtyard area */
      id: "A",
      zone: { x: 1600, z: 100, width: 630, height: 410 },
      plantZone: { x: 1800, z: 200, width: 300, height: 250 },
    },
    {
      /** Bomb Site B - Lower enclosed area */
      id: "B",
      zone: { x: 1600, z: 1500, width: 630, height: 410 },
      plantZone: { x: 1800, z: 1550, width: 300, height: 250 },
    },
  ],

  // ==========================================================================
  // WALLS ARRAY
  // Each wall: { x, z, width, height, elevation, material }
  // x,z = top-left corner; width = X extent; height = Z extent
  // elevation = vertical height (120 = full wall, 50 = half wall)
  // ==========================================================================
  walls: [
    // --- Map Boundary Walls ---
    // Invisible perimeter walls preventing soldiers from leaving the map.
    { x: 0, z: 0, width: 3000, height: 20, elevation: 120, material: "concrete" },       // Top boundary
    { x: 0, z: 1980, width: 3000, height: 20, elevation: 120, material: "concrete" },     // Bottom boundary
    { x: 0, z: 0, width: 20, height: 2000, elevation: 120, material: "concrete" },        // Left boundary
    { x: 2980, z: 0, width: 20, height: 2000, elevation: 120, material: "concrete" },     // Right boundary

    // -----------------------------------------------------------------------
    // --- A SITE BUILDINGS (upper portion, z: 100-500) ---
    // -----------------------------------------------------------------------

    // A Site - North wall
    { x: 1600, z: 100, width: 600, height: 30, elevation: 120, material: "sandstone" },
    // A Site - South wall (with gap for A Short)
    { x: 1600, z: 480, width: 250, height: 30, elevation: 120, material: "sandstone" },
    { x: 1950, z: 480, width: 250, height: 30, elevation: 120, material: "sandstone" },
    // A Site - East wall (CT side, with doorway gap)
    { x: 2200, z: 100, width: 30, height: 160, elevation: 120, material: "sandstone" },
    { x: 2200, z: 340, width: 30, height: 170, elevation: 120, material: "sandstone" },
    // A Site - West pillar
    { x: 1600, z: 100, width: 30, height: 150, elevation: 120, material: "sandstone" },

    // -----------------------------------------------------------------------
    // --- A LONG LANE (top lane, z: 100-480, x: 400-1600) ---
    // -----------------------------------------------------------------------

    // A Long - North wall
    { x: 400, z: 80, width: 1200, height: 30, elevation: 120, material: "sandstone" },
    // A Long - South wall (forms lane boundary)
    { x: 400, z: 500, width: 350, height: 30, elevation: 120, material: "sandstone" },
    // A Long Doors - Narrow chokepoint
    { x: 780, z: 110, width: 30, height: 170, elevation: 120, material: "brick" },
    { x: 780, z: 350, width: 30, height: 160, elevation: 120, material: "brick" },
    // A Long - South wall continuation past doors
    { x: 850, z: 500, width: 400, height: 30, elevation: 120, material: "sandstone" },
    // A Long - South wall final segment connecting to A site
    { x: 1300, z: 500, width: 300, height: 30, elevation: 120, material: "sandstone" },

    // -----------------------------------------------------------------------
    // --- MID CORRIDOR (center lane, z: 700-1300, x: 500-2400) ---
    // -----------------------------------------------------------------------

    // Mid - North wall
    { x: 500, z: 700, width: 400, height: 30, elevation: 120, material: "brick" },
    { x: 1000, z: 700, width: 500, height: 30, elevation: 120, material: "brick" },
    { x: 1600, z: 700, width: 400, height: 30, elevation: 120, material: "brick" },
    { x: 2100, z: 700, width: 300, height: 30, elevation: 120, material: "brick" },
    // Mid - South wall
    { x: 500, z: 1300, width: 400, height: 30, elevation: 120, material: "brick" },
    { x: 1000, z: 1300, width: 500, height: 30, elevation: 120, material: "brick" },
    { x: 1600, z: 1300, width: 400, height: 30, elevation: 120, material: "brick" },
    { x: 2100, z: 1300, width: 300, height: 30, elevation: 120, material: "brick" },
    // Mid Doors chokepoint
    { x: 1380, z: 730, width: 30, height: 250, elevation: 120, material: "concrete" },
    { x: 1380, z: 1050, width: 30, height: 250, elevation: 120, material: "concrete" },
    // Mid Window room
    { x: 1800, z: 730, width: 120, height: 30, elevation: 120, material: "sandstone" },
    { x: 1800, z: 900, width: 120, height: 30, elevation: 120, material: "sandstone" },
    { x: 1800, z: 730, width: 30, height: 200, elevation: 120, material: "sandstone" },

    // -----------------------------------------------------------------------
    // --- B TUNNELS (bottom lane, z: 1500-1900, x: 400-1600) ---
    // -----------------------------------------------------------------------

    // B Tunnels - Top wall
    { x: 400, z: 1500, width: 500, height: 30, elevation: 120, material: "sandstone" },
    { x: 1000, z: 1500, width: 600, height: 30, elevation: 120, material: "sandstone" },
    // B Tunnels - Bottom wall
    { x: 400, z: 1850, width: 500, height: 30, elevation: 120, material: "sandstone" },
    { x: 1000, z: 1850, width: 600, height: 30, elevation: 120, material: "sandstone" },
    // B Tunnels - Interior walls creating zigzag
    { x: 700, z: 1530, width: 30, height: 150, elevation: 120, material: "sandstone" },
    { x: 1100, z: 1680, width: 30, height: 170, elevation: 120, material: "sandstone" },

    // -----------------------------------------------------------------------
    // --- B SITE BUILDINGS (lower portion, z: 1500-1900) ---
    // -----------------------------------------------------------------------

    // B Site - North wall (with gap for B entrance)
    { x: 1600, z: 1500, width: 200, height: 30, elevation: 120, material: "brick" },
    { x: 1900, z: 1500, width: 300, height: 30, elevation: 120, material: "brick" },
    // B Site - South wall
    { x: 1600, z: 1880, width: 600, height: 30, elevation: 120, material: "brick" },
    // B Site - West wall (with gap)
    { x: 1600, z: 1530, width: 30, height: 130, elevation: 120, material: "brick" },
    { x: 1600, z: 1750, width: 30, height: 130, elevation: 120, material: "brick" },
    // B Site - East wall (CT side, with gap)
    { x: 2200, z: 1500, width: 30, height: 160, elevation: 120, material: "brick" },
    { x: 2200, z: 1740, width: 30, height: 140, elevation: 120, material: "brick" },

    // -----------------------------------------------------------------------
    // --- CT CONNECTOR (right side, x: 2200-2500, z: 510-1500) ---
    // -----------------------------------------------------------------------

    // CT Connector - West wall
    { x: 2230, z: 510, width: 30, height: 400, elevation: 120, material: "concrete" },
    { x: 2230, z: 1000, width: 30, height: 500, elevation: 120, material: "concrete" },
    // CT Connector - East wall
    { x: 2500, z: 510, width: 30, height: 400, elevation: 120, material: "concrete" },
    { x: 2500, z: 1000, width: 30, height: 500, elevation: 120, material: "concrete" },

    // -----------------------------------------------------------------------
    // --- T SPAWN AREA (left side, x: 50-400) ---
    // -----------------------------------------------------------------------

    // T Spawn - Dividing walls creating three exit lanes
    { x: 380, z: 500, width: 30, height: 200, elevation: 120, material: "concrete" },
    { x: 380, z: 1300, width: 30, height: 200, elevation: 120, material: "concrete" },

    // -----------------------------------------------------------------------
    // --- CT SPAWN AREA (right side, x: 2500-2900) ---
    // -----------------------------------------------------------------------

    // CT Spawn - Dividing walls
    { x: 2530, z: 500, width: 30, height: 200, elevation: 120, material: "concrete" },
    { x: 2530, z: 1300, width: 30, height: 200, elevation: 120, material: "concrete" },
  ],

  // ==========================================================================
  // COVER OBJECTS
  // Waist-high cover that soldiers can crouch behind. Some are destructible.
  // ==========================================================================
  cover: [
    // --- A Site cover ---
    { x: 1850, z: 250, width: 60, height: 60, elevation: 50, destructible: true, health: 100 },
    { x: 1700, z: 350, width: 40, height: 40, elevation: 50, destructible: true, health: 80 },
    { x: 2050, z: 380, width: 50, height: 50, elevation: 50, destructible: false, health: 100 },

    // --- A Long cover ---
    { x: 600, z: 280, width: 70, height: 40, elevation: 50, destructible: true, health: 100 },
    { x: 1100, z: 300, width: 60, height: 40, elevation: 50, destructible: false, health: 100 },

    // --- Mid cover ---
    { x: 650, z: 950, width: 50, height: 50, elevation: 50, destructible: true, health: 100 },
    { x: 1200, z: 980, width: 40, height: 40, elevation: 50, destructible: false, health: 100 },
    { x: 1450, z: 900, width: 35, height: 35, elevation: 50, destructible: true, health: 60 },
    { x: 2000, z: 1000, width: 60, height: 40, elevation: 50, destructible: false, health: 100 },

    // --- B Tunnels cover ---
    { x: 500, z: 1650, width: 50, height: 50, elevation: 50, destructible: true, health: 80 },
    { x: 900, z: 1700, width: 60, height: 40, elevation: 50, destructible: false, health: 100 },

    // --- B Site cover ---
    { x: 1900, z: 1650, width: 60, height: 60, elevation: 50, destructible: true, health: 100 },
    { x: 1750, z: 1750, width: 40, height: 40, elevation: 50, destructible: true, health: 80 },
    { x: 2050, z: 1580, width: 50, height: 30, elevation: 50, destructible: false, health: 100 },

    // --- CT Connector cover ---
    { x: 2350, z: 800, width: 50, height: 50, elevation: 50, destructible: true, health: 100 },
    { x: 2350, z: 1200, width: 45, height: 45, elevation: 50, destructible: true, health: 80 },
  ],

  /**
   * Navigation grid - generated at runtime by the movement system.
   * Empty array here since the MovementSystem generates it from walls.
   */
  navGrid: [],
};
