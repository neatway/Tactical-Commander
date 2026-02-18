// ============================================================================
// WeaponData.ts
// Concrete stat tables for all weapons, armor, and utility items.
// These tables are the single source of truth for all item stats in the game.
// Used by the buy phase UI, simulation engine, and economy system.
// ============================================================================

import type { WeaponId, ArmorType, UtilityType, WeaponStats, ArmorStats, UtilityStats } from '../types/WeaponTypes';

// ----------------------------------------------------------------------------
// WEAPON DEFINITIONS
// Each weapon fills a distinct tactical niche. Cost scales with power.
// Kill rewards are inversely related to weapon power to reward risky plays.
// ----------------------------------------------------------------------------

/**
 * Complete weapon stats lookup table.
 * Key is the WeaponId, value contains all stats needed for simulation.
 *
 * Design philosophy:
 * - Cheap weapons (PISTOL, SMG) have high kill rewards to reward eco-round plays
 * - Expensive weapons (AWP, LMG) have low kill rewards since they are powerful
 * - Fire rate is in milliseconds between shots (lower = faster)
 * - accMod multiplies the soldier base accuracy (>1.0 means the weapon helps aim)
 * - speedMod multiplies movement speed (heavier weapons slow you down)
 */
export const WEAPONS: Record<WeaponId, WeaponStats> = {
  /**
   * PISTOL - Default sidearm, available on eco rounds.
   * Balanced stats with decent headshot multiplier.
   * High kill reward (300) encourages pistol-round aggression.
   * Medium range makes it versatile but not dominant at any distance.
   */
  PISTOL: {
    cost: 200,          // Cheapest weapon, always affordable
    bodyDmg: 25,        // 4 body shots to kill (100 HP, no armor)
    headMult: 2.5,      // 62.5 headshot damage -> 2 headshots to kill
    fireRate: 400,      // 2.5 shots per second (semi-auto feel)
    mag: 12,            // Small magazine, rewards accuracy
    accMod: 0.85,       // Slightly reduces base accuracy (small sights)
    speedMod: 0.95,     // Very light, minimal speed penalty
    killReward: 300,    // Standard kill reward
    range: 'MEDIUM',    // Effective at moderate distances
  },

  /**
   * SMG - Close quarters spray weapon.
   * Very fast fire rate with large magazine for aggressive pushes.
   * Highest kill reward (600) rewards the risk of getting close.
   * Low accuracy and short range limit effectiveness at distance.
   */
  SMG: {
    cost: 1200,         // Affordable force-buy option
    bodyDmg: 22,        // 5 body shots to kill (no armor)
    headMult: 2.0,      // 44 headshot damage -> 3 headshots to kill
    fireRate: 100,      // 10 shots per second (full-auto spray)
    mag: 30,            // Large magazine for sustained fire
    accMod: 0.80,       // Poor base accuracy (spray weapon)
    speedMod: 0.90,     // Light weapon, decent mobility
    killReward: 600,    // Double standard reward (high risk close-range play)
    range: 'SHORT',     // Only effective in close quarters
  },

  /**
   * RIFLE - The workhorse primary weapon.
   * Best-in-class headshot multiplier (4x) rewards precise aimers.
   * Balanced cost, range, and fire rate make it the standard buy.
   * Accuracy modifier of 1.0 means it uses the soldier true accuracy.
   */
  RIFLE: {
    cost: 2700,         // Standard full-buy primary
    bodyDmg: 30,        // 4 body shots to kill (no armor)
    headMult: 4.0,      // 120 headshot damage -> instant headshot kill!
    fireRate: 120,      // ~8.3 shots per second (burst/tap-fire effective)
    mag: 30,            // Standard magazine
    accMod: 1.0,        // Neutral accuracy (soldier true skill shows)
    speedMod: 0.85,     // Moderate weight, noticeable speed reduction
    killReward: 300,    // Standard kill reward
    range: 'LONG',      // Effective at long range
  },

  /**
   * AWP - High-risk, high-reward sniper rifle.
   * Massive body damage (85) means 1-shot kill against unarmored targets
   * and 2-shot kill against heavy armor. Very slow fire rate punishes misses.
   * Lowest kill reward (100) balances its incredible lethality.
   * Heaviest weapon in the game (0.78 speed modifier).
   */
  AWP: {
    cost: 4750,         // Most expensive weapon, major economy investment
    bodyDmg: 85,        // Near one-shot kill to body (85 damage)
    headMult: 1.2,      // 102 headshot damage -> guaranteed one-shot headshot
    fireRate: 1500,     // 0.67 shots per second (bolt-action feel)
    mag: 5,             // Tiny magazine, every shot counts
    accMod: 1.15,       // BEST accuracy modifier (scope advantage)
    speedMod: 0.78,     // Heaviest weapon, severe speed penalty
    killReward: 100,    // Lowest reward (weapon is already very powerful)
    range: 'VERY_LONG', // Maximum effective range
  },

  /**
   * SHOTGUN - Point-blank devastation.
   * bodyDmg of 18 represents EACH of 8 pellets (18 x 8 = 144 max damage).
   * At close range, all pellets hit for a guaranteed one-shot kill.
   * At distance, pellets spread and fewer connect, making it useless.
   * Highest kill reward (900) massively rewards getting close enough.
   */
  SHOTGUN: {
    cost: 1800,         // Mid-range cost, situational purchase
    bodyDmg: 18,        // Per-pellet damage (x8 pellets = 144 max total body damage)
    headMult: 1.0,      // No headshot bonus (pellet spread is random)
    fireRate: 900,      // ~1.1 shots per second (pump-action feel)
    mag: 7,             // Tube magazine, slow reload per shell
    accMod: 0.70,       // Worst accuracy (spread is the point)
    speedMod: 0.90,     // Moderate weight, decent mobility for rushing
    killReward: 900,    // Highest reward (extreme risk required to use)
    range: 'VERY_SHORT', // Only effective at point-blank range
  },

  /**
   * LMG - Suppression and area denial weapon.
   * Massive 100-round magazine for sustained fire. Fastest fire rate in class.
   * Good damage and range but heavy weight makes repositioning slow.
   * Best used for holding angles and suppressing enemy movement.
   */
  LMG: {
    cost: 5200,         // Very expensive, committed purchase
    bodyDmg: 28,        // 4 body shots to kill (no armor)
    headMult: 3.0,      // 84 headshot damage -> 2 headshots to kill
    fireRate: 80,       // 12.5 shots per second (fastest fire rate)
    mag: 100,           // Enormous magazine for sustained suppression
    accMod: 0.90,       // Slightly below neutral (hard to control)
    speedMod: 0.80,     // Very heavy, significant speed penalty
    killReward: 300,    // Standard kill reward
    range: 'LONG',      // Effective at long range (belt-fed stability)
  },
} as const;

// ----------------------------------------------------------------------------
// ARMOR DEFINITIONS
// Armor reduces incoming damage but penalizes movement speed.
// Players must balance protection vs. mobility.
// ----------------------------------------------------------------------------

/**
 * Armor stats lookup table.
 *
 * Damage reduction is applied as: finalDmg = baseDmg * (1 - reduction)
 * Example: 30 body damage with HEAVY_ARMOR -> 30 * (1 - 0.50) = 15 damage
 *
 * Speed penalty stacks multiplicatively with weapon speedMod:
 * Example: RIFLE(0.85) + HEAVY_ARMOR(0.92) -> effective speedMod = 0.85 * 0.92 = 0.782
 */
export const ARMOR: Record<ArmorType, ArmorStats> = {
  /**
   * LIGHT_VEST - Budget armor option.
   * Provides 30% body damage reduction with minimal speed penalty.
   * Does NOT protect legs (legReduction = 0).
   * Good for eco/force-buy rounds where full armor is too expensive.
   */
  LIGHT_VEST: {
    cost: 400,            // Affordable protection
    bodyReduction: 0.30,  // 30% body damage reduction
    legReduction: 0,      // No leg protection
    speedPenalty: 0.97,   // Only 3% speed reduction
  },

  /**
   * HEAVY_ARMOR - Full body protection.
   * Provides 50% body damage reduction AND 15% leg protection.
   * Significant speed penalty (8%) makes positioning more committal.
   * Standard purchase on full-buy rounds.
   */
  HEAVY_ARMOR: {
    cost: 1000,           // Significant investment
    bodyReduction: 0.50,  // 50% body damage reduction (halves body damage)
    legReduction: 0.15,   // 15% leg damage reduction
    speedPenalty: 0.92,   // 8% speed reduction (noticeable)
  },
} as const;

// ----------------------------------------------------------------------------
// UTILITY (GRENADE) DEFINITIONS
// Utility items provide tactical options beyond shooting.
// Each type serves a distinct role in round strategy.
// ----------------------------------------------------------------------------

/**
 * Utility item stats lookup table.
 *
 * Utility is crucial for executing strategies:
 * - SMOKE blocks vision for map control
 * - FLASH blinds enemies for aggressive peeks
 * - FRAG deals burst damage to force enemies off positions
 * - MOLOTOV denies areas with persistent fire damage
 * - DECOY creates fake gunfire sounds to mislead opponents
 */
export const UTILITY: Record<UtilityType, UtilityStats> = {
  /**
   * SMOKE - Vision-blocking cloud.
   * Creates an opaque circle that blocks line-of-sight for 18 seconds.
   * 150px radius is large enough to block a standard chokepoint.
   * Deals no damage. Essential for executing bomb plants and retakes.
   */
  SMOKE: {
    cost: 300,     // Moderately priced for its strategic value
    duration: 18,  // 18 seconds of vision denial
    radius: 150,   // 150px radius smoke cloud
    damage: 0,     // No damage (purely tactical)
  },

  /**
   * FLASH - Blinding grenade.
   * Temporarily blinds enemies within 400px radius for 2 seconds.
   * Blinded soldiers cannot detect enemies and have severely reduced accuracy.
   * Large radius but short duration means timing is critical.
   */
  FLASH: {
    cost: 200,     // Cheapest utility item
    duration: 2,   // 2 seconds of blindness
    radius: 400,   // 400px effect radius (large, but must face it)
    damage: 0,     // No damage (disabling effect only)
  },

  /**
   * FRAG - Explosive fragmentation grenade.
   * Deals up to 100 damage at the center, falling off linearly with distance.
   * At the edge of the 200px radius, damage approaches 0.
   * Damage formula: dmg = 100 * (1 - distance/radius)
   * Instant detonation (duration=0) after thrown trajectory completes.
   */
  FRAG: {
    cost: 300,     // Same price as smoke
    duration: 0,   // Instant explosion (no lingering effect)
    radius: 200,   // 200px blast radius
    damage: 100,   // Maximum damage at center (falls off with distance)
  },

  /**
   * MOLOTOV - Area denial incendiary.
   * Creates a burning area for 7 seconds that deals 25 damage per second.
   * Soldiers standing in the fire take continuous damage (25 DPS).
   * 120px radius is smaller than smoke, designed for doorways and corners.
   * Maximum potential damage: 7 * 25 = 175 (if standing in fire the entire time).
   */
  MOLOTOV: {
    cost: 400,     // Most expensive utility (powerful area denial)
    duration: 7,   // 7 seconds of area denial
    radius: 120,   // 120px fire radius (tight area)
    damage: 25,    // 25 damage per second while in the fire
  },

  /**
   * DECOY - Audio deception device.
   * Produces fake gunfire sounds for 10 seconds within a 300px radius.
   * Enemies within range may react as if a real threat exists.
   * Cheapest item in the game, useful for mind games and fakes.
   * Deals no damage and has no physical effect.
   */
  DECOY: {
    cost: 50,      // Dirt cheap, throwaway purchase
    duration: 10,  // 10 seconds of fake gunfire
    radius: 300,   // 300px audio effect radius
    damage: 0,     // No damage (audio deception only)
  },
} as const;

// ----------------------------------------------------------------------------
// INDIVIDUAL EQUIPMENT COSTS
// Standalone equipment items that are not weapons, armor, or utility.
// ----------------------------------------------------------------------------

/**
 * Cost of a helmet in in-match economy credits.
 * Helmets reduce headshot damage multipliers by 50% (see StatFormulas.ts).
 * Critical purchase against RIFLE users (reduces one-shot headshot potential).
 * Note: The AWP ignores helmet protection entirely.
 */
export const HELMET_COST: number = 350;

/**
 * Cost of a defuse kit in in-match economy credits.
 * Reduces bomb defuse time from 5 seconds to 3 seconds.
 * Only useful for the defending side. Often a crucial purchase
 * that can mean the difference between a successful defuse and a loss.
 */
export const DEFUSE_KIT_COST: number = 400;

/**
 * Fraction by which a helmet reduces the headshot damage multiplier.
 * Applied as: effectiveMult = 1 + (headMult - 1) * (1 - HELMET_HEADSHOT_REDUCTION)
 *
 * Example with RIFLE (headMult=4.0) and helmet:
 *   effectiveMult = 1 + (4.0 - 1) * (1 - 0.5) = 1 + 3.0 * 0.5 = 2.5
 *   Damage: 30 * 2.5 = 75 (survives!) vs 30 * 4.0 = 120 (instant kill without helmet)
 *
 * AWP ignores this reduction entirely (isAwp flag in damage calculation).
 */
export const HELMET_HEADSHOT_REDUCTION: number = 0.5;
