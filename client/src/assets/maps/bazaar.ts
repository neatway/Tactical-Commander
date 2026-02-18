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

import type { MapData } from "../../../../shared/types/MapTypes";

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
  /** Unique map identifier */
  id: "bazaar",
  /** Display name shown in map selection */
  name: "Bazaar",
  /** Flavor text describing the map theme */
  description: "A sun-scorched Middle Eastern marketplace with narrow alleys, open courtyards, and ancient sandstone buildings. Control the three lanes to dominate.",
  /** Map width in game units (X axis) */
  width: 3000,
  /** Map height in game units (Z axis) */
  height: 2000,
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
    // Site A is an open courtyard surrounded by sandstone buildings.
    // The plant zone is roughly at x:1800-2100, z:200-450.
    // -----------------------------------------------------------------------

    // A Site - North wall (top edge of the courtyard)
    { x: 1600, z: 100, width: 600, height: 30, elevation: 120, material: "sandstone" },
    // A Site - South wall (bottom edge of courtyard, with gap for A Short)
    { x: 1600, z: 480, width: 250, height: 30, elevation: 120, material: "sandstone" },
    { x: 1950, z: 480, width: 250, height: 30, elevation: 120, material: "sandstone" },
    // A Site - East wall (CT side, with doorway gap)
    { x: 2200, z: 100, width: 30, height: 160, elevation: 120, material: "sandstone" },
    { x: 2200, z: 340, width: 30, height: 170, elevation: 120, material: "sandstone" },
    // A Site - West pillar (provides partial cover on-site)
    { x: 1600, z: 100, width: 30, height: 150, elevation: 120, material: "sandstone" },

    // -----------------------------------------------------------------------
    // --- A LONG LANE (top lane, z: 100-480, x: 400-1600) ---
    // Long corridor from T spawn toward A site. Open with long sightlines.
    // Features "A Long Doors" chokepoint around x:800-900.
    // -----------------------------------------------------------------------

    // A Long - North wall (continuous along top)
    { x: 400, z: 80, width: 1200, height: 30, elevation: 120, material: "sandstone" },
    // A Long - South wall (forms the lane boundary, broken for Mid connector)
    { x: 400, z: 500, width: 350, height: 30, elevation: 120, material: "sandstone" },
    // A Long Doors - Narrow chokepoint (two walls with gap between them)
    { x: 780, z: 110, width: 30, height: 170, elevation: 120, material: "brick" },       // A Long door left pillar
    { x: 780, z: 350, width: 30, height: 160, elevation: 120, material: "brick" },       // A Long door right pillar
    // A Long - South wall continuation past doors
    { x: 850, z: 500, width: 400, height: 30, elevation: 120, material: "sandstone" },
    // A Long - South wall final segment connecting to A site
    { x: 1300, z: 500, width: 300, height: 30, elevation: 120, material: "sandstone" },

    // -----------------------------------------------------------------------
    // --- MID CORRIDOR (center lane, z: 700-1300, x: 500-2400) ---
    // Medium-width corridor with cover. Key crossover point between lanes.
    // "Mid Doors" chokepoint at x:1400 and "Window" peek at x:1800.
    // -----------------------------------------------------------------------

    // Mid - North wall (separates A Long from Mid)
    { x: 500, z: 700, width: 400, height: 30, elevation: 120, material: "brick" },
    { x: 1000, z: 700, width: 500, height: 30, elevation: 120, material: "brick" },
    { x: 1600, z: 700, width: 400, height: 30, elevation: 120, material: "brick" },
    { x: 2100, z: 700, width: 300, height: 30, elevation: 120, material: "brick" },    // Mid - South wall (separates Mid from B Tunnels)
    { x: 500, z: 1300, width: 400, height: 30, elevation: 120, material: "brick" },
    { x: 1000, z: 1300, width: 500, height: 30, elevation: 120, material: "brick" },
    { x: 1600, z: 1300, width: 400, height: 30, elevation: 120, material: "brick" },
    { x: 2100, z: 1300, width: 300, height: 30, elevation: 120, material: "brick" },
    // Mid Doors chokepoint - Two pillars forming a narrow passage
    { x: 1380, z: 730, width: 30, height: 250, elevation: 120, material: "concrete" },   // Mid door left
    { x: 1380, z: 1050, width: 30, height: 250, elevation: 120, material: "concrete" },  // Mid door right
    // Mid Window room - Small structure providing a peek angle
    { x: 1800, z: 730, width: 120, height: 30, elevation: 120, material: "sandstone" },
    { x: 1800, z: 900, width: 120, height: 30, elevation: 120, material: "sandstone" },
    { x: 1800, z: 730, width: 30, height: 200, elevation: 120, material: "sandstone" },

    // -----------------------------------------------------------------------
    // --- B TUNNELS (bottom lane, z: 1500-1900, x: 400-1600) ---
    // Narrow, winding tunnels from T spawn to B site.
    // Tight corners favor close-range combat.
    // -----------------------------------------------------------------------

    // B Tunnels - Top wall
    { x: 400, z: 1500, width: 500, height: 30, elevation: 120, material: "sandstone" },
    { x: 1000, z: 1500, width: 600, height: 30, elevation: 120, material: "sandstone" },
    // B Tunnels - Bottom wall
    { x: 400, z: 1850, width: 500, height: 30, elevation: 120, material: "sandstone" },
    { x: 1000, z: 1850, width: 600, height: 30, elevation: 120, material: "sandstone" },
    // B Tunnels - Interior wall creating a zigzag path
    { x: 700, z: 1530, width: 30, height: 150, elevation: 120, material: "sandstone" },  // Forces turn
    { x: 1100, z: 1680, width: 30, height: 170, elevation: 120, material: "sandstone" }, // Second turn

    // -----------------------------------------------------------------------
    // --- B SITE BUILDINGS (lower portion, z: 1500-1900) ---
    // B site is a tighter enclosed area with narrow entry points.
    // Plant zone roughly at x:1800-2100, z:1550-1800.
    // -----------------------------------------------------------------------

    // B Site - North wall (with gap for B entrance from tunnels)
    { x: 1600, z: 1500, width: 200, height: 30, elevation: 120, material: "brick" },
    { x: 1900, z: 1500, width: 300, height: 30, elevation: 120, material: "brick" },
    // B Site - South wall
    { x: 1600, z: 1880, width: 600, height: 30, elevation: 120, material: "brick" },
    // B Site - West wall (with gap for tunnel entrance)
    { x: 1600, z: 1530, width: 30, height: 130, elevation: 120, material: "brick" },
    { x: 1600, z: 1750, width: 30, height: 130, elevation: 120, material: "brick" },
    // B Site - East wall (CT side entrance with gap)
    { x: 2200, z: 1500, width: 30, height: 160, elevation: 120, material: "brick" },
    { x: 2200, z: 1740, width: 30, height: 140, elevation: 120, material: "brick" },

    // -----------------------------------------------------------------------
    // --- CT CONNECTOR (right side, x: 2200-2500, z: 510-1500) ---
    // Vertical corridor connecting A site to B site on the CT side.
    // Allows CTs to rotate between sites quickly.
    // -----------------------------------------------------------------------

    // CT Connector - West wall
    { x: 2230, z: 510, width: 30, height: 400, elevation: 120, material: "concrete" },
    { x: 2230, z: 1000, width: 30, height: 500, elevation: 120, material: "concrete" },
    // CT Connector - East wall
    { x: 2500, z: 510, width: 30, height: 400, elevation: 120, material: "concrete" },
    { x: 2500, z: 1000, width: 30, height: 500, elevation: 120, material: "concrete" },

    // -----------------------------------------------------------------------
    // --- T SPAWN AREA (left side, x: 50-400) ---
    // Open area where T-side soldiers start. Three exits lead to
    // A Long (top), Mid (center), and B Tunnels (bottom).
    // -----------------------------------------------------------------------

    // T Spawn - Dividing walls creating three exit lanes
    { x: 380, z: 500, width: 30, height: 200, elevation: 120, material: "concrete" },    // Wall between A Long and Mid exits
    { x: 380, z: 1300, width: 30, height: 200, elevation: 120, material: "concrete" },   // Wall between Mid and B Tunnel exits

    // -----------------------------------------------------------------------
    // --- CT SPAWN AREA (right side, x: 2500-2900) ---
    // Open area where CT-side soldiers start. Exits lead to
    // A site (top), CT connector (center), and B site (bottom).
    // -----------------------------------------------------------------------

    // CT Spawn - Dividing walls
    { x: 2530, z: 500, width: 30, height: 200, elevation: 120, material: "concrete" },   // Between A and connector
    { x: 2530, z: 1300, width: 30, height: 200, elevation: 120, material: "concrete" },  // Between connector and B
  ],
  // ==========================================================================
  // COVER OBJECTS ARRAY
  // Waist-high cover that soldiers can crouch behind. Some are destructible.
  // Each: { x, z, width, height, elevation, destructible, health }
  // ==========================================================================
  cover: [

    // --- A Site cover ---
    // Crates and barrels on the bomb site providing defensive positions.
    /** Large wooden crate on A site - main headglitch position */
    { x: 1850, z: 250, width: 60, height: 60, elevation: 50, destructible: true, health: 100 },
    /** Stack of barrels near A site pillar */
    { x: 1700, z: 350, width: 40, height: 40, elevation: 50, destructible: true, health: 80 },
    /** Stone block on A site - indestructible ancient ruin */
    { x: 2050, z: 380, width: 50, height: 50, elevation: 50, destructible: false, health: 100 },

    // --- A Long cover ---
    // Sparse cover along the long sightline. Risk vs reward positioning.
    /** Overturned cart on A Long - first piece of cover for T push */
    { x: 600, z: 280, width: 70, height: 40, elevation: 50, destructible: true, health: 100 },
    /** Sandbag stack midway down A Long */
    { x: 1100, z: 300, width: 60, height: 40, elevation: 50, destructible: false, health: 100 },

    // --- Mid cover ---
    // Cover in the mid corridor for crossing safely.
    /** Wooden crates at T-side mid entrance */
    { x: 650, z: 950, width: 50, height: 50, elevation: 50, destructible: true, health: 100 },
    /** Stone pillar in center of mid */
    { x: 1200, z: 980, width: 40, height: 40, elevation: 50, destructible: false, health: 100 },
    /** Metal barrel near mid doors */
    { x: 1450, z: 900, width: 35, height: 35, elevation: 50, destructible: true, health: 60 },
    /** Sandbags at CT-side mid exit */
    { x: 2000, z: 1000, width: 60, height: 40, elevation: 50, destructible: false, health: 100 },

    // --- B Tunnels cover ---
    // Cover within the tight tunnel system.
    /** Wooden boxes at B tunnel entrance */
    { x: 500, z: 1650, width: 50, height: 50, elevation: 50, destructible: true, health: 80 },
    /** Rubble pile mid-tunnel */
    { x: 900, z: 1700, width: 60, height: 40, elevation: 50, destructible: false, health: 100 },

    // --- B Site cover ---
    // Defensive positions on the B bomb site.
    /** Large crate on B site - primary cover for defenders */
    { x: 1900, z: 1650, width: 60, height: 60, elevation: 50, destructible: true, health: 100 },
    /** Barrel stack near B site wall */
    { x: 1750, z: 1750, width: 40, height: 40, elevation: 50, destructible: true, health: 80 },
    /** Stone bench - ancient fixture, indestructible */
    { x: 2050, z: 1580, width: 50, height: 30, elevation: 50, destructible: false, health: 100 },

    // --- CT Connector cover ---
    // Cover along the rotation path between sites.
    /** Supply crates in CT connector */
    { x: 2350, z: 800, width: 50, height: 50, elevation: 50, destructible: true, health: 100 },
    /** Ammo boxes halfway through CT connector */
    { x: 2350, z: 1200, width: 45, height: 45, elevation: 50, destructible: true, health: 80 },
  ],
  // ==========================================================================
  // SPAWN POINTS
  // Positions where soldiers start each round.
  // rotation: facing direction in radians (0 = right, PI = left)
  // ==========================================================================

  /** T-side (attacker) spawn points - left side of map, facing right */
  tSpawns: [
    { x: 200, z: 300, rotation: 0 },    // Top T spawn - near A Long entrance
    { x: 200, z: 700, rotation: 0 },    // Upper-mid T spawn
    { x: 200, z: 1000, rotation: 0 },   // Center T spawn - near Mid entrance
    { x: 200, z: 1400, rotation: 0 },   // Lower-mid T spawn
    { x: 200, z: 1700, rotation: 0 },   // Bottom T spawn - near B Tunnel entrance
  ],

  /** CT-side (defender) spawn points - right side of map, facing left */
  ctSpawns: [
    { x: 2700, z: 300, rotation: Math.PI },   // Top CT spawn - near A site
    { x: 2700, z: 700, rotation: Math.PI },   // Upper CT spawn
    { x: 2700, z: 1000, rotation: Math.PI },  // Center CT spawn - CT connector
    { x: 2700, z: 1400, rotation: Math.PI },  // Lower CT spawn
    { x: 2700, z: 1700, rotation: Math.PI },  // Bottom CT spawn - near B site
  ],

  // ==========================================================================
  // BOMB SITES
  // Rectangular plant zones where attackers can plant the bomb.
  // ==========================================================================

  bombSites: [
    {
      /** Bomb Site A - Upper courtyard area */
      id: "A",
      name: "Bomb Site A",
      x: 1800,
      z: 200,
      width: 300,
      height: 250,
      centerX: 1950,
      centerZ: 325,
    },
    {
      /** Bomb Site B - Lower enclosed area */
      id: "B",
      name: "Bomb Site B",
      x: 1800,
      z: 1550,
      width: 300,
      height: 250,
      centerX: 1950,
      centerZ: 1675,
    },
  ],

  // ==========================================================================
  // CALLOUT LOCATIONS
  // Named positions for communication and strategy display.
  // ==========================================================================

  callouts: [
    /** Spawn areas */
    { id: "t_spawn", name: "T Spawn", x: 200, z: 1000 },
    { id: "ct_spawn", name: "CT Spawn", x: 2700, z: 1000 },

    /** A Site callouts */
    { id: "a_site", name: "A Site", x: 1950, z: 325 },
    { id: "a_long", name: "A Long", x: 800, z: 300 },
    { id: "a_long_doors", name: "A Long Doors", x: 790, z: 280 },
    { id: "a_short", name: "A Short", x: 1850, z: 500 },
    { id: "a_ct", name: "A CT", x: 2300, z: 300 },

    /** Mid callouts */
    { id: "t_mid", name: "T Mid", x: 600, z: 1000 },
    { id: "mid", name: "Mid", x: 1200, z: 1000 },
    { id: "mid_doors", name: "Mid Doors", x: 1400, z: 1000 },
    { id: "window", name: "Window", x: 1850, z: 800 },
    { id: "ct_mid", name: "CT Mid", x: 2100, z: 1000 },

    /** B Site callouts */
    { id: "b_site", name: "B Site", x: 1950, z: 1675 },
    { id: "b_tunnels", name: "B Tunnels", x: 700, z: 1700 },
    { id: "b_entrance", name: "B Entrance", x: 1600, z: 1680 },
    { id: "b_ct", name: "B CT", x: 2300, z: 1700 },

    /** Connector callouts */
    { id: "ct_connector", name: "CT Connector", x: 2350, z: 1000 },
  ],
};
