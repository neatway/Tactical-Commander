/**
 * GameState.ts - Core game state definitions and factory functions
 *
 * This file defines the runtime game state that drives the entire match.
 * The state is updated every tick during the live phase and between phases.
 * It's the single source of truth for what's happening in the game.
 */

// ============================================================
// Enums - Game phases and sides
// ============================================================

/** The current phase of a round */
export enum GamePhase {
  /** Players buying weapons/armor/utility for their soldiers */
  BUY_PHASE = 'BUY_PHASE',
  /** Players setting waypoints, stances, and tactics before the round starts */
  STRATEGY_PHASE = 'STRATEGY_PHASE',
  /** Round is actively playing - soldiers move, fight, and execute commands */
  LIVE_PHASE = 'LIVE_PHASE',
  /** Bomb has been planted - defenders must retake and defuse */
  POST_PLANT = 'POST_PLANT',
  /** Round just ended - showing summary before next buy phase */
  ROUND_END = 'ROUND_END',
  /** Match is over - showing final results */
  MATCH_END = 'MATCH_END',
  /** Waiting in lobby / main menu */
  LOBBY = 'LOBBY',
}

/** Which side a team is playing this half */
export enum Side {
  /** Attacking team - must plant the bomb at a bomb site */
  ATTACKER = 'ATTACKER',
  /** Defending team - must prevent the bomb plant or defuse it */
  DEFENDER = 'DEFENDER',
}

/** Soldier engagement stance - affects how they behave in combat */
export enum Stance {
  /** Pushes fights, peeks corners, prioritizes kills */
  AGGRESSIVE = 'AGGRESSIVE',
  /** Holds position, shoots if engaged but doesn't push */
  DEFENSIVE = 'DEFENSIVE',
  /** Avoids engagements, retreats if possible */
  PASSIVE = 'PASSIVE',
}

// ============================================================
// Interfaces - State structures
// ============================================================

/** Position in the game world (top-down, y is up in Three.js so we use x,z) */
export interface Position {
  /** Horizontal position in world units */
  x: number;
  /** Vertical position in world units (depth in top-down view) */
  z: number;
}

/** Complete state of a single soldier during a round */
export interface SoldierRuntimeState {
  /** Index of this soldier in the team (0-4) */
  index: number;
  /** Reference ID to the soldier's persistent data (stats, name, etc.) */
  soldierId: string;
  /** Current world position */
  position: Position;
  /** Direction the soldier is facing, in radians (0 = right, PI/2 = down) */
  rotation: number;
  /** Current health points (0-100, dies at 0) */
  health: number;
  /** Whether the soldier is still alive this round */
  alive: boolean;
  /** Currently equipped primary weapon (null if none bought) */
  primaryWeapon: string | null;
  /** Armor type equipped (null if none) */
  armor: string | null;
  /** Whether the soldier has a helmet */
  helmet: boolean;
  /** Remaining utility items */
  utility: string[];
  /** Whether this soldier has a defuse kit (defenders only) */
  defuseKit: boolean;
  /** Current engagement stance */
  stance: Stance;
  /** Whether the soldier is currently moving */
  isMoving: boolean;
  /** Whether the soldier is in an active combat engagement */
  isInCombat: boolean;
  /** ID of the enemy soldier currently being targeted (null if none) */
  currentTarget: string | null;
  /** Queue of positions to move to */
  waypoints: Position[];
  /** Whether this soldier is carrying the bomb (attackers only) */
  hasBomb: boolean;
  /** Whether this soldier is currently planting the bomb */
  isPlanting: boolean;
  /** Whether this soldier is currently defusing the bomb */
  isDefusing: boolean;
  /** Progress of plant/defuse action (0 to required time in seconds) */
  actionProgress: number;
}

/** Economy state for one team */
export interface TeamEconomy {
  /** Current money available to spend */
  money: number;
  /** Number of consecutive round losses (for loss bonus calculation) */
  lossStreak: number;
  /** Total kills this match (for tracking) */
  totalKills: number;
}

/** Score tracking for the match */
export interface MatchScore {
  /** Rounds won by player 1 */
  player1: number;
  /** Rounds won by player 2 */
  player2: number;
}

/** Result of a single round */
export interface RoundResult {
  /** Which round number this was (1-9) */
  roundNumber: number;
  /** Which side won */
  winningSide: Side;
  /** Whether the bomb was planted */
  bombPlanted: boolean;
  /** Whether the bomb was defused (only relevant if planted) */
  bombDefused: boolean;
  /** Whether the bomb detonated */
  bombDetonated: boolean;
  /** Kill log for the round */
  kills: KillRecord[];
}

/** Record of a single kill event */
export interface KillRecord {
  /** ID of the soldier who got the kill */
  killerId: string;
  /** ID of the soldier who was killed */
  victimId: string;
  /** Weapon used for the kill */
  weapon: string;
  /** Whether it was a headshot */
  headshot: boolean;
  /** Game tick when the kill happened */
  tick: number;
}

/** Complete state of an active game */
export interface GameState {
  /** Current game phase */
  phase: GamePhase;
  /** Current round number (1-9) */
  roundNumber: number;
  /** Match score */
  score: MatchScore;
  /** Seconds remaining in current phase */
  timeRemaining: number;
  /** Which side player 1 is on this half */
  player1Side: Side;
  /** Soldiers for player 1's team (always 5) */
  player1Soldiers: SoldierRuntimeState[];
  /** Soldiers for player 2's team (always 5) */
  player2Soldiers: SoldierRuntimeState[];
  /** Economy for player 1 */
  player1Economy: TeamEconomy;
  /** Economy for player 2 */
  player2Economy: TeamEconomy;
  /** Whether the bomb has been planted this round */
  bombPlanted: boolean;
  /** World position of the planted bomb (null if not planted) */
  bombPosition: Position | null;
  /** Bomb site the bomb was planted at ('A' or 'B', null if not planted) */
  bombSite: string | null;
  /** Seconds remaining on bomb timer (only when planted) */
  bombTimer: number;
  /** Current simulation tick number within this round */
  tick: number;
  /** History of completed rounds */
  roundHistory: RoundResult[];
  /** The RNG seed for this match (ensures deterministic simulation) */
  matchSeed: number;
}

// ============================================================
// Factory Functions - Create initial state objects
// ============================================================

/**
 * Creates the initial game state for a new match.
 * Both players start with $800, score 0-0, round 1.
 *
 * @param matchSeed - Seed for the deterministic RNG
 * @returns Fresh GameState ready for the first buy phase
 */
export function createInitialGameState(matchSeed: number): GameState {
  return {
    phase: GamePhase.BUY_PHASE,
    roundNumber: 1,
    score: { player1: 0, player2: 0 },
    timeRemaining: 20, // Buy phase duration
    player1Side: Side.ATTACKER, // Player 1 attacks first half
    player1Soldiers: [],  // Populated when soldiers are selected
    player2Soldiers: [],
    player1Economy: createInitialEconomy(),
    player2Economy: createInitialEconomy(),
    bombPlanted: false,
    bombPosition: null,
    bombSite: null,
    bombTimer: 0,
    tick: 0,
    roundHistory: [],
    matchSeed,
  };
}

/**
 * Creates the starting economy for a team.
 * Everyone starts with $800 and no loss streak.
 */
export function createInitialEconomy(): TeamEconomy {
  return {
    money: 800,
    lossStreak: 0,
    totalKills: 0,
  };
}

/**
 * Creates the initial runtime state for a soldier at the start of a round.
 * Soldiers spawn with full health, default pistol, no waypoints.
 *
 * @param index - Soldier's index in the team (0-4)
 * @param soldierId - Reference to persistent soldier data
 * @param spawnPosition - Where to place the soldier in the spawn zone
 */
export function createSoldierRuntimeState(
  index: number,
  soldierId: string,
  spawnPosition: Position
): SoldierRuntimeState {
  return {
    index,
    soldierId,
    position: { ...spawnPosition },
    rotation: 0,
    health: 100,
    alive: true,
    primaryWeapon: null,      // Only default pistol until they buy
    armor: null,
    helmet: false,
    utility: [],
    defuseKit: false,
    stance: Stance.DEFENSIVE, // Default to defensive
    isMoving: false,
    isInCombat: false,
    currentTarget: null,
    waypoints: [],
    hasBomb: false,
    isPlanting: false,
    isDefusing: false,
    actionProgress: 0,
  };
}
