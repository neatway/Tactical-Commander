/**
 * @file Combat.ts
 * @description Combat resolution system - the core of the tactical game.
 * Handles engagement resolution when two soldiers detect each other,
 * including reaction times, shot accuracy, hit location determination,
 * damage calculation, and sustained fire (spray) mechanics.
 *
 * Combat Flow:
 * 1. Two soldiers detect each other (via DetectionSystem)
 * 2. resolveEngagement() determines who fires first (reaction time)
 * 3. Each shot is resolved: hit/miss, location (head/body/legs), damage
 * 4. If the first shooter kills the target, combat ends
 * 5. If not, the other soldier fires back
 * 6. For sustained fire, resolveSustainedFire() handles spray degradation
 *
 * All random values come from SeededRandom for deterministic replay.
 * All formulas reference the shared StatFormulas module.
 */

import type { Vec2 } from "@shared/util/MathUtils";
import {
  calculateReactionTime,
  calculateBaseHitChance,
  calculateFinalHitChance,
  calculateHeadshotChance,
  calculateDamage,
  calculateSprayAccuracy,
  calculateComposureModifier,
  calculateClutchModifier,
  calculateTeamworkModifier,
} from "@shared/constants/StatFormulas";
import { distance } from "@shared/util/MathUtils";
import { SeededRandom } from "@shared/util/RandomUtils";
import { SIMULATION } from "@shared/constants/GameConstants";
import type { ClientSoldier } from "./Soldier";

// ============================================================================
// --- Result Interfaces ---
// ============================================================================

/**
 * Result of a single shot fired by one soldier at another.
 * Captures everything needed for replay, UI, and state updates.
 */
export interface ShotResult {
  /** ID of the soldier who fired the shot */
  shooterId: string;
  /** ID of the soldier being shot at */
  targetId: string;
  /** Whether the shot hit the target (true) or missed (false) */
  hit: boolean;
  /** Where the shot landed (null if missed) */
  location: "head" | "body" | "legs" | null;
  /** Damage dealt to the targets health (0 if missed) */
  damage: number;
  /** Targets health after this shot */
  targetHealthAfter: number;
  /** Whether this shot killed the target */
  killed: boolean;
}

/**
 * Result of a full engagement between two soldiers.
 * An engagement starts when both soldiers detect each other and
 * ends when one (or both) are killed or combat is broken off.
 */
export interface EngagementResult {
  /** ID of the soldier who fired first (or "simultaneous" if within 50ms) */
  firstShooter: string;
  /** Array of all shots fired during the engagement, in order */
  shots: ShotResult[];
  /** Array of soldier IDs that were killed during this engagement */
  kills: string[];
  /** Total damage dealt by each soldier: { soldierId: totalDamage } */
  damageDealt: Record<string, number>;
}
// ============================================================================
// --- CombatSystem Class ---
// ============================================================================

/**
 * Resolves combat engagements between soldiers.
 * Stateless - all state is passed via parameters.
 * Uses SeededRandom for all random outcomes to ensure determinism.
 *
 * @example
 * 
 */
export class CombatSystem {

  // --------------------------------------------------------------------------
  // Main Engagement Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a full engagement between two soldiers who have detected each other.
   *
   * This is the main combat function implementing the design doc formulas:
   *
   * Step 1: Calculate reaction times for both soldiers.
   *   Uses calculateReactionTime(REA stat, random variance).
   *   Lower reaction time = fires first.
   *
   * Step 2: Determine firing order.
   *   If reaction times are within 50ms: SIMULTANEOUS (both fire at once).
   *   Otherwise: faster soldier fires first, slower fires second (if alive).
   *
   * Step 3: Resolve the first shooters shot.
   *   Calculate final hit chance using the full accuracy pipeline.
   *   Apply composure, clutch, and teamwork modifiers.
   *   Roll hit/miss, determine hit location, calculate damage.
   *
   * Step 4: If target survived (and not simultaneous), target fires back.
   *   Same accuracy and damage pipeline.
   *
   * Step 5: If simultaneous, both shots are resolved independently.
   *   Both soldiers fire regardless of whether the other shot kills them.
   *
   * Step 6: Package and return the EngagementResult.
   *
   * @param soldierA - First soldier in the engagement
   * @param soldierB - Second soldier in the engagement
   * @param rng - Seeded random number generator
   * @returns Complete engagement result with all shots, kills, and damage
   */
  resolveEngagement(
    soldierA: ClientSoldier,
    soldierB: ClientSoldier,
    rng: SeededRandom
  ): EngagementResult {
    /** Accumulate all shots fired during this engagement */
    const shots: ShotResult[] = [];
    /** Track kills */
    const kills: string[] = [];
    /** Track total damage dealt by each soldier */
    const damageDealt: Record<string, number> = {
      [soldierA.id]: 0,
      [soldierB.id]: 0,
    };

    // --- Step 1: Calculate reaction times ---
    /**
     * Each soldiers reaction time is based on their REA stat
     * plus a small random variance (+/- 50ms) for unpredictability.
     */
    const reactionA = calculateReactionTime(soldierA.stats.REA, rng.next());
    const reactionB = calculateReactionTime(soldierB.stats.REA, rng.next());

    // --- Step 2: Determine firing order ---
    /**
     * If reaction times are within SIMULTANEOUS_THRESHOLD (50ms),
     * both soldiers fire at the same time - neither gets an advantage.
     */
    const reactionDiff = Math.abs(reactionA - reactionB);
    const isSimultaneous = reactionDiff <= 50;

    /**
     * Determine who fires first.
     * Lower reaction time = faster = fires first.
     */
    let firstShooter: ClientSoldier;
    let secondShooter: ClientSoldier;
    if (reactionA <= reactionB) {
      firstShooter = soldierA;
      secondShooter = soldierB;
    } else {
      firstShooter = soldierB;
      secondShooter = soldierA;
    }
    // --- Step 3: First shooter fires ---
    /**
     * Resolve the first shooters shot using the full accuracy pipeline.
     */
    const firstShot = this.resolveShot(firstShooter, secondShooter, rng);
    shots.push(firstShot);
    damageDealt[firstShooter.id] += firstShot.damage;

    /* If the first shot killed the target, record the kill */
    if (firstShot.killed) {
      kills.push(secondShooter.id);
    }

    // --- Step 4 & 5: Second shooter fires (if applicable) ---
    if (isSimultaneous) {
      /**
       * SIMULTANEOUS ENGAGEMENT:
       * Both soldiers fire at the same time. The second soldier fires
       * regardless of whether the first shot killed them.
       * This represents the reality that bullets fired simultaneously
       * are already in flight before either impact lands.
       */
      const secondShot = this.resolveShot(secondShooter, firstShooter, rng);
      shots.push(secondShot);
      damageDealt[secondShooter.id] += secondShot.damage;

      if (secondShot.killed) {
        kills.push(firstShooter.id);
      }
    } else if (secondShooter.isAlive()) {
      /**
       * SEQUENTIAL ENGAGEMENT:
       * The second soldier fires back only if they survived the first shot.
       * This is the reward for having a faster reaction time.
       */
      const secondShot = this.resolveShot(secondShooter, firstShooter, rng);
      shots.push(secondShot);
      damageDealt[secondShooter.id] += secondShot.damage;

      if (secondShot.killed) {
        kills.push(firstShooter.id);
      }
    }

    // --- Step 6: Package the result ---
    return {
      firstShooter: isSimultaneous ? "simultaneous" : firstShooter.id,
      shots,
      kills,
      damageDealt,
    };
  }
  // --------------------------------------------------------------------------
  // Single Shot Resolution (private helper)
  // --------------------------------------------------------------------------

  /**
   * Resolve a single shot from shooter to target.
   * This is the core accuracy + damage pipeline:
   *
   * 1. Calculate base hit chance from ACC stat
   * 2. Calculate final hit chance with distance, movement, stance modifiers
   * 3. Apply composure modifier (clutch pressure)
   * 4. Apply clutch modifier (low health adrenaline)
   * 5. Apply teamwork modifier (nearby allies)
   * 6. Roll hit/miss
   * 7. If hit: determine location (head/body/legs)
   * 8. Calculate damage based on weapon, location, and target armor
   * 9. Apply damage to target
   *
   * @param shooter - The soldier firing
   * @param target - The soldier being fired at
   * @param rng - Seeded random for all rolls
   * @returns ShotResult capturing the outcome
   */
  private resolveShot(
    shooter: ClientSoldier,
    target: ClientSoldier,
    rng: SeededRandom
  ): ShotResult {
    // --- Calculate final hit chance ---

    /** Step 1: Base hit chance from ACC stat */
    const baseHitChance = calculateBaseHitChance(shooter.stats.ACC);

    /** Step 2: Apply distance, movement, and stance modifiers */
    const dist = distance(shooter.position, target.position);
    const weapon = shooter.currentWeapon === shooter.primaryWeapon.id
      ? shooter.primaryWeapon
      : shooter.secondaryWeapon;
    const finalHitChance = calculateFinalHitChance(
      baseHitChance,
      dist,
      weapon.range,
      shooter.isMoving,
      shooter.stance
    );

    /**
     * Step 3: Apply composure modifier.
     * In a clutch situation (no allies alive), high CMP helps maintain accuracy.
     * TODO: Pass actual alive allies/enemies count from simulation state.
     * For now, assume 0 allies and 1 enemy (worst case for composure).
     */
    const composureMod = calculateComposureModifier(shooter.stats.CMP, 0, 1);

    /**
     * Step 4: Apply clutch modifier.
     * Low health can boost or penalize accuracy depending on CMP stat.
     */
    const clutchMod = calculateClutchModifier(shooter.stats.CMP, shooter.health);

    /**
     * Step 5: Apply teamwork modifier.
     * Nearby allies provide a coordination bonus.
     * TODO: Pass actual nearby ally count from simulation state.
     */
    const teamworkMod = calculateTeamworkModifier(shooter.stats.TWK, 0);

    /** Combine all modifiers with the final hit chance */
    const modifiedHitChance = Math.min(
      0.98,
      Math.max(0.02, finalHitChance * composureMod * clutchMod * teamworkMod)
    );

    // --- Roll hit/miss ---
    const hitRoll = rng.next();
    const isHit = hitRoll < modifiedHitChance;
    /* If the shot missed, return a miss result */
    if (!isHit) {
      return {
        shooterId: shooter.id,
        targetId: target.id,
        hit: false,
        location: null,
        damage: 0,
        targetHealthAfter: target.health,
        killed: false,
      };
    }

    // --- Determine hit location ---
    /**
     * Roll to determine where the shot landed.
     * Headshot chance is based on shooters ACC stat.
     * Remaining probability is split between body (80%) and legs (20%).
     */
    const headshotChance = calculateHeadshotChance(shooter.stats.ACC);
    const locationRoll = rng.next();

    let hitLocation: "head" | "body" | "legs";
    if (locationRoll < headshotChance) {
      hitLocation = "head";
    } else if (locationRoll < headshotChance + (1 - headshotChance) * 0.8) {
      hitLocation = "body";
    } else {
      hitLocation = "legs";
    }

    // --- Calculate damage ---
    /**
     * Use the calculateDamage formula to determine health and armor damage.
     * Factors in: weapon base damage, hit location, headshot multiplier,
     * armor penetration, target armor, and helmet.
     */
    const damageResult = calculateDamage(
      weapon.damage,
      hitLocation,
      weapon.headshotMultiplier,
      weapon.armorPenetration,
      target.armor,
      target.helmet
    );

    // --- Apply damage to target ---
    /** Reduce targets armor by armor damage */
    target.armor = Math.max(0, target.armor - damageResult.armorDamage);

    /** Apply health damage via the soldiers takeDamage method */
    target.takeDamage(damageResult.healthDamage);

    return {
      shooterId: shooter.id,
      targetId: target.id,
      hit: true,
      location: hitLocation,
      damage: damageResult.healthDamage,
      targetHealthAfter: target.health,
      killed: !target.isAlive(),
    };
  }
  // --------------------------------------------------------------------------
  // Sustained Fire (Spray) Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a single shot during sustained automatic fire (spraying).
   * Unlike the initial engagement shot, spray shots have degraded accuracy
   * based on the shot number in the burst.
   *
   * This is called for each subsequent shot after the initial engagement.
   * As shotNumber increases, accuracy decreases according to the weapons
   * spray penalty and the shooters ACC stat.
   *
   * @param shooter - The soldier firing
   * @param target - The soldier being fired at
   * @param shotNumber - Which shot this is in the spray (0-indexed)
   * @param rng - Seeded random for all rolls
   * @returns ShotResult capturing the outcome
   */
  resolveSustainedFire(
    shooter: ClientSoldier,
    target: ClientSoldier,
    shotNumber: number,
    rng: SeededRandom
  ): ShotResult {
    /* Dead soldiers cannot shoot or be shot */
    if (!shooter.isAlive() || !target.isAlive()) {
      return {
        shooterId: shooter.id,
        targetId: target.id,
        hit: false,
        location: null,
        damage: 0,
        targetHealthAfter: target.health,
        killed: false,
      };
    }

    // --- Calculate spray accuracy ---
    /**
     * Get the current weapon and calculate degraded spray accuracy.
     * The weapons sprayPenalty determines how fast accuracy drops.
     * The shooters ACC stat mitigates the spray penalty.
     */
    const weapon = shooter.currentWeapon === shooter.primaryWeapon.id
      ? shooter.primaryWeapon
      : shooter.secondaryWeapon;

    const sprayAcc = calculateSprayAccuracy(
      weapon.baseAccuracy,
      weapon.sprayPenalty,
      shotNumber,
      shooter.stats.ACC
    );

    // --- Apply modifiers (same as initial shot) ---
    const dist = distance(shooter.position, target.position);
    const finalHitChance = calculateFinalHitChance(
      sprayAcc,
      dist,
      weapon.range,
      shooter.isMoving,
      shooter.stance
    );

    /** Apply composure, clutch, and teamwork modifiers */
    const composureMod = calculateComposureModifier(shooter.stats.CMP, 0, 1);
    const clutchMod = calculateClutchModifier(shooter.stats.CMP, shooter.health);
    const teamworkMod = calculateTeamworkModifier(shooter.stats.TWK, 0);

    const modifiedHitChance = Math.min(
      0.98,
      Math.max(0.02, finalHitChance * composureMod * clutchMod * teamworkMod)
    );

    // --- Roll hit/miss ---
    const hitRoll = rng.next();
    const isHit = hitRoll < modifiedHitChance;

    if (!isHit) {
      return {
        shooterId: shooter.id,
        targetId: target.id,
        hit: false,
        location: null,
        damage: 0,
        targetHealthAfter: target.health,
        killed: false,
      };
    }

    // --- Determine hit location ---
    /**
     * During spray, headshot chance is reduced slightly
     * because recoil makes precise aiming harder.
     */
    const baseHeadshotChance = calculateHeadshotChance(shooter.stats.ACC);
    /** Reduce headshot chance by 30% for spraying */
    const sprayHeadshotChance = baseHeadshotChance * 0.7;
    const locationRoll = rng.next();

    let hitLocation: "head" | "body" | "legs";
    if (locationRoll < sprayHeadshotChance) {
      hitLocation = "head";
    } else if (locationRoll < sprayHeadshotChance + (1 - sprayHeadshotChance) * 0.8) {
      hitLocation = "body";
    } else {
      hitLocation = "legs";
    }

    // --- Calculate and apply damage ---
    const damageResult = calculateDamage(
      weapon.damage,
      hitLocation,
      weapon.headshotMultiplier,
      weapon.armorPenetration,
      target.armor,
      target.helmet
    );

    /** Reduce targets armor */
    target.armor = Math.max(0, target.armor - damageResult.armorDamage);

    /** Apply health damage */
    target.takeDamage(damageResult.healthDamage);

    return {
      shooterId: shooter.id,
      targetId: target.id,
      hit: true,
      location: hitLocation,
      damage: damageResult.healthDamage,
      targetHealthAfter: target.health,
      killed: !target.isAlive(),
    };
  }
}
