/**
 * @file Combat.ts
 * @description Combat resolution system — the core of the tactical game.
 *
 * NOTE: This class is NOT currently used in the main game loop.
 * The Game.ts simulation tick handles combat resolution directly using
 * SoldierRuntimeState objects and StatFormulas. This standalone class
 * is preserved for future use when:
 *   - Server-side simulation needs a combat resolver
 *   - Unit testing combat formulas in isolation
 *   - A replay verification system needs to replay engagements
 *
 * Combat Flow:
 * 1. Two soldiers detect each other (via DetectionSystem)
 * 2. resolveEngagement() determines who fires first (reaction time)
 * 3. Each shot is resolved: hit/miss, location (head/body/legs), damage
 * 4. If the first shooter kills the target, combat ends
 * 5. If not, the other soldier fires back
 *
 * All random values come from SeededRandom for deterministic replay.
 * All formulas reference the shared StatFormulas module.
 */

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
  /** Damage dealt to the target's health (0 if missed) */
  damage: number;
  /** Target's health after this shot */
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
 * Stateless — all state is passed via parameters.
 * Uses SeededRandom for all random outcomes to ensure determinism.
 *
 * NOTE: Not wired into the main game loop. See file header.
 */
export class CombatSystem {

  // --------------------------------------------------------------------------
  // Main Engagement Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a full engagement between two soldiers who have detected each other.
   *
   * Step 1: Calculate reaction times for both soldiers.
   * Step 2: Determine firing order (lower reaction time fires first).
   * Step 3: Resolve the first shooter's shot.
   * Step 4: If target survived and not simultaneous, target fires back.
   * Step 5: If simultaneous, both fire regardless.
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
     * Each soldier's reaction time is based on their reactionTime stat
     * plus a small random variance (+/- 50ms) for unpredictability.
     * calculateReactionTime expects (rea, rng_func) where rng_func returns [0,1).
     */
    const reactionA = calculateReactionTime(
      soldierA.stats.reactionTime,
      () => rng.next()
    );
    const reactionB = calculateReactionTime(
      soldierB.stats.reactionTime,
      () => rng.next()
    );

    // --- Step 2: Determine firing order ---
    /**
     * If reaction times are within 50ms, both fire simultaneously.
     */
    const reactionDiff = Math.abs(reactionA - reactionB);
    const isSimultaneous = reactionDiff <= 50;

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
    const firstShot = this.resolveShot(firstShooter, secondShooter, rng);
    shots.push(firstShot);
    damageDealt[firstShooter.id] += firstShot.damage;

    if (firstShot.killed) {
      kills.push(secondShooter.id);
    }

    // --- Step 4 & 5: Second shooter fires (if applicable) ---
    if (isSimultaneous) {
      /* Both fire regardless of whether the first shot killed them */
      const secondShot = this.resolveShot(secondShooter, firstShooter, rng);
      shots.push(secondShot);
      damageDealt[secondShooter.id] += secondShot.damage;

      if (secondShot.killed) {
        kills.push(firstShooter.id);
      }
    } else if (secondShooter.isAlive()) {
      /* Sequential: second fires only if alive */
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
   * Uses the full accuracy + damage pipeline with shared StatFormulas.
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
    /* Step 1: Calculate final hit chance using StatFormulas */
    const dist = distance(shooter.position, target.position);

    /**
     * calculateFinalHitChance(acc, distance, isMoving, weaponAccMod)
     * Uses accuracy stat (full name) and computes base + distance + moving + weapon.
     * TODO: Pass actual weapon accuracy modifier from WeaponData lookup.
     */
    const finalHitChance = calculateFinalHitChance(
      shooter.stats.accuracy,
      dist,
      shooter.isMoving,
      1.0  /* Neutral weapon modifier as placeholder */
    );

    /* Apply composure modifier (4 args: cmp, hp, enemiesVisible, alliesNearby) */
    const composureMod = calculateComposureModifier(
      shooter.stats.composure,
      shooter.health,
      1,  /* Assume 1 enemy visible */
      0   /* Assume 0 allies nearby (worst case) */
    );

    /* Apply clutch modifier (last alive check) */
    const clutchMod = calculateClutchModifier(shooter.stats.clutchFactor, 0);

    /* Apply teamwork modifier (boolean for ally within 300px) */
    const teamworkMod = calculateTeamworkModifier(shooter.stats.teamwork, false);

    /** Combine all modifiers */
    const modifiedHitChance = Math.min(
      0.98,
      Math.max(0.02, finalHitChance * composureMod * clutchMod * teamworkMod)
    );

    /* Roll hit/miss */
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

    /* Determine hit location */
    const headshotChance = calculateHeadshotChance(shooter.stats.accuracy);
    const locationRoll = rng.next();

    let hitLocation: "head" | "body" | "legs";
    if (locationRoll < headshotChance) {
      hitLocation = "head";
    } else if (locationRoll < headshotChance + (1 - headshotChance) * 0.8) {
      hitLocation = "body";
    } else {
      hitLocation = "legs";
    }

    /* Calculate damage using the 7-argument calculateDamage function */
    const damage = calculateDamage(
      25,     /* weaponBodyDmg — pistol placeholder */
      2.5,    /* headshotMult — pistol placeholder */
      hitLocation,
      0,      /* armorBodyReduction (no armor placeholder) */
      0,      /* armorLegReduction (no armor placeholder) */
      target.helmet,
      false   /* isAwp */
    );

    /* Apply damage to target */
    target.takeDamage(damage);

    return {
      shooterId: shooter.id,
      targetId: target.id,
      hit: true,
      location: hitLocation,
      damage: damage,
      targetHealthAfter: target.health,
      killed: !target.isAlive(),
    };
  }

  // --------------------------------------------------------------------------
  // Sustained Fire (Spray) Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a single shot during sustained automatic fire (spraying).
   * Accuracy degrades based on shot number and RCL stat.
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

    /* Calculate spray accuracy using StatFormulas */
    const baseHit = calculateBaseHitChance(shooter.stats.accuracy);
    const sprayAcc = calculateSprayAccuracy(
      baseHit,
      shotNumber,
      shooter.stats.recoilControl
    );

    /* Apply distance and movement modifiers */
    const dist = distance(shooter.position, target.position);
    const finalHitChance = calculateFinalHitChance(
      shooter.stats.accuracy,
      dist,
      shooter.isMoving,
      1.0  /* Neutral weapon modifier placeholder */
    );

    /* Use spray accuracy as a multiplier on final hit chance */
    const sprayMult = baseHit > 0 ? sprayAcc / baseHit : 1.0;
    const adjustedHit = finalHitChance * sprayMult;

    /* Apply composure, clutch, and teamwork modifiers */
    const composureMod = calculateComposureModifier(
      shooter.stats.composure, shooter.health, 1, 0
    );
    const clutchMod = calculateClutchModifier(shooter.stats.clutchFactor, 0);
    const teamworkMod = calculateTeamworkModifier(shooter.stats.teamwork, false);

    const modifiedHitChance = Math.min(
      0.98,
      Math.max(0.02, adjustedHit * composureMod * clutchMod * teamworkMod)
    );

    /* Roll hit/miss */
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

    /* Determine hit location (reduced headshot chance during spray) */
    const baseHeadshotChance = calculateHeadshotChance(shooter.stats.accuracy);
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

    /* Calculate and apply damage */
    const damage = calculateDamage(
      25,     /* weaponBodyDmg placeholder */
      2.5,    /* headshotMult placeholder */
      hitLocation,
      0,      /* armorBodyReduction */
      0,      /* armorLegReduction */
      target.helmet,
      false   /* isAwp */
    );

    target.takeDamage(damage);

    return {
      shooterId: shooter.id,
      targetId: target.id,
      hit: true,
      location: hitLocation,
      damage: damage,
      targetHealthAfter: target.health,
      killed: !target.isAlive(),
    };
  }
}
