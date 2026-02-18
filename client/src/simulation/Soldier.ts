/**
 * @file Soldier.ts
 * @description Client-side soldier entity class used in the game simulation.
 * Wraps the static Soldier data (name, stats, weapons) with mutable
 * runtime state (health, position, waypoints, combat status).
 *
 * This class provides convenience methods for querying soldier capabilities
 * (speed, detection, accuracy) by delegating to the StatFormulas module.
 *
 * The ClientSoldier is the primary entity manipulated by the Movement,
 * Detection, and Combat systems during each simulation tick.
 */

import type {
  Soldier,
  SoldierState,
  SoldierStats,
  Stance,
} from "@shared/types/SoldierTypes";
import type { Vec2 } from "@shared/util/MathUtils";

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
 * Client-side soldier entity that combines static data with mutable state.
 * Used by all simulation systems (Movement, Detection, Combat) as the
 * primary unit of gameplay.
 *
 * @example
 * 
 */
export class ClientSoldier {  // --------------------------------------------------------------------------
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

  /** Current armor value (0-100). Absorbs a portion of incoming damage. */
  public armor: number;

  /** Whether the soldier has a helmet (reduces headshot damage) */
  public helmet: boolean;

  /** Array of utility items (grenades, smokes, etc.) the soldier carries */
  public utility: UtilityItem[];

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

  /** Reference to the soldiers base stats (ACC, SPD, AWR, etc.) */
  public readonly stats: SoldierStats;

  /** Reference to the static soldier profile (name, team, weapons) */
  public readonly soldierData: Soldier;

  /** The soldiers primary weapon data */
  public readonly primaryWeapon: Weapon;

  /** The soldiers secondary weapon data */
  public readonly secondaryWeapon: Weapon;
  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  /**
   * Create a new ClientSoldier from static data and initial state.
   *
   * @param soldier - The static soldier profile (name, team, stats, weapons).
   *                   This data never changes during a round.
   * @param initialState - The initial mutable state (position, health, etc.).
   *                       Typically generated at the start of a round.
   */
  constructor(soldier: Soldier, initialState: SoldierState) {
    /* Store reference to the immutable soldier profile */
    this.soldierData = soldier;
    this.stats = soldier.stats;
    this.primaryWeapon = soldier.primaryWeapon;
    this.secondaryWeapon = soldier.secondaryWeapon;

    /* Initialize all mutable state from the provided initial state */
    this.id = initialState.id;
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
  // --------------------------------------------------------------------------

  /**
   * Calculate the soldiers current movement speed in game units per second.
   * Takes into account the SPD stat, currently equipped weapons speed modifier,
   * and whether the soldier is wearing armor.
   *
   * @returns Movement speed in game units per second
   */
  getSpeed(): number {
    /* Look up the current weapons speed modifier */
    const weapon = this.currentWeapon === this.primaryWeapon.id
      ? this.primaryWeapon
      : this.secondaryWeapon;
    const weaponSpeedMod = weapon.speedModifier;

    /* Armor check: soldier has armor if armor value > 0 */
    const hasArmor = this.armor > 0;

    /* Delegate to the shared formula */
    return calculateMovementSpeed(this.stats.SPD, weaponSpeedMod, hasArmor);
  }

  /**
   * Get the soldiers detection radius - how far they can spot enemies.
   * Based on the AWR (awareness) stat.
   *
   * @returns Detection radius in game units
   */
  getDetectionRadius(): number {
    return calculateDetectionRadius(this.stats.AWR);
  }

  /**
   * Get the soldiers stealth modifier - how hard they are to detect.
   * Based on the STL (stealth) stat. Lower = stealthier.
   *
   * @returns Stealth modifier (0.4 to 1.0)
   */
  getStealthMod(): number {
    return calculateStealthModifier(this.stats.STL);
  }

  /**
   * Get the soldiers base hit chance for the first shot.
   * Based on the ACC (accuracy) stat.
   *
   * @returns Base hit probability (0.30 to 0.95)
   */
  getBaseHitChance(): number {
    return calculateBaseHitChance(this.stats.ACC);
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
    /* Reduce health by the damage amount */
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
   * Returns null if the waypoint queue is empty (soldier has nowhere to go).
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
   * Called when the soldier has reached the current waypoint (within
   * the arrival distance threshold).
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
   * Change the soldiers stance. Stance affects movement speed,
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
      id: this.id,
      position: { ...this.position },
      rotation: this.rotation,
      health: this.health,
      alive: this.alive,
      currentWeapon: this.currentWeapon,
      armor: this.armor,
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
