/**
 * @file Soldier.ts
 * @description Client-side soldier entity class for potential future use.
 *
 * NOTE: This class is NOT currently used in the main game loop.
 * The Game.ts simulation tick operates directly on SoldierRuntimeState
 * objects from GameState.ts, which carry RuntimeStats (abbreviated names).
 *
 * This file wraps the persistent Soldier data (from shared/types/SoldierTypes)
 * with mutable state. It will be useful when:
 *   - Server-side simulation needs a soldier entity class
 *   - The roster/meta-game system is implemented (persistent soldier profiles)
 *
 * The shared SoldierStats interface uses full names:
 *   accuracy, reactionTime, movementSpeed, stealth, awareness,
 *   recoilControl, composure, utilityUsage, clutchFactor, teamwork
 */

import type {
  Soldier,
  SoldierState,
  SoldierStats,
  Stance,
} from "@shared/types/SoldierTypes";
import type { Vec2 } from "@shared/util/MathUtils";
import type { UtilityType } from "@shared/types/WeaponTypes";

import {
  calculateMovementSpeed,
  calculateDetectionRadius,
  calculateStealthModifier,
  calculateBaseHitChance,
} from "@shared/constants/StatFormulas";

// ============================================================================
// --- ClientSoldier Class ---
// ============================================================================

/**
 * Client-side soldier entity that combines static profile data with mutable
 * runtime state. Uses the shared SoldierStats interface (full stat names).
 *
 * NOTE: Not currently wired into the main game loop. See file header.
 */
export class ClientSoldier {
  // --------------------------------------------------------------------------
  // Properties - matching SoldierState interface fields
  // --------------------------------------------------------------------------

  /** Unique identifier for this soldier */
  public readonly id: string;

  /** Current world position (x, z) in the top-down plane */
  public position: Vec2;

  /** Current facing direction in radians (0 = right, PI/2 = down) */
  public rotation: number;

  /** Current health points (0-100). At 0 the soldier is dead. */
  public health: number;

  /** Whether this soldier is still alive */
  public alive: boolean;

  /** ID of the currently equipped weapon */
  public currentWeapon: string;

  /** Current armor type (null if unarmored) */
  public armor: string | null;

  /** Whether the soldier has a helmet (reduces headshot damage) */
  public helmet: boolean;

  /** Array of utility items (grenades, smokes, etc.) the soldier carries */
  public utility: UtilityType[];

  /** Current stance affecting speed, accuracy, and visibility */
  public stance: Stance;

  /** Whether the soldier is currently in motion */
  public isMoving: boolean;

  /** Whether the soldier is currently engaged in combat */
  public isInCombat: boolean;

  /** ID of the current target being aimed at (null if none) */
  public currentTarget: string | null;

  /** Queue of waypoints the soldier is moving through */
  public waypoints: Vec2[];

  /** Whether the soldier has a defuse kit (CT only, faster bomb defuse) */
  public defuseKit: boolean;

  // --------------------------------------------------------------------------
  // Static data references (do not change during a round)
  // --------------------------------------------------------------------------

  /** Reference to the soldier's base stats (full names: accuracy, reactionTime, etc.) */
  public readonly stats: SoldierStats;

  /** Reference to the static soldier profile (name, team, weapons) */
  public readonly soldierData: Soldier;

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  /**
   * Create a new ClientSoldier from static profile data and initial state.
   *
   * @param soldier - The static soldier profile (name, team, stats).
   *                   This data never changes during a round.
   * @param initialState - The initial mutable state (position, health, etc.).
   *                       Typically generated at the start of a round.
   */
  constructor(soldier: Soldier, initialState: SoldierState) {
    /* Store reference to the immutable soldier profile */
    this.soldierData = soldier;
    this.stats = soldier.stats;

    /* Initialize all mutable state from the provided initial state */
    this.id = initialState.soldierId;
    this.position = { ...initialState.position };  /* Clone to avoid shared reference */
    this.rotation = initialState.rotation;
    this.health = initialState.health;
    this.alive = initialState.alive;
    this.currentWeapon = initialState.currentWeapon;
    this.armor = initialState.armor;
    this.helmet = initialState.helmet;
    this.utility = [...initialState.utility];       /* Shallow clone the array */
    this.stance = initialState.stance;
    this.isMoving = initialState.isMoving;
    this.isInCombat = initialState.isInCombat;
    this.currentTarget = initialState.currentTarget;
    this.waypoints = initialState.waypoints.map(wp => ({ ...wp })); /* Deep clone waypoints */
    this.defuseKit = initialState.defuseKit;
  }

  // --------------------------------------------------------------------------
  // Stat Query Methods
  // Delegate to StatFormulas for actual calculations.
  // These use the full stat names from the shared SoldierStats interface.
  // --------------------------------------------------------------------------

  /**
   * Calculate the soldier's current movement speed in game units per second.
   * Uses the movementSpeed stat, weapon speed modifier, and armor penalty.
   *
   * @param weaponSpeedMod - The current weapon's speed modifier (from WeaponData)
   * @param armorPenalty - Armor speed penalty multiplier (1.0 if no armor)
   * @returns Movement speed in game units per second
   */
  getSpeed(weaponSpeedMod: number = 0.95, armorPenalty: number = 1.0): number {
    return calculateMovementSpeed(this.stats.movementSpeed, weaponSpeedMod, armorPenalty);
  }

  /**
   * Get the soldier's detection radius based on the awareness stat.
   *
   * @returns Detection radius in game units
   */
  getDetectionRadius(): number {
    return calculateDetectionRadius(this.stats.awareness);
  }

  /**
   * Get the soldier's stealth modifier based on the stealth stat.
   * Lower = stealthier (harder to detect).
   *
   * @returns Stealth modifier (0.5 to 1.0)
   */
  getStealthMod(): number {
    return calculateStealthModifier(this.stats.stealth);
  }

  /**
   * Get the soldier's base hit chance based on the accuracy stat.
   *
   * @returns Base hit probability (0.157 to 0.85)
   */
  getBaseHitChance(): number {
    return calculateBaseHitChance(this.stats.accuracy);
  }

  // --------------------------------------------------------------------------
  // State Query Methods
  // --------------------------------------------------------------------------

  /**
   * Check if this soldier is still alive.
   * A soldier dies when health reaches 0 or below.
   *
   * @returns True if the soldier is alive
   */
  isAlive(): boolean {
    return this.alive && this.health > 0;
  }

  // --------------------------------------------------------------------------
  // Health / Damage Methods
  // --------------------------------------------------------------------------

  /**
   * Apply damage to this soldier, reducing health.
   * If health drops to 0 or below, the soldier is marked as dead.
   *
   * @param amount - The amount of health damage to apply (positive number)
   */
  takeDamage(amount: number): void {
    this.health -= amount;

    /* Clamp health to minimum of 0 */
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.isMoving = false;
      this.isInCombat = false;
      this.currentTarget = null;
      this.waypoints = [];
    }
  }

  // --------------------------------------------------------------------------
  // Waypoint / Movement Methods
  // --------------------------------------------------------------------------

  /**
   * Get the next waypoint the soldier should move toward.
   * Returns null if the waypoint queue is empty.
   *
   * @returns The next waypoint position, or null if no waypoints remain
   */
  getCurrentWaypoint(): Vec2 | null {
    if (this.waypoints.length === 0) {
      return null;
    }
    return this.waypoints[0];
  }

  /**
   * Remove the first waypoint from the queue, advancing to the next one.
   */
  advanceWaypoint(): void {
    if (this.waypoints.length > 0) {
      this.waypoints.shift();
    }
  }

  /**
   * Check whether the soldier has any remaining waypoints to move to.
   *
   * @returns True if there are waypoints in the queue
   */
  hasWaypoints(): boolean {
    return this.waypoints.length > 0;
  }

  // --------------------------------------------------------------------------
  // Stance Methods
  // --------------------------------------------------------------------------

  /**
   * Change the soldier's stance. Stance affects movement speed,
   * accuracy, and how visible the soldier is to enemies.
   *
   * @param newStance - The stance to switch to
   */
  setStance(newStance: Stance): void {
    this.stance = newStance;
  }

  // --------------------------------------------------------------------------
  // Serialization
  // --------------------------------------------------------------------------

  /**
   * Serialize the current mutable state into a SoldierState object.
   * Used for network transmission, replay recording, and state snapshots.
   *
   * @returns A plain SoldierState object representing current state
   */
  toState(): SoldierState {
    return {
      soldierId: this.id,
      position: { ...this.position },
      rotation: this.rotation,
      health: this.health,
      alive: this.alive,
      currentWeapon: this.currentWeapon as any,
      armor: this.armor as any,
      helmet: this.helmet,
      utility: [...this.utility],
      stance: this.stance,
      isMoving: this.isMoving,
      isInCombat: this.isInCombat,
      currentTarget: this.currentTarget,
      waypoints: this.waypoints.map(wp => ({ ...wp })),
      defuseKit: this.defuseKit,
    };
  }
}
