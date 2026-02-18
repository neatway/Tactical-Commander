/**
 * GameState.ts - Core game state definitions and factory functions
 *
 * Re-exports shared enums (GamePhase, Side) from the shared types module
 * and defines client-specific runtime state interfaces. The state is updated
 * every tick during the live phase and between phases.
 *
 * Each soldier carries a RuntimeStats block (the 10 core stats abbreviated
 * ACC, REA, SPD, STL, AWR, RCL, CMP, CLT, UTL, TWK) that feed directly
 * into the StatFormulas calculations for movement, detection, and combat.
 */

// Re-export shared enums so other client files can import from one place
import { GamePhase, Side } from '@shared/types/GameTypes';
import { WeaponId } from '@shared/types/WeaponTypes';
import type { Stance } from '@shared/types/SoldierTypes';
export { GamePhase, Side, WeaponId };
export type { Stance };

// ============================================================
// Interfaces - Client-specific state structures
// ============================================================

/** Position in the game world (top-down, y is up in Three.js so we use x,z) */
export interface Position {
  /** Horizontal position in world units */
  x: number;
  /** Vertical position in world units (depth in top-down view) */
  z: number;
}

/**
 * RuntimeStats: the 10 core soldier stats used by all simulation formulas.
 * These map directly to the StatFormulas function parameters.
 * Abbreviated names match the design document (ACC, REA, SPD, etc.).
 * Each stat ranges from 1-100 (see SOLDIER constants in GameConstants.ts).
 */
export interface RuntimeStats {
  /** Accuracy — hit probability per shot */
  ACC: number;
  /** Reaction Time — who fires first in encounters */
  REA: number;
  /** Movement Speed — traversal speed on map */
  SPD: number;
  /** Stealth — reduces enemy detection radius */
  STL: number;
  /** Awareness — detection radius, vision quality */
  AWR: number;
  /** Recoil Control — accuracy decay during sustained fire */
  RCL: number;
  /** Composure — stat retention under pressure (low HP, outnumbered) */
  CMP: number;
  /** Clutch Factor — stat bonus when last alive */
  CLT: number;
  /** Utility Usage — grenade accuracy, flash duration, smoke density */
  UTL: number;
  /** Teamwork — bonus near allies, trade-kill speed */
  TWK: number;
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
  /** Currently equipped weapon ID (defaults to PISTOL) */
  currentWeapon: WeaponId;
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
  /** The 10 core combat stats used by simulation formulas */
  stats: RuntimeStats;
  /** IDs of enemies this soldier currently detects (updated each tick) */
  detectedEnemies: string[];
  /** Number of consecutive shots fired in current engagement (for spray decay) */
  shotsFired: number;
  /** Whether this soldier is currently blinded by a flash grenade */
  isBlinded: boolean;
  /** Seconds remaining on the flash blind effect (counts down each tick) */
  blindedTimer: number;
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
  /** Kill log for the current round (flushed to RoundResult on round end) */
  currentRoundKills: KillRecord[];
}

// ============================================================
// Default Soldier Stats
// ============================================================

/**
 * Creates default stats for a soldier (all stats at 50 — the baseline).
 * In the full meta-game, each soldier will have unique stats based on
 * their profile and rarity. For the prototype, everyone gets 50s.
 *
 * @returns A RuntimeStats object with all stats set to 50
 */
export function createDefaultStats(): RuntimeStats {
  return {
    ACC: 50,
    REA: 50,
    SPD: 50,
    STL: 50,
    AWR: 50,
    RCL: 50,
    CMP: 50,
    CLT: 50,
    UTL: 50,
    TWK: 50,
  };
}

/**
 * Creates varied stats for testing purposes. Each soldier index (0-4) gets
 * a different stat profile to make combat outcomes more interesting:
 *   0: Entry Fragger — high ACC, REA, low STL
 *   1: Support — high UTL, TWK, balanced
 *   2: AWPer — very high ACC, low SPD
 *   3: Lurker — high STL, AWR, CLT
 *   4: Anchor — high CMP, RCL, AWR
 *
 * @param index - Soldier index (0-4), determines the stat profile
 * @returns A RuntimeStats object with role-appropriate stat distribution
 */
export function createVariedStats(index: number): RuntimeStats {
  const profiles: RuntimeStats[] = [
    /* 0: Entry Fragger — fast reactions, accurate, not stealthy */
    { ACC: 65, REA: 70, SPD: 60, STL: 30, AWR: 50, RCL: 55, CMP: 55, CLT: 40, UTL: 35, TWK: 45 },
    /* 1: Support — good utility and teamwork, balanced combat */
    { ACC: 45, REA: 45, SPD: 50, STL: 45, AWR: 55, RCL: 45, CMP: 50, CLT: 35, UTL: 70, TWK: 65 },
    /* 2: AWPer — amazing aim, poor mobility */
    { ACC: 75, REA: 60, SPD: 35, STL: 40, AWR: 55, RCL: 50, CMP: 60, CLT: 45, UTL: 30, TWK: 40 },
    /* 3: Lurker — stealthy, aware, clutch performer */
    { ACC: 50, REA: 55, SPD: 55, STL: 75, AWR: 65, RCL: 40, CMP: 50, CLT: 70, UTL: 35, TWK: 25 },
    /* 4: Anchor — composed, good recoil control, aware */
    { ACC: 55, REA: 45, SPD: 40, STL: 50, AWR: 65, RCL: 70, CMP: 70, CLT: 40, UTL: 40, TWK: 55 },
  ];

  /* Return the profile for this index, or defaults if index is out of range */
  return { ...(profiles[index] ?? createDefaultStats()) };
}

// ============================================================
// Factory Functions - Create initial state objects
// ============================================================

/**
 * Creates the initial game state for a new match.
 * Both players start with $800, score 0-0, round 1.
 * @param matchSeed - Seed for the deterministic RNG
 * @returns Fresh GameState ready for the first buy phase
 */
export function createInitialGameState(matchSeed: number): GameState {
  return {
    phase: GamePhase.BUY_PHASE,
    roundNumber: 1,
    score: { player1: 0, player2: 0 },
    timeRemaining: 20,
    player1Side: Side.ATTACKER,
    player1Soldiers: [],
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
    currentRoundKills: [],
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
 * Soldiers spawn with full health, default pistol, varied stats, no waypoints.
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
    currentWeapon: WeaponId.PISTOL,
    armor: null,
    helmet: false,
    utility: [],
    defuseKit: false,
    stance: 'DEFENSIVE',
    isMoving: false,
    isInCombat: false,
    currentTarget: null,
    waypoints: [],
    hasBomb: false,
    isPlanting: false,
    isDefusing: false,
    actionProgress: 0,
    stats: createVariedStats(index),
    detectedEnemies: [],
    shotsFired: 0,
    isBlinded: false,
    blindedTimer: 0,
  };
}
