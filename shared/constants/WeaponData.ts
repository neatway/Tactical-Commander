// ============================================================================
// WeaponData.ts
// Concrete stat tables for all weapons, armor, and utility items.
// These tables are the single source of truth for all item stats in the game.
// Used by the buy phase UI, simulation engine, and economy system.
// ============================================================================

import { WeaponId, ArmorType, UtilityType } from '../types/WeaponTypes';
import type { WeaponStats, ArmorStats, UtilityStats } from '../types/WeaponTypes';

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
 * - fireRateMs is in milliseconds between shots (lower = faster)
 * - accuracyModifier multiplies the soldier base accuracy (>1.0 means the weapon helps aim)
 * - speedModifier multiplies movement speed (heavier weapons slow you down)
 */
export const WEAPONS: Record<WeaponId, WeaponStats> = {
  /**
   * PISTOL - Default sidearm, available on eco rounds.
   * Balanced stats with decent headshot multiplier.
   * High kill reward (300) encourages pistol-round aggression.
   * Medium range makes it versatile but not dominant at any distance.
   */
  PISTOL: {
    id: WeaponId.PISTOL,
    name: "Pistol",
    cost: 200,                  // Cheapest weapon, always affordable
    bodyDamage: 25,             // 4 body shots to kill (100 HP, no armor)
    headshotMultiplier: 2.5,    // 62.5 headshot damage -> 2 headshots to kill
    fireRateMs: 400,            // 2.5 shots per second (semi-auto feel)
    magazineSize: 12,           // Small magazine, rewards accuracy
    accuracyModifier: 0.85,     // Slightly reduces base accuracy (small sights)
    speedModifier: 0.95,        // Very light, minimal speed penalty
    killReward: 300,            // Standard kill reward
    rangeRating: 'MEDIUM',      // Effective at moderate distances
  },

  /**
   * SMG - Close quarters spray weapon.
   * Very fast fire rate with large magazine for aggressive pushes.
   * Highest kill reward (600) rewards the risk of getting close.
   * Low accuracy and short range limit effectiveness at distance.
   */
  SMG: {
    id: WeaponId.SMG,
    name: "SMG",
    cost: 1200,                 // Affordable force-buy option
    bodyDamage: 22,             // 5 body shots to kill (no armor)
    headshotMultiplier: 2.0,    // 44 headshot damage -> 3 headshots to kill
    fireRateMs: 100,            // 10 shots per second (full-auto spray)
    magazineSize: 30,           // Large magazine for sustained fire
    accuracyModifier: 0.80,     // Poor base accuracy (spray weapon)
    speedModifier: 0.90,        // Light weapon, decent mobility
    killReward: 600,            // Double standard reward (high risk close-range play)
    rangeRating: 'SHORT',       // Only effective in close quarters
  },

  /**
   * RIFLE - The workhorse primary weapon.
   * Best-in-class headshot multiplier (4x) rewards precise aimers.
   * Balanced cost, range, and fire rate make it the standard buy.
   * Accuracy modifier of 1.0 means it uses the soldier true accuracy.
   */
  RIFLE: {
    id: WeaponId.RIFLE,
    name: "Assault Rifle",
    cost: 2700,                 // Standard full-buy primary
    bodyDamage: 30,             // 4 body shots to kill (no armor)
    headshotMultiplier: 4.0,    // 120 headshot damage -> instant headshot kill!
    fireRateMs: 120,            // ~8.3 shots per second (burst/tap-fire effective)
    magazineSize: 30,           // Standard magazine
    accuracyModifier: 1.0,      // Neutral accuracy (soldier true skill shows)
    speedModifier: 0.85,        // Moderate weight, noticeable speed reduction
    killReward: 300,            // Standard kill reward
    rangeRating: 'LONG',        // Effective at long range
  },

  /**
   * AWP - High-risk, high-reward sniper rifle.
   * Massive body damage (85) means 1-shot kill against unarmored targets
   * and 2-shot kill against heavy armor. Very slow fire rate punishes misses.
   * Lowest kill reward (100) balances its incredible lethality.
   * Heaviest weapon in the game (0.78 speed modifier).
   */
  AWP: {
    id: WeaponId.AWP,
    name: "AWP",
    cost: 4750,                 // Most expensive weapon, major economy investment
    bodyDamage: 85,             // Near one-shot kill to body (85 damage)
    headshotMultiplier: 1.2,    // 102 headshot damage -> guaranteed one-shot headshot
    fireRateMs: 1500,           // 0.67 shots per second (bolt-action feel)
    magazineSize: 5,            // Tiny magazine, every shot counts
    accuracyModifier: 1.15,     // BEST accuracy modifier (scope advantage)
    speedModifier: 0.78,        // Heaviest weapon, severe speed penalty
    killReward: 100,            // Lowest reward (weapon is already very powerful)
    rangeRating: 'VERY_LONG',   // Maximum effective range
  },

  /**
   * SHOTGUN - Point-blank devastation.
   * bodyDamage of 18 represents EACH of 8 pellets (18 x 8 = 144 max damage).
   * At close range, all pellets hit for a guaranteed one-shot kill.
   * At distance, pellets spread and fewer connect, making it useless.
   * Highest kill reward (900) massively rewards getting close enough.
   */
  SHOTGUN: {
    id: WeaponId.SHOTGUN,
    name: "Shotgun",
    cost: 1800,                 // Mid-range cost, situational purchase
    bodyDamage: 18,             // Per-pellet damage (x8 pellets = 144 max total body damage)
    headshotMultiplier: 1.0,    // No headshot bonus (pellet spread is random)
    fireRateMs: 900,            // ~1.1 shots per second (pump-action feel)
    magazineSize: 7,            // Tube magazine, slow reload per shell
    accuracyModifier: 0.70,     // Worst accuracy (spread is the point)
    speedModifier: 0.90,        // Moderate weight, decent mobility for rushing
    killReward: 900,            // Highest reward (extreme risk required to use)
    rangeRating: 'SHORT',       // Only effective at close range (VERY_SHORT not in type)
  },

  /**
   * LMG - Suppression and area denial weapon.
   * Massive 100-round magazine for sustained fire. Fastest fire rate in class.
   * Good damage and range but heavy weight makes repositioning slow.
   * Best used for holding angles and suppressing enemy movement.
   */
  LMG: {
    id: WeaponId.LMG,
    name: "Light Machine Gun",
    cost: 5200,                 // Very expensive, committed purchase
    bodyDamage: 28,             // 4 body shots to kill (no armor)
    headshotMultiplier: 3.0,    // 84 headshot damage -> 2 headshots to kill
    fireRateMs: 80,             // 12.5 shots per second (fastest fire rate)
    magazineSize: 100,          // Enormous magazine for sustained suppression
    accuracyModifier: 0.90,     // Slightly below neutral (hard to control)
    speedModifier: 0.80,        // Very heavy, significant speed penalty
    killReward: 300,            // Standard kill reward
    rangeRating: 'LONG',        // Effective at long range (belt-fed stability)
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
 * Speed penalty stacks multiplicatively with weapon speedModifier:
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
    type: ArmorType.LIGHT_VEST,
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
    type: ArmorType.HEAVY_ARMOR,
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
    type: UtilityType.SMOKE,
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
    type: UtilityType.FLASH,
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
    type: UtilityType.FRAG,
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
    type: UtilityType.MOLOTOV,
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
    type: UtilityType.DECOY,
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
 * Example with RIFLE (headshotMultiplier=4.0) and helmet:
 *   effectiveMult = 1 + (4.0 - 1) * (1 - 0.5) = 1 + 3.0 * 0.5 = 2.5
 *   Damage: 30 * 2.5 = 75 (survives!) vs 30 * 4.0 = 120 (instant kill without helmet)
 *
 * AWP ignores this reduction entirely (isAwp flag in damage calculation).
 */
export const HELMET_HEADSHOT_REDUCTION: number = 0.5;
