/**
 * @file GameRoom.ts
 * @description Manages a single match between two players on the server.
 *
 * Each GameRoom encapsulates:
 *   - Game state machine (BUY → STRATEGY → LIVE → POST_PLANT → ROUND_END)
 *   - Phase timer management
 *   - Command validation and routing
 *   - Economy tracking for both players
 *   - Broadcasting state updates to players via Socket.io
 *   - Reconnection handling (60-second timeout)
 *
 * The GameRoom does NOT run its own simulation — that's handled by
 * ServerSimulation.ts (to be built). For now, the room manages phases
 * and relays messages between the two players.
 *
 * Architecture:
 *   GameRoom
 *     ├── Phase timer (setInterval)
 *     ├── Player 1 state (socket ID, connected, ready)
 *     ├── Player 2 state (socket ID, connected, ready)
 *     └── ServerSimulation (future: tick-based game simulation)
 */

import type { Server } from 'socket.io';

// ============================================================================
// --- Constants ---
// ============================================================================

/** Phase durations in seconds (matches client-side values) */
const PHASE_DURATIONS: Record<string, number> = {
  BUY_PHASE: 20,
  STRATEGY_PHASE: 15,
  LIVE_PHASE: 105,  // 1:45
  POST_PLANT: 40,
  ROUND_END: 5,
};

/** Total rounds in a match (first to 5 wins, 9 rounds max) */
const MAX_ROUNDS = 9;

/** Rounds per half (side swap happens at this point) */
const ROUNDS_PER_HALF = 4;

/** Rounds needed to win the match */
const ROUNDS_TO_WIN = 5;

/** Reconnection timeout in milliseconds (60 seconds) */
const RECONNECT_TIMEOUT_MS = 60000;

/** Simulation tick rate in milliseconds (5 ticks per second) */
const TICK_RATE_MS = 200;

// ============================================================================
// --- Types ---
// ============================================================================

/** Possible game phases (matches shared GamePhase enum) */
type Phase = 'BUY_PHASE' | 'STRATEGY_PHASE' | 'LIVE_PHASE' | 'POST_PLANT' | 'ROUND_END' | 'MATCH_END';

/** State of a single player within the room */
interface PlayerState {
  /** Socket.io socket ID */
  socketId: string;
  /** Whether the player is currently connected */
  connected: boolean;
  /** Whether the player has readied up this phase */
  ready: boolean;
  /** Current money */
  money: number;
  /** Consecutive round losses (for loss streak bonus) */
  lossStreak: number;
  /** Total kills in the match */
  totalKills: number;
  /** Reconnection timeout handle (null if connected) */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

// ============================================================================
// --- GameRoom Class ---
// ============================================================================

/**
 * Manages a single match between two players.
 *
 * Lifecycle:
 *   1. Created by SocketServer when two players are matched
 *   2. startMatch() begins the first round (BUY_PHASE)
 *   3. Phase timer ticks every second, advancing phases when time expires
 *   4. During LIVE_PHASE, simulation ticks run at 5/sec
 *   5. Match ends when one player reaches ROUNDS_TO_WIN (5)
 *   6. Room is cleaned up and players can re-queue
 */
export class GameRoom {
  /** Unique identifier for this room */
  readonly roomId: string;

  /** Socket.io server instance (for emitting to room) */
  private io: Server;

  /** Player 1 state */
  private player1: PlayerState;

  /** Player 2 state */
  private player2: PlayerState;

  /** Current game phase */
  private phase: Phase = 'BUY_PHASE';

  /** Current round number (1-based) */
  private roundNumber: number = 0;

  /** Match score */
  private score: { player1: number; player2: number } = { player1: 0, player2: 0 };

  /** Which side player 1 is on this half (ATTACKER or DEFENDER) */
  private player1Side: 'ATTACKER' | 'DEFENDER' = 'ATTACKER';

  /** Seconds remaining in the current phase */
  private timeRemaining: number = 0;

  /** Phase timer interval handle */
  private phaseTimerHandle: ReturnType<typeof setInterval> | null = null;

  /** Simulation tick interval handle (runs during LIVE and POST_PLANT phases) */
  private simTickHandle: ReturnType<typeof setInterval> | null = null;

  /** Current simulation tick number within the round */
  private tick: number = 0;

  /** Whether the bomb has been planted this round */
  private bombPlanted: boolean = false;

  /** Whether the bomb was defused this round */
  private bombDefused: boolean = false;

  /** Whether the room has been destroyed (match ended or abandoned) */
  private destroyed: boolean = false;

  /**
   * Create a new game room.
   *
   * @param roomId - Unique room identifier
   * @param io - Socket.io server instance
   * @param player1SocketId - Socket ID of player 1
   * @param player2SocketId - Socket ID of player 2
   */
  constructor(
    roomId: string,
    io: Server,
    player1SocketId: string,
    player2SocketId: string
  ) {
    this.roomId = roomId;
    this.io = io;

    /* Initialize player states */
    this.player1 = {
      socketId: player1SocketId,
      connected: true,
      ready: false,
      money: 800,  // Starting money
      lossStreak: 0,
      totalKills: 0,
      reconnectTimer: null,
    };

    this.player2 = {
      socketId: player2SocketId,
      connected: true,
      ready: false,
      money: 800,
      lossStreak: 0,
      totalKills: 0,
      reconnectTimer: null,
    };
  }

  // --------------------------------------------------------------------------
  // Match Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start the match. Initializes round 1 and begins the BUY_PHASE.
   * Called by SocketServer after creating the room and notifying players.
   */
  startMatch(): void {
    this.roundNumber = 1;
    this.player1Side = 'ATTACKER';
    this.startPhase('BUY_PHASE');
    console.log(`[Room ${this.roomId}] Match started — Round 1, Buy Phase`);
  }

  // --------------------------------------------------------------------------
  // Phase Management
  // --------------------------------------------------------------------------

  /**
   * Transition to a new game phase.
   * Sets the timer, notifies both players, and starts/stops simulation as needed.
   *
   * @param phase - The phase to transition to
   */
  private startPhase(phase: Phase): void {
    this.phase = phase;
    this.timeRemaining = PHASE_DURATIONS[phase] ?? 0;

    /* Reset ready-up flags for both players */
    this.player1.ready = false;
    this.player2.ready = false;

    /* Notify both players of the phase change */
    this.broadcast('PHASE_CHANGE', {
      phase: this.phase,
      timeRemaining: this.timeRemaining,
      roundNumber: this.roundNumber,
      score: this.score,
      player1Side: this.player1Side,
    });

    /* Start the phase countdown timer (ticks every second) */
    this.stopPhaseTimer();
    this.phaseTimerHandle = setInterval(() => this.phaseTimerTick(), 1000);

    /* Start simulation ticks during active phases */
    if (phase === 'LIVE_PHASE' || phase === 'POST_PLANT') {
      this.startSimulationTicks();
    } else {
      this.stopSimulationTicks();
    }

    console.log(
      `[Room ${this.roomId}] Phase: ${phase} (${this.timeRemaining}s)` +
      ` — Round ${this.roundNumber}`
    );
  }

  /**
   * Phase timer tick — called every second.
   * Decrements the time remaining and advances phase when expired.
   */
  private phaseTimerTick(): void {
    this.timeRemaining--;

    if (this.timeRemaining <= 0) {
      this.advancePhase();
    }
  }

  /**
   * Advance to the next phase based on the current one.
   * Handles the game state machine logic.
   */
  private advancePhase(): void {
    this.stopPhaseTimer();

    switch (this.phase) {
      case 'BUY_PHASE':
        this.startPhase('STRATEGY_PHASE');
        break;

      case 'STRATEGY_PHASE':
        this.tick = 0;
        this.startPhase('LIVE_PHASE');
        break;

      case 'LIVE_PHASE':
        /* Time expired without bomb plant → defenders win */
        this.endRound('DEFENDER');
        break;

      case 'POST_PLANT':
        /* Bomb timer expired → bomb detonates, attackers win */
        this.endRound('ATTACKER');
        break;

      case 'ROUND_END':
        /* Start the next round or end the match */
        this.startNextRound();
        break;
    }
  }

  /**
   * Stop the phase countdown timer.
   */
  private stopPhaseTimer(): void {
    if (this.phaseTimerHandle) {
      clearInterval(this.phaseTimerHandle);
      this.phaseTimerHandle = null;
    }
  }

  // --------------------------------------------------------------------------
  // Simulation Tick Management
  // --------------------------------------------------------------------------

  /**
   * Start simulation ticks at TICK_RATE_MS (200ms = 5 ticks/sec).
   * During LIVE_PHASE and POST_PLANT, the server runs the game simulation
   * and broadcasts state updates to both players.
   */
  private startSimulationTicks(): void {
    this.stopSimulationTicks();
    this.simTickHandle = setInterval(() => this.simulationTick(), TICK_RATE_MS);
  }

  /**
   * Stop simulation ticks.
   */
  private stopSimulationTicks(): void {
    if (this.simTickHandle) {
      clearInterval(this.simTickHandle);
      this.simTickHandle = null;
    }
  }

  /**
   * Run one simulation tick.
   * TODO: This is where ServerSimulation will be called to:
   *   1. Process queued commands
   *   2. Update movement (A* + SPD stat)
   *   3. Run detection (vision cone + LOS)
   *   4. Resolve combat (stat-driven firefights)
   *   5. Tick utility effects
   *   6. Check round-end conditions
   *   7. Build fog-of-war filtered state for each player
   *   8. Broadcast state updates
   *
   * For now, broadcasts a tick heartbeat to keep clients in sync.
   */
  private simulationTick(): void {
    this.tick++;

    /* Broadcast tick update to both players */
    this.broadcast('GAME_TICK', {
      tick: this.tick,
      phase: this.phase,
      timeRemaining: this.timeRemaining,
    });
  }

  // --------------------------------------------------------------------------
  // Round Management
  // --------------------------------------------------------------------------

  /**
   * End the current round with a winner.
   * Updates score, economy, and transitions to ROUND_END phase.
   *
   * @param winningSide - Which side won ('ATTACKER' or 'DEFENDER')
   */
  private endRound(winningSide: 'ATTACKER' | 'DEFENDER'): void {
    this.stopSimulationTicks();

    /* Determine which player won */
    const p1Won = this.player1Side === winningSide;

    /* Update score */
    if (p1Won) {
      this.score.player1++;
    } else {
      this.score.player2++;
    }

    /* Update loss streaks */
    if (p1Won) {
      this.player1.lossStreak = 0;
      this.player2.lossStreak++;
    } else {
      this.player2.lossStreak = 0;
      this.player1.lossStreak++;
    }

    /* Broadcast round end to both players */
    this.broadcast('ROUND_END', {
      winner: winningSide,
      roundNumber: this.roundNumber,
      score: this.score,
      bombPlanted: this.bombPlanted,
      bombDefused: this.bombDefused,
    });

    console.log(
      `[Room ${this.roomId}] Round ${this.roundNumber}: ${winningSide} wins` +
      ` — Score: ${this.score.player1}-${this.score.player2}`
    );

    /* Check for match end */
    if (this.score.player1 >= ROUNDS_TO_WIN || this.score.player2 >= ROUNDS_TO_WIN) {
      this.endMatch();
      return;
    }

    /* Transition to ROUND_END phase */
    this.startPhase('ROUND_END');
  }

  /**
   * Start the next round. Handles side swap and round counter advancement.
   */
  private startNextRound(): void {
    this.roundNumber++;

    /* Side swap at the halfway point */
    if (this.roundNumber === ROUNDS_PER_HALF + 1) {
      this.player1Side = this.player1Side === 'ATTACKER' ? 'DEFENDER' : 'ATTACKER';
      console.log(`[Room ${this.roomId}] Side swap! P1 is now ${this.player1Side}`);
    }

    /* Reset round state */
    this.bombPlanted = false;
    this.bombDefused = false;
    this.tick = 0;

    /* Start buy phase for the new round */
    this.startPhase('BUY_PHASE');
  }

  /**
   * End the entire match. Broadcasts the final result and cleans up.
   */
  private endMatch(): void {
    this.phase = 'MATCH_END';
    this.stopPhaseTimer();
    this.stopSimulationTicks();

    const winner = this.score.player1 >= ROUNDS_TO_WIN ? 'Player 1' : 'Player 2';

    this.broadcast('MATCH_END', {
      winner,
      finalScore: this.score,
    });

    console.log(
      `[Room ${this.roomId}] MATCH OVER! ${winner} wins` +
      ` ${this.score.player1}-${this.score.player2}`
    );

    this.destroy();
  }

  // --------------------------------------------------------------------------
  // Message Handlers (from SocketServer)
  // --------------------------------------------------------------------------

  /**
   * Handle a tactical command from a player.
   * Validates the command and queues it for the next simulation tick.
   *
   * @param playerNumber - Which player sent the command (1 or 2)
   * @param command - The command data (will be validated)
   */
  handleCommand(playerNumber: 1 | 2, command: unknown): void {
    /* Only accept commands during active phases */
    if (this.phase !== 'LIVE_PHASE' && this.phase !== 'POST_PLANT') {
      return;
    }

    /**
     * TODO: Validate the command structure and queue it for the simulation.
     * For now, relay it to the other player (peer-to-peer style).
     * This will be replaced by server-authoritative simulation.
     */
    const otherPlayer = playerNumber === 1 ? this.player2 : this.player1;
    this.emitToPlayer(otherPlayer, 'OPPONENT_COMMAND', { command });
  }

  /**
   * Handle a buy order from a player.
   * Validates affordability and applies the purchase.
   *
   * @param playerNumber - Which player sent the order (1 or 2)
   * @param orders - Array of buy order data
   */
  handleBuyOrder(playerNumber: 1 | 2, orders: unknown[]): void {
    if (this.phase !== 'BUY_PHASE') {
      return;
    }

    /**
     * TODO: Validate the buy orders against the player's economy.
     * For now, acknowledge the order.
     */
    const player = playerNumber === 1 ? this.player1 : this.player2;
    this.emitToPlayer(player, 'BUY_ORDER_ACCEPTED', { orders });
  }

  /**
   * Handle a player readying up.
   * If both players are ready, the current phase advances early.
   *
   * @param playerNumber - Which player readied up (1 or 2)
   */
  handleReadyUp(playerNumber: 1 | 2): void {
    const player = playerNumber === 1 ? this.player1 : this.player2;
    player.ready = true;

    console.log(`[Room ${this.roomId}] Player ${playerNumber} ready`);

    /* If both players are ready, advance the phase immediately */
    if (this.player1.ready && this.player2.ready) {
      console.log(`[Room ${this.roomId}] Both players ready — advancing phase`);
      this.advancePhase();
    }
  }

  /**
   * Handle a strategy plan submission from a player.
   * Stores the waypoints for each soldier to follow when LIVE_PHASE starts.
   *
   * @param playerNumber - Which player submitted the plan (1 or 2)
   * @param plans - Waypoint plans for the player's 5 soldiers
   */
  handleStrategyPlan(playerNumber: 1 | 2, plans: unknown): void {
    if (this.phase !== 'STRATEGY_PHASE') {
      return;
    }

    /**
     * TODO: Validate and store the strategy plans.
     * For now, acknowledge receipt.
     */
    const player = playerNumber === 1 ? this.player1 : this.player2;
    this.emitToPlayer(player, 'STRATEGY_PLAN_ACCEPTED', {});
  }

  /**
   * Handle a player disconnecting.
   * Starts a 60-second reconnection timer. If the timer expires,
   * the disconnected player forfeits.
   *
   * @param playerNumber - Which player disconnected (1 or 2)
   */
  handleDisconnect(playerNumber: 1 | 2): void {
    const player = playerNumber === 1 ? this.player1 : this.player2;
    player.connected = false;

    /* Notify the other player */
    const otherPlayer = playerNumber === 1 ? this.player2 : this.player1;
    this.emitToPlayer(otherPlayer, 'OPPONENT_DISCONNECTED', {
      timeoutSeconds: RECONNECT_TIMEOUT_MS / 1000,
    });

    /**
     * Start a reconnection timer. If the player doesn't reconnect
     * within 60 seconds, they forfeit the match.
     */
    player.reconnectTimer = setTimeout(() => {
      console.log(`[Room ${this.roomId}] Player ${playerNumber} reconnect timeout — forfeit`);

      /* The other player wins by forfeit */
      const forfeitWinner = playerNumber === 1 ? 'Player 2' : 'Player 1';
      this.broadcast('MATCH_END', {
        winner: forfeitWinner,
        finalScore: this.score,
        reason: 'opponent_disconnect',
      });

      this.destroy();
    }, RECONNECT_TIMEOUT_MS);

    console.log(
      `[Room ${this.roomId}] Player ${playerNumber} disconnected` +
      ` — ${RECONNECT_TIMEOUT_MS / 1000}s to reconnect`
    );
  }

  // --------------------------------------------------------------------------
  // Communication Helpers
  // --------------------------------------------------------------------------

  /**
   * Broadcast a message to all players in this room.
   *
   * @param event - The event name
   * @param data - The data payload
   */
  private broadcast(event: string, data: unknown): void {
    this.io.to(this.roomId).emit(event, data);
  }

  /**
   * Emit a message to a specific player.
   *
   * @param player - The player state containing the socket ID
   * @param event - The event name
   * @param data - The data payload
   */
  private emitToPlayer(player: PlayerState, event: string, data: unknown): void {
    if (!player.connected) return;
    this.io.to(player.socketId).emit(event, data);
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Destroy the room and clean up all timers and resources.
   * Called when the match ends or is abandoned.
   */
  private destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.stopPhaseTimer();
    this.stopSimulationTicks();

    /* Clear reconnection timers */
    if (this.player1.reconnectTimer) clearTimeout(this.player1.reconnectTimer);
    if (this.player2.reconnectTimer) clearTimeout(this.player2.reconnectTimer);

    console.log(`[Room ${this.roomId}] Room destroyed`);
  }

  // --------------------------------------------------------------------------
  // Getters (for monitoring)
  // --------------------------------------------------------------------------

  /** Get the current phase of the game. */
  getPhase(): Phase { return this.phase; }

  /** Get the current round number. */
  getRoundNumber(): number { return this.roundNumber; }

  /** Get the current score. */
  getScore(): { player1: number; player2: number } { return { ...this.score }; }
}
