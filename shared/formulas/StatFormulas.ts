/**
 * @file StatFormulas.ts
 * @description Core gameplay formulas converting soldier stats (1-99)
 * into movement speeds, hit chances, reaction times, and damage.
 * Pure functions, deterministic. Use SeededRandom for stochastic inputs.
 */

// ============================================================================
// --- Movement Formulas ---
// ============================================================================

/**
 * Calculate movement speed from SPD stat, weapon modifier, and armor.
 * Base speed: 150 (SPD=1) to 300 (SPD=99) game units/second.
 * @param spd - SPD stat (1-99)
 * @param weaponSpeedModifier - Weapon speed mod (0.0-1.0)
 * @param hasArmor - Whether wearing armor (5% penalty)
 * @returns Movement speed in game units per second
 */
export function calculateMovementSpeed(
  spd: number,
  weaponSpeedModifier: number,
  hasArmor: boolean
): number {
  const baseSpeed = 150 + (spd / 99) * 150;
  const armorMultiplier = hasArmor ? 0.95 : 1.0;
  return baseSpeed * weaponSpeedModifier * armorMultiplier;
}

// ============================================================================
// --- Detection Formulas ---
// ============================================================================

/**
 * Detection radius from AWR stat. Range: 300 to 800 game units.
 * @param awr - AWR stat (1-99)
 * @returns Detection radius in game units
 */
export function calculateDetectionRadius(awr: number): number {
  return 300 + (awr / 99) * 500;
}

/**
 * Stealth modifier reducing observer detection radius.
 * Range: 1.0 (STL=1) to 0.4 (STL=99).
 * @param stl - STL stat (1-99)
 * @returns Stealth modifier (lower = stealthier)
 */
export function calculateStealthModifier(stl: number): number {
  return 1.0 - (stl / 99) * 0.6;
}

// ============================================================================
// --- Accuracy Formulas ---
// ============================================================================

/**
 * Base hit chance from ACC stat. Range: 0.30 to 0.95.
 * @param acc - ACC stat (1-99)
 * @returns Base hit probability
 */
export function calculateBaseHitChance(acc: number): number {
  return 0.30 + (acc / 99) * 0.65;
}

/**
 * Spray accuracy degradation per shot.
 * @param baseAccuracy - Weapon base accuracy
 * @param sprayPenalty - Weapon spray penalty per shot
 * @param shotNumber - Shot index (0-based)
 * @param acc - ACC stat (1-99)
 * @returns Modified accuracy for this shot
 */
export function calculateSprayAccuracy(
  baseAccuracy: number, sprayPenalty: number,
  shotNumber: number, acc: number
): number {
  const accMod = 1 - (acc / 200);
  const degraded = baseAccuracy * (1 - sprayPenalty * shotNumber * accMod);
  return Math.max(0.05, degraded);
}
/**
 * Final hit chance after distance, movement, and stance modifiers.
 * @param baseHitChance - From calculateBaseHitChance
 * @param distanceToTarget - Distance in game units
 * @param weaponRange - Weapon max range
 * @param isMoving - Shooter moving?
 * @param stance - standing/crouching/prone
 * @returns Final hit probability (0.02-0.98)
 */
export function calculateFinalHitChance(
  baseHitChance: number, distanceToTarget: number,
  weaponRange: number, isMoving: boolean,
  stance: 'standing' | 'crouching' | 'prone'
): number {
  const distRatio = distanceToTarget / weaponRange;
  const distMod = Math.max(0.1, 1 - distRatio * 0.5);
  const moveMod = isMoving ? 0.7 : 1.0;
  let stanceMod = 1.0;
  if (stance === 'crouching') stanceMod = 1.15;
  if (stance === 'prone') stanceMod = 1.25;
  const final = baseHitChance * distMod * moveMod * stanceMod;
  return Math.min(0.98, Math.max(0.02, final));
}

// ============================================================================
// --- Reaction Time ---
// ============================================================================

/**
 * Reaction time: 400ms (REA=99) to 900ms (REA=1) +/- 50ms variance.
 * @param rea - REA stat (1-99)
 * @param randomValue - [0,1) from SeededRandom
 * @returns Reaction time in ms
 */
export function calculateReactionTime(rea: number, randomValue: number): number {
  const base = 900 - (rea / 99) * 500;
  const variance = (randomValue - 0.5) * 100;
  return Math.max(200, base + variance);
}

// ============================================================================
// --- Damage ---
// ============================================================================

/**
 * Headshot chance from ACC. Range: 0.05 to 0.40.
 * @param acc - ACC stat (1-99)
 * @returns Headshot probability
 */
export function calculateHeadshotChance(acc: number): number {
  return 0.05 + (acc / 99) * 0.35;
}

/**
 * Damage after armor/location. Returns health and armor damage.
 * @param baseDamage - Weapon base damage
 * @param hitLocation - head/body/legs
 * @param headshotMultiplier - Weapon headshot multiplier
 * @param armorPenetration - Weapon armor pen (0-1)
 * @param targetArmor - Target armor (0-100)
 * @param targetHasHelmet - Target has helmet?
 */
export function calculateDamage(
  baseDamage: number,
  hitLocation: 'head' | 'body' | 'legs',
  headshotMultiplier: number, armorPenetration: number,
  targetArmor: number, targetHasHelmet: boolean
): { healthDamage: number; armorDamage: number } {
  let dmg = baseDamage;
  if (hitLocation === 'head') dmg *= headshotMultiplier;
  else if (hitLocation === 'legs') dmg *= 0.75;
  let healthDmg = dmg;
  let armorDmg = 0;
  if (targetArmor > 0) {
    const prot =
      (hitLocation === 'head' && targetHasHelmet) ||
      (hitLocation === 'body' && targetArmor > 0);
    if (prot) {
      const absorbPct = 1 - armorPenetration;
      armorDmg = Math.floor(dmg * absorbPct * 0.5);
      healthDmg = Math.floor(dmg * armorPenetration);
      if (armorDmg > targetArmor) {
        healthDmg += armorDmg - targetArmor;
        armorDmg = targetArmor;
      }
    }
  }
  return {
    healthDamage: Math.max(1, Math.round(healthDmg)),
    armorDamage: Math.max(0, Math.round(armorDmg))
  };
}

// ============================================================================
// --- Composure & Clutch ---
// ============================================================================

/** Composure modifier under pressure. */
export function calculateComposureModifier(
  cmp: number, aliveAllies: number, aliveEnemies: number
): number {
  if (aliveAllies > 0) return 1.0;
  const cmpF = cmp / 99;
  const mod = 0.7 + cmpF * 0.4 - (1 - cmpF) * aliveEnemies * 0.05;
  return Math.max(0.5, Math.min(1.1, mod));
}

/** Clutch modifier from health + composure. */
export function calculateClutchModifier(cmp: number, healthPct: number): number {
  const hF = 1 - (healthPct / 100);
  return 1.0 + (cmp / 99 - 0.5) * hF * 0.4;
}

/** Teamwork modifier with nearby allies. */
export function calculateTeamworkModifier(twk: number, nearbyAllies: number): number {
  if (nearbyAllies === 0) return 1.0;
  const bonus = Math.min(0.2, nearbyAllies * (twk / 99) * 0.05);
  return 1.0 + bonus;
}
