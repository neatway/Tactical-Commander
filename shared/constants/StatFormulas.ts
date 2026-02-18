// ============================================================================
// StatFormulas.ts
// The mathematical heart of the tactical commander game.
//
// This module contains ALL pure functions that compute soldier performance
// during the live simulation phase. Every formula is deterministic given
// the same inputs (except where an explicit RNG function is passed in).
//
// STAT ABBREVIATIONS used throughout:
//   ACC = Accuracy       (affects hit chance and headshot probability)
//   REA = Reaction Time  (affects how fast a soldier responds to threats)
//   SPD = Speed          (affects movement speed in pixels per second)
//   STL = Stealth        (reduces enemy detection probability)
//   AWR = Awareness      (increases detection radius and chance)
//   RCL = Recoil Control (reduces accuracy loss during sustained fire)
//   CMP = Composure      (maintains performance under pressure)
//   CLT = Clutch         (bonus performance when last alive)
//   TWK = Teamwork       (bonus when near allies)
//
// All stat values range from 1-100 (see SOLDIER constants in GameConstants.ts).
// ============================================================================

// ----------------------------------------------------------------------------
// UTILITY: Clamp helper
// Used extensively to bound formula outputs within safe ranges.
// ----------------------------------------------------------------------------

/**
 * Clamps a numeric value between a minimum and maximum bound.
 * This is used throughout the stat formulas to ensure outputs stay
 * within game-balanced ranges and prevent edge-case exploits.
 *
 * @param value - The raw value to clamp
 * @param min - The minimum allowed value (inclusive)
 * @param max - The maximum allowed value (inclusive)
 * @returns The clamped value, guaranteed to be within [min, max]
 *
 * @example
 * clamp(150, 0, 100)  // returns 100
 * clamp(-5, 0, 100)   // returns 0
 * clamp(50, 0, 100)   // returns 50
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ----------------------------------------------------------------------------
// MOVEMENT AND DETECTION FORMULAS
// These determine how fast soldiers move and how well they spot enemies.
// Movement speed is in pixels per second (the simulation runs in pixel space).
// Detection uses a cone-based model with awareness-scaled radius.
// ----------------------------------------------------------------------------

/**
 * Calculates a soldier's movement speed in pixels per second.
 *
 * Formula: BASE_SPEED * (0.5 + spd/100) * weaponSpeedMod * armorSpeedPenalty
 *
 * The (0.5 + spd/100) term creates a linear scale from 50% to 150% of base:
 *   - SPD=1:   0.5 + 0.01 = 0.51 -> 200 * 0.51 = 102 px/s (very slow)
 *   - SPD=50:  0.5 + 0.50 = 1.00 -> 200 * 1.00 = 200 px/s (baseline)
 *   - SPD=100: 0.5 + 1.00 = 1.50 -> 200 * 1.50 = 300 px/s (maximum)
 *
 * After stat scaling, weapon and armor modifiers reduce the final value:
 *   Example: SPD=50, RIFLE(0.85), HEAVY_ARMOR(0.92)
 *   -> 200 * 1.0 * 0.85 * 0.92 = 156.4 px/s
 *
 * @param spd - The soldier's SPD stat (1-100)
 * @param weaponSpeedMod - Weapon speed modifier (e.g., 0.85 for RIFLE)
 * @param armorSpeedPenalty - Armor speed penalty (e.g., 0.92 for HEAVY_ARMOR, 1.0 for none)
 * @returns Movement speed in pixels per second
 */
export function calculateMovementSpeed(
  spd: number,
  weaponSpeedMod: number,
  armorSpeedPenalty: number
): number {
  /** Base movement speed in pixels per second at SPD=50 with no equipment penalties */
  const BASE_SPEED = 200;

  return BASE_SPEED * (0.5 + spd / 100) * weaponSpeedMod * armorSpeedPenalty;
}

/**
 * Calculates the radius (in pixels) at which a soldier can detect enemies.
 *
 * Formula: BASE_RADIUS * (0.4 + awr/83.3)
 *
 * The divisor of 83.3 is chosen so that AWR=50 gives exactly the base radius:
 *   0.4 + 50/83.3 = 0.4 + 0.6 = 1.0 -> 400 * 1.0 = 400 px
 *
 * Example values:
 *   - AWR=1:   400 * (0.4 + 0.012) = 400 * 0.412 = ~165 px (nearly blind)
 *   - AWR=50:  400 * (0.4 + 0.600) = 400 * 1.000 = 400 px  (baseline)
 *   - AWR=100: 400 * (0.4 + 1.200) = 400 * 1.600 = 640 px  (eagle-eyed)
 *
 * This radius defines the maximum distance at which a detection roll can occur.
 * The actual detection probability also depends on the enemy's STL stat.
 *
 * @param awr - The soldier's AWR (Awareness) stat (1-100)
 * @returns Detection radius in pixels
 */
export function calculateDetectionRadius(awr: number): number {
  /** Base detection radius in pixels at AWR=50 */
  const BASE_RADIUS = 400;

  return BASE_RADIUS * (0.4 + awr / 83.3);
}

/**
 * Calculates the stealth modifier that reduces an enemy's detection chance.
 *
 * Formula: 1.0 - stl/200
 *
 * This produces a multiplier between 0.5 and 1.0:
 *   - STL=0:   1.0 - 0/200   = 1.00 (no stealth benefit, full visibility)
 *   - STL=50:  1.0 - 50/200  = 0.75 (25% harder to detect)
 *   - STL=100: 1.0 - 100/200 = 0.50 (50% harder to detect, maximum stealth)
 *
 * Applied as a multiplier to the enemy's effective detection radius:
 *   effectiveRadius = detectionRadius * stealthModifier
 *
 * @param stl - The soldier's STL (Stealth) stat (0-100)
 * @returns Stealth modifier between 0.5 and 1.0 (lower = stealthier)
 */
export function calculateStealthModifier(stl: number): number {
  return 1.0 - stl / 200;
}

/**
 * Calculates the probability of detecting an enemy on a single simulation tick.
 *
 * Formula: clamp(0.3 + awr/200 - enemyStl/300, 0.05, 0.8)
 *
 * This is a per-tick (200ms) probability, meaning:
 *   - At 0.3 base probability with 5 ticks/second, an average soldier
 *     has ~83% chance to detect within 1 second (1 - 0.7^5)
 *   - High AWR increases detection; high enemy STL decreases it
 *
 * Bounds: minimum 5% (always some chance), maximum 80% (never guaranteed)
 *
 * Example scenarios:
 *   AWR=50, enemy STL=50: 0.3 + 0.25 - 0.167 = 0.383 (38.3% per tick)
 *   AWR=100, enemy STL=1: 0.3 + 0.5 - 0.003 = 0.797 -> clamped to 0.8
 *   AWR=1, enemy STL=100: 0.3 + 0.005 - 0.333 = -0.028 -> clamped to 0.05
 *
 * @param awr - The detecting soldier's AWR stat (1-100)
 * @param enemyStl - The target enemy's STL stat (1-100)
 * @returns Detection probability per 200ms tick, clamped to [0.05, 0.8]
 */
export function calculateDetectionChance(awr: number, enemyStl: number): number {
  return clamp(0.3 + awr / 200 - enemyStl / 300, 0.05, 0.8);
}

// ----------------------------------------------------------------------------
// COMBAT FORMULAS: Reaction Time and Hit Chance
// These determine how quickly soldiers react and how accurately they shoot.
// The core combat loop is: detect -> react -> aim -> fire -> hit/miss.
// ----------------------------------------------------------------------------

/**
 * Calculates how long a soldier takes to react after detecting an enemy.
 *
 * Formula: max(100, 800 - rea*6 + (rng()*100 - 50))
 *
 * The base reaction time is 800ms, reduced by 6ms per point of REA.
 * A random jitter of +/- 50ms prevents perfectly predictable timing.
 * The minimum is floored at 100ms (human reflex limit).
 *
 * Example values (without jitter, which adds +/- 50ms):
 *   - REA=1:   max(100, 800 - 6 + 0)   = 794ms (very slow, nearly 0.8s)
 *   - REA=50:  max(100, 800 - 300 + 0)  = 500ms (half-second reaction)
 *   - REA=100: max(100, 800 - 600 + 0)  = 200ms (lightning reflexes)
 *
 * With jitter (rng adds -50 to +50):
 *   - REA=1:   ~744-844ms range
 *   - REA=50:  ~450-550ms range
 *   - REA=100: ~150-250ms range
 *
 * Note: The result is in milliseconds and represents the delay before
 * the soldier begins firing after detecting an enemy.
 *
 * @param rea - The soldier's REA (Reaction Time) stat (1-100)
 * @param rng - A random number generator function returning [0, 1)
 * @returns Reaction time in milliseconds, minimum 100ms
 */
export function calculateReactionTime(rea: number, rng: () => number): number {
  return Math.max(100, 800 - rea * 6 + (rng() * 100 - 50));
}

/**
 * Calculates the base probability of hitting a target (before modifiers).
 *
 * Formula: 0.15 + acc * 0.007
 *
 * This creates a linear scale from 15.7% to 85%:
 *   - ACC=1:   0.15 + 0.007   = 0.157 (15.7% - terrible aim)
 *   - ACC=50:  0.15 + 0.350   = 0.500 (50.0% - coin flip per shot)
 *   - ACC=100: 0.15 + 0.700   = 0.850 (85.0% - extremely accurate)
 *
 * This base chance is then modified by distance, movement, weapon accuracy,
 * recoil, and composure/clutch/teamwork modifiers.
 *
 * @param acc - The soldier's ACC (Accuracy) stat (1-100)
 * @returns Base hit probability between 0.157 and 0.85
 */
export function calculateBaseHitChance(acc: number): number {
  return 0.15 + acc * 0.007;
}

/**
 * Calculates the distance-based accuracy modifier.
 *
 * Formula: max(0.3, 1.0 - distancePixels/1500)
 *
 * Accuracy decreases linearly with distance, floored at 30%:
 *   - 0px:    1.0 - 0     = 1.00 (point blank, full accuracy)
 *   - 375px:  1.0 - 0.25  = 0.75 (close range, 75%)
 *   - 750px:  1.0 - 0.50  = 0.50 (medium range, 50%)
 *   - 1050px: 1.0 - 0.70  = 0.30 (long range, minimum 30%)
 *   - 1500px: 1.0 - 1.00  = 0.30 (clamped at floor)
 *
 * Note: This is a universal distance modifier. Weapon range categories
 * may additionally affect this via the weapon's accMod stat.
 *
 * @param distancePixels - Distance to target in pixels
 * @returns Distance accuracy modifier, minimum 0.3
 */
export function calculateDistanceModifier(distancePixels: number): number {
  return Math.max(0.3, 1.0 - distancePixels / 1500);
}

/**
 * Calculates the final hit probability after all modifiers are applied.
 *
 * Formula: clamp(baseHit * distanceMod * movingMod * weaponAccMod, 0.05, 0.95)
 *
 * Combines four factors:
 * 1. Base hit chance (from soldier ACC stat)
 * 2. Distance modifier (further = harder to hit)
 * 3. Moving penalty (0.5x if moving, 1.0x if stationary)
 * 4. Weapon accuracy modifier (from WeaponData accMod)
 *
 * The result is clamped to [0.05, 0.95] so there is always:
 *   - At least a 5% chance to hit (lucky shot)
 *   - At most a 95% chance to hit (never guaranteed)
 *
 * Example: ACC=70 soldier, 500px away, standing still, with RIFLE(accMod=1.0)
 *   baseHit    = 0.15 + 70*0.007 = 0.64
 *   distMod    = max(0.3, 1.0 - 500/1500) = 0.667
 *   movingMod  = 1.0 (not moving)
 *   weaponMod  = 1.0 (rifle)
 *   final      = 0.64 * 0.667 * 1.0 * 1.0 = 0.427 (42.7% hit chance)
 *
 * Same scenario but moving with SMG:
 *   baseHit    = 0.64
 *   distMod    = 0.667
 *   movingMod  = 0.5 (moving)
 *   weaponMod  = 0.80 (SMG)
 *   final      = 0.64 * 0.667 * 0.5 * 0.80 = 0.171 (17.1% hit chance)
 *
 * @param acc - The soldier's ACC stat (1-100)
 * @param distance - Distance to target in pixels
 * @param isMoving - Whether the shooting soldier is currently moving
 * @param weaponAccMod - The weapon's accuracy modifier from WeaponData
 * @returns Final hit probability, clamped to [0.05, 0.95]
 */
export function calculateFinalHitChance(
  acc: number,
  distance: number,
  isMoving: boolean,
  weaponAccMod: number
): number {
  /** Base hit probability from soldier ACC stat */
  const baseHit = calculateBaseHitChance(acc);

  /** Distance-based accuracy falloff */
  const distanceMod = calculateDistanceModifier(distance);

  /** Movement penalty: halved accuracy while moving */
  const movingMod = isMoving ? 0.5 : 1.0;

  return clamp(baseHit * distanceMod * movingMod * weaponAccMod, 0.05, 0.95);
}

/**
 * Calculates the probability of a hit being a headshot.
 *
 * Formula: 0.10 + acc/500
 *
 * Headshot chance scales linearly from 10% to 30% with ACC:
 *   - ACC=1:   0.10 + 0.002 = 0.102 (10.2% - rarely hits the head)
 *   - ACC=50:  0.10 + 0.100 = 0.200 (20.0% - decent headshot rate)
 *   - ACC=100: 0.10 + 0.200 = 0.300 (30.0% - one in three hits is a headshot)
 *
 * This probability is checked AFTER a hit is confirmed.
 * So the effective headshot-per-shot rate is: hitChance * headshotChance.
 *
 * @param acc - The soldier's ACC stat (1-100)
 * @returns Headshot probability (given that a hit occurred), 10-30%
 */
export function calculateHeadshotChance(acc: number): number {
  return 0.10 + acc / 500;
}

// ----------------------------------------------------------------------------
// COMBAT FORMULAS: Spray Control and Situational Modifiers
// These handle sustained fire accuracy decay and psychological factors
// that affect soldier performance under various combat conditions.
// ----------------------------------------------------------------------------

/**
 * Calculates accuracy degradation during sustained automatic fire (spraying).
 *
 * Formula: baseHitChance * max(0.3, 1.0 - shotsFired*0.08 + rcl*0.0006*shotsFired)
 *
 * As a soldier fires more shots without pause, accuracy degrades due to recoil.
 * The RCL (Recoil Control) stat mitigates this degradation.
 *
 * The spray multiplier breaks down as:
 *   - 1.0: Starting accuracy (first shot)
 *   - -0.08 per shot: Base degradation (8% per shot)
 *   - +0.0006 * rcl per shot: RCL mitigation per shot
 *   - Floor at 0.3: Spray never drops below 30% of base accuracy
 *
 * Example: baseHit=0.5, shotsFired=10, RCL=50
 *   multiplier = max(0.3, 1.0 - 10*0.08 + 50*0.0006*10)
 *              = max(0.3, 1.0 - 0.8 + 0.3) = max(0.3, 0.5) = 0.5
 *   result = 0.5 * 0.5 = 0.25 (25% hit chance after 10 shots)
 *
 * Example: baseHit=0.5, shotsFired=10, RCL=100
 *   multiplier = max(0.3, 1.0 - 0.8 + 0.6) = max(0.3, 0.8) = 0.8
 *   result = 0.5 * 0.8 = 0.40 (40% hit chance - much better recoil control!)
 *
 * @param baseHitChance - The base hit probability before spray degradation
 * @param shotsFired - Number of consecutive shots fired in current burst
 * @param rcl - The soldier's RCL (Recoil Control) stat (1-100)
 * @returns Spray-adjusted hit probability
 */
export function calculateSprayAccuracy(
  baseHitChance: number,
  shotsFired: number,
  rcl: number
): number {
  /** Spray accuracy multiplier, floored at 0.3 to prevent total inaccuracy */
  const sprayMultiplier = Math.max(
    0.3,
    1.0 - shotsFired * 0.08 + rcl * 0.0006 * shotsFired
  );

  return baseHitChance * sprayMultiplier;
}

/**
 * Calculates the composure modifier that affects accuracy under pressure.
 *
 * When a soldier is in a stressful situation (low HP or outnumbered),
 * their accuracy is penalized unless they have high CMP (Composure).
 *
 * Stress condition: HP < 30 OR enemiesVisible > alliesNearby + 1
 *
 * Under stress:
 *   Formula: 0.6 + cmp * 0.004
 *   - CMP=1:   0.6 + 0.004 = 0.604 (40% accuracy penalty under stress)
 *   - CMP=50:  0.6 + 0.200 = 0.800 (20% penalty - holds composure better)
 *   - CMP=100: 0.6 + 0.400 = 1.000 (no penalty at all - ice cold!)
 *
 * Not under stress: always returns 1.0 (no effect)
 *
 * @param cmp - The soldier's CMP (Composure) stat (1-100)
 * @param hp - The soldier's current health points
 * @param enemiesVisible - Number of detected enemy soldiers
 * @param alliesNearby - Number of allied soldiers within support range
 * @returns Composure multiplier (0.6-1.0 under stress, 1.0 otherwise)
 */
export function calculateComposureModifier(
  cmp: number,
  hp: number,
  enemiesVisible: number,
  alliesNearby: number
): number {
  /** Check if the soldier is under stress */
  const isUnderStress = hp < 30 || enemiesVisible > alliesNearby + 1;

  if (isUnderStress) {
    // Under stress: CMP determines how much accuracy is retained
    // CMP=0 -> 60% accuracy, CMP=100 -> 100% accuracy
    return 0.6 + cmp * 0.004;
  }

  // Not under stress: no composure modifier needed
  return 1.0;
}

/**
 * Calculates the clutch modifier bonus when a soldier is the last one alive.
 *
 * When alliesAlive === 0, the soldier enters "clutch mode" and receives
 * a performance bonus scaled by their CLT (Clutch) stat.
 *
 * In clutch (alliesAlive === 0):
 *   Formula: 1.0 + clt * 0.003
 *   - CLT=1:   1.0 + 0.003 = 1.003 (negligible bonus)
 *   - CLT=50:  1.0 + 0.150 = 1.150 (15% accuracy bonus)
 *   - CLT=100: 1.0 + 0.300 = 1.300 (30% accuracy bonus - clutch god!)
 *
 * Not in clutch: always returns 1.0 (no effect)
 *
 * This modifier rewards investing in CLT for designated last-stand soldiers.
 *
 * @param clt - The soldier's CLT (Clutch) stat (1-100)
 * @param alliesAlive - Number of allied soldiers still alive in the round
 * @returns Clutch multiplier (1.0-1.3 in clutch, 1.0 otherwise)
 */
export function calculateClutchModifier(clt: number, alliesAlive: number): number {
  if (alliesAlive === 0) {
    // Last soldier standing: CLT bonus activates
    return 1.0 + clt * 0.003;
  }

  // Allies still alive: no clutch bonus
  return 1.0;
}

/**
 * Calculates the teamwork modifier bonus when near an ally.
 *
 * When an allied soldier is within 300 pixels, the soldier receives
 * a coordination bonus scaled by their TWK (Teamwork) stat.
 *
 * Ally within 300px:
 *   Formula: 1.0 + twk * 0.002
 *   - TWK=1:   1.0 + 0.002 = 1.002 (negligible bonus)
 *   - TWK=50:  1.0 + 0.100 = 1.100 (10% accuracy bonus)
 *   - TWK=100: 1.0 + 0.200 = 1.200 (20% accuracy bonus - perfect synergy!)
 *
 * No ally nearby: always returns 1.0 (no effect)
 *
 * This encourages keeping soldiers in pairs/groups rather than spreading out.
 * Trade-off: grouped soldiers are more vulnerable to utility (FRAG, MOLOTOV).
 *
 * @param twk - The soldier's TWK (Teamwork) stat (1-100)
 * @param allyWithin300px - Whether at least one ally is within 300 pixels
 * @returns Teamwork multiplier (1.0-1.2 with ally, 1.0 otherwise)
 */
export function calculateTeamworkModifier(twk: number, allyWithin300px: boolean): number {
  if (allyWithin300px) {
    // Allied soldier nearby: TWK bonus activates
    return 1.0 + twk * 0.002;
  }

  // No allies nearby: no teamwork bonus
  return 1.0;
}

// ----------------------------------------------------------------------------
// DAMAGE CALCULATION
// The final damage formula combines weapon stats, hit location,
// armor protection, and helmet effects.
// ----------------------------------------------------------------------------

/**
 * Calculates the final damage dealt by a single hit.
 *
 * Damage calculation flow:
 * 1. Start with weapon base body damage
 * 2. Apply hit location multiplier:
 *    - 'head': multiply by headshot multiplier (reduced by helmet if applicable)
 *    - 'body': multiply by 1.0 (base damage)
 *    - 'legs': multiply by 0.75 (reduced damage)
 * 3. Apply armor damage reduction based on hit location:
 *    - 'head': no armor reduction (helmets are handled separately via headshot mult)
 *    - 'body': reduce by armor bodyReduction
 *    - 'legs': reduce by armor legReduction
 *
 * Helmet mechanics:
 *   - Reduces the headshot multiplier by HELMET_HEADSHOT_REDUCTION (50%)
 *   - Formula: effectiveMult = 1 + (headMult - 1) * (1 - 0.5) = 1 + (headMult-1)*0.5
 *   - EXCEPTION: AWP ignores helmet protection entirely (isAwp=true bypasses reduction)
 *
 * Examples:
 *   RIFLE headshot, no helmet:  30 * 4.0 = 120 damage (instant kill)
 *   RIFLE headshot, with helmet: 30 * (1 + 3.0*0.5) = 30 * 2.5 = 75 damage (survives!)
 *   AWP headshot, with helmet:  85 * 1.2 = 102 damage (helmet ignored, still kills)
 *   RIFLE body, HEAVY_ARMOR:   30 * 1.0 * (1 - 0.50) = 15 damage
 *   RIFLE legs, HEAVY_ARMOR:   30 * 0.75 * (1 - 0.15) = 19.1 damage
 *   SMG body, no armor:        22 * 1.0 * (1 - 0) = 22 damage
 *
 * @param weaponBodyDmg - Base body damage of the weapon
 * @param headshotMult - Weapon's headshot damage multiplier
 * @param hitLocation - Where the shot landed: 'head', 'body', or 'legs'
 * @param armorBodyReduction - Armor's body damage reduction fraction (0-1, or 0 if no armor)
 * @param armorLegReduction - Armor's leg damage reduction fraction (0-1, or 0 if no armor)
 * @param hasHelmet - Whether the target is wearing a helmet
 * @param isAwp - Whether the weapon is an AWP (ignores helmet protection)
 * @returns Final damage dealt to the target
 */
export function calculateDamage(
  weaponBodyDmg: number,
  headshotMult: number,
  hitLocation: 'head' | 'body' | 'legs',
  armorBodyReduction: number,
  armorLegReduction: number,
  hasHelmet: boolean,
  isAwp: boolean
): number {
  /** Start with the weapon's base body damage */
  let damage = weaponBodyDmg;

  switch (hitLocation) {
    case 'head': {
      /**
       * Calculate effective headshot multiplier.
       * Helmet reduces the bonus portion of the multiplier by 50%,
       * but the AWP ignores helmet protection entirely.
       */
      let effectiveMult = headshotMult;

      if (hasHelmet && !isAwp) {
        // Helmet reduces the BONUS portion (mult - 1) by 50%
        // effectiveMult = 1 + (headshotMult - 1) * 0.5
        effectiveMult = 1 + (headshotMult - 1) * (1 - 0.5);
      }

      damage = weaponBodyDmg * effectiveMult;
      // Headshots are NOT reduced by body/leg armor
      break;
    }

    case 'body': {
      // Body shots receive the full armor body reduction
      damage = weaponBodyDmg * (1 - armorBodyReduction);
      break;
    }

    case 'legs': {
      /** Legs take 75% of body damage, then armor leg reduction is applied */
      const LEG_DAMAGE_MULTIPLIER = 0.75;
      damage = weaponBodyDmg * LEG_DAMAGE_MULTIPLIER * (1 - armorLegReduction);
      break;
    }
  }

  return damage;
}

// ----------------------------------------------------------------------------
// ECONOMY: Training Cost
// Training costs scale with the soldier's current stat level and rarity.
// Higher stats and rarer soldiers are more expensive to train.
// ----------------------------------------------------------------------------

/**
 * Calculates the coin cost to train a soldier's stat by one point.
 *
 * Formula: 100 * (currentStatValue / 50) * rarityMultiplier
 *
 * The cost scales linearly with the current stat value:
 *   - Training from 10->11: 100 * (10/50) * mult = 20 * mult
 *   - Training from 50->51: 100 * (50/50) * mult = 100 * mult
 *   - Training from 90->91: 100 * (90/50) * mult = 180 * mult
 *
 * Rarity multipliers make higher-rarity soldiers more expensive to train:
 *   - COMMON:    0.8x  (cheapest to train, but lowest base stats)
 *   - UNCOMMON:  1.0x  (baseline training cost)
 *   - RARE:      1.2x  (slightly more expensive)
 *   - EPIC:      1.5x  (noticeably more expensive)
 *   - LEGENDARY: 2.0x  (very expensive, but highest base stats)
 *
 * Example: Training a RARE soldier's stat from 70 to 71:
 *   cost = 100 * (70/50) * 1.2 = 100 * 1.4 * 1.2 = 168 coins
 *
 * @param currentStatValue - The current value of the stat being trained (1-100)
 * @param rarityMultiplier - Cost multiplier based on soldier rarity
 *                           (COMMON=0.8, UNCOMMON=1.0, RARE=1.2, EPIC=1.5, LEGENDARY=2.0)
 * @returns The coin cost to increase this stat by 1 point
 */
export function calculateTrainingCost(
  currentStatValue: number,
  rarityMultiplier: number
): number {
  /** Base cost per training point at stat value 50 */
  const BASE_TRAINING_COST = 100;

  return BASE_TRAINING_COST * (currentStatValue / 50) * rarityMultiplier;
}
