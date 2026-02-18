// ============================================================================
// SoldierTypes.ts
// Types for individual soldier units: their persistent profiles, runtime
// combat stats, and real-time state during a match.
// ============================================================================

import { ArmorType, UtilityType, WeaponId } from "./WeaponTypes";

/**
 * SoldierStats represents the ten core attribute ratings for a soldier.
 * Each stat is an integer from 1 to 100, where 1 is the worst possible
 * and 100 is peak human performance. These stats directly influence
 * combat simulation outcomes and AI behavior during the LIVE_PHASE.
 */
export interface SoldierStats {
  /**
   * How precisely the soldier aims at targets.
   * Higher values reduce bullet spread and increase hit probability.
   * Directly affects the chance of hitting a target at any given range.
   * @minimum 1
   * @maximum 100
   */
  accuracy: number;

  /**
   * How quickly the soldier reacts to spotting an enemy (in abstract units).
   * Lower reaction times (higher stat values) mean the soldier fires first
   * in duels. Critical for entry fraggers and AWPers who must react fast.
   * @minimum 1
   * @maximum 100
   */
  reactionTime: number;

  /**
   * Base movement speed modifier for the soldier.
   * Higher values allow faster rotation between map positions and quicker peeks.
   * Interacts with weapon weight (speedModifier) to determine final move speed.
   * @minimum 1
   * @maximum 100
   */
  movementSpeed: number;

  /**
   * How difficult the soldier is to detect by enemies.
   * Higher stealth means quieter footsteps, less visible on the minimap,
   * and a reduced detection radius. Especially valuable for lurkers.
   * @minimum 1
   * @maximum 100
   */
  stealth: number;

  /**
   * How effectively the soldier detects hidden or flanking enemies.
   * Higher awareness extends the soldier detection radius and reduces
   * the chance of being surprised by stealthy opponents.
   * @minimum 1
   * @maximum 100
   */
  awareness: number;

  /**
   * How well the soldier manages weapon recoil during sustained fire.
   * Higher values keep the crosshair closer to center during sprays,
   * resulting in tighter groupings, especially with rifles and LMGs.
   * @minimum 1
   * @maximum 100
   */
  recoilControl: number;

  /**
   * Mental fortitude under pressure (e.g., low health, outnumbered situations).
   * High composure prevents stat degradation when the soldier is in
   * disadvantageous situations. Low composure causes accuracy and reaction
   * time penalties when under stress.
   * @minimum 1
   * @maximum 100
   */
  composure: number;

  /**
   * Effectiveness when deploying utility items (smokes, flashes, etc.).
   * Higher values improve throw accuracy, detonation timing, and
   * the probability of a utility item achieving its intended effect.
   * @minimum 1
   * @maximum 100
   */
  utilityUsage: number;

  /**
   * Performance modifier in clutch situations (1vN scenarios).
   * When the soldier is the last alive on their side, clutchFactor
   * provides percentage bonuses to accuracy, reaction time, and composure.
   * @minimum 1
   * @maximum 100
   */
  clutchFactor: number;

  /**
   * How well the soldier coordinates with nearby teammates.
   * Higher teamwork improves trade-kill timing, crossfire effectiveness,
   * and the bonus granted when multiple soldiers hold the same area.
   * @minimum 1
   * @maximum 100
   */
  teamwork: number;
}

/**
 * Rarity determines how rare and powerful a soldier is.
 * Higher rarity soldiers have better base stats, higher stat ceilings,
 * and more training points available for customization.
 * Rarity is permanent and assigned when a soldier is acquired.
 */
export enum Rarity {
  /**
   * COMMON: The most frequently obtained rarity tier.
   * Base stats typically range from 30-50. Readily available.
   */
  COMMON = "COMMON",

  /**
   * UNCOMMON: Slightly above average soldiers.
   * Base stats typically range from 40-60. Moderate availability.
   */
  UNCOMMON = "UNCOMMON",

  /**
   * RARE: Noticeably talented soldiers with strong base attributes.
   * Base stats typically range from 50-70. Harder to obtain.
   */
  RARE = "RARE",

  /**
   * EPIC: Elite soldiers with exceptional innate abilities.
   * Base stats typically range from 60-80. Quite scarce.
   */
  EPIC = "EPIC",

  /**
   * LEGENDARY: The absolute best soldiers available.
   * Base stats typically range from 75-95. Extremely rare to acquire.
   */
  LEGENDARY = "LEGENDARY",
}

/**
 * SoldierProfile defines the tactical role a soldier is best suited for.
 * Each profile influences AI behavior during LIVE_PHASE, determining
 * preferred positions, engagement style, and decision priorities.
 * A soldier profile is permanent and shapes how they play.
 */
export enum SoldierProfile {
  /**
   * ENTRY_FRAGGER: First soldier into a contested area.
   * Prioritizes aggressive peeks, fast site takes, and creating space.
   * Benefits most from high accuracy, reaction time, and composure.
   */
  ENTRY_FRAGGER = "ENTRY_FRAGGER",

  /**
   * SUPPORT: Provides utility and crossfire for teammates.
   * Prioritizes throwing smokes/flashes before engagements and trading kills.
   * Benefits most from high utility usage, teamwork, and awareness.
   */
  SUPPORT = "SUPPORT",

  /**
   * AWPER: Specialist with the AWP sniper rifle.
   * Holds long angles, gets opening picks, and controls sightlines.
   * Benefits most from high accuracy, reaction time, and composure.
   */
  AWPER = "AWPER",

  /**
   * LURKER: Operates alone on the opposite side of the map.
   * Flanks enemies, gathers information, and punishes rotations.
   * Benefits most from high stealth, awareness, and clutch factor.
   */
  LURKER = "LURKER",

  /**
   * ANCHOR: Holds a bomb site solo on the defensive side.
   * Specializes in delaying pushes and staying alive until rotations arrive.
   * Benefits most from high composure, awareness, and recoil control.
   */
  ANCHOR = "ANCHOR",

  /**
   * FLEX: Versatile soldier who adapts to whatever role is needed.
   * Can entry frag, support, or anchor depending on the round strategy.
   * Benefits from well-rounded stats across all categories.
   */
  FLEX = "FLEX",
}

/**
 * Soldier represents the persistent, roster-level data for a single soldier unit.
 * This data persists across matches and is stored in the player collection.
 * It includes identity, rarity, stats, and training/progression information.
 */
export interface Soldier {
  /**
   * Unique identifier for this soldier, typically a UUID v4 string.
   * Used as the primary key for all soldier-related lookups and references.
   */
  id: string;

  /**
   * The soldier full display name (e.g., "Marcus Thompson").
   * Shown in the roster screen, buy menu, and kill feed.
   */
  name: string;

  /**
   * Short tactical callsign used during gameplay (e.g., "Viper", "Ghost").
   * Displayed above the soldier head in-game and in quick status updates.
   */
  callsign: string;

  /**
   * The soldier country of origin (e.g., "USA", "Germany", "Japan").
   * Cosmetic only -- used for flag icons and flavor text. No gameplay effect.
   */
  nationality: string;

  /**
   * The rarity tier of this soldier, determining stat ceilings and value.
   * Assigned on acquisition and cannot be changed.
   * @see Rarity
   */
  rarity: Rarity;

  /**
   * The tactical role this soldier is specialized in.
   * Influences AI behavior, preferred positions, and engagement patterns.
   * Assigned on acquisition and cannot be changed.
   * @see SoldierProfile
   */
  profile: SoldierProfile;

  /**
   * The soldier ten core combat statistics.
   * These are the base values modified by training points.
   * @see SoldierStats
   */
  stats: SoldierStats;

  /**
   * The soldier current experience level (starts at 1).
   * Leveling up may unlock cosmetic rewards or minor bonuses.
   * Increases as the soldier participates in matches.
   */
  level: number;

  /**
   * Current experience points toward the next level.
   * When xp reaches the threshold for the current level, the soldier levels up
   * and xp resets (or rolls over, depending on implementation).
   */
  xp: number;

  /**
   * Maximum number of training points that can be allocated to this soldier.
   * Training points are spent to increase individual stats beyond their base.
   * Fixed at 30 for all soldiers regardless of rarity.
   * @default 30
   */
  maxTrainingPoints: number;

  /**
   * Number of training points currently allocated to stat boosts.
   * Must always be less than or equal to maxTrainingPoints.
   * Points can be reallocated between matches (reset and redistribute).
   */
  usedTrainingPoints: number;
}

/**
 * Stance defines the behavioral posture a soldier adopts during combat.
 * Affects engagement range, willingness to push, and positioning decisions.
 * - AGGRESSIVE: Pushes forward, wide peeks, prioritizes kills over survival.
 * - DEFENSIVE: Holds angles, plays for trades, prioritizes survival.
 * - PASSIVE: Avoids engagements entirely, gathers info, plays for time.
 */
export type Stance = "AGGRESSIVE" | "DEFENSIVE" | "PASSIVE";

/**
 * SoldierState represents the real-time, in-match state of a single soldier.
 * Updated every simulation tick during LIVE_PHASE and POST_PLANT.
 * Contains everything needed to render and simulate the soldier behavior.
 */
export interface SoldierState {
  /**
   * Reference to the persistent Soldier.id this state belongs to.
   * Links the runtime state back to the roster-level soldier data.
   */
  soldierId: string;

  /**
   * Current world-space position of the soldier on the map.
   * Uses a 2D coordinate system (top-down view) where x is horizontal
   * and z is vertical. Units are in pixels matching the map dimensions.
   */
  position: {
    /** Horizontal position in pixels from the left edge of the map. */
    x: number;
    /** Vertical position in pixels from the top edge of the map. */
    z: number;
  };

  /**
   * Current facing direction of the soldier in radians.
   * 0 radians points to the right (+x direction).
   * Increases counter-clockwise: PI/2 is up, PI is left, 3PI/2 is down.
   * Range: [0, 2*PI)
   */
  rotation: number;

  /**
   * Current health points of the soldier.
   * Starts at 100 at the beginning of each round.
   * Reduced by incoming damage (modified by armor). At 0, the soldier dies.
   * @minimum 0
   * @maximum 100
   */
  health: number;

  /**
   * Whether the soldier is still alive in the current round.
   * Set to false when health reaches 0. Dead soldiers cannot act
   * or be targeted, and their position becomes their death location.
   */
  alive: boolean;

  /**
   * The weapon the soldier currently has equipped and ready to fire.
   * Determines damage output, fire rate, and accuracy for engagements.
   * @see WeaponId
   */
  currentWeapon: WeaponId;

  /**
   * The type of body armor the soldier is wearing, or null if unarmored.
   * Armor reduces incoming body and leg damage by a percentage.
   * Purchased during BUY_PHASE and lasts until the soldier dies.
   * @see ArmorType
   */
  armor: ArmorType | null;

  /**
   * Whether the soldier is wearing a helmet.
   * Helmets reduce headshot damage significantly.
   * Without a helmet, headshots deal full multiplied damage.
   */
  helmet: boolean;

  /**
   * Array of utility items the soldier currently has available to use.
   * Items are removed from this array when thrown/deployed.
   * Maximum of 4 utility items per soldier.
   * @see UtilityType
   */
  utility: UtilityType[];

  /**
   * The soldier current behavioral stance, set by the player.
   * - AGGRESSIVE: Pushes forward, wide peeks, prioritizes kills.
   * - DEFENSIVE: Holds angles, plays for trades, prioritizes survival.
   * - PASSIVE: Avoids engagements, gathers info, plays for time.
   */
  stance: Stance;

  /**
   * Whether the soldier is currently in motion.
   * Moving soldiers are easier to detect (footstep sounds, visible movement)
   * but harder to hit. Standing still improves accuracy.
   */
  isMoving: boolean;

  /**
   * Whether the soldier is currently engaged in a firefight.
   * True when the soldier is actively shooting at or being shot by an enemy.
   * Affects stat modifiers like composure-based accuracy adjustments.
   */
  isInCombat: boolean;

  /**
   * The soldier ID of the enemy this soldier is currently targeting, or null.
   * When set, the soldier AI will focus fire on this specific enemy.
   * Automatically cleared when the target dies or leaves line of sight.
   */
  currentTarget: string | null;

  /**
   * Ordered array of waypoints the soldier will navigate through.
   * Set during STRATEGY_PHASE or via MOVE commands during LIVE_PHASE.
   * The soldier moves to each waypoint in sequence, removing them as reached.
   */
  waypoints: {
    /** Target horizontal position in pixels. */
    x: number;
    /** Target vertical position in pixels. */
    z: number;
  }[];

  /**
   * Whether the soldier is carrying a defuse kit (defenders only).
   * A defuse kit reduces bomb defusal time from 5 seconds to 3 seconds.
   * Purchased during BUY_PHASE at an additional cost.
   */
  defuseKit: boolean;
}
