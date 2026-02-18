/**
 * @file Detection.ts
 * @description Line-of-sight and enemy detection system for the tactical simulation.
 * Handles vision cone checks, ray-vs-wall intersection for LOS,
 * and the full multi-step detection algorithm that determines whether
 * one soldier spots another on any given tick.
 *
 * Detection Pipeline (per tick):
 * 1. Range check: Is the target within the observer's detection radius?
 *    (Modified by target's stealth stat)
 * 2. Vision cone: Is the target within the observer's field of view?
 * 3. Line of sight: Is there a clear, unobstructed line to the target?
 * 4. Detection roll: Probabilistic check (per tick) for spotting.
 *    Peripheral vision targets get a penalty to this roll.
 *
 * All random values come from SeededRandom for deterministic simulation.
 */

import type { Vec2 } from "@shared/util/MathUtils";
import type { Wall } from "@shared/types/MapTypes";
import {
  distance,
  angleBetween,
  degreesToRadians,
  lineIntersectsRect,
} from "@shared/util/MathUtils";
import {
  calculateDetectionRadius,
  calculateStealthModifier,
} from "@shared/constants/StatFormulas";
import { SeededRandom } from "@shared/util/RandomUtils";
import { SIMULATION } from "@shared/constants/GameConstants";
import type { SoldierRuntimeState, Position } from "../game/GameState";

// ============================================================================
// --- Helper: Angle Difference ---
// ============================================================================

/**
 * Calculate the smallest signed angle difference between two angles.
 * Returns a value in [-PI, PI].
 * @param a - First angle in radians
 * @param b - Second angle in radians
 */
function angleDifference(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

// ============================================================================
// --- Default Stat Values ---
// ============================================================================

/**
 * Default awareness stat for soldiers without a full stats profile.
 * This gives a baseline detection radius of ~400px.
 * Will be replaced by per-soldier stats when the roster system is wired in.
 */
const DEFAULT_AWARENESS = 50;

/**
 * Default stealth stat for soldiers without a full stats profile.
 * This gives a baseline stealth modifier of ~1.0 (no reduction).
 */
const DEFAULT_STEALTH = 50;

// ============================================================================
// --- DetectionSystem Class ---
// ============================================================================

/**
 * Manages line-of-sight checks and enemy detection for the simulation.
 * Created once per map, reused every tick.
 *
 * @example
 * ```ts
 * const detection = new DetectionSystem(mapData.walls);
 * const detected = detection.getVisibleEnemies(soldier, enemies, rng);
 * ```
 */
export class DetectionSystem {
  /** Reference to the map's walls for LOS checks */
  private walls: Wall[];

  /**
   * Create a DetectionSystem for the given map walls.
   *
   * @param walls - Array of wall definitions for LOS tests
   */
  constructor(walls: Wall[]) {
    this.walls = walls;
  }

  // --------------------------------------------------------------------------
  // Line of Sight
  // --------------------------------------------------------------------------

  /**
   * Check if there is an unobstructed line of sight between two positions.
   *
   * Casts a ray (line segment) from `from` to `to` and tests it against
   * every wall rectangle. If any wall intersects the line, LOS is blocked.
   *
   * Uses the Liang-Barsky algorithm via lineIntersectsRect from MathUtils.
   *
   * @param from - The observer position
   * @param to - The target position
   * @returns True if no walls block the line between from and to
   */
  hasLineOfSight(from: Position, to: Position): boolean {
    /**
     * Iterate through every wall and test for intersection.
     * Return false immediately if any wall blocks the line.
     * This is a brute-force approach but is fast enough for ~50 walls.
     */
    for (const wall of this.walls) {
      if (lineIntersectsRect(from, to, {
        x: wall.x,
        z: wall.z,
        width: wall.width,
        height: wall.height,
      })) {
        return false; /* This wall blocks line of sight */
      }
    }

    /* No walls blocked the line - clear LOS */
    return true;
  }

  // --------------------------------------------------------------------------
  // Vision Cone
  // --------------------------------------------------------------------------

  /**
   * Check if a target position is within an observer's vision cone.
   *
   * The vision cone is defined by the observer's facing angle and a
   * cone width in degrees. A target is "in cone" if the angle from
   * the observer to the target is within facingAngle +/- (coneDegrees/2).
   *
   * @param origin - The observer's position
   * @param facingAngle - The direction the observer is facing (radians)
   * @param target - The target position to check
   * @param coneDegrees - Total width of the vision cone in degrees
   * @returns True if the target is within the vision cone
   */
  isInVisionCone(
    origin: Position,
    facingAngle: number,
    target: Position,
    coneDegrees: number
  ): boolean {
    /* Calculate the angle from observer to target */
    const angleToTarget = angleBetween(origin, target);

    /**
     * Calculate the angular difference between facing direction and target angle.
     * angleDifference handles wraparound and returns [-PI, PI].
     */
    const diff = angleDifference(facingAngle, angleToTarget);

    /* Convert cone half-angle from degrees to radians */
    const halfConeRad = degreesToRadians(coneDegrees / 2);

    /* Target is in cone if the absolute angular difference is within half-cone */
    return Math.abs(diff) <= halfConeRad;
  }

  // --------------------------------------------------------------------------
  // Full Detection Check
  // --------------------------------------------------------------------------

  /**
   * Perform the full detection check: can the observer detect the target this tick?
   *
   * Detection pipeline:
   *
   * Step 1: RANGE CHECK
   *   Calculate the observer's detection radius (from awareness stat).
   *   Multiply by target's stealth modifier (from stealth stat).
   *   If target is beyond this effective radius, detection fails.
   *
   * Step 2: VISION CONE CHECK
   *   Check if the target is within the observer's vision cone.
   *   The cone is SIMULATION.detectionConeDegrees wide (default 120).
   *   Also check extended peripheral zone (+30 degrees on each side).
   *
   * Step 3: LINE OF SIGHT CHECK
   *   Cast a ray from observer to target and check for wall intersections.
   *   If any wall blocks the line, detection fails.
   *
   * Step 4: DETECTION PROBABILITY ROLL
   *   Even if all geometry checks pass, detection is probabilistic per tick.
   *   Base detection probability per tick: 0.6 (60%).
   *   Peripheral vision penalty: probability * 0.5 if target is at cone edge.
   *   Roll using SeededRandom for determinism.
   *
   * @param observer - The soldier trying to detect (needs position, rotation, alive)
   * @param target - The enemy soldier to detect (needs position, alive)
   * @param rng - Seeded random number generator for detection roll
   * @param observerAwareness - Observer's AWR stat (1-100), default 50
   * @param targetStealth - Target's STL stat (1-100), default 50
   * @returns True if the observer detects the target this tick
   */
  checkDetection(
    observer: SoldierRuntimeState,
    target: SoldierRuntimeState,
    rng: SeededRandom,
    observerAwareness: number = DEFAULT_AWARENESS,
    targetStealth: number = DEFAULT_STEALTH
  ): boolean {
    /* Dead soldiers cannot detect or be detected */
    if (!observer.alive || !target.alive) {
      return false;
    }

    // --- Step 1: Range check ---
    /**
     * Calculate the effective detection range.
     * Observer detection radius is based on their awareness stat.
     * Target stealth modifier reduces this effective radius.
     * A stealthy target (low modifier) means the observer needs to be closer.
     */
    const baseRadius = calculateDetectionRadius(observerAwareness);
    const stealthMod = calculateStealthModifier(targetStealth);
    const effectiveRadius = baseRadius * stealthMod;

    /** Calculate actual distance between the two soldiers */
    const dist = distance(observer.position, target.position);

    /** If target is beyond effective radius, cannot detect */
    if (dist > effectiveRadius) {
      return false;
    }

    // --- Step 2: Vision cone check ---
    /**
     * Check if target is within the main vision cone.
     * Also check the extended peripheral zone for partial detection.
     */
    const coneDeg = SIMULATION.detectionConeDegrees;
    const peripheralDeg = coneDeg + (SIMULATION.peripheralAngle * 2);

    const inMainCone = this.isInVisionCone(
      observer.position, observer.rotation, target.position, coneDeg
    );
    const inPeripheral = this.isInVisionCone(
      observer.position, observer.rotation, target.position, peripheralDeg
    );

    /** If target is not in main cone OR peripheral zone, cannot detect */
    if (!inMainCone && !inPeripheral) {
      return false;
    }

    // --- Step 3: Line of sight check ---
    /** Cast a ray and check if any walls block the view */
    if (!this.hasLineOfSight(observer.position, target.position)) {
      return false;
    }

    // --- Step 4: Detection probability roll ---
    /**
     * Base detection probability per tick.
     * At close range, detection is near-certain.
     * At max range, it is the base probability.
     * Closer targets are easier to spot.
     */
    const distanceFactor = 1.0 - (dist / effectiveRadius) * 0.4;
    let detectionProb = 0.6 * distanceFactor;

    /**
     * Apply peripheral vision penalty.
     * Targets at the edge of vision (in peripheral but not main cone)
     * are harder to spot - detection probability is halved.
     */
    if (!inMainCone && inPeripheral) {
      detectionProb *= SIMULATION.peripheralPenalty;
    }

    /** Roll the detection check using the seeded RNG */
    const roll = rng.next();
    return roll < detectionProb;
  }

  // --------------------------------------------------------------------------
  // Batch Detection
  // --------------------------------------------------------------------------

  /**
   * Get all enemies visible to a soldier this tick.
   * Runs the full checkDetection pipeline against every alive enemy.
   *
   * This is the primary method called by the simulation loop to determine
   * which enemies a soldier can see and potentially engage in combat.
   *
   * @param soldier - The observing soldier
   * @param enemies - Array of enemy soldiers to check against
   * @param rng - Seeded random for detection rolls
   * @param awareness - Observer's awareness stat (default 50)
   * @param targetStealth - Default stealth for targets (default 50)
   * @returns Array of enemy soldier IDs detected this tick
   */
  getVisibleEnemies(
    soldier: SoldierRuntimeState,
    enemies: SoldierRuntimeState[],
    rng: SeededRandom,
    awareness: number = DEFAULT_AWARENESS,
    targetStealth: number = DEFAULT_STEALTH
  ): string[] {
    /** Array to collect all detected enemy soldier IDs */
    const detected: string[] = [];

    /**
     * Check each enemy through the detection pipeline.
     * Only alive enemies are checked (dead ones are skipped by checkDetection).
     */
    for (const enemy of enemies) {
      /* Skip dead enemies early for performance */
      if (!enemy.alive) continue;

      /* Run the full detection check */
      if (this.checkDetection(soldier, enemy, rng, awareness, targetStealth)) {
        detected.push(enemy.soldierId);
      }
    }

    return detected;
  }
}
