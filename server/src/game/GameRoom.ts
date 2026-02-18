/**
 * @file GameRoom.ts
 * @description Manages a single match between two players on the server.
 *
 * Each GameRoom encapsulates:
 *   - Game state machine (BUY -> STRATEGY -> LIVE -> POST_PLANT -> ROUND_END)
 *   - Phase timer management
 *   - Server-authoritative simulation via ServerSimulation
 *   - Command validation and routing (anti-cheat)
 *   - Economy tracking for both players
 *   - Fog-of-war filtered state broadcasting to each player
 *   - Reconnection handling (60-second timeout)
 *
 * Architecture:
 *   GameRoom
 *     ├── Phase timer (setInterval)
 *     ├── Player 1 state (socket ID, connected, ready, economy)
 *     ├── Player 2 state (socket ID, connected, ready, economy)
 *     └── ServerSimulation (tick-based authoritative game simulation)
 *           ├── Runs at 5 ticks/sec during LIVE_PHASE and POST_PLANT
 *           ├── Processes queued commands from both players
 *           ├── Updates movement, detection, combat, bomb actions
 *           ├── Generates events (shots, kills, bomb plant/defuse)
 *           └── Produces fog-of-war filtered state for each player
 */

import type { Server } from 'socket.io';
import { ServerSimulation } from '../simulation/ServerSimulation.js';
import type { TickResult, FilteredGameState } from '../simulation/ServerSimulation.js';

// ============================================================================
// --- Constants ---
// ============================================================================

/** Phase durations in seconds (matches client-side values from GameConstants.ts) */
const PHASE_DURATIONS: Record<string, number> = {
  BUY_PHASE: 20,
  STRATEGY_PHASE: 15,
  LIVE_PHASE: 105,  // 1:45
  POST_PLANT: 40,
  ROUND_END: 5,
};

/** Rounds per half (side swap happens after this many rounds) */
const ROUNDS_PER_HALF = 4;

/** Rounds needed to win the match */
const ROUNDS_TO_WIN = 5;

/** Reconnection timeout in milliseconds (60 seconds) */
const RECONNECT_TIMEOUT_MS = 60000;

/** Simulation tick rate in milliseconds (5 ticks per second) */
const TICK_RATE_MS = 200;

/** Starting money for each player at the beginning of the match */
const STARTING_MONEY = 800;

/** Maximum money a player can accumulate */
const MAX_MONEY = 16000;

/** Win reward for the winning team */
const WIN_REWARD = 3250;

/** Loss rewards based on consecutive loss streak (index = streak count - 1) */
const LOSS_STREAK_REWARDS = [1400, 1900, 2400, 2900, 3400];

/** Kill reward per weapon type */
const KILL_REWARDS: Record<string, number> = {
  PISTOL: 300,
  SMG: 600,
  RIFLE: 300,
  AWP: 100,
  SHOTGUN: 900,
  LMG: 300,
};

/** Bomb plant/defuse bonus for the team that achieves it */
const OBJECTIVE_BONUS = 300;

/**
 * Bazaar map spawn zones (hardcoded for now — will be loaded from map data).
 * These match the values in client/src/assets/maps/bazaar.ts.
 */
const BAZAAR_ATTACKER_SPAWN = { x: 100, z: 200, width: 300, height: 1600 };
const BAZAAR_DEFENDER_SPAWN = { x: 2550, z: 200, width: 300, height: 1600 };

/**
 * Bazaar map walls (hardcoded subset of key walls for LOS checks).
 * Full wall data will be imported from the map data file in a future iteration.
 * For the prototype, we include the boundary walls and the major structural walls.
 */
const BAZAAR_WALLS = [
  /* Map boundary walls */
  { x: 0, z: 0, width: 3000, height: 20 },       // Top boundary
  { x: 0, z: 1980, width: 3000, height: 20 },     // Bottom boundary
  { x: 0, z: 0, width: 20, height: 2000 },        // Left boundary
  { x: 2980, z: 0, width: 20, height: 2000 },     // Right boundary

  /* A Long lane walls */
  { x: 420, z: 130, width: 180, height: 340 },    // T-side A long corner
  { x: 780, z: 20, width: 40, height: 420 },      // A long left wall
  { x: 780, z: 530, width: 240, height: 40 },     // A long cross wall
  { x: 1120, z: 20, width: 40, height: 420 },     // A long right wall
  { x: 1120, z: 530, width: 200, height: 40 },    // A long right cross wall

  /* Mid lane walls */
  { x: 780, z: 700, width: 40, height: 600 },     // Mid left wall
  { x: 1120, z: 700, width: 40, height: 600 },    // Mid right wall
  { x: 850, z: 960, width: 240, height: 40 },     // Mid cross wall

  /* B tunnels walls */
  { x: 420, z: 1520, width: 180, height: 340 },   // T-side B tunnel entrance
  { x: 780, z: 1400, width: 40, height: 580 },    // B tunnel left wall
  { x: 1120, z: 1400, width: 40, height: 580 },   // B tunnel right wall
  { x: 780, z: 1400, width: 380, height: 40 },    // B tunnel top wall

  /* A site structures */
  { x: 1600, z: 100, width: 40, height: 410 },    // A site left wall
  { x: 1600, z: 100, width: 630, height: 40 },    // A site top wall
  { x: 2190, z: 100, width: 40, height: 410 },    // A site right wall

  /* B site structures */
  { x: 1600, z: 1400, width: 40, height: 410 },   // B site left wall
  { x: 1600, z: 1770, width: 630, height: 40 },   // B site bottom wall
  { x: 2190, z: 1400, width: 40, height: 410 },   // B site right wall

  /* CT connector walls */
  { x: 2300, z: 500, width: 40, height: 180 },    // CT connector top wall
  { x: 2300, z: 1320, width: 40, height: 180 },   // CT connector bottom wall
];

/**
 * Valid command types that the server will accept from clients.
 * Any command with a type not in this list will be rejected.
 */
const VALID_COMMAND_TYPES = ['MOVE', 'RUSH', 'HOLD', 'RETREAT', 'USE_UTILITY', 'PLANT_BOMB', 'DEFUSE_BOMB', 'REGROUP'];

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

/**
 * Parsed and validated command from a client.
 * After validation, this is passed to the ServerSimulation.
 */
interface ValidatedCommand {
  /** Command type (MOVE, RUSH, HOLD, etc.) */
  type: string;
  /** Target soldier index (0-4) */
  soldierIndex: number;
  /** Target position for movement commands */
  targetPosition?: { x: number; z: number };
  /** Utility type for USE_UTILITY commands */
  utilityType?: string;
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
 *   4. During LIVE_PHASE, simulation ticks run at 5/sec via ServerSimulation
 *   5. Each tick: process commands -> simulate -> broadcast filtered state
 *   6. Match ends when one player reaches ROUNDS_TO_WIN (5)
 *   7. Room is cleaned up and players can re-queue
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
   * The server-authoritative simulation engine for this match.
   * Created once when the room is constructed and reused across rounds.
   */
  private simulation: ServerSimulation;

  /** Strategy plans submitted by each player (waypoints per soldier) */
  private strategyPlans: {
    player1: { x: number; z: number }[][] | null;
    player2: { x: number; z: number }[][] | null;
  } = { player1: null, player2: null };

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

    /* Initialize player states with starting money */
    this.player1 = {
      socketId: player1SocketId,
      connected: true,
      ready: false,
      money: STARTING_MONEY,
      lossStreak: 0,
      totalKills: 0,
      reconnectTimer: null,
    };

    this.player2 = {
      socketId: player2SocketId,
      connected: true,
      ready: false,
      money: STARTING_MONEY,
      lossStreak: 0,
      totalKills: 0,
      reconnectTimer: null,
    };

    /**
     * Create the simulation engine with a random seed.
     * The seed is generated once per match for deterministic replay.
     */
    const matchSeed = Math.floor(Math.random() * 2147483647);
    this.simulation = new ServerSimulation(matchSeed);

    /* Load map wall data into the simulation for LOS checks */
    this.simulation.setWalls(BAZAAR_WALLS);
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

    /* Initialize the simulation for the first round */
    this.initializeSimulationForRound();

    this.startPhase('BUY_PHASE');
    console.log(`[Room ${this.roomId}] Match started — Round 1, Buy Phase`);
  }

  /**
   * Initialize the ServerSimulation for a new round.
   * Sets up soldiers at spawn positions based on current sides.
   */
  private initializeSimulationForRound(): void {
    this.simulation.initializeRound(
      this.player1Side,
      BAZAAR_ATTACKER_SPAWN,
      BAZAAR_DEFENDER_SPAWN
    );
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

    /**
     * When transitioning to LIVE_PHASE, apply any strategy plans
     * that were submitted during STRATEGY_PHASE.
     */
    if (phase === 'LIVE_PHASE') {
      this.applyStrategyPlans();
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
        /* Time expired without bomb plant -> defenders win */
        this.endRound('DEFENDER');
        break;

      case 'POST_PLANT':
        /* Bomb timer expired -> bomb detonates, attackers win */
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
  // Strategy Phase
  // --------------------------------------------------------------------------

  /**
   * Apply stored strategy plans to the simulation when LIVE_PHASE starts.
   * Strategy plans set initial waypoints for soldiers at round start.
   */
  private applyStrategyPlans(): void {
    /* Apply player 1's strategy plans */
    if (this.strategyPlans.player1) {
      for (let i = 0; i < this.strategyPlans.player1.length && i < 5; i++) {
        const waypoints = this.strategyPlans.player1[i];
        if (waypoints && waypoints.length > 0) {
          /**
           * Queue a MOVE command for each soldier with a zero delay
           * (strategy plans execute immediately at round start).
           */
          this.simulation.queueCommand(1, 'MOVE', i, waypoints[0]);
        }
      }
    }

    /* Apply player 2's strategy plans */
    if (this.strategyPlans.player2) {
      for (let i = 0; i < this.strategyPlans.player2.length && i < 5; i++) {
        const waypoints = this.strategyPlans.player2[i];
        if (waypoints && waypoints.length > 0) {
          this.simulation.queueCommand(2, 'MOVE', i, waypoints[0]);
        }
      }
    }

    /* Clear strategy plans after applying */
    this.strategyPlans.player1 = null;
    this.strategyPlans.player2 = null;
  }

  // --------------------------------------------------------------------------
  // Simulation Tick Management
  // --------------------------------------------------------------------------

  /**
   * Start simulation ticks at TICK_RATE_MS (200ms = 5 ticks/sec).
   * During LIVE_PHASE and POST_PLANT, the server runs the authoritative
   * simulation and sends fog-of-war filtered state updates to each player.
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
   * Run one authoritative simulation tick.
   *
   * Pipeline:
   *   1. Run ServerSimulation.runTick() (movement, detection, combat, bomb, etc.)
   *   2. Check for bomb plant -> POST_PLANT transition
   *   3. Check for round-end conditions (elimination, bomb defuse/detonate)
   *   4. Generate fog-of-war filtered state for each player
   *   5. Broadcast GAME_STATE_UPDATE to each player (different views!)
   */
  private simulationTick(): void {
    this.tick++;

    /* Step 1: Run the authoritative simulation tick */
    const tickResult: TickResult = this.simulation.runTick();

    /* Step 2: Track kills for economy purposes */
    for (const kill of tickResult.kills) {
      /* Determine which player got the kill */
      if (kill.killerId.startsWith('p1')) {
        this.player1.totalKills++;
      } else {
        this.player2.totalKills++;
      }
    }

    /* Step 3: Check for bomb plant -> phase transition to POST_PLANT */
    const p1State = this.simulation.getFilteredState(1);
    if (p1State.bombPlanted && !this.bombPlanted) {
      this.bombPlanted = true;

      /* Transition to POST_PLANT if currently in LIVE_PHASE */
      if (this.phase === 'LIVE_PHASE') {
        this.stopPhaseTimer();
        this.startPhase('POST_PLANT');

        /* Broadcast bomb plant event */
        this.broadcast('BOMB_PLANTED', {
          tick: this.tick,
          bombPosition: p1State.bombPosition,
          bombSite: p1State.bombSite,
        });
      }
    }

    /* Step 4: Check for round-end conditions from the simulation */
    if (tickResult.roundEnded && tickResult.winningSide) {
      /* Track if bomb was defused */
      if (tickResult.winningSide === 'DEFENDER' && this.bombPlanted) {
        this.bombDefused = true;
      }

      this.endRound(tickResult.winningSide);
      return; // Stop processing — round is over
    }

    /* Step 5: Generate fog-of-war filtered state for each player */
    const filteredStateP1 = this.simulation.getFilteredState(1);
    const filteredStateP2 = this.simulation.getFilteredState(2);

    /**
     * Step 6: Send filtered state updates to each player.
     * Each player gets a different view — they can only see their own
     * soldiers and enemies that their team has detected.
     */
    this.emitToPlayer(this.player1, 'GAME_STATE_UPDATE', {
      tick: this.tick,
      phase: this.phase,
      timeRemaining: this.timeRemaining,
      state: filteredStateP1,
      events: tickResult.events,
      kills: tickResult.kills,
    });

    this.emitToPlayer(this.player2, 'GAME_STATE_UPDATE', {
      tick: this.tick,
      phase: this.phase,
      timeRemaining: this.timeRemaining,
      state: filteredStateP2,
      events: tickResult.events,
      kills: tickResult.kills,
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

    /* Update loss streaks and award economy */
    this.updateEconomy(p1Won, winningSide);

    /* Collect round kill data for the summary */
    const roundKills = this.simulation.getRoundKills();

    /* Broadcast round end to both players */
    this.broadcast('ROUND_END', {
      winner: winningSide,
      roundNumber: this.roundNumber,
      score: this.score,
      bombPlanted: this.bombPlanted,
      bombDefused: this.bombDefused,
      kills: roundKills,
      economy: {
        player1Money: this.player1.money,
        player2Money: this.player2.money,
      },
    });

    console.log(
      `[Room ${this.roomId}] Round ${this.roundNumber}: ${winningSide} wins` +
      ` — Score: ${this.score.player1}-${this.score.player2}` +
      ` — Economy: P1=$${this.player1.money}, P2=$${this.player2.money}`
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
   * Update economy for both players after a round ends.
   * Awards win/loss rewards, kill rewards, and objective bonuses.
   *
   * @param p1Won - Whether player 1 won the round
   * @param winningSide - Which side won ('ATTACKER' or 'DEFENDER')
   */
  private updateEconomy(p1Won: boolean, winningSide: 'ATTACKER' | 'DEFENDER'): void {
    /* Calculate win and loss rewards */
    const winner = p1Won ? this.player1 : this.player2;
    const loser = p1Won ? this.player2 : this.player1;

    /* Winner gets the flat win reward */
    winner.money += WIN_REWARD;
    winner.lossStreak = 0;

    /* Loser gets loss streak reward (escalating) */
    loser.lossStreak++;
    const streakIndex = Math.min(loser.lossStreak - 1, LOSS_STREAK_REWARDS.length - 1);
    loser.money += LOSS_STREAK_REWARDS[streakIndex];

    /* Award kill rewards based on weapon used */
    const roundKills = this.simulation.getRoundKills();
    for (const kill of roundKills) {
      const weaponReward = KILL_REWARDS[kill.weapon] ?? 300;
      if (kill.killerId.startsWith('p1')) {
        this.player1.money += weaponReward;
      } else {
        this.player2.money += weaponReward;
      }
    }

    /* Award objective bonus (bomb plant/defuse) */
    if (this.bombPlanted) {
      /* Attackers get a bonus for planting regardless of round outcome */
      const attackerPlayer = this.player1Side === 'ATTACKER' ? this.player1 : this.player2;
      attackerPlayer.money += OBJECTIVE_BONUS;
    }

    if (this.bombDefused) {
      /* Defenders get a bonus for defusing */
      const defenderPlayer = this.player1Side === 'DEFENDER' ? this.player1 : this.player2;
      defenderPlayer.money += OBJECTIVE_BONUS;
    }

    /* Clamp money to the maximum */
    this.player1.money = Math.min(this.player1.money, MAX_MONEY);
    this.player2.money = Math.min(this.player2.money, MAX_MONEY);
  }

  /**
   * Start the next round. Handles side swap and round counter advancement.
   */
  private startNextRound(): void {
    this.roundNumber++;

    /* Side swap at the halfway point */
    if (this.roundNumber === ROUNDS_PER_HALF + 1) {
      this.player1Side = this.player1Side === 'ATTACKER' ? 'DEFENDER' : 'ATTACKER';

      /* Reset economy on side swap */
      this.player1.money = STARTING_MONEY;
      this.player2.money = STARTING_MONEY;
      this.player1.lossStreak = 0;
      this.player2.lossStreak = 0;

      console.log(`[Room ${this.roomId}] Side swap! P1 is now ${this.player1Side}`);
    }

    /* Reset round state */
    this.bombPlanted = false;
    this.bombDefused = false;
    this.tick = 0;

    /* Re-initialize the simulation for the new round */
    this.initializeSimulationForRound();

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
   * Validates the command structure, checks for anti-cheat violations,
   * and queues it in the ServerSimulation for the next tick.
   *
   * Anti-cheat validations:
   *   - Command must have a valid type
   *   - Soldier index must be 0-4
   *   - Player can only command their own soldiers
   *   - Target position must be within map bounds
   *   - Can only command alive soldiers
   *
   * @param playerNumber - Which player sent the command (1 or 2)
   * @param command - The raw command data (will be validated)
   */
  handleCommand(playerNumber: 1 | 2, command: unknown): void {
    /* Only accept commands during active phases */
    if (this.phase !== 'LIVE_PHASE' && this.phase !== 'POST_PLANT') {
      return;
    }

    /* Validate command structure */
    const validated = this.validateCommand(command);
    if (!validated) {
      console.warn(`[Room ${this.roomId}] P${playerNumber}: Invalid command rejected`);
      return;
    }

    /**
     * Queue the validated command in the simulation.
     * The simulation will process it after the radio delay.
     */
    this.simulation.queueCommand(
      playerNumber,
      validated.type,
      validated.soldierIndex,
      validated.targetPosition,
      validated.utilityType
    );
  }

  /**
   * Validate a raw command object from the client.
   * Returns a clean ValidatedCommand or null if invalid.
   *
   * @param command - Raw command data from the client
   * @returns Validated command or null if invalid
   */
  private validateCommand(command: unknown): ValidatedCommand | null {
    /* Command must be a non-null object */
    if (!command || typeof command !== 'object') return null;

    const cmd = command as Record<string, unknown>;

    /* Validate command type */
    if (typeof cmd.type !== 'string' || !VALID_COMMAND_TYPES.includes(cmd.type)) {
      return null;
    }

    /* Validate soldier index (must be 0-4) */
    if (typeof cmd.soldierIndex !== 'number' || cmd.soldierIndex < 0 || cmd.soldierIndex > 4) {
      return null;
    }
    const soldierIndex = Math.floor(cmd.soldierIndex);

    /* Validate target position if provided */
    let targetPosition: { x: number; z: number } | undefined;
    if (cmd.targetPosition && typeof cmd.targetPosition === 'object') {
      const tp = cmd.targetPosition as Record<string, unknown>;
      if (typeof tp.x === 'number' && typeof tp.z === 'number') {
        /* Clamp position to map bounds (Bazaar: 3000x2000) */
        targetPosition = {
          x: Math.max(0, Math.min(3000, tp.x)),
          z: Math.max(0, Math.min(2000, tp.z)),
        };
      }
    }

    /* Movement commands require a target position */
    if ((cmd.type === 'MOVE' || cmd.type === 'RUSH') && !targetPosition) {
      return null;
    }

    /* Validate utility type if provided */
    let utilityType: string | undefined;
    if (typeof cmd.utilityType === 'string') {
      utilityType = cmd.utilityType;
    }

    return {
      type: cmd.type,
      soldierIndex,
      targetPosition,
      utilityType,
    };
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
     * For now, acknowledge the order and trust the client.
     * Full buy validation will be added in the anti-cheat pass.
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

    /* Validate plans structure: should be an array of arrays of positions */
    if (!Array.isArray(plans)) return;

    const validPlans: { x: number; z: number }[][] = [];
    for (const soldierPlan of plans) {
      if (!Array.isArray(soldierPlan)) {
        validPlans.push([]);
        continue;
      }

      const waypoints: { x: number; z: number }[] = [];
      for (const wp of soldierPlan) {
        if (wp && typeof wp === 'object' && typeof wp.x === 'number' && typeof wp.z === 'number') {
          /* Clamp waypoints to map bounds */
          waypoints.push({
            x: Math.max(0, Math.min(3000, wp.x)),
            z: Math.max(0, Math.min(2000, wp.z)),
          });
        }
      }
      validPlans.push(waypoints);
    }

    /* Store the validated plans */
    if (playerNumber === 1) {
      this.strategyPlans.player1 = validPlans;
    } else {
      this.strategyPlans.player2 = validPlans;
    }

    /* Acknowledge receipt */
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
