// ============================================================================
// GameTypes.ts
// Core game types governing match flow, scoring, and overall game state.
// ============================================================================

/**
 * GamePhase represents the distinct phases that a round cycles through.
 * The round lifecycle flows linearly:
 *   BUY_PHASE -> STRATEGY_PHASE -> LIVE_PHASE -> (POST_PLANT) -> ROUND_END
 * A match ends with MATCH_END after enough rounds are won.
 */
export enum GamePhase {
  /**
   * BUY_PHASE: Players purchase weapons, armor, and utility for their soldiers.
   * Duration is controlled by MatchConfig.buyPhaseTime (default 20 seconds).
   * Players can freely adjust loadouts during this window.
   */
  BUY_PHASE = "BUY_PHASE",

  /**
   * STRATEGY_PHASE: Players set waypoints and assign strategies to soldiers.
   * Duration is controlled by MatchConfig.strategyPhaseTime (default 15 seconds).
   * No purchases can be made; focus is on tactical planning.
   */
  STRATEGY_PHASE = "STRATEGY_PHASE",

  /**
   * LIVE_PHASE: The main combat phase where soldiers execute commands in real time.
   * Duration is controlled by MatchConfig.livePhaseTime (default 105 seconds).
   * Attackers attempt to plant the bomb; defenders try to eliminate attackers.
   */
  LIVE_PHASE = "LIVE_PHASE",

  /**
   * POST_PLANT: Activated when the bomb has been planted during LIVE_PHASE.
   * Duration is controlled by MatchConfig.postPlantTime (default 40 seconds).
   * Defenders must defuse the bomb before it detonates; attackers defend the site.
   */
  POST_PLANT = "POST_PLANT",

  /**
   * ROUND_END: Brief period after a round concludes, showing the round summary.
   * Displays kill feed, economy changes, and the round winner.
   */
  ROUND_END = "ROUND_END",

  /**
   * MATCH_END: The match has concluded -- one player has won enough rounds.
   * Final scoreboard, rewards, and XP are displayed to both players.
   */
  MATCH_END = "MATCH_END",
}

/**
 * Side represents which role a player is assigned for the current half.
 * In a 1v1 tactical commander game, one player attacks and one defends.
 * Sides swap at halftime (after maxRounds / 2 rounds, rounded up).
 */
export enum Side {
  /**
   * ATTACKER: The offensive side. Their objective is to plant the bomb
   * at one of the bomb sites, or eliminate all defending soldiers.
   */
  ATTACKER = "ATTACKER",

  /**
   * DEFENDER: The defensive side. Their objective is to prevent the bomb
   * plant by eliminating attackers or running out the round clock.
   * If the bomb is planted, defenders must defuse it before detonation.
   */
  DEFENDER = "DEFENDER",
}

/**
 * GameState is the authoritative snapshot of the entire game at any given tick.
 * This is maintained server-side and partially sent to clients each update.
 * Contains all information needed to render the game and make decisions.
 */
export interface GameState {
  /**
   * The current phase of the round.
   * Determines which actions are legal and what the UI should display.
   * @see GamePhase
   */
  phase: GamePhase;

  /**
   * The current round number, starting from 1.
   * Increments after each ROUND_END phase.
   * Maximum value is MatchConfig.maxRounds (default 9).
   */
  roundNumber: number;

  /**
   * Score tracking object for each side.
   * Records the number of rounds won by attackers and defenders respectively.
   * A side wins the match when their score reaches MatchConfig.roundsToWin (default 5).
   */
  score: {
    /** Number of rounds won by the attacking side so far. */
    attacker: number;
    /** Number of rounds won by the defending side so far. */
    defender: number;
  };

  /**
   * Time remaining in the current phase, measured in seconds.
   * Counts down from the phase configured duration to 0.
   * When it reaches 0, the game transitions to the next phase.
   */
  timeRemaining: number;

  /**
   * Whether the bomb has been planted in the current round.
   * Set to true when an attacker completes the plant action.
   * Triggers a phase transition from LIVE_PHASE to POST_PLANT.
   */
  bombPlanted: boolean;

  /**
   * The world-space position of the bomb, or null if not yet planted.
   * Only populated after bombPlanted becomes true.
   * Used for rendering the bomb on the map and calculating defuse proximity.
   */
  bombPosition: { x: number; z: number } | null;

  /**
   * The full soldier arrays for each side.
   * Each side has up to 5 soldiers (indices 0-4).
   * Contains the complete SoldierState for server-side use;
   * clients receive a filtered/fog-of-war version.
   */
  soldiers: {
    /** Array of soldier states for the attacking side (up to 5 soldiers). */
    attacker: import("./SoldierTypes").SoldierState[];
    /** Array of soldier states for the defending side (up to 5 soldiers). */
    defender: import("./SoldierTypes").SoldierState[];
  };

  /**
   * Economy tracking for each side.
   * Represents the amount of in-game currency available for purchasing
   * weapons, armor, and utility during the BUY_PHASE.
   */
  economy: {
    /** Current money available for the attacking player to spend. */
    attacker: number;
    /** Current money available for the defending player to spend. */
    defender: number;
  };

  /**
   * Maps each player unique ID to their assigned side for this half.
   * The keys are player IDs (strings), and the values are Side enums.
   * This mapping swaps at halftime so each player plays both sides.
   */
  currentSide: Record<string, Side>;
}

/**
 * RoundResult captures the outcome summary of a completed round.
 * Sent to both clients at ROUND_END for display and statistics tracking.
 */
export interface RoundResult {
  /**
   * The side that won this round.
   * Attackers win by: planting and detonating the bomb, or eliminating all defenders.
   * Defenders win by: defusing the bomb, eliminating all attackers, or time expiring.
   */
  winner: Side;

  /**
   * Array of kill records that occurred during the round.
   * Each entry contains the killer soldier ID, the victim soldier ID,
   * the weapon used, and whether it was a headshot.
   */
  kills: {
    /** The unique soldier ID of the soldier who scored the kill. */
    killerId: string;
    /** The unique soldier ID of the soldier who was eliminated. */
    victimId: string;
    /** The weapon that dealt the killing blow. */
    weaponId: import("./WeaponTypes").WeaponId;
    /** Whether the killing blow was a headshot (applies headshot multiplier). */
    headshot: boolean;
  }[];

  /**
   * Whether the bomb was planted at any point during the round.
   * True even if the bomb was subsequently defused -- it still counts as planted.
   */
  bombPlanted: boolean;

  /**
   * Whether the bomb was successfully defused by a defending soldier.
   * Can only be true if bombPlanted is also true.
   */
  bombDefused: boolean;
}

/**
 * MatchConfig holds all the tunable constants that define match rules and timing.
 * These values are fixed for a given game mode and are shared between
 * client and server to ensure synchronized phase transitions.
 */
export interface MatchConfig {
  /**
   * Maximum number of rounds in a match.
   * If both players reach (roundsToWin - 1), the match continues until
   * one player reaches roundsToWin.
   * @default 9
   */
  maxRounds: number;

  /**
   * Number of rounds a player must win to claim the match victory.
   * Typically set to (maxRounds / 2) + 1, rounded up.
   * @default 5
   */
  roundsToWin: number;

  /**
   * Duration of the BUY_PHASE in seconds.
   * Players purchase equipment for their soldiers during this time.
   * @default 20
   */
  buyPhaseTime: number;

  /**
   * Duration of the STRATEGY_PHASE in seconds.
   * Players set waypoints and assign tactical plans during this time.
   * @default 15
   */
  strategyPhaseTime: number;

  /**
   * Duration of the LIVE_PHASE in seconds.
   * The main combat period where soldiers fight and objectives are pursued.
   * @default 105
   */
  livePhaseTime: number;

  /**
   * Duration of the POST_PLANT phase in seconds.
   * The countdown before the planted bomb detonates.
   * Defenders must defuse within this window.
   * @default 40
   */
  postPlantTime: number;

  /**
   * Time in seconds required for an attacker to plant the bomb.
   * The planting soldier must remain stationary and uninterrupted.
   * @default 3
   */
  plantTime: number;

  /**
   * Time in seconds required for a defender to defuse the bomb without a kit.
   * The defusing soldier must remain stationary and uninterrupted.
   * @default 5
   */
  defuseTime: number;

  /**
   * Time in seconds required for a defender to defuse the bomb with a defuse kit.
   * Significantly faster than a bare-hands defuse, rewarding kit purchases.
   * @default 3
   */
  defuseTimeWithKit: number;
}

/**
 * Default match configuration with standard competitive values.
 * Import and use this as the baseline config for all matches.
 */
export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  maxRounds: 9,
  roundsToWin: 5,
  buyPhaseTime: 20,
  strategyPhaseTime: 15,
  livePhaseTime: 105,
  postPlantTime: 40,
  plantTime: 3,
  defuseTime: 5,
  defuseTimeWithKit: 3,
};
