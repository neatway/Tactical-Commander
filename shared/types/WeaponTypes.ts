// ============================================================================
// WeaponTypes.ts
// Types for all purchasable equipment: weapons, armor, utility grenades,
// and the full equipment loadout a soldier carries into a round.
// ============================================================================

/**
 * WeaponId enumerates all weapon categories available for purchase.
 * Each category represents a class of firearm with distinct characteristics.
 * Soldiers can carry one primary weapon and one sidearm (always a PISTOL).
 */
export enum WeaponId {
  /**
   * PISTOL: Default sidearm given to every soldier for free each round.
   * Low damage but decent accuracy. Used when no primary is purchased
   * or as a backup when the primary runs dry.
   */
  PISTOL = "PISTOL",

  /**
   * SMG: Submachine gun -- cheap, fast-firing, but limited damage at range.
   * Good for eco rounds or close-quarters maps. High mobility.
   */
  SMG = "SMG",

  /**
   * RIFLE: The bread-and-butter primary weapon for most soldiers.
   * Balanced damage, accuracy, and fire rate. Effective at all ranges.
   * The standard choice for full-buy rounds.
   */
  RIFLE = "RIFLE",

  /**
   * AWP: High-powered sniper rifle. One-shot kill to the body or head.
   * Extremely expensive with a slow fire rate and heavy movement penalty.
   * Best used by soldiers with the AWPER profile.
   */
  AWP = "AWP",

  /**
   * SHOTGUN: Close-range devastation with massive damage per shot.
   * Nearly useless at medium or long range. Very cheap.
   * Situational pick for tight corridors and aggressive pushes.
   */
  SHOTGUN = "SHOTGUN",

  /**
   * LMG: Light machine gun with a massive magazine and sustained fire.
   * High damage output over time but poor accuracy and heavy weight.
   * Good for suppression and holding choke points.
   */
  LMG = "LMG",
}

/**
 * ArmorType defines the two tiers of body armor available for purchase.
 * Armor absorbs a percentage of incoming damage to the body and legs,
 * extending the soldier effective health pool.
 */
export enum ArmorType {
  /**
   * LIGHT_VEST: Affordable armor offering moderate damage reduction.
   * Reduces body damage by a smaller percentage with minimal speed penalty.
   * Good for eco or force-buy rounds when funds are limited.
   */
  LIGHT_VEST = "LIGHT_VEST",

  /**
   * HEAVY_ARMOR: Premium armor offering substantial damage reduction.
   * Reduces body and leg damage significantly but imposes a speed penalty.
   * Standard purchase on full-buy rounds for maximum survivability.
   */
  HEAVY_ARMOR = "HEAVY_ARMOR",
}

/**
 * UtilityType enumerates the tactical grenades and throwable items.
 * Each utility type serves a distinct tactical purpose and is consumed on use.
 * Soldiers can carry a maximum of 4 utility items total.
 */
export enum UtilityType {
  /**
   * SMOKE: Deploys a smoke cloud that blocks line of sight.
   * Used to obscure angles, block sightlines, and enable safe crossings.
   * Does not deal damage. Duration-based effect.
   */
  SMOKE = "SMOKE",

  /**
   * FLASH: Flashbang grenade that temporarily blinds enemies in its radius.
   * Used before peeking angles or entering bomb sites to gain an advantage.
   * Affects both enemies and allies if they are looking at the detonation.
   */
  FLASH = "FLASH",

  /**
   * FRAG: High-explosive fragmentation grenade that deals area damage.
   * Used to clear corners, force enemies out of cover, or deal chip damage.
   * Damage falls off with distance from the center of the explosion.
   */
  FRAG = "FRAG",

  /**
   * MOLOTOV: Incendiary grenade that creates a burning area on the ground.
   * Used to deny area access, flush enemies out of positions, or delay pushes.
   * Deals damage over time to any soldier standing in the fire zone.
   */
  MOLOTOV = "MOLOTOV",

  /**
   * DECOY: Fake grenade that produces gunshot sounds at its landing location.
   * Used to create false information, simulate presence, or mask real attacks.
   * Deals no damage. Very cheap but situationally useful.
   */
  DECOY = "DECOY",
}

/**
 * WeaponStats holds the full statistical profile of a weapon category.
 * These values drive the combat simulation: damage calculations, fire rate,
 * accuracy modifiers, and economic impact (cost and kill reward).
 */
export interface WeaponStats {
  /**
   * The unique identifier for this weapon, matching a WeaponId enum value.
   * Used to look up this weapon stats from a registry or map.
   * @see WeaponId
   */
  id: WeaponId;

  /**
   * Human-readable display name for the weapon (e.g., "Assault Rifle", "AWP").
   * Shown in the buy menu, kill feed, and equipment overlay.
   */
  name: string;

  /**
   * Purchase cost in in-game currency.
   * Deducted from the player economy during BUY_PHASE.
   * Higher cost generally correlates with weapon effectiveness.
   */
  cost: number;

  /**
   * Base damage dealt per bullet when hitting the body (torso).
   * Actual damage is modified by armor, distance, and hit location.
   * This is the reference value before any multipliers are applied.
   */
  bodyDamage: number;

  /**
   * Damage multiplier applied when a bullet hits the head.
   * Final headshot damage = bodyDamage * headshotMultiplier.
   * Helmets may reduce this further. Typically ranges from 2.0 to 4.0.
   */
  headshotMultiplier: number;

  /**
   * Time between consecutive shots in milliseconds.
   * Lower values mean faster fire rate. Determines DPS potential.
   * For bolt-action weapons like the AWP, this includes the cycling animation.
   */
  fireRateMs: number;

  /**
   * Number of bullets in a full magazine before reloading is required.
   * Larger magazines sustain fire longer but are typically found on
   * less precise weapons (SMGs, LMGs).
   */
  magazineSize: number;

  /**
   * Multiplier applied to the soldier base accuracy stat when using this weapon.
   * Values > 1.0 improve accuracy; values < 1.0 reduce it.
   * Sniper rifles have high modifiers; SMGs and shotguns have low ones.
   */
  accuracyModifier: number;

  /**
   * Multiplier applied to the soldier base movement speed when this weapon is equipped.
   * Values < 1.0 slow the soldier down (heavy weapons like AWP and LMG).
   * Values close to 1.0 allow near-full speed (pistols, SMGs).
   */
  speedModifier: number;

  /**
   * Bonus in-game currency awarded to the player when this weapon scores a kill.
   * Cheaper weapons typically award more money per kill to reward risky eco plays.
   * Added to the player economy at the end of the round.
   */
  killReward: number;

  /**
   * The effective engagement range category for this weapon.
   * Determines at which distances the weapon performs optimally.
   * - SHORT: Effective up to close range (shotguns, some SMGs).
   * - MEDIUM: Effective at mid range (SMGs, some rifles).
   * - LONG: Effective at long range (rifles, LMGs).
   * - VERY_LONG: Effective at extreme range (AWP).
   */
  rangeRating: "SHORT" | "MEDIUM" | "LONG" | "VERY_LONG";
}

/**
 * ArmorStats defines the protective properties and costs of an armor type.
 * Armor reduces incoming damage to specific body regions and has
 * an associated movement speed penalty as a tradeoff.
 */
export interface ArmorStats {
  /**
   * The armor type these stats belong to.
   * @see ArmorType
   */
  type: ArmorType;

  /**
   * Purchase cost in in-game currency.
   * Deducted from the player economy during BUY_PHASE.
   */
  cost: number;

  /**
   * Percentage of body (torso) damage absorbed by this armor.
   * Expressed as a decimal: 0.50 means 50% of body damage is absorbed.
   * The remaining percentage is dealt as health damage.
   */
  bodyReduction: number;

  /**
   * Percentage of leg damage absorbed by this armor.
   * Expressed as a decimal: 0.25 means 25% of leg damage is absorbed.
   * Leg shots are not affected by helmets, only by armor leg reduction.
   */
  legReduction: number;

  /**
   * Movement speed penalty while wearing this armor.
   * Expressed as a decimal multiplier: 0.95 means 5% slower movement.
   * Stacks multiplicatively with the weapon speedModifier.
   */
  speedPenalty: number;
}

/**
 * UtilityStats defines the properties of a throwable utility item.
 * These values control the area of effect, duration, and damage
 * (if applicable) of each utility type.
 */
export interface UtilityStats {
  /**
   * The utility type these stats belong to.
   * @see UtilityType
   */
  type: UtilityType;

  /**
   * Purchase cost in in-game currency per unit.
   * Each utility item is purchased individually during BUY_PHASE.
   */
  cost: number;

  /**
   * How long the utility effect persists after deployment, in seconds.
   * For SMOKE: how long the smoke cloud blocks vision.
   * For FLASH: how long the blindness effect lasts on affected soldiers.
   * For FRAG: 0 (instant detonation, no lingering effect).
   * For MOLOTOV: how long the fire zone burns on the ground.
   * For DECOY: how long the fake gunshot sounds play.
   */
  duration: number;

  /**
   * The radius of the utility area of effect, measured in pixels.
   * Determines the circular area affected by the utility.
   * For SMOKE: the radius of the vision-blocking cloud.
   * For FLASH: the radius within which soldiers can be blinded.
   * For FRAG: the explosion radius for damage falloff.
   * For MOLOTOV: the radius of the burning zone.
   * For DECOY: the radius within which fake sounds are heard.
   */
  radius: number;

  /**
   * Damage dealt by this utility item, or 0 if it deals no damage.
   * For FRAG: the maximum damage at the center of the explosion.
   * For MOLOTOV: the damage per second dealt to soldiers in the fire.
   * For SMOKE, FLASH, DECOY: 0 (no direct damage).
   */
  damage: number;
}

/**
 * Equipment represents the full loadout a soldier carries into a round.
 * Configured during BUY_PHASE and locked in when STRATEGY_PHASE begins.
 * Includes weapons, protection, utility grenades, and special items.
 */
export interface Equipment {
  /**
   * The primary weapon the soldier carries, or null if only using the sidearm.
   * Purchased from the buy menu; null means the soldier goes "eco" (pistol only).
   * @see WeaponId
   */
  primary: WeaponId | null;

  /**
   * The sidearm weapon, which is always a PISTOL.
   * Every soldier receives a free pistol each round.
   * Used as a backup weapon or as the only weapon on eco rounds.
   * @default WeaponId.PISTOL
   */
  sidearm: WeaponId;

  /**
   * The body armor the soldier is wearing, or null if unarmored.
   * Provides damage reduction at the cost of movement speed.
   * @see ArmorType
   */
  armor: ArmorType | null;

  /**
   * Whether the soldier has purchased a helmet.
   * Helmets drastically reduce headshot damage and are critical for survival.
   * Typically purchased alongside armor on full-buy rounds.
   */
  helmet: boolean;

  /**
   * Array of utility items (grenades) the soldier is carrying.
   * Maximum of 4 utility items per soldier.
   * Order in the array determines the default throw priority.
   * @maxItems 4
   * @see UtilityType
   */
  utility: UtilityType[];

  /**
   * Whether the soldier has purchased a defuse kit (defenders only).
   * Reduces bomb defusal time from 5 seconds to 3 seconds.
   * Attackers should never have this set to true.
   */
  defuseKit: boolean;
}
