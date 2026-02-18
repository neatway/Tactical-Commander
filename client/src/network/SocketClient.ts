/**
 * @file SocketClient.ts
 * @description Client-side Socket.io connection manager for multiplayer.
 *
 * Manages the WebSocket connection to the game server and provides:
 *   - Connection lifecycle (connect, disconnect, reconnect)
 *   - Typed message sending (JOIN_QUEUE, SEND_COMMAND, etc.)
 *   - Event callbacks for server messages (MATCH_FOUND, PHASE_CHANGE, etc.)
 *   - Connection state tracking with status events
 *
 * Architecture:
 *   Game.ts
 *     └── SocketClient (this file)
 *           ├── Sends C2S messages (commands, buy orders, strategy plans)
 *           └── Receives S2C messages (phase changes, state updates, match events)
 *
 * The SocketClient is optional — the game can run in single-player (vs bot)
 * mode without a server connection. When connected, it replaces the local
 * phase management with server-authoritative phase control.
 */

import { io, Socket } from 'socket.io-client';
import type { Command, BuyOrder } from '@shared/types/MessageTypes';

// ============================================================================
// --- Types ---
// ============================================================================

/** Connection status of the client */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Callback type for connection status changes */
export type OnStatusChangeCallback = (status: ConnectionStatus) => void;

/** Callback type for when a match is found */
export type OnMatchFoundCallback = (data: {
  roomId: string;
  playerNumber: 1 | 2;
  opponentName: string;
}) => void;

/** Callback type for phase change events from the server */
export type OnPhaseChangeCallback = (data: {
  phase: string;
  timeRemaining: number;
  roundNumber: number;
  score: { player1: number; player2: number };
  player1Side: string;
}) => void;

/** Callback type for game tick updates during LIVE/POST_PLANT phases */
export type OnGameTickCallback = (data: {
  tick: number;
  phase: string;
  timeRemaining: number;
}) => void;

/**
 * Fog-of-war filtered soldier state from the server.
 * Contains position, health, weapon, and movement info for visible soldiers.
 */
export interface ServerSoldierState {
  /** Index of this soldier in the team (0-4) */
  index: number;
  /** Reference ID to the soldier's persistent data */
  soldierId: string;
  /** Current world position */
  position: { x: number; z: number };
  /** Direction the soldier is facing, in radians */
  rotation: number;
  /** Current health points (0-100) */
  health: number;
  /** Whether the soldier is still alive */
  alive: boolean;
  /** Currently equipped weapon */
  currentWeapon: string;
  /** Whether the soldier is currently moving */
  isMoving: boolean;
  /** Whether the soldier is in active combat */
  isInCombat: boolean;
  /** Whether this soldier is planting the bomb */
  isPlanting?: boolean;
  /** Whether this soldier is defusing the bomb */
  isDefusing?: boolean;
}

/**
 * Fog-of-war filtered game state from the server.
 * Each player receives a different view based on what their soldiers detect.
 */
export interface FilteredGameState {
  /** All of the player's own soldiers (full state) */
  ownSoldiers: ServerSoldierState[];
  /** Enemy soldiers that are currently visible (detected) */
  visibleEnemies: Partial<ServerSoldierState>[];
  /** Whether the bomb has been planted */
  bombPlanted: boolean;
  /** Bomb position (null if not planted or not visible) */
  bombPosition: { x: number; z: number } | null;
  /** Bomb site identifier */
  bombSite: string | null;
  /** Bomb timer (only visible to defenders when planted) */
  bombTimer: number;
  /** Current tick number */
  tick: number;
}

/** Kill record from the server simulation */
export interface ServerKillRecord {
  killerId: string;
  victimId: string;
  weapon: string;
  headshot: boolean;
  tick: number;
}

/**
 * Callback type for authoritative game state updates from the server.
 * Received every simulation tick (5/sec) during LIVE_PHASE and POST_PLANT.
 * Contains fog-of-war filtered state — each player sees a different view.
 */
export type OnGameStateUpdateCallback = (data: {
  tick: number;
  phase: string;
  timeRemaining: number;
  state: FilteredGameState;
  events: unknown[];
  kills: ServerKillRecord[];
}) => void;

/**
 * Callback type for bomb planted events from the server.
 * Signals the transition from LIVE_PHASE to POST_PLANT.
 */
export type OnBombPlantedCallback = (data: {
  tick: number;
  bombPosition: { x: number; z: number };
  bombSite: string;
}) => void;

/** Callback type for round end events */
export type OnRoundEndCallback = (data: {
  winner: string;
  roundNumber: number;
  score: { player1: number; player2: number };
  bombPlanted: boolean;
  bombDefused: boolean;
}) => void;

/** Callback type for match end events */
export type OnMatchEndCallback = (data: {
  winner: string;
  finalScore: { player1: number; player2: number };
  reason?: string;
}) => void;

/** Callback type for queue status updates */
export type OnQueueUpdateCallback = (data: { position: number }) => void;

/** Callback type for opponent disconnect notification */
export type OnOpponentDisconnectedCallback = (data: { timeoutSeconds: number }) => void;

/** Callback type for generic server errors */
export type OnErrorCallback = (data: { message: string }) => void;

// ============================================================================
// --- SocketClient Class ---
// ============================================================================

/**
 * Client-side Socket.io connection manager.
 *
 * Usage:
 * ```ts
 * const client = new SocketClient('http://localhost:4000');
 * client.onMatchFound = (data) => { startMultiplayerGame(data); };
 * client.onPhaseChange = (data) => { updateGamePhase(data); };
 * client.connect();
 * client.joinQueue();
 * ```
 */
export class SocketClient {
  /** The Socket.io client socket instance */
  private socket: Socket | null = null;

  /** URL of the game server */
  private serverUrl: string;

  /** Current connection status */
  private status: ConnectionStatus = 'disconnected';

  // --- Event Callbacks ---

  /** Fired when the connection status changes */
  public onStatusChange: OnStatusChangeCallback | null = null;

  /** Fired when a match is found and a room is created */
  public onMatchFound: OnMatchFoundCallback | null = null;

  /** Fired when the game phase changes (from server) */
  public onPhaseChange: OnPhaseChangeCallback | null = null;

  /** Fired on each simulation tick during active phases (legacy heartbeat) */
  public onGameTick: OnGameTickCallback | null = null;

  /**
   * Fired on each authoritative state update from the server (5/sec).
   * Contains fog-of-war filtered game state with own soldiers and visible enemies.
   */
  public onGameStateUpdate: OnGameStateUpdateCallback | null = null;

  /**
   * Fired when the bomb is planted.
   * Signals transition from LIVE_PHASE to POST_PLANT.
   */
  public onBombPlanted: OnBombPlantedCallback | null = null;

  /** Fired when a round ends */
  public onRoundEnd: OnRoundEndCallback | null = null;

  /** Fired when the match ends */
  public onMatchEnd: OnMatchEndCallback | null = null;

  /** Fired when the queue position updates */
  public onQueueUpdate: OnQueueUpdateCallback | null = null;

  /** Fired when the opponent disconnects */
  public onOpponentDisconnected: OnOpponentDisconnectedCallback | null = null;

  /** Fired on server errors */
  public onError: OnErrorCallback | null = null;

  /**
   * Create a new SocketClient.
   * Does NOT automatically connect — call connect() when ready.
   *
   * @param serverUrl - URL of the game server (e.g., 'http://localhost:4000')
   */
  constructor(serverUrl: string = 'http://localhost:4000') {
    this.serverUrl = serverUrl;
  }

  // --------------------------------------------------------------------------
  // Connection Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Connect to the game server.
   * Sets up all Socket.io event listeners for server messages.
   * Safe to call multiple times — reconnects if already connected.
   */
  connect(): void {
    /* Close any existing connection */
    if (this.socket) {
      this.socket.disconnect();
    }

    this.setStatus('connecting');

    /** Create the Socket.io connection with auto-reconnect enabled */
    this.socket = io(this.serverUrl, {
      transports: ['websocket'],        // Skip long-polling, go straight to WebSocket
      reconnection: true,               // Auto-reconnect on disconnect
      reconnectionAttempts: 10,         // Try 10 times before giving up
      reconnectionDelay: 1000,          // Start with 1s delay
      reconnectionDelayMax: 5000,       // Max 5s delay between attempts
    });

    /* --- Connection Events --- */

    this.socket.on('connect', () => {
      console.log(`[SocketClient] Connected to server (id: ${this.socket?.id})`);
      this.setStatus('connected');
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`[SocketClient] Disconnected: ${reason}`);
      this.setStatus('disconnected');
    });

    this.socket.on('reconnecting', () => {
      this.setStatus('reconnecting');
    });

    this.socket.on('connect_error', (err) => {
      console.error(`[SocketClient] Connection error: ${err.message}`);
    });

    /* --- Game Event Handlers --- */

    this.socket.on('MATCH_FOUND', (data) => {
      console.log(`[SocketClient] Match found! Room: ${data.roomId}, Player: ${data.playerNumber}`);
      this.onMatchFound?.(data);
    });

    this.socket.on('QUEUE_JOINED', (data) => {
      console.log(`[SocketClient] Joined queue (position ${data.position})`);
      this.onQueueUpdate?.(data);
    });

    this.socket.on('QUEUE_LEFT', () => {
      console.log('[SocketClient] Left matchmaking queue');
    });

    this.socket.on('PHASE_CHANGE', (data) => {
      console.log(`[SocketClient] Phase: ${data.phase} (${data.timeRemaining}s)`);
      this.onPhaseChange?.(data);
    });

    this.socket.on('GAME_TICK', (data) => {
      this.onGameTick?.(data);
    });

    /**
     * GAME_STATE_UPDATE: Authoritative state from the server simulation.
     * Contains fog-of-war filtered view for this player.
     * Received 5 times/sec during LIVE_PHASE and POST_PLANT.
     */
    this.socket.on('GAME_STATE_UPDATE', (data) => {
      this.onGameStateUpdate?.(data);
    });

    /**
     * BOMB_PLANTED: The bomb has been planted.
     * Triggers the LIVE_PHASE -> POST_PLANT transition.
     */
    this.socket.on('BOMB_PLANTED', (data) => {
      console.log(`[SocketClient] Bomb planted at ${data.bombSite}`);
      this.onBombPlanted?.(data);
    });

    this.socket.on('ROUND_END', (data) => {
      console.log(`[SocketClient] Round ${data.roundNumber} ended: ${data.winner} wins`);
      this.onRoundEnd?.(data);
    });

    this.socket.on('MATCH_END', (data) => {
      console.log(`[SocketClient] Match ended: ${data.winner} wins`);
      this.onMatchEnd?.(data);
    });

    this.socket.on('OPPONENT_DISCONNECTED', (data) => {
      console.log(`[SocketClient] Opponent disconnected (${data.timeoutSeconds}s to reconnect)`);
      this.onOpponentDisconnected?.(data);
    });

    this.socket.on('ERROR', (data) => {
      console.error(`[SocketClient] Server error: ${data.message}`);
      this.onError?.(data);
    });
  }

  /**
   * Disconnect from the server.
   * Closes the WebSocket connection and cleans up.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.setStatus('disconnected');
  }

  /**
   * Check if the client is currently connected to the server.
   * @returns True if connected
   */
  isConnected(): boolean {
    return this.status === 'connected' && this.socket?.connected === true;
  }

  /**
   * Get the current connection status.
   * @returns The current ConnectionStatus
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  // --------------------------------------------------------------------------
  // Message Sending (C2S)
  // --------------------------------------------------------------------------

  /**
   * Join the matchmaking queue to find an opponent.
   * The server will pair two queued players and create a game room.
   */
  joinQueue(): void {
    this.emit('JOIN_QUEUE', {});
  }

  /**
   * Leave the matchmaking queue.
   */
  leaveQueue(): void {
    this.emit('LEAVE_QUEUE', {});
  }

  /**
   * Send a tactical command to a soldier during LIVE_PHASE or POST_PLANT.
   *
   * @param command - The command to send (includes type, soldier index, target, etc.)
   */
  sendCommand(command: Command): void {
    this.emit('SEND_COMMAND', { command });
  }

  /**
   * Send buy orders for purchasing equipment during BUY_PHASE.
   *
   * @param orders - Array of buy orders for individual soldiers
   */
  sendBuyOrder(orders: BuyOrder[]): void {
    this.emit('SEND_BUY_ORDER', { orders });
  }

  /**
   * Signal that the player is ready to proceed to the next phase.
   * If both players ready up, the phase advances immediately.
   */
  readyUp(): void {
    this.emit('READY_UP', {});
  }

  /**
   * Submit strategy plans (waypoints) for the current round.
   *
   * @param plans - Array of waypoint arrays, one per soldier (5 total)
   */
  sendStrategyPlan(plans: { x: number; z: number }[][]): void {
    this.emit('STRATEGY_PLAN', { plans });
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  /**
   * Emit a message to the server.
   * Silently drops the message if not connected.
   *
   * @param event - The event name
   * @param data - The data payload
   */
  private emit(event: string, data: unknown): void {
    if (!this.socket?.connected) {
      console.warn(`[SocketClient] Cannot emit '${event}' — not connected`);
      return;
    }
    this.socket.emit(event, data);
  }

  /**
   * Update the connection status and fire the status change callback.
   *
   * @param status - The new status
   */
  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status);
  }
}
