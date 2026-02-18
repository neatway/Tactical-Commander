// ============================================================================
// EconomyConstants.ts
// All economy, crate, and match reward constants for the tactical commander game.
// Controls in-match money flow, meta-game currency rewards, and soldier gacha.
// ============================================================================

// ----------------------------------------------------------------------------
// IN-MATCH ECONOMY
// These constants govern the money each player receives during a match.
// The economy system creates strategic depth: winning gives more money,
// but loss streaks provide catch-up mechanics to prevent snowballing.
// ----------------------------------------------------------------------------

/**
 * Starting money for both players at the beginning of a match.
 * 800 credits is enough for a pistol (200) + light vest (400) + a flash (200),
 * OR save for a stronger second-round buy.
 * This creates meaningful first-round economic decisions.
 */
export const STARTING_MONEY: number = 800;

/**
 * Maximum money a player can accumulate.
 * Any earnings beyond this cap are lost.
 * Prevents infinite hoarding and encourages spending on utility.
 */
export const MAX_MONEY: number = 16000;

/**
 * Base money awarded for winning a round.
 * The winning team always receives this flat amount regardless of
 * how they won (elimination, bomb plant/defuse, or time expiry).
 */
export const ROUND_WIN_REWARD: number = 3250;

/**
 * Money awarded for losing based on consecutive loss count.
 * Index 0 = first loss, index 1 = second consecutive loss, etc.
 * Caps at index 3 (4+ consecutive losses all give 2900).
 *
 * Loss streak progression:
 *   1 consecutive loss  -> 1400 credits
 *   2 consecutive losses -> 1900 credits
 *   3 consecutive losses -> 2400 credits
 *   4+ consecutive losses -> 2900 credits (maximum)
 *
 * This catch-up mechanic ensures the losing player can eventually
 * afford a full buy, preventing unwinnable economic spirals.
 */
export const LOSS_STREAK_REWARDS: readonly number[] = [1400, 1900, 2400, 2900];

/**
 * Bonus money awarded to the attacking team for successfully planting the bomb,
 * even if they lose the round (bomb gets defused).
 * Rewards the attackers for executing their objective.
 */
export const BOMB_PLANT_BONUS: number = 300;

/**
 * Bonus money awarded to the defending team for successfully defusing the bomb.
 * Rewards defenders for the risky act of defusing under pressure.
 */
export const BOMB_DEFUSE_BONUS: number = 300;

/**
 * Fixed money given to both players at the start of overtime rounds.
 * Ensures overtime is always a fair, full-buy fight regardless of
 * previous economic state.
 */
export const OVERTIME_MONEY: number = 10000;

// ----------------------------------------------------------------------------
// RARITY SYSTEM
// Soldiers are obtained through crates and have rarity tiers that
// determine their base stat ranges and training costs.
// ----------------------------------------------------------------------------

/**
 * Rarity tiers for soldiers, from most common to most rare.
 * Higher rarity soldiers have better base stats but cost more to train.
 */
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

// ----------------------------------------------------------------------------
// CRATE DEFINITIONS
// Crates are the primary way to obtain new soldiers for your roster.
// Higher-tier crates guarantee better minimum rarity and/or more soldiers.
// ----------------------------------------------------------------------------

/**
 * Configuration for each crate tier available in the shop.
 *
 * Crate opening flow:
 * 1. Player purchases crate with meta-currency (coins)
 * 2. System rolls rarity based on DROP_RATES, but guarantees at least
 *    the crate's guaranteedMinRarity
 * 3. Soldier stats are rolled within the STAT_RANGES for that rarity
 * 4. Soldier is added to the player's roster
 *
 * Mega crate is special: it gives 3 soldiers and guarantees at least one EPIC.
 */
export const CRATE_TYPES = {
  /**
   * Standard Crate - Entry-level crate.
   * Cheapest option, no rarity floor beyond COMMON.
   * Good for filling out a roster early on.
   */
  Standard: {
    /** Cost in meta-currency (coins) */
    cost: 500,
    /** Minimum rarity guaranteed from this crate */
    guaranteedMinRarity: 'COMMON' as Rarity,
  },

  /**
   * Premium Crate - Mid-tier crate.
   * Guarantees at least UNCOMMON rarity.
   * Better value than Standard if you want to avoid COMMON duds.
   */
  Premium: {
    /** Cost in meta-currency (coins) */
    cost: 1500,
    /** Minimum rarity guaranteed from this crate */
    guaranteedMinRarity: 'UNCOMMON' as Rarity,
  },

  /**
   * Elite Crate - High-tier crate.
   * Guarantees at least RARE rarity.
   * Expensive but ensures a useful soldier.
   */
  Elite: {
    /** Cost in meta-currency (coins) */
    cost: 4000,
    /** Minimum rarity guaranteed from this crate */
    guaranteedMinRarity: 'RARE' as Rarity,
  },

  /**
   * Mega Crate - Ultimate crate.
   * Gives 3 soldiers instead of 1.
   * Guarantees at least one EPIC soldier among the three.
   * Best value for high-spending players.
   */
  Mega: {
    /** Cost in meta-currency (coins) */
    cost: 10000,
    /** Minimum rarity guaranteed from this crate */
    guaranteedMinRarity: 'RARE' as Rarity,
    /** Number of soldiers received from this crate */
    count: 3,
    /** Whether at least one soldier is guaranteed to be EPIC or higher */
    guaranteeOneEpic: true,
  },
} as const;

// ----------------------------------------------------------------------------
// DROP RATES
// Base probability of rolling each rarity tier from a crate.
// These are the raw probabilities before the crate's guaranteedMinRarity
// is applied. If the roll is below the minimum, it gets bumped up.
// ----------------------------------------------------------------------------

/**
 * Base drop rate (probability) for each rarity tier.
 * All values sum to 1.0 (100%).
 *
 * Probability breakdown:
 *   COMMON:    50% (1 in 2)
 *   UNCOMMON:  25% (1 in 4)
 *   RARE:      15% (1 in ~6.7)
 *   EPIC:       8% (1 in 12.5)
 *   LEGENDARY:  2% (1 in 50)
 *
 * When a crate has a guaranteedMinRarity, any roll below that rarity
 * is re-rolled or promoted to the minimum.
 */
export const DROP_RATES: Record<Rarity, number> = {
  COMMON: 0.50,
  UNCOMMON: 0.25,
  RARE: 0.15,
  EPIC: 0.08,
  LEGENDARY: 0.02,
};

// ----------------------------------------------------------------------------
// RECYCLE VALUES
// Players can recycle (disenchant) unwanted soldiers for meta-currency.
// Higher rarity soldiers yield more coins when recycled.
// ----------------------------------------------------------------------------

/**
 * Coins received when recycling (disenchanting) a soldier of each rarity.
 *
 * Value ratios relative to crate costs help determine expected value:
 *   Standard crate (500 coins) -> COMMON recycle = 50 (10% return)
 *   Premium crate (1500 coins) -> UNCOMMON recycle = 150 (10% return)
 *
 * Recycling is intentionally low-value to discourage mass recycling
 * and encourage keeping a diverse roster.
 */
export const RECYCLE_VALUES: Record<Rarity, number> = {
  COMMON: 50,
  UNCOMMON: 150,
  RARE: 400,
  EPIC: 1000,
  LEGENDARY: 3000,
};

// ----------------------------------------------------------------------------
// STAT RANGES
// When a soldier is generated from a crate, their total stat points
// are rolled within these ranges based on rarity. Individual stats
// are then distributed from this total pool.
// ----------------------------------------------------------------------------

/**
 * Total stat point ranges by rarity tier.
 * When a soldier is generated, the system:
 * 1. Rolls a total stat budget within {min, max} for the soldier's rarity
 * 2. Distributes those points across all stats (ACC, REA, SPD, STL, AWR, etc.)
 * 3. Each individual stat is bounded by SOLDIER.minStatValue and SOLDIER.maxStatValue
 *
 * With ~8 stats, the per-stat average for each rarity is roughly:
 *   COMMON:    37-50 per stat  (below average soldiers)
 *   UNCOMMON:  50-62 per stat  (average soldiers)
 *   RARE:      62-75 per stat  (above average soldiers)
 *   EPIC:      75-87 per stat  (elite soldiers)
 *   LEGENDARY: 87-100 per stat (peak soldiers, all stats near max)
 */
export const STAT_RANGES: Record<Rarity, { min: number; max: number }> = {
  COMMON:    { min: 300, max: 400 },
  UNCOMMON:  { min: 400, max: 500 },
  RARE:      { min: 500, max: 600 },
  EPIC:      { min: 600, max: 700 },
  LEGENDARY: { min: 700, max: 800 },
};

// ----------------------------------------------------------------------------
// MATCH REWARD CONSTANTS
// Meta-currency and XP awarded at the end of each match.
// These fuel the metagame progression (buying crates, leveling soldiers).
// ----------------------------------------------------------------------------

/**
 * Coins awarded to the match winner.
 * Combined with per-round and per-kill bonuses, a dominant win
 * can yield 200 + (5 * 10) + (kills * 5) = 250+ coins.
 */
export const MATCH_WIN_COINS: number = 200;

/**
 * Coins awarded to the match loser.
 * Ensures even losing players make progress toward their next crate.
 * Losing a close 4-5 match still yields 100 + (4 * 10) + (kills * 5).
 */
export const MATCH_LOSS_COINS: number = 100;

/**
 * Bonus coins per round won within the match.
 * Rewards competitive play even in a loss.
 * Max possible: 5 rounds * 10 = 50 bonus coins.
 */
export const PER_ROUND_WIN_COINS: number = 10;

/**
 * Bonus coins per kill scored across all rounds.
 * Rewards aggressive and skillful play.
 * A soldier who gets 15 kills in a match earns 15 * 5 = 75 bonus coins.
 */
export const PER_KILL_COINS: number = 5;

/**
 * Experience points awarded to each soldier that participated in a winning match.
 * XP contributes to soldier leveling (up to SOLDIER.maxLevel).
 * Higher levels may unlock passive bonuses or cosmetic rewards.
 */
export const MATCH_WIN_XP: number = 50;

/**
 * Experience points awarded to each soldier that participated in a losing match.
 * Lower than win XP, but still provides progression for the losing side.
 */
export const MATCH_LOSS_XP: number = 30;
