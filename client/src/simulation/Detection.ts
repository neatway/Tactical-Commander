/**
 * @file Detection.ts
 * @description Line-of-sight and enemy detection system for the tactical simulation.
 * Handles vision cone checks, ray-vs-wall intersection for LOS,
 * and the full multi-step detection algorithm that determines whether
 * one soldier spots another on any given tick.
 *
 * Detection Pipeline (per tick):
 * 1. Range check: Is the target within the observers detection radius?
 *    (Modified by targets stealth stat)
 * 2. Vision cone: Is the target within the observers field of view?
 * 3. Line of sight: Is there a clear, unobstructed line to the target?
 * 4. Detection roll: Probabilistic check (per tick) for spotting.
 *    Peripheral vision targets get a penalty to this roll.
 *
 * All random values come from SeededRandom for deterministic simulation.
 */

import type { Vec2 } from "../../../../shared/types/SoldierTypes";
import type { MapData, Wall } from "../../../../shared/types/MapTypes";
import {
  distance,
  angleBetween,
  angleDifference,
  degreesToRadians,
  lineIntersectsRect,
} from "../../../../shared/util/MathUtils";
import {
  calculateDetectionRadius,
  calculateStealthModifier,
} from "../../../../shared/formulas/StatFormulas";
import { SeededRandom } from "../../../../shared/util/SeededRandom";
import { SIMULATION } from "../../../../shared/constants/GameConstants";
import type { ClientSoldier } from "./Soldier";

// ============================================================================
// --- DetectionSystem Class ---
// ============================================================================

/**
 * Manages line-of-sight checks and enemy detection for the simulation.
 * Created once per map, reused every tick.
 *
 * @example
 * 
 */
export class DetectionSystem {
  /** Reference to the maps walls for LOS checks */
  private walls: Wall[];

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  /**
   * Create a DetectionSystem for the given map.
   *
   * @param mapData - Map data containing walls for LOS tests
   */
  constructor(mapData: MapData) {
    this.walls = mapData.walls;
  }
  // --------------------------------------------------------------------------
  // Line of Sight
  // --------------------------------------------------------------------------

  /**
   * Check if there is an unobstructed line of sight between two positions.
   *
   * Casts a ray (line segment) from  to  and tests it against
   * every wall rectangle. If any wall intersects the line, LOS is blocked.
   *
   * Uses the Liang-Barsky algorithm via lineIntersectsRect from MathUtils.
   *
   * @param from - The observer position
   * @param to - The target position
   * @param walls - Array of wall rectangles to test against
   * @returns True if no walls block the line between from and to
   */
  hasLineOfSight(from: Vec2, to: Vec2, walls: Wall[]): boolean {
    /**
     * Iterate through every wall and test for intersection.
     * Return false immediately if any wall blocks the line.
     * This is a brute-force approach but is fast enough for ~50 walls.
     */
    for (const wall of walls) {
      if (lineIntersectsRect(
        from.x, from.z,   /* Line segment start */
        to.x, to.z,       /* Line segment end */
        wall.x, wall.z,   /* Wall top-left corner */
        wall.width,        /* Wall X extent */
        wall.height        /* Wall Z extent */
      )) {
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
   * Check if a target position is within an observers vision cone.
   *
   * The vision cone is defined by the observers facing angle and a
   * cone width in degrees. A target is "in cone" if the angle from
   * the observer to the target is within facingAngle +/- (coneDegrees/2).
   *
   * This function correctly handles the wraparound at the 0/2PI boundary
   * by using the angleDifference utility which returns the shortest
   * signed angular difference.
   *
   * @param origin - The observers position
   * @param facingAngle - The direction the observer is facing (radians)
   * @param target - The target position to check
   * @param coneDegrees - Total width of the vision cone in degrees
   * @returns True if the target is within the vision cone
   */
  isInVisionCone(
    origin: Vec2,
    facingAngle: number,
    target: Vec2,
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
   *   Calculate the observers detection radius (from AWR stat).
   *   Multiply by targets stealth modifier (from STL stat).
   *   If target is beyond this effective radius, detection fails.
   *
   * Step 2: VISION CONE CHECK
   *   Check if the target is within the observers vision cone.
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
   * @param observer - The soldier trying to detect
   * @param target - The enemy soldier to detect
   * @param walls - Map walls for LOS checks
   * @param rng - Seeded random number generator for detection roll
   * @returns True if the observer detects the target this tick
   */
  checkDetection(
    observer: ClientSoldier,
    target: ClientSoldier,
    walls: Wall[],
    rng: SeededRandom
  ): boolean {
    /* Dead soldiers cannot detect or be detected */
    if (!observer.isAlive() || !target.isAlive()) {
      return false;
    }

    // --- Step 1: Range check ---
    /**
     * Calculate the effective detection range.
     * Observer detection radius is based on their AWR stat.
     * Target stealth modifier reduces this effective radius.
     * A stealthy target (low modifier) means the observer needs to be closer.
     */
    const baseRadius = calculateDetectionRadius(observer.stats.AWR);
    const stealthMod = calculateStealthModifier(target.stats.STL);
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
    if (!this.hasLineOfSight(observer.position, target.position, walls)) {
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
   * @param walls - Map walls for LOS checks
   * @param rng - Seeded random for detection rolls
   * @returns Array of enemy soldiers detected this tick
   */
  getVisibleEnemies(
    soldier: ClientSoldier,
    enemies: ClientSoldier[],
    walls: Wall[],
    rng: SeededRandom
  ): ClientSoldier[] {
    /** Array to collect all detected enemies */
    const detected: ClientSoldier[] = [];

    /**
     * Check each enemy through the detection pipeline.
     * Only alive enemies are checked (dead ones are skipped by checkDetection).
     */
    for (const enemy of enemies) {
      /* Skip dead enemies early for performance */
      if (!enemy.isAlive()) continue;

      /* Run the full detection check */
      if (this.checkDetection(soldier, enemy, walls, rng)) {
        detected.push(enemy);
      }
    }

    return detected;
  }
}
