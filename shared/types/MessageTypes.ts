// ============================================================================
// MessageTypes.ts
// Network message types for client-server communication.
// Defines every message that can flow between client (C2S) and server (S2C),
// plus shared types used in those messages (commands, events, buy orders).
// ============================================================================

import { GamePhase, RoundResult, Side } from "./GameTypes";
import { SoldierState } from "./SoldierTypes";
import { Equipment, UtilityType } from "./WeaponTypes";

// ============================================================================
// Command Types -- Instructions the player issues to individual soldiers
// ============================================================================

/**
 * CommandType enumerates every command a player can issue to a soldier
 * during the LIVE_PHASE or POST_PLANT phase of a round.
 * Commands are queued and processed by the server simulation engine.
 */
export enum CommandType {
  /**
   * MOVE: Order a soldier to walk to a specific position on the map.
   * The soldier will pathfind to the targetPosition using the nav grid.
   * Movement is at normal speed; the soldier will engage enemies encountered.
   */
  MOVE = "MOVE",

  /**
   * RUSH: Order a soldier to sprint to a position at maximum speed.
   * Faster than MOVE but generates more noise (easier to detect).
   * The soldier will still engage enemies but with reduced accuracy while running.
   */
  RUSH = "RUSH",

  /**
   * HOLD: Order a soldier to stop moving and hold their current position.
   * The soldier will aim at the nearest angle or last-known enemy position.
   * Ideal for setting up crossfires and holding choke points.
   */
  HOLD = "HOLD",

  /**
   * RETREAT: Order a soldier to fall back toward their spawn or a safer position.
   * The soldier will disengage from combat and move away from enemies.
   * Useful when a site is overwhelmed or a rotation is needed.
   */
  RETREAT = "RETREAT",

  /**
   * USE_UTILITY: Order a soldier to throw a utility item at a target position.
   * Requires the soldier to have the specified utilityType in their inventory.
   * The utility is consumed on use and removed from the soldier utility array.
   */
  USE_UTILITY = "USE_UTILITY",

  /**
   * PLANT_BOMB: Order an attacking soldier to begin planting the bomb.
   * The soldier must be inside a bomb site plantZone to execute this.
   * Planting takes MatchConfig.plantTime seconds and can be interrupted.
   */
  PLANT_BOMB = "PLANT_BOMB",

  /**
   * DEFUSE_BOMB: Order a defending soldier to begin defusing the planted bomb.
   * The soldier must be adjacent to the bomb position.
   * Defuse time depends on whether the soldier has a defuse kit.
   */
  DEFUSE_BOMB = "DEFUSE_BOMB",

  /**
   * REGROUP: Order a soldier to move toward the nearest allied soldier.
   * Used to consolidate forces before a coordinated push or retake.
   * The server determines the optimal regrouping position automatically.
   */
  REGROUP = "REGROUP",
}

/**
 * Command represents a single tactical instruction issued by the player
 * to one of their soldiers during gameplay. Commands are sent to the server
 * which validates and executes them in the simulation.
 */
export interface Command {
  /**
   * The type of command being issued.
   * Determines how the server interprets the rest of the command fields.
   * @see CommandType
   */
  type: CommandType;

  /**
   * The index (0-4) of the soldier this command targets.
   * Corresponds to the soldier position in the player 5-soldier roster.
   * Must reference a soldier that is alive; commands to dead soldiers are ignored.
   * @minimum 0
   * @maximum 4
   */
  soldierIndex: number;

  /**
   * The target map position for movement or utility commands, or undefined.
   * Required for: MOVE, RUSH, USE_UTILITY, PLANT_BOMB.
   * Optional for: RETREAT (server picks a fallback position if not specified).
   * Ignored for: HOLD, REGROUP, DEFUSE_BOMB.
   */
  targetPosition?: {
    /** Target x-coordinate in pixels from the left edge of the map. */
    x: number;
    /** Target z-coordinate in pixels from the top edge of the map. */
    z: number;
  };

  /**
   * The type of utility to throw, required only for USE_UTILITY commands.
   * Must match a UtilityType that the soldier currently has in inventory.
   * Ignored for all other command types.
   * @see UtilityType
   */
  utilityType?: UtilityType;

  /**
   * Client-side timestamp (in milliseconds since epoch) when the command was issued.
   * Used for latency compensation and command ordering.
   * The server may reject commands with excessively stale timestamps.
   */
  timestamp: number;
}

// ============================================================================
// Buy Order Types -- Equipment purchases during BUY_PHASE
// ============================================================================

/**
 * BuyOrder represents a purchase request for a single soldier equipment.
 * Sent as part of a batch during BUY_PHASE. The server validates that the
 * player can afford all orders and deducts the total cost from their economy.
 */
export interface BuyOrder {
  /**
   * The index (0-4) of the soldier whose equipment is being set.
   * Corresponds to the soldier position in the player 5-soldier roster.
   * @minimum 0
   * @maximum 4
   */
  soldierIndex: number;

  /**
   * The full equipment loadout to assign to this soldier.
   * Includes primary weapon, armor, helmet, utility, and defuse kit.
   * The server calculates the total cost and validates against the player economy.
   * @see Equipment
   */
  equipment: Equipment;
}

// ============================================================================
// Client-to-Server (C2S) Message Types
// ============================================================================

/**
 * C2S_JoinQueue is sent when the player wants to enter the matchmaking queue.
 * The server will attempt to find an opponent and create a match.
 */
export interface C2S_JoinQueue {
  /**
   * Array of soldier IDs (5 total) that the player has selected for their roster.
   * These must be valid soldier IDs owned by the player.
   * Exactly 5 soldiers are required to enter the queue.
   * @minItems 5
   * @maxItems 5
   */
  roster: string[];
}

/**
 * C2S_SendCommand is sent during LIVE_PHASE or POST_PLANT to issue
 * a tactical command to one of the player soldiers.
 */
export interface C2S_SendCommand {
  /**
   * The command to execute.
   * Contains the command type, target soldier, position, and other parameters.
   * @see Command
   */
  command: Command;
}

/**
 * C2S_SendBuyOrder is sent during BUY_PHASE to purchase equipment.
 * Contains buy orders for one or more soldiers. The server processes
 * them as a batch and deducts the total cost.
 */
export interface C2S_SendBuyOrder {
  /**
   * Array of buy orders, one per soldier being equipped.
   * A player may send orders for all 5 soldiers or just a subset.
   * The server validates that the combined cost does not exceed the player economy.
   * @see BuyOrder
   */
  orders: BuyOrder[];
}

/**
 * C2S_ReadyUp is sent when the player has finished their preparations
 * (buying equipment or planning strategy) and is ready to proceed.
 * If both players ready up, the current phase may end early.
 */
export interface C2S_ReadyUp {
  /* No additional fields -- the act of sending this message signals readiness. */
}

/**
 * C2S_StrategyPlan is sent during STRATEGY_PHASE to assign waypoint paths
 * to each soldier. The server stores these plans and soldiers will follow
 * them when LIVE_PHASE begins.
 */
export interface C2S_StrategyPlan {
  /**
   * Array of waypoint plans, one per soldier (indexed 0-4).
   * Each element is an array of waypoints the corresponding soldier will follow.
   * Soldiers navigate waypoints in order during LIVE_PHASE.
   * @minItems 5
   * @maxItems 5
   */
  plans: {
    /** Target x-coordinate in pixels from the left edge of the map. */
    x: number;
    /** Target z-coordinate in pixels from the top edge of the map. */
    z: number;
  }[][];
}

/**
 * Union type of all possible client-to-server messages.
 * Each message is tagged with a "type" discriminator string for routing.
 * The server inspects the type field to determine which handler processes the message.
 */
export type C2SMessage =
  | { type: "JOIN_QUEUE"; payload: C2S_JoinQueue }
  | { type: "SEND_COMMAND"; payload: C2S_SendCommand }
  | { type: "SEND_BUY_ORDER"; payload: C2S_SendBuyOrder }
  | { type: "READY_UP"; payload: C2S_ReadyUp }
  | { type: "STRATEGY_PLAN"; payload: C2S_StrategyPlan };

// ============================================================================
// Server-to-Client (S2C) Message Types
// ============================================================================

/**
 * S2C_MatchFound is sent when matchmaking finds an opponent and creates a room.
 * Contains information about the match and the opponent.
 */
export interface S2C_MatchFound {
  /**
   * Unique identifier for the match room/session.
   * Used to route all subsequent messages for this match.
   */
  roomId: string;

  /**
   * The display name of the opponent player.
   * Shown on the HUD and scoreboard throughout the match.
   */
  opponentName: string;

  /**
   * Basic information about the opponent selected soldier roster.
   * Includes soldier names, callsigns, profiles, and rarities -- but NOT
   * detailed stats, to prevent scouting the opponent exact build.
   */
  opponentRoster: {
    /** The opponent soldier display name. */
    name: string;
    /** The opponent soldier tactical callsign. */
    callsign: string;
    /** The opponent soldier tactical role profile. */
    profile: string;
    /** The opponent soldier rarity tier. */
    rarity: string;
  }[];
}

/**
 * S2C_PhaseChange is sent whenever the game transitions to a new phase.
 * Clients use this to update their UI, enable/disable controls, and
 * start local countdown timers.
 */
export interface S2C_PhaseChange {
  /**
   * The new game phase that is now active.
   * @see GamePhase
   */
  phase: GamePhase;

  /**
   * The duration of the new phase in seconds.
   * Clients should start a local countdown timer from this value.
   */
  timeRemaining: number;
}

/**
 * S2C_GameStateUpdate is the primary real-time update sent every simulation tick
 * during LIVE_PHASE and POST_PLANT. Contains the visible game state and events.
 * This is the most frequently sent message type.
 */
export interface S2C_GameStateUpdate {
  /**
   * The server simulation tick number for this update.
   * Monotonically increasing; used for ordering, interpolation, and replay.
   * The tick rate is determined by the server configuration (e.g., 20 ticks/sec).
   */
  tick: number;

  /**
   * Array of soldier states visible to the receiving player.
   * Includes all of the player own soldiers (alive or dead) plus
   * any enemy soldiers that are currently detected (within line of sight
   * or revealed by awareness). Fog-of-war filtered server-side.
   * @see SoldierState
   */
  soldiers: SoldierState[];

  /**
   * Array of game events that occurred since the last tick update.
   * Events are discrete occurrences like shots fired, kills, bomb actions, etc.
   * Used to trigger visual/audio effects on the client.
   * @see GameEvent
   */
  events: GameEvent[];
}

/**
 * S2C_RoundEnd is sent when a round concludes, providing the outcome summary.
 * Sent during the transition to ROUND_END phase.
 */
export interface S2C_RoundEnd {
  /**
   * The side that won the completed round.
   * @see Side
   */
  winner: Side;

  /**
   * Detailed summary of the round including kills, bomb status, etc.
   * @see RoundResult
   */
  summary: RoundResult;
}

/**
 * S2C_MatchEnd is sent when the entire match concludes (one player wins enough rounds).
 * Contains final results, the winner, and any rewards earned.
 */
export interface S2C_MatchEnd {
  /**
   * The player ID of the match winner.
   * The receiving client compares this to their own ID to determine if they won.
   */
  winner: string;

  /**
   * The final score of the match, showing rounds won by each side.
   * Represents the cumulative score at the moment the match ended.
   */
  finalScore: {
    /** Total rounds won by the attacking side across the match. */
    attacker: number;
    /** Total rounds won by the defending side across the match. */
    defender: number;
  };

  /**
   * Rewards earned by the receiving player for participating in/winning the match.
   * Can include currency, XP, unlocks, or other progression rewards.
   * Structure is flexible to accommodate future reward types.
   */
  rewards: Record<string, unknown>;
}

/**
 * Union type of all possible server-to-client messages.
 * Each message is tagged with a "type" discriminator string for routing.
 * The client inspects the type field to determine which handler processes the message.
 */
export type S2CMessage =
  | { type: "MATCH_FOUND"; payload: S2C_MatchFound }
  | { type: "PHASE_CHANGE"; payload: S2C_PhaseChange }
  | { type: "GAME_STATE_UPDATE"; payload: S2C_GameStateUpdate }
  | { type: "ROUND_END"; payload: S2C_RoundEnd }
  | { type: "MATCH_END"; payload: S2C_MatchEnd };

// ============================================================================
// Game Event Types -- Discrete occurrences during simulation
// ============================================================================

/**
 * GameEventType enumerates every discrete event that can occur during
 * the LIVE_PHASE or POST_PLANT simulation. Events are collected each tick
 * and sent to clients as part of GameStateUpdate for visual/audio feedback.
 */
export enum GameEventType {
  /**
   * SHOT_FIRED: A soldier discharged their weapon.
   * Data includes: shooterId, weaponId, origin position, direction.
   * Used to render muzzle flash and play gunshot audio.
   */
  SHOT_FIRED = "SHOT_FIRED",

  /**
   * HIT: A bullet connected with a soldier (but did not kill them).
   * Data includes: shooterId, victimId, damage dealt, hitLocation (body/head/leg).
   * Used to render hit markers and blood effects.
   */
  HIT = "HIT",

  /**
   * KILL: A soldier was eliminated (health reached 0).
   * Data includes: killerId, victimId, weaponId, headshot boolean.
   * Used to update the kill feed and play elimination effects.
   */
  KILL = "KILL",

  /**
   * BOMB_PLANTED: An attacker successfully completed planting the bomb.
   * Data includes: planterId, siteId ("A" or "B"), position.
   * Triggers the transition from LIVE_PHASE to POST_PLANT.
   */
  BOMB_PLANTED = "BOMB_PLANTED",

  /**
   * BOMB_DEFUSED: A defender successfully completed defusing the bomb.
   * Data includes: defuserId, hadKit boolean.
   * Immediately ends the round with a defender victory.
   */
  BOMB_DEFUSED = "BOMB_DEFUSED",

  /**
   * BOMB_EXPLODED: The planted bomb detonated (post-plant timer reached 0).
   * Data includes: position, casualties (soldiers killed by the explosion).
   * Immediately ends the round with an attacker victory.
   */
  BOMB_EXPLODED = "BOMB_EXPLODED",

  /**
   * UTILITY_USED: A soldier deployed a utility item (grenade).
   * Data includes: soldierId, utilityType, origin, targetPosition.
   * Used to render the throw arc and deploy the utility effect.
   */
  UTILITY_USED = "UTILITY_USED",

  /**
   * SOLDIER_DETECTED: An enemy soldier has been spotted/revealed.
   * Data includes: detectorId, detectedId, position.
   * Used to add the detected soldier to the client visible state.
   */
  SOLDIER_DETECTED = "SOLDIER_DETECTED",
}

/**
 * GameEvent represents a single discrete occurrence during the game simulation.
 * Events are ephemeral -- they describe something that happened at a specific tick
 * and are used by the client for rendering effects, updating the kill feed,
 * and playing audio cues.
 */
export interface GameEvent {
  /**
   * The category of event that occurred.
   * Determines how the client processes and renders the event.
   * @see GameEventType
   */
  type: GameEventType;

  /**
   * The simulation tick at which this event occurred.
   * Used for precise timing of visual/audio effects and replay synchronization.
   * Matches the tick number in the enclosing GameStateUpdate.
   */
  tick: number;

  /**
   * Flexible key-value data payload containing event-specific details.
   * The structure varies based on the event type:
   * - SHOT_FIRED: { shooterId, weaponId, originX, originZ, directionRad }
   * - HIT: { shooterId, victimId, damage, hitLocation, isHeadshot }
   * - KILL: { killerId, victimId, weaponId, headshot }
   * - BOMB_PLANTED: { planterId, siteId, x, z }
   * - BOMB_DEFUSED: { defuserId, hadKit }
   * - BOMB_EXPLODED: { x, z, casualties }
   * - UTILITY_USED: { soldierId, utilityType, originX, originZ, targetX, targetZ }
   * - SOLDIER_DETECTED: { detectorId, detectedId, x, z }
   */
  data: Record<string, unknown>;
}
