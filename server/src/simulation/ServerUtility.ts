/**
 * @file ServerUtility.ts
 * @description Server-side utility (grenade) system.
 *
 * Manages all active utility effects on the map: smokes, flashes, frags,
 * molotovs, and decoys. This mirrors the client's UtilitySystem
 * (client/src/simulation/Utility.ts) but is self-contained for the server.
 *
 * Utility types and their effects:
 *   SMOKE  — Blocks line-of-sight within 150px radius for 18s
 *   FLASH  — Blinds soldiers within 400px radius for up to 2s
 *   FRAG   — Instant area damage (100 max, linear falloff over 200px)
 *   MOLOTOV — Continuous DPS (25/s) within 120px radius for 7s
 *   DECOY  — Fake detection pings within 300px for 10s
 *
 * Integration points in ServerSimulation:
 *   - Detection: smokes block LOS
 *   - Combat: blinded soldiers can't fire
 *   - Movement: molotov zones deal damage to soldiers standing in them
 */

// ============================================================================
// --- Types ---
// ============================================================================

/** 2D position in the game world */
interface Position {
  x: number;
  z: number;
}

/**
 * Minimal soldier interface for the utility system.
 * Only the fields needed for applying utility effects.
 */
interface UtilitySoldierState {
  soldierId: string;
  position: Position;
  health: number;
  alive: boolean;
  isBlinded: boolean;
  blindedTimer: number;
  isMoving: boolean;
  isInCombat: boolean;
  currentTarget: string | null;
  waypoints: Position[];
  detectedEnemies: string[];
}

/** Active utility effect on the map */
export interface ActiveUtilityEffect {
  /** Unique ID for this effect instance */
  id: string;
  /** Which type of utility this is */
  type: string;
  /** World position where the effect is centred */
  position: Position;
  /** Effect radius in pixels */
  radius: number;
  /** Time remaining before the effect expires (seconds) */
  timeRemaining: number;
  /** Total duration of the effect (seconds) */
  totalDuration: number;
  /** ID of the soldier who threw this utility */
  ownerId: string;
  /** Which team owns this effect (1 or 2) */
  ownerTeam: 1 | 2;
  /** Whether instant effects have been applied (FRAG, FLASH) */
  instantApplied: boolean;
}

// ============================================================================
// --- Utility Stats (matches shared/constants/WeaponData.ts UTILITY table) ---
// ============================================================================

/**
 * Hardcoded utility stats matching the shared WeaponData.ts.
 * Using local constants to avoid import path issues between server and shared.
 */
const UTILITY_STATS: Record<string, { duration: number; radius: number; damage: number }> = {
  SMOKE:   { duration: 18, radius: 150, damage: 0 },
  FLASH:   { duration: 2,  radius: 400, damage: 0 },
  FRAG:    { duration: 0,  radius: 200, damage: 100 },
  MOLOTOV: { duration: 7,  radius: 120, damage: 25 },
  DECOY:   { duration: 10, radius: 300, damage: 0 },
};

// ============================================================================
// --- ServerUtilitySystem Class ---
// ============================================================================

/**
 * Manages all active utility effects in the server simulation.
 *
 * Lifecycle:
 *   1. `throwUtility()` — Creates a new active effect at the target position
 *   2. `tick()` — Called each simulation tick to update durations and apply effects
 *   3. `isLOSBlockedBySmoke()` — Queried by detection system to check LOS blocks
 *   4. `clearAll()` — Clears all effects at round end
 */
export class ServerUtilitySystem {
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
   * @param type - Utility type string ('SMOKE', 'FLASH', 'FRAG', 'MOLOTOV', 'DECOY')
   * @param position - World position for the effect centre
   * @param ownerId - ID of the soldier who threw it
   * @param ownerTeam - Which team (1 or 2) owns this effect
   * @returns The created effect
   */
  throwUtility(
    type: string,
    position: Position,
    ownerId: string,
    ownerTeam: 1 | 2
  ): ActiveUtilityEffect {
    const stats = UTILITY_STATS[type] ?? UTILITY_STATS.SMOKE;

    const effect: ActiveUtilityEffect = {
      id: `util_${this.nextId++}`,
      type,
      position: { ...position },
      radius: stats.radius,
      timeRemaining: stats.duration > 0 ? stats.duration : 0.2, /* FRAG gets 1 tick */
      totalDuration: stats.duration > 0 ? stats.duration : 0.2,
      ownerId,
      ownerTeam,
      instantApplied: false,
    };

    this.activeEffects.push(effect);
    return effect;
  }

  // --------------------------------------------------------------------------
  // Per-Tick Update
  // --------------------------------------------------------------------------

  /**
   * Update all active utility effects for one simulation tick.
   *
   * Applies:
   *   - FRAG instant area damage on first tick
   *   - FLASH instant blind on first tick
   *   - MOLOTOV continuous DPS each tick
   *   - Timer countdown and expiration
   *
   * @param dt - Time delta for this tick in seconds (typically 0.2)
   * @param allSoldiers - All soldiers from both teams
   */
  tick(dt: number, allSoldiers: UtilitySoldierState[]): void {
    const expiredIndices: number[] = [];

    for (let i = 0; i < this.activeEffects.length; i++) {
      const effect = this.activeEffects[i];

      /* Apply instant effects on the first tick after creation */
      if (!effect.instantApplied) {
        effect.instantApplied = true;

        if (effect.type === 'FRAG') {
          this.applyFragDamage(effect, allSoldiers);
        } else if (effect.type === 'FLASH') {
          this.applyFlashBlind(effect, allSoldiers);
        }
      }

      /* Apply continuous MOLOTOV damage every tick */
      if (effect.type === 'MOLOTOV') {
        this.applyMolotovDamage(effect, dt, allSoldiers);
      }

      /* Count down the timer */
      effect.timeRemaining -= dt;

      if (effect.timeRemaining <= 0) {
        expiredIndices.push(i);
      }
    }

    /* Remove expired effects (iterate backwards to preserve indices) */
    for (let i = expiredIndices.length - 1; i >= 0; i--) {
      this.activeEffects.splice(expiredIndices[i], 1);
    }
  }

  // --------------------------------------------------------------------------
  // FRAG — Instant Area Damage
  // --------------------------------------------------------------------------

  /**
   * Apply fragmentation grenade damage to all soldiers in the blast radius.
   * Damage = maxDamage * (1 - distance/radius), linear falloff.
   * Self-damage is reduced by 50%.
   */
  private applyFragDamage(
    effect: ActiveUtilityEffect,
    allSoldiers: UtilitySoldierState[]
  ): void {
    const maxDamage = UTILITY_STATS.FRAG.damage;

    for (const soldier of allSoldiers) {
      if (!soldier.alive) continue;

      const dist = this.dist(soldier.position, effect.position);
      if (dist > effect.radius) continue;

      let damage = maxDamage * (1 - dist / effect.radius);

      /* Thrower takes 50% reduced self-damage */
      if (soldier.soldierId === effect.ownerId) {
        damage *= 0.5;
      }

      soldier.health -= damage;

      if (soldier.health <= 0) {
        soldier.health = 0;
        soldier.alive = false;
        soldier.isMoving = false;
        soldier.isInCombat = false;
        soldier.currentTarget = null;
        soldier.waypoints = [];
        soldier.detectedEnemies = [];
      }
    }
  }

  // --------------------------------------------------------------------------
  // FLASH — Blind Effect
  // --------------------------------------------------------------------------

  /**
   * Apply flash grenade blind effect to soldiers within the flash radius.
   * Blind intensity scales with distance (closer = longer blind).
   * Thrower is immune to their own flash.
   */
  private applyFlashBlind(
    effect: ActiveUtilityEffect,
    allSoldiers: UtilitySoldierState[]
  ): void {
    const flashDuration = UTILITY_STATS.FLASH.duration;

    for (const soldier of allSoldiers) {
      if (!soldier.alive) continue;
      if (soldier.soldierId === effect.ownerId) continue; /* Thrower immune */

      const dist = this.dist(soldier.position, effect.position);
      if (dist > effect.radius) continue;

      /* Intensity scales: 100% at centre, 50% at edge */
      const intensity = 0.5 + 0.5 * (1 - dist / effect.radius);
      const blindDuration = flashDuration * intensity;

      soldier.isBlinded = true;
      soldier.blindedTimer = blindDuration;
      soldier.detectedEnemies = [];
    }
  }

  // --------------------------------------------------------------------------
  // MOLOTOV — Continuous Area Damage
  // --------------------------------------------------------------------------

  /**
   * Apply molotov fire damage to soldiers standing in the fire zone.
   * Deals DPS * dt damage each tick. Affects all soldiers (including teammates).
   */
  private applyMolotovDamage(
    effect: ActiveUtilityEffect,
    dt: number,
    allSoldiers: UtilitySoldierState[]
  ): void {
    const dps = UTILITY_STATS.MOLOTOV.damage;

    for (const soldier of allSoldiers) {
      if (!soldier.alive) continue;

      const dist = this.dist(soldier.position, effect.position);
      if (dist > effect.radius) continue;

      const damage = dps * dt;
      soldier.health -= damage;

      if (soldier.health <= 0) {
        soldier.health = 0;
        soldier.alive = false;
        soldier.isMoving = false;
        soldier.isInCombat = false;
        soldier.currentTarget = null;
        soldier.waypoints = [];
        soldier.detectedEnemies = [];
      }
    }
  }

  // --------------------------------------------------------------------------
  // Smoke LOS Blocking
  // --------------------------------------------------------------------------

  /**
   * Check if a line of sight between two positions is blocked by any smoke.
   * Uses point-to-segment distance to test if smoke centre is close to the LOS line.
   *
   * @param from - Start position of the LOS ray
   * @param to - End position of the LOS ray
   * @returns True if any active smoke blocks the line of sight
   */
  isLOSBlockedBySmoke(from: Position, to: Position): boolean {
    for (const effect of this.activeEffects) {
      if (effect.type !== 'SMOKE') continue;

      const closestDist = this.pointToSegmentDistance(effect.position, from, to);
      if (closestDist < effect.radius) {
        return true;
      }
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Public Accessors
  // --------------------------------------------------------------------------

  /** Get all currently active utility effects. */
  getActiveEffects(): readonly ActiveUtilityEffect[] {
    return this.activeEffects;
  }

  /** Remove all active effects. Called at round end. */
  clearAll(): void {
    this.activeEffects = [];
    this.nextId = 0;
  }

  // --------------------------------------------------------------------------
  // Geometry Helpers
  // --------------------------------------------------------------------------

  /** Euclidean distance between two positions. */
  private dist(a: Position, b: Position): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Calculate the shortest distance from a point to a line segment.
   * Used for smoke LOS blocking.
   */
  private pointToSegmentDistance(
    point: Position,
    segStart: Position,
    segEnd: Position
  ): number {
    const dx = segEnd.x - segStart.x;
    const dz = segEnd.z - segStart.z;
    const segLengthSq = dx * dx + dz * dz;

    if (segLengthSq === 0) {
      return this.dist(point, segStart);
    }

    const t = Math.max(0, Math.min(1,
      ((point.x - segStart.x) * dx + (point.z - segStart.z) * dz) / segLengthSq
    ));

    const closestX = segStart.x + t * dx;
    const closestZ = segStart.z + t * dz;
    const distX = point.x - closestX;
    const distZ = point.z - closestZ;
    return Math.sqrt(distX * distX + distZ * distZ);
  }
}
