/**
 * @file Utility.ts
 * @description Utility (grenade) system for the tactical simulation.
 *
 * Manages all active utility effects on the map: smokes, flashes, frags,
 * molotovs, and decoys. Each utility type has different area-of-effect
 * behaviour:
 *
 *   SMOKE  — Creates a circular cloud that blocks line-of-sight for 18s.
 *   FLASH  — Blinds soldiers within 400px radius for 2s.
 *   FRAG   — Deals instant area damage (100 max, linear falloff over 200px).
 *   MOLOTOV — Creates a burning zone that deals 25 DPS for 7s.
 *   DECOY  — Produces fake detection pings for 10s within 300px.
 *
 * The system is ticked once per simulation tick (200ms / 5 ticks per second).
 * Effects are created by the throw command and expire based on their duration.
 *
 * Integration points:
 *   - Detection: smokes block LOS, flashes clear detectedEnemies
 *   - Combat: blinded soldiers cannot fire accurately
 *   - Movement: molotov zones deal damage to soldiers standing in them
 */

import { UtilityType } from '@shared/types/WeaponTypes';
import { UTILITY } from '@shared/constants/WeaponData';
import { distance as vecDistance } from '@shared/util/MathUtils';
import type { Position, SoldierRuntimeState } from '../game/GameState';

// ============================================================================
// --- Active Effect Interface ---
// ============================================================================

/**
 * Represents a single active utility effect on the map.
 * Created when a soldier throws a grenade, expires after its duration.
 */
export interface ActiveUtilityEffect {
  /** Unique ID for this effect instance */
  id: string;
  /** Which type of utility this is */
  type: UtilityType;
  /** World position where the effect is centred */
  position: Position;
  /** Effect radius in pixels (from UtilityStats) */
  radius: number;
  /** Time remaining before the effect expires (seconds) */
  timeRemaining: number;
  /** Total duration of the effect (seconds, for calculating progress) */
  totalDuration: number;
  /** ID of the soldier who threw this utility */
  ownerId: string;
  /** Which team owns this effect (1 or 2) */
  ownerTeam: 1 | 2;
  /** Whether this effect has already applied its instant effects (FRAG, FLASH) */
  instantApplied: boolean;
}

// ============================================================================
// --- UtilitySystem Class ---
// ============================================================================

/**
 * Manages all active utility effects in the game world.
 *
 * Lifecycle:
 *   1. `throwUtility()` — Creates a new active effect at the target position
 *   2. `tick()` — Called each simulation tick to update durations and apply effects
 *   3. `isPositionInSmoke()` — Queried by the detection system to check LOS blocks
 *   4. `getActiveEffects()` — Returns all active effects for rendering
 *
 * @example
 * ```ts
 * const utilitySystem = new UtilitySystem();
 * utilitySystem.throwUtility(UtilityType.SMOKE, { x: 500, z: 300 }, 'p1_1', 1);
 * // Each tick:
 * utilitySystem.tick(0.2, allSoldiers);
 * // Detection check:
 * if (utilitySystem.isLOSBlockedBySmoke(posA, posB)) { ... }
 * ```
 */
export class UtilitySystem {
  /** All currently active utility effects */
  private activeEffects: ActiveUtilityEffect[] = [];

  /** Auto-incrementing ID counter for effects */
  private nextId: number = 0;

  // --------------------------------------------------------------------------
  // Throwing Utility
  // --------------------------------------------------------------------------

  /**
   * Create a new active utility effect at the target position.
   *
   * The utility item is removed from the soldier's inventory by the caller
   * (Game.ts) before calling this method. This method only creates the
   * world effect.
   *
   * For instant-effect utilities (FRAG, FLASH), the damage/blind is applied
   * on the first tick after creation via the `instantApplied` flag.
   *
   * @param type - Which utility type to deploy
   * @param position - World position for the effect centre
   * @param ownerId - ID of the soldier who threw it
   * @param ownerTeam - Which team (1 or 2) owns this effect
   * @returns The created effect (for logging/debugging)
   */
  throwUtility(
    type: UtilityType,
    position: Position,
    ownerId: string,
    ownerTeam: 1 | 2
  ): ActiveUtilityEffect {
    const stats = UTILITY[type];

    const effect: ActiveUtilityEffect = {
      id: `util_${this.nextId++}`,
      type,
      position: { ...position },
      radius: stats.radius,
      timeRemaining: stats.duration,
      totalDuration: stats.duration,
      ownerId,
      ownerTeam,
      instantApplied: false,
    };

    this.activeEffects.push(effect);

    console.log(
      `[Utility] ${type} deployed at (${Math.round(position.x)}, ${Math.round(position.z)})` +
      ` by ${ownerId} — radius ${stats.radius}px, duration ${stats.duration}s`
    );

    return effect;
  }

  // --------------------------------------------------------------------------
  // Per-Tick Update
  // --------------------------------------------------------------------------

  /**
   * Update all active utility effects for one simulation tick.
   *
   * This method:
   *   1. Applies instant effects (FRAG damage, FLASH blind) on their first tick
   *   2. Applies continuous effects (MOLOTOV DPS) every tick
   *   3. Counts down timers and removes expired effects
   *
   * @param dt - Time delta for this tick in seconds (typically 0.2)
   * @param allSoldiers - All soldiers from both teams (for area damage/blind)
   */
  tick(dt: number, allSoldiers: SoldierRuntimeState[]): void {
    /** Track indices of effects that have expired and need removal */
    const expiredIndices: number[] = [];

    for (let i = 0; i < this.activeEffects.length; i++) {
      const effect = this.activeEffects[i];

      /* Apply instant effects on the first tick after creation */
      if (!effect.instantApplied) {
        effect.instantApplied = true;

        switch (effect.type) {
          case UtilityType.FRAG:
            this.applyFragDamage(effect, allSoldiers);
            break;

          case UtilityType.FLASH:
            this.applyFlashBlind(effect, allSoldiers);
            break;

          default:
            /* SMOKE, MOLOTOV, DECOY have no instant effect */
            break;
        }
      }

      /* Apply continuous effects (MOLOTOV deals DPS every tick) */
      if (effect.type === UtilityType.MOLOTOV) {
        this.applyMolotovDamage(effect, dt, allSoldiers);
      }

      /* Count down the timer */
      effect.timeRemaining -= dt;

      /* Mark expired effects for removal */
      if (effect.timeRemaining <= 0) {
        expiredIndices.push(i);
      }
    }

    /* Remove expired effects (iterate backwards to preserve indices) */
    for (let i = expiredIndices.length - 1; i >= 0; i--) {
      const idx = expiredIndices[i];
      const removed = this.activeEffects[idx];
      console.log(`[Utility] ${removed.type} at (${Math.round(removed.position.x)}, ${Math.round(removed.position.z)}) expired`);
      this.activeEffects.splice(idx, 1);
    }
  }

  // --------------------------------------------------------------------------
  // FRAG — Instant Area Damage
  // --------------------------------------------------------------------------

  /**
   * Apply fragmentation grenade damage to all soldiers in the blast radius.
   *
   * Damage formula: maxDamage * (1 - distance/radius)
   *   - At centre (distance=0): full 100 damage
   *   - At edge (distance=radius): 0 damage
   *   - Linear falloff between centre and edge
   *
   * Frags damage ALL soldiers (friendly fire is on), but the thrower
   * takes 50% reduced self-damage.
   *
   * @param effect - The active frag effect
   * @param allSoldiers - All soldiers to check for blast damage
   */
  private applyFragDamage(
    effect: ActiveUtilityEffect,
    allSoldiers: SoldierRuntimeState[]
  ): void {
    const maxDamage = UTILITY[UtilityType.FRAG].damage;

    for (const soldier of allSoldiers) {
      if (!soldier.alive) continue;

      const dist = vecDistance(soldier.position, effect.position);

      /* Only damage soldiers within the blast radius */
      if (dist > effect.radius) continue;

      /* Linear falloff: full damage at centre, zero at edge */
      let damage = maxDamage * (1 - dist / effect.radius);

      /* Self-damage reduction: 50% less damage to the thrower */
      if (soldier.soldierId === effect.ownerId) {
        damage *= 0.5;
      }

      /* Apply damage */
      soldier.health -= damage;

      /* Check for kill */
      if (soldier.health <= 0) {
        soldier.health = 0;
        soldier.alive = false;
        soldier.isMoving = false;
        soldier.isInCombat = false;
        soldier.currentTarget = null;
        soldier.waypoints = [];
        soldier.detectedEnemies = [];
      }

      console.log(
        `[Utility] FRAG hit ${soldier.soldierId} for ${damage.toFixed(1)} damage` +
        ` (dist: ${dist.toFixed(0)}px)${soldier.alive ? '' : ' — KILLED'}`
      );
    }
  }

  // --------------------------------------------------------------------------
  // FLASH — Blind Effect
  // --------------------------------------------------------------------------

  /**
   * Apply flash grenade blind effect to all soldiers in the flash radius.
   *
   * Soldiers within the radius are blinded for the flash duration (2s).
   * Blinded soldiers:
   *   - Cannot detect enemies (detectedEnemies is cleared)
   *   - Have severely reduced accuracy (handled in combat resolution)
   *   - Are set to isBlinded=true with a blindedUntilTick timestamp
   *
   * Flash grenades affect ALL soldiers (including teammates) but the
   * thrower is immune to their own flash.
   *
   * @param effect - The active flash effect
   * @param allSoldiers - All soldiers to check for flash blind
   */
  private applyFlashBlind(
    effect: ActiveUtilityEffect,
    allSoldiers: SoldierRuntimeState[]
  ): void {
    const flashDuration = UTILITY[UtilityType.FLASH].duration;

    for (const soldier of allSoldiers) {
      if (!soldier.alive) continue;

      /* Thrower is immune to their own flash */
      if (soldier.soldierId === effect.ownerId) continue;

      const dist = vecDistance(soldier.position, effect.position);

      /* Only blind soldiers within the flash radius */
      if (dist > effect.radius) continue;

      /**
       * Flash intensity scales with distance — closer = longer blind.
       * At centre: full duration. At edge: 50% duration.
       */
      const intensity = 0.5 + 0.5 * (1 - dist / effect.radius);
      const blindDuration = flashDuration * intensity;

      /* Apply the blind effect */
      soldier.isBlinded = true;
      soldier.blindedTimer = blindDuration;

      /* Clear detected enemies — can't see anything while blinded */
      soldier.detectedEnemies = [];

      console.log(
        `[Utility] FLASH blinded ${soldier.soldierId} for ${blindDuration.toFixed(1)}s` +
        ` (dist: ${dist.toFixed(0)}px)`
      );
    }
  }

  // --------------------------------------------------------------------------
  // MOLOTOV — Continuous Area Damage
  // --------------------------------------------------------------------------

  /**
   * Apply molotov damage to all soldiers standing in the fire zone.
   *
   * Deals DPS (damage per second) scaled by the tick delta time.
   * Damage is flat within the radius — no distance falloff for molotov.
   *
   * Molotovs damage ALL soldiers (including teammates).
   *
   * @param effect - The active molotov effect
   * @param dt - Time delta for this tick (seconds)
   * @param allSoldiers - All soldiers to check for fire damage
   */
  private applyMolotovDamage(
    effect: ActiveUtilityEffect,
    dt: number,
    allSoldiers: SoldierRuntimeState[]
  ): void {
    const dps = UTILITY[UtilityType.MOLOTOV].damage;

    for (const soldier of allSoldiers) {
      if (!soldier.alive) continue;

      const dist = vecDistance(soldier.position, effect.position);

      /* Only damage soldiers inside the fire zone */
      if (dist > effect.radius) continue;

      /* Apply DPS scaled by tick time */
      const damage = dps * dt;
      soldier.health -= damage;

      /* Check for kill */
      if (soldier.health <= 0) {
        soldier.health = 0;
        soldier.alive = false;
        soldier.isMoving = false;
        soldier.isInCombat = false;
        soldier.currentTarget = null;
        soldier.waypoints = [];
        soldier.detectedEnemies = [];

        console.log(
          `[Utility] MOLOTOV killed ${soldier.soldierId} (fire damage)`
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // Smoke LOS Blocking
  // --------------------------------------------------------------------------

  /**
   * Check if a line of sight between two positions is blocked by any smoke.
   *
   * Tests whether the line segment from `from` to `to` passes through any
   * active smoke cloud. We approximate this by checking if the smoke centre
   * is close enough to the line segment between the two positions.
   *
   * The check works by finding the closest point on the line segment to the
   * smoke centre, then comparing that distance to the smoke radius.
   *
   * @param from - Start position of the LOS ray
   * @param to - End position of the LOS ray
   * @returns True if any active smoke blocks the line of sight
   */
  isLOSBlockedBySmoke(from: Position, to: Position): boolean {
    for (const effect of this.activeEffects) {
      /* Only smokes block LOS */
      if (effect.type !== UtilityType.SMOKE) continue;

      /* Find closest point on the line segment to the smoke centre */
      const closestDist = this.pointToSegmentDistance(
        effect.position,
        from,
        to
      );

      /**
       * If the closest point on the LOS line is within the smoke radius,
       * the smoke blocks line of sight.
       */
      if (closestDist < effect.radius) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a specific position is inside any active smoke cloud.
   * Used for determining if a soldier is standing in smoke (reduced vision).
   *
   * @param pos - The world position to check
   * @returns True if the position is inside any active smoke
   */
  isPositionInSmoke(pos: Position): boolean {
    for (const effect of this.activeEffects) {
      if (effect.type !== UtilityType.SMOKE) continue;

      const dist = vecDistance(pos, effect.position);
      if (dist <= effect.radius) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a specific position is inside any active molotov fire zone.
   * Used for AI decision-making (avoid fire).
   *
   * @param pos - The world position to check
   * @returns True if the position is inside any active molotov
   */
  isPositionInFire(pos: Position): boolean {
    for (const effect of this.activeEffects) {
      if (effect.type !== UtilityType.MOLOTOV) continue;

      const dist = vecDistance(pos, effect.position);
      if (dist <= effect.radius) {
        return true;
      }
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // Blind Timer Management
  // --------------------------------------------------------------------------

  /**
   * Tick down blind timers on all soldiers.
   * Called once per simulation tick. When a soldier's blind timer reaches 0,
   * their blind effect is cleared.
   *
   * @param dt - Time delta for this tick (seconds)
   * @param allSoldiers - All soldiers to update blind timers for
   */
  tickBlindTimers(dt: number, allSoldiers: SoldierRuntimeState[]): void {
    for (const soldier of allSoldiers) {
      if (!soldier.isBlinded) continue;

      soldier.blindedTimer -= dt;

      if (soldier.blindedTimer <= 0) {
        soldier.isBlinded = false;
        soldier.blindedTimer = 0;
        console.log(`[Utility] ${soldier.soldierId} is no longer blinded`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Decoy Detection Pings
  // --------------------------------------------------------------------------

  /**
   * Get all active decoy positions.
   * Used by the AI to generate "fake detection" pings — the AI may react
   * to decoys as if they are real threats.
   *
   * @returns Array of decoy effect positions and their remaining durations
   */
  getActiveDecoys(): { position: Position; radius: number; ownerTeam: 1 | 2 }[] {
    return this.activeEffects
      .filter(e => e.type === UtilityType.DECOY)
      .map(e => ({
        position: { ...e.position },
        radius: e.radius,
        ownerTeam: e.ownerTeam,
      }));
  }

  // --------------------------------------------------------------------------
  // Public Accessors
  // --------------------------------------------------------------------------

  /**
   * Get all currently active utility effects.
   * Used by the renderer to draw smoke clouds, fire zones, etc.
   *
   * @returns Read-only array of all active effects
   */
  getActiveEffects(): readonly ActiveUtilityEffect[] {
    return this.activeEffects;
  }

  /**
   * Get active effects of a specific type.
   *
   * @param type - The utility type to filter by
   * @returns Array of active effects matching the given type
   */
  getEffectsByType(type: UtilityType): ActiveUtilityEffect[] {
    return this.activeEffects.filter(e => e.type === type);
  }

  /**
   * Remove all active effects. Called at round end to clean up.
   */
  clearAll(): void {
    this.activeEffects = [];
    this.nextId = 0;
  }

  // --------------------------------------------------------------------------
  // Geometry Helpers
  // --------------------------------------------------------------------------

  /**
   * Calculate the shortest distance from a point to a line segment.
   *
   * Used for smoke LOS blocking — checks how close the smoke centre
   * is to the line of sight between two soldiers.
   *
   * Algorithm: project the point onto the line, clamp the projection
   * parameter to [0,1] to stay on the segment, then return the distance
   * from the point to the clamped projection.
   *
   * @param point - The point to measure from (smoke centre)
   * @param segStart - Start of the line segment (observer position)
   * @param segEnd - End of the line segment (target position)
   * @returns Distance in pixels from the point to the nearest point on the segment
   */
  private pointToSegmentDistance(
    point: Position,
    segStart: Position,
    segEnd: Position
  ): number {
    const dx = segEnd.x - segStart.x;
    const dz = segEnd.z - segStart.z;
    const segLengthSq = dx * dx + dz * dz;

    /* Degenerate case: segment has zero length (start === end) */
    if (segLengthSq === 0) {
      return vecDistance(point, segStart);
    }

    /**
     * Project the point onto the infinite line defined by the segment.
     * t is the parameter: 0 = segStart, 1 = segEnd.
     * Clamping t to [0,1] constrains to the actual segment.
     */
    const t = Math.max(0, Math.min(1,
      ((point.x - segStart.x) * dx + (point.z - segStart.z) * dz) / segLengthSq
    ));

    /* Calculate the closest point on the segment */
    const closestX = segStart.x + t * dx;
    const closestZ = segStart.z + t * dz;

    /* Return distance from point to closest point on segment */
    const distX = point.x - closestX;
    const distZ = point.z - closestZ;
    return Math.sqrt(distX * distX + distZ * distZ);
  }
}
