/**
 * @file BombLogic.ts
 * @description Bomb plant and defuse simulation logic for the tactical game.
 *
 * Handles the core bomb mechanics:
 *   - Plant: Attacker with bomb stands in a plant zone and holds the plant key
 *     for TIMING.plantSeconds (3s). Progress is tracked per-tick.
 *   - Defuse: Defender stands near the planted bomb and holds the defuse key.
 *     Takes TIMING.defuseSeconds (5s) without kit, or TIMING.defuseWithKitSeconds (3s) with kit.
 *   - Phase Transition: When bomb is planted, game enters POST_PLANT phase with
 *     a 40-second timer before detonation.
 *
 * The BombLogic class is stateless — it provides pure helper functions that
 * the Game.ts orchestrator calls during simulation ticks.
 *
 * Integration points:
 *   - Game.ts calls `isInPlantZone()` to check if a soldier can plant
 *   - Game.ts calls `isInDefuseRange()` to check if a soldier can defuse
 *   - Plant/defuse progress is tracked on `SoldierRuntimeState.actionProgress`
 *   - Phase transition is handled by Game.ts when plant/defuse completes
 */

import { TIMING } from '@shared/constants/GameConstants';
import type { BombSite, Zone } from '@shared/types/MapTypes';
import type { Position } from '../game/GameState';

// ============================================================================
// --- Constants ---
// ============================================================================

/**
 * How close a defender must be to the planted bomb to begin defusing (in pixels).
 * Defenders must be within this radius of the bomb position to defuse.
 */
const DEFUSE_RANGE = 50;

// ============================================================================
// --- BombLogic Class ---
// ============================================================================

/**
 * Provides bomb plant/defuse logic functions for the simulation.
 *
 * This class holds references to the map's bomb sites and provides
 * methods to check zone membership, calculate progress, and determine
 * when plant/defuse actions complete.
 *
 * @example
 * ```ts
 * const bombLogic = new BombLogic(mapData.bombSites);
 * if (bombLogic.isInPlantZone(soldier.position)) {
 *   soldier.isPlanting = true;
 *   soldier.actionProgress += dt;
 *   if (bombLogic.isPlantComplete(soldier.actionProgress)) { ... }
 * }
 * ```
 */
export class BombLogic {
  /** The bomb sites on the current map */
  private bombSites: BombSite[];

  /**
   * Create a BombLogic instance for the given map.
   * @param bombSites - Array of bomb sites from the map data
   */
  constructor(bombSites: BombSite[]) {
    this.bombSites = bombSites;
  }

  // --------------------------------------------------------------------------
  // Zone Checks
  // --------------------------------------------------------------------------

  /**
   * Check if a position is inside any bomb site's plant zone.
   *
   * The plant zone is the smaller inner area within each bomb site where
   * the bomb can actually be planted. An attacker must be standing inside
   * this zone to begin planting.
   *
   * @param pos - The world position to check
   * @returns The bomb site ID ('A' or 'B') if inside a plant zone, or null
   */
  isInPlantZone(pos: Position): string | null {
    for (const site of this.bombSites) {
      if (this.isPointInZone(pos, site.plantZone)) {
        return site.id;
      }
    }
    return null;
  }

  /**
   * Check if a position is inside any bomb site's general zone.
   *
   * The general zone is the larger area that encompasses the entire bomb site.
   * Used for UI indicators and determining if soldiers are "on site".
   *
   * @param pos - The world position to check
   * @returns The bomb site ID ('A' or 'B') if inside a site zone, or null
   */
  isOnBombSite(pos: Position): string | null {
    for (const site of this.bombSites) {
      if (this.isPointInZone(pos, site.zone)) {
        return site.id;
      }
    }
    return null;
  }

  /**
   * Check if a position is within defuse range of a planted bomb.
   *
   * The defender must be within DEFUSE_RANGE (50px) of the bomb position
   * to begin defusing. This is a circular range check.
   *
   * @param soldierPos - The defender's current position
   * @param bombPos - The position of the planted bomb
   * @returns True if the soldier is close enough to defuse
   */
  isInDefuseRange(soldierPos: Position, bombPos: Position): boolean {
    const dx = soldierPos.x - bombPos.x;
    const dz = soldierPos.z - bombPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return dist <= DEFUSE_RANGE;
  }

  // --------------------------------------------------------------------------
  // Progress Checks
  // --------------------------------------------------------------------------

  /**
   * Check if the bomb plant action is complete.
   *
   * Plant takes TIMING.plantSeconds (3s). The caller accumulates
   * `actionProgress` each tick by adding `dt`.
   *
   * @param actionProgress - Accumulated progress in seconds
   * @returns True if the plant is complete
   */
  isPlantComplete(actionProgress: number): boolean {
    return actionProgress >= TIMING.plantSeconds;
  }

  /**
   * Check if the bomb defuse action is complete.
   *
   * Defuse takes TIMING.defuseSeconds (5s) without a kit, or
   * TIMING.defuseWithKitSeconds (3s) with a defuse kit.
   *
   * @param actionProgress - Accumulated progress in seconds
   * @param hasKit - Whether the defusing soldier has a defuse kit
   * @returns True if the defuse is complete
   */
  isDefuseComplete(actionProgress: number, hasKit: boolean): boolean {
    const required = hasKit
      ? TIMING.defuseWithKitSeconds
      : TIMING.defuseSeconds;
    return actionProgress >= required;
  }

  /**
   * Get the required time for a defuse action.
   *
   * @param hasKit - Whether the soldier has a defuse kit
   * @returns Time required in seconds (3s with kit, 5s without)
   */
  getDefuseTime(hasKit: boolean): number {
    return hasKit
      ? TIMING.defuseWithKitSeconds
      : TIMING.defuseSeconds;
  }

  /**
   * Get the required time for a plant action.
   * @returns Time required in seconds (always 3s)
   */
  getPlantTime(): number {
    return TIMING.plantSeconds;
  }

  /**
   * Get the bomb site data by ID.
   *
   * @param siteId - The bomb site ID ('A' or 'B')
   * @returns The BombSite data, or undefined if not found
   */
  getBombSite(siteId: string): BombSite | undefined {
    return this.bombSites.find(s => s.id === siteId);
  }

  /**
   * Get all bomb sites.
   * @returns Array of all bomb sites on the map
   */
  getAllBombSites(): BombSite[] {
    return this.bombSites;
  }

  // --------------------------------------------------------------------------
  // Geometry Helper
  // --------------------------------------------------------------------------

  /**
   * Check if a point is inside an axis-aligned rectangular zone.
   *
   * The zone is defined by its top-left corner (x, z) and size (width, height).
   * The point is inside if:
   *   x >= zone.x AND x <= zone.x + zone.width
   *   z >= zone.z AND z <= zone.z + zone.height
   *
   * @param pos - The point to check
   * @param zone - The rectangular zone to check against
   * @returns True if the point is inside the zone
   */
  private isPointInZone(pos: Position, zone: Zone): boolean {
    return (
      pos.x >= zone.x &&
      pos.x <= zone.x + zone.width &&
      pos.z >= zone.z &&
      pos.z <= zone.z + zone.height
    );
  }
}
