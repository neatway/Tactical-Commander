// ============================================================================
// GameConstants.ts
// Core game timing, simulation, and gameplay limit constants.
// These values define the fundamental parameters of the tactical commander game.
// All values are readonly and grouped by domain for easy reference.
// ============================================================================

// ----------------------------------------------------------------------------
// MATCH CONSTANTS
// Define the overall structure of a match (how many rounds, win conditions).
// ----------------------------------------------------------------------------

/**
 * Match structure constants.
 * A standard match is first-to-5 in a max of 9 rounds.
 * If the match goes to overtime, both players receive a fixed economy reset.
 */
export const MATCH = {
  /** Maximum number of rounds in a single match (regulation) */
  maxRounds: 9,

  /**
   * Number of round wins required to win the match.
   * With maxRounds=9, the match ends as soon as one player reaches 5 wins
   * (since the opponent can have at most 4).
   */
  roundsToWin: 5,

  /**
   * Fixed money both players receive at the start of overtime.
   * Ensures overtime rounds are always full-buy situations.
   */
  overtimeMoney: 10000,
} as const;

// ----------------------------------------------------------------------------
// TIMING CONSTANTS
// Control the duration of each phase within a round, plus command delays.
// All time values are in seconds unless otherwise noted.
// ----------------------------------------------------------------------------

/**
 * Phase timing and command delay constants.
 *
 * Round flow: Buy Phase -> Strategy Phase -> Live Phase
 *
 * During Live Phase, the bomb plant/defuse sub-timers may activate.
 * Command delays simulate the "fog of war" delay between issuing an order
 * and the soldier executing it, adding tactical depth.
 */
export const TIMING = {
  /** Duration of the buy phase where players purchase weapons/utility (seconds) */
  buyPhaseSeconds: 20,

  /** Duration of the strategy phase where players place waypoints/commands (seconds) */
  strategyPhaseSeconds: 15,

  /**
   * Maximum duration of the live (combat) phase (seconds).
   * The round ends early if all soldiers on one side are eliminated
   * or the bomb detonates/is defused.
   */
  livePhaseSeconds: 105,

  /**
   * Time after bomb is planted before it detonates (seconds).
   * Defenders must defuse within this window or lose the round.
   */
  postPlantSeconds: 40,

  /** Time required for an attacker to plant the bomb (seconds) */
  plantSeconds: 3,

  /** Time required to defuse the bomb WITHOUT a defuse kit (seconds) */
  defuseSeconds: 5,

  /** Time required to defuse the bomb WITH a defuse kit (seconds) */
  defuseWithKitSeconds: 3,

  /**
   * Minimum command execution delay in seconds.
   * When a player issues a mid-round command, it takes at least this long
   * before the soldier begins executing it.
   */
  commandDelayMin: 0.3,

  /**
   * Maximum command execution delay in seconds.
   * The actual delay is randomized between commandDelayMin and commandDelayMax
   * to prevent pixel-perfect reaction exploits.
   */
  commandDelayMax: 0.8,

  /**
   * Minimum time between successive commands to the same soldier (seconds).
   * Prevents spam-clicking to micromanage soldiers frame-by-frame.
   */
  commandCooldown: 0.5,
} as const;

// ----------------------------------------------------------------------------
// SIMULATION CONSTANTS
// Parameters for the tick-based combat simulation engine.
// ----------------------------------------------------------------------------

/**
 * Simulation tick rate and detection geometry constants.
 *
 * The combat simulation runs at a fixed tick rate. Each tick, soldiers
 * check for enemies within their detection cone, attempt shots, and move.
 * Using a fixed tick rate ensures deterministic replay and fair simulation.
 */
export const SIMULATION = {
  /**
   * Time per simulation tick in milliseconds.
   * 200ms = 5 ticks per second. This is intentionally low since the game
   * is a tactical sim, not a twitch shooter.
   */
  tickRateMs: 200,

  /** Number of simulation ticks per second (1000 / tickRateMs) */
  ticksPerSecond: 5,

  /**
   * Width of the forward detection cone in degrees.
   * A soldier can detect enemies within +/- 60 degrees of their facing direction
   * (120 degree total arc).
   */
  detectionConeAngle: 120,

  /** Alias for detectionConeAngle, explicitly in degrees for clarity */
  detectionConeDegrees: 120,

  /**
   * Additional peripheral vision angle beyond the main detection cone (degrees).
   * Enemies in this zone can still be detected, but with reduced probability.
   */
  peripheralAngle: 30,

  /**
   * Detection probability multiplier for enemies in the peripheral vision zone.
   * 0.5 means 50% of normal detection chance for peripheral targets.
   */
  peripheralPenalty: 0.5,
} as const;

// ----------------------------------------------------------------------------
// SOLDIER CONSTANTS
// Stat ranges, leveling limits, and roster constraints for soldiers.
// ----------------------------------------------------------------------------

/**
 * Soldier stat and progression constants.
 *
 * Each soldier has stats (ACC, REA, SPD, etc.) that range from
 * minStatValue to maxStatValue. Training can improve stats, but is
 * limited per-stat and in total to prevent hyper-specialization.
 */
export const SOLDIER = {
  /** Maximum health points for a soldier */
  maxHealth: 100,

  /** Maximum value any single stat can reach (absolute ceiling) */
  maxStatValue: 100,

  /** Minimum value any single stat can have (floor) */
  minStatValue: 1,

  /** Maximum experience level a soldier can reach */
  maxLevel: 20,

  /**
   * Maximum number of training points that can be applied to a SINGLE stat.
   * Prevents dumping all training into one stat.
   */
  maxTrainingPerStat: 20,

  /**
   * Maximum TOTAL training points that can be distributed across ALL stats.
   * Forces players to make meaningful choices about soldier development.
   * With 8+ stats, 30 total points means ~3-4 points per stat on average,
   * or heavy investment in 1-2 stats at the cost of others.
   */
  maxTotalTraining: 30,

  /**
   * Effective stat cap after training is applied.
   * Even if base + training exceeds 100, the effective value is capped at 95
   * to prevent any soldier from being perfect in any stat.
   */
  statCap: 95,

  /** Maximum number of soldiers a player can have in their roster */
  rosterLimit: 30,
} as const;

// ----------------------------------------------------------------------------
// MAP CONSTANTS
// Grid and spatial parameters for pathfinding and map layout.
// ----------------------------------------------------------------------------

/**
 * Map and pathfinding grid constants.
 *
 * The game world is divided into a grid for A* pathfinding.
 * cellSize determines the granularity of movement and collision detection.
 */
export const MAP = {
  /**
   * Size of each pathfinding grid cell in pixels.
   * Smaller values give more precise movement but increase computation.
   * 50px provides a good balance for tactical-scale maps.
   */
  cellSize: 50,
} as const;
