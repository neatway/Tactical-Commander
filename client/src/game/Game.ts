/**
 * Game.ts - Main game controller and state machine
 *
 * This is the central orchestrator that ties together rendering, input,
 * simulation, and UI. It runs the game loop, manages phase transitions,
 * and coordinates all subsystems.
 *
 * The game loop runs at 60fps for rendering, but the simulation ticks
 * at 5 ticks/second (200ms intervals) matching the server tick rate.
 */

import * as THREE from 'three';
import { Renderer } from '../rendering/Renderer';
import { MapRenderer } from '../rendering/MapRenderer';
import { SoldierRenderer } from '../rendering/SoldierRenderer';
import { CameraController } from '../rendering/Camera';
import { InputManager, MouseButton } from './InputManager';
import { CommandSystem, CommandType } from './CommandSystem';
import {
  GamePhase,
  Side,
  GameState,
  SoldierRuntimeState,
  Position,
  createInitialGameState,
  createSoldierRuntimeState,
} from './GameState';

// ============================================================
// Constants
// ============================================================

/** How often the game simulation ticks (milliseconds) */
const TICK_RATE_MS = 200;

/** Phase durations in seconds */
const PHASE_DURATIONS: Record<string, number> = {
  [GamePhase.BUY_PHASE]: 20,
  [GamePhase.STRATEGY_PHASE]: 15,
  [GamePhase.LIVE_PHASE]: 105,   // 1:45 for attackers to plant
  [GamePhase.POST_PLANT]: 40,    // Bomb timer
  [GamePhase.ROUND_END]: 5,      // Brief pause before next round
};

// ============================================================
// Game Class
// ============================================================

/**
 * Main game class - creates and manages all subsystems.
 *
 * Lifecycle:
 *   1. constructor() - Initializes all systems
 *   2. startMatch() - Begins a new match
 *   3. gameLoop() runs continuously at 60fps:
 *      - processInput() - Read player input
 *      - update(dt) - Advance simulation
 *      - render() - Draw the frame
 *   4. Phase transitions happen automatically based on timers and events
 */
export class Game {
  // --- Core systems ---
  /** Three.js renderer wrapper */
  private renderer: Renderer;
  /** Renders the map geometry (walls, floors, zones) */
  private mapRenderer: MapRenderer;
  /** Renders soldier capsules, health bars, waypoints */
  private soldierRenderer: SoldierRenderer;
  /** Handles camera pan, zoom, and screen-to-world conversion */
  private cameraController: CameraController;
  /** Tracks keyboard and mouse input */
  private input: InputManager;
  /** Manages command queue with delays and cooldowns */
  private commandSystem: CommandSystem;

  // --- Game state ---
  /** The complete current state of the game */
  private state: GameState;
  /** Which player we are (1 or 2) - determines which soldiers we control */
  private localPlayer: 1 | 2 = 1;
  /** Currently selected soldier index (0-4) or null */
  private selectedSoldier: number | null = null;

  // --- Timing ---
  /** Timestamp of the last frame (for delta time calculation) */
  private lastFrameTime: number = 0;
  /** Accumulated time since last simulation tick */
  private tickAccumulator: number = 0;
  /** Current game time in seconds (within the current round) */
  private gameTime: number = 0;
  /** Whether the game loop is running */
  private running: boolean = false;
  /** The requestAnimationFrame ID (for cancellation) */
  private animationFrameId: number = 0;

  /**
   * Initialize all game systems.
   * @param canvas - The HTML canvas element to render into
   */
  constructor(canvas: HTMLCanvasElement) {
    /* Initialize the Three.js renderer */
    this.renderer = new Renderer(canvas);

    /* Initialize map renderer (will load map data later) */
    this.mapRenderer = new MapRenderer(this.renderer.getScene());

    /* Initialize soldier renderer */
    this.soldierRenderer = new SoldierRenderer(this.renderer.getScene());

    /* Initialize camera controller with default map bounds */
    this.cameraController = new CameraController(
      this.renderer.getCamera(),
      3000, // Map width - will be updated when map loads
      2000  // Map height
    );

    /* Initialize input handling */
    this.input = new InputManager(canvas);

    /* Initialize command system */
    this.commandSystem = new CommandSystem();

    /* Create initial game state with a random seed */
    this.state = createInitialGameState(Date.now());

    console.log('[Game] All systems initialized');
  }

  // ============================================================
  // Match Lifecycle
  // ============================================================

  /**
   * Start a new match. Loads the map, places soldiers, and begins the game loop.
   * For now this sets up a local test match (single player vs basic AI).
   */
  async startMatch(): Promise<void> {
    console.log('[Game] Starting new match...');

    /* Load the map */
    /* TODO: Dynamic map loading - for now we import directly */
    const { BAZAAR_MAP } = await import('../assets/maps/bazaar');
    this.mapRenderer.loadMap(BAZAAR_MAP);

    /* Update camera bounds to match loaded map */
    this.cameraController = new CameraController(
      this.renderer.getCamera(),
      BAZAAR_MAP.dimensions.width,
      BAZAAR_MAP.dimensions.height
    );

    /* Center camera on the map */
    this.cameraController.focusOn(
      BAZAAR_MAP.dimensions.width / 2,
      BAZAAR_MAP.dimensions.height / 2
    );

    /* Create soldiers for both teams at spawn positions */
    this.spawnSoldiers(BAZAAR_MAP);

    /* Reset state for round 1 */
    this.state.phase = GamePhase.BUY_PHASE;
    this.state.timeRemaining = PHASE_DURATIONS[GamePhase.BUY_PHASE];
    this.state.roundNumber = 1;
    this.gameTime = 0;

    /* Start the game loop */
    this.running = true;
    this.lastFrameTime = performance.now();
    this.gameLoop(this.lastFrameTime);

    console.log('[Game] Match started - Round 1, Buy Phase');
  }

  /**
   * Spawn soldiers at their team's spawn zone.
   * Distributes 5 soldiers evenly within the spawn area.
   */
  private spawnSoldiers(mapData: any): void {
    const attackerSpawn = mapData.spawnZones.attacker;
    const defenderSpawn = mapData.spawnZones.defender;

    /* Create player 1 soldiers (attacker first half) */
    this.state.player1Soldiers = [];
    for (let i = 0; i < 5; i++) {
      const pos: Position = {
        x: attackerSpawn.x + attackerSpawn.width * 0.2 + (attackerSpawn.width * 0.6 * (i / 4)),
        z: attackerSpawn.z + attackerSpawn.height / 2,
      };
      const soldierState = createSoldierRuntimeState(i, `p1_soldier_${i}`, pos);
      /* First soldier on attacker team carries the bomb */
      if (i === 0) {
        soldierState.hasBomb = true;
      }
      this.state.player1Soldiers.push(soldierState);

      /* Create visual representation */
      this.soldierRenderer.createSoldier(`p1_${i}`, 'red', pos);
    }

    /* Create player 2 soldiers (defender first half) */
    this.state.player2Soldiers = [];
    for (let i = 0; i < 5; i++) {
      const pos: Position = {
        x: defenderSpawn.x + defenderSpawn.width * 0.2 + (defenderSpawn.width * 0.6 * (i / 4)),
        z: defenderSpawn.z + defenderSpawn.height / 2,
      };
      const soldierState = createSoldierRuntimeState(i, `p2_soldier_${i}`, pos);
      this.state.player2Soldiers.push(soldierState);

      /* Create visual representation */
      this.soldierRenderer.createSoldier(`p2_${i}`, 'blue', pos);
    }

    console.log('[Game] Soldiers spawned: 5 attackers (red), 5 defenders (blue)');
  }

  // ============================================================
  // Game Loop - Runs every frame (~60fps)
  // ============================================================

  /**
   * The main game loop. Called via requestAnimationFrame.
   * Separates rendering (every frame) from simulation (fixed timestep).
   *
   * @param timestamp - High-resolution timestamp from requestAnimationFrame
   */
  private gameLoop(timestamp: number): void {
    if (!this.running) return;

    /* Calculate time since last frame in seconds */
    const deltaTime = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;

    /* Cap delta time to prevent huge jumps (e.g., after tab switch) */
    const cappedDelta = Math.min(deltaTime, 0.1);

    /* Step 1: Process player input */
    this.processInput(cappedDelta);

    /* Step 2: Update simulation (fixed timestep for determinism) */
    this.tickAccumulator += cappedDelta * 1000; // Convert to ms
    while (this.tickAccumulator >= TICK_RATE_MS) {
      this.simulationTick();
      this.tickAccumulator -= TICK_RATE_MS;
    }

    /* Step 3: Update phase timer */
    this.updatePhaseTimer(cappedDelta);

    /* Step 4: Update visuals (interpolated between ticks for smooth rendering) */
    this.updateVisuals();

    /* Step 5: Render the frame */
    this.renderer.render();

    /* Step 6: Clear per-frame input state */
    this.input.endFrame();

    /* Schedule next frame */
    this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
  }

  // ============================================================
  // Input Processing
  // ============================================================

  /**
   * Read player input and translate it into game actions.
   * Handles camera movement, soldier selection, and command issuing.
   */
  private processInput(deltaTime: number): void {
    /* --- Camera controls --- */
    const panState = this.input.getCameraPanState();
    const scrollDelta = this.input.consumeScroll();

    this.cameraController.update(deltaTime, {
      panLeft: panState.left,
      panRight: panState.right,
      panUp: panState.up,
      panDown: panState.down,
      zoomIn: scrollDelta > 0,
      zoomOut: scrollDelta < 0,
    });

    /* --- Process clicks --- */
    const clicks = this.input.consumeClicks();
    for (const click of clicks) {
      if (click.button === MouseButton.LEFT) {
        this.handleLeftClick(click.screenX, click.screenY, click.shiftKey);
      } else if (click.button === MouseButton.RIGHT) {
        this.handleRightClick(click.screenX, click.screenY);
      }
    }

    /* --- Keyboard shortcuts --- */
    if (this.input.wasKeyPressed('KeyH') && this.selectedSoldier !== null) {
      /* Hold position command */
      this.issueCommand(CommandType.HOLD, this.selectedSoldier);
    }
    if (this.input.wasKeyPressed('KeyR') && this.selectedSoldier !== null) {
      /* Retreat command */
      this.issueCommand(CommandType.RETREAT, this.selectedSoldier);
    }
    if (this.input.wasKeyPressed('KeyB')) {
      /* Toggle buy menu (only during buy phase) */
      // TODO: Toggle buy menu UI
      console.log('[Input] Buy menu toggle (TODO)');
    }
    if (this.input.wasKeyPressed('Tab')) {
      /* Toggle scoreboard */
      // TODO: Toggle scoreboard UI
      console.log('[Input] Scoreboard toggle (TODO)');
    }
  }

  /**
   * Handle left click - select soldiers or issue move commands.
   *
   * Logic:
   * - If clicked on a friendly soldier: select that soldier
   * - If a soldier is selected and clicked on map: issue move command
   * - If shift+clicked on a soldier: add to selection (future multi-select)
   */
  private handleLeftClick(screenX: number, screenY: number, shiftKey: boolean): void {
    /* Convert screen position to world coordinates */
    const worldPos = this.renderer.getWorldPosition(screenX, screenY);
    if (!worldPos) return;

    /* Check if we clicked on one of our soldiers */
    const mySoldiers = this.localPlayer === 1
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;

    const clickedSoldierIndex = this.findSoldierAtPosition(
      mySoldiers,
      { x: worldPos.x, z: worldPos.z },
      30 // Click radius in world units
    );

    if (clickedSoldierIndex !== null) {
      /* Clicked on a soldier - select it */
      this.selectedSoldier = clickedSoldierIndex;
      const prefix = this.localPlayer === 1 ? 'p1' : 'p2';
      this.soldierRenderer.setSelected(`${prefix}_${clickedSoldierIndex}`);
      console.log(`[Input] Selected soldier ${clickedSoldierIndex}`);
    } else if (this.selectedSoldier !== null) {
      /* Clicked on empty map - issue move command to selected soldier */
      if (this.state.phase === GamePhase.LIVE_PHASE || this.state.phase === GamePhase.POST_PLANT) {
        this.issueCommand(CommandType.MOVE, this.selectedSoldier, {
          x: worldPos.x,
          z: worldPos.z,
        });
      } else if (this.state.phase === GamePhase.STRATEGY_PHASE) {
        /* During strategy phase, add waypoint */
        const soldier = mySoldiers[this.selectedSoldier];
        if (soldier) {
          soldier.waypoints.push({ x: worldPos.x, z: worldPos.z });
          const prefix = this.localPlayer === 1 ? 'p1' : 'p2';
          this.soldierRenderer.showWaypoints(
            `${prefix}_${this.selectedSoldier}`,
            soldier.waypoints,
            this.localPlayer === 1 ? '#ff6666' : '#6666ff'
          );
          console.log(`[Input] Added waypoint for soldier ${this.selectedSoldier}`);
        }
      }
    }
  }

  /**
   * Handle right click - issue rush command to selected soldier.
   * Rush = move fast but with accuracy penalty.
   */
  private handleRightClick(screenX: number, screenY: number): void {
    if (this.selectedSoldier === null) return;
    if (this.state.phase !== GamePhase.LIVE_PHASE && this.state.phase !== GamePhase.POST_PLANT) return;

    const worldPos = this.renderer.getWorldPosition(screenX, screenY);
    if (!worldPos) return;

    this.issueCommand(CommandType.RUSH, this.selectedSoldier, {
      x: worldPos.x,
      z: worldPos.z,
    });
  }

  /**
   * Issue a command through the command system.
   * Handles the delay and cooldown logic.
   */
  private issueCommand(type: CommandType, soldierIndex: number, targetPos?: Position): void {
    const mySoldiers = this.localPlayer === 1
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;

    const soldier = mySoldiers[soldierIndex];
    if (!soldier || !soldier.alive) return;

    const accepted = this.commandSystem.issueCommand(
      type,
      soldierIndex,
      this.gameTime,
      soldier.isInCombat,
      { targetPosition: targetPos }
    );

    if (accepted) {
      console.log(`[Command] ${type} issued to soldier ${soldierIndex}${targetPos ? ` -> (${Math.round(targetPos.x)}, ${Math.round(targetPos.z)})` : ''}`);
    } else {
      console.log(`[Command] Rejected - soldier ${soldierIndex} on cooldown`);
    }
  }

  // ============================================================
  // Simulation - Fixed timestep updates
  // ============================================================

  /**
   * Run one simulation tick (every 200ms).
   * This is where game logic happens: movement, detection, combat.
   */
  private simulationTick(): void {
    this.state.tick++;
    this.gameTime += TICK_RATE_MS / 1000;

    /* Only simulate during active phases */
    if (this.state.phase !== GamePhase.LIVE_PHASE && this.state.phase !== GamePhase.POST_PLANT) {
      return;
    }

    /* Process ready commands from the command queue */
    const readyCommands = this.commandSystem.getReadyCommands(this.gameTime);
    for (const cmd of readyCommands) {
      this.executeCommand(cmd);
    }

    /* Update soldier movement */
    this.updateMovement();

    /* TODO: Run detection system */
    /* TODO: Run combat resolution */
    /* TODO: Check bomb plant/defuse progress */
    /* TODO: Check round end conditions */
  }

  /**
   * Execute a command that has finished its delay period.
   * Translates the command into actual soldier state changes.
   */
  private executeCommand(cmd: any): void {
    const mySoldiers = this.localPlayer === 1
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;

    const soldier = mySoldiers[cmd.soldierIndex];
    if (!soldier || !soldier.alive) return;

    switch (cmd.type) {
      case CommandType.MOVE:
      case CommandType.RUSH:
        if (cmd.targetPosition) {
          /* Set the soldier's waypoint to the target position */
          soldier.waypoints = [cmd.targetPosition];
        }
        break;

      case CommandType.HOLD:
        /* Stop moving and hold current position */
        soldier.waypoints = [];
        soldier.isMoving = false;
        break;

      case CommandType.RETREAT:
        /* Move back toward spawn - simplified for now */
        /* TODO: Calculate path back to spawn zone */
        soldier.waypoints = [];
        soldier.isMoving = false;
        break;

      default:
        console.log(`[Command] Unhandled command type: ${cmd.type}`);
    }
  }

  /**
   * Update soldier positions based on their waypoints.
   * Simple linear movement toward the next waypoint.
   */
  private updateMovement(): void {
    const allSoldiers = [
      ...this.state.player1Soldiers,
      ...this.state.player2Soldiers,
    ];

    const dt = TICK_RATE_MS / 1000; // Time per tick in seconds

    for (const soldier of allSoldiers) {
      if (!soldier.alive || soldier.waypoints.length === 0) {
        soldier.isMoving = false;
        continue;
      }

      /* Get the next waypoint */
      const target = soldier.waypoints[0];
      const dx = target.x - soldier.position.x;
      const dz = target.z - soldier.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      /* Base movement speed (will use StatFormulas once available) */
      const speed = 200; // pixels per second (placeholder - SPD=50 default)

      if (dist < 5) {
        /* Close enough to waypoint - advance to next */
        soldier.position.x = target.x;
        soldier.position.z = target.z;
        soldier.waypoints.shift();
        soldier.isMoving = soldier.waypoints.length > 0;
      } else {
        /* Move toward waypoint */
        const moveAmount = speed * dt;
        const ratio = Math.min(moveAmount / dist, 1);
        soldier.position.x += dx * ratio;
        soldier.position.z += dz * ratio;
        soldier.rotation = Math.atan2(dz, dx);
        soldier.isMoving = true;
      }
    }
  }

  // ============================================================
  // Phase Management
  // ============================================================

  /**
   * Update the phase timer and handle transitions.
   * Called every frame with the real delta time.
   */
  private updatePhaseTimer(deltaTime: number): void {
    /* Don't tick timer during match end or lobby */
    if (this.state.phase === GamePhase.MATCH_END || this.state.phase === GamePhase.LOBBY) {
      return;
    }

    /* Count down the timer */
    this.state.timeRemaining -= deltaTime;

    /* Check if the current phase has expired */
    if (this.state.timeRemaining <= 0) {
      this.advancePhase();
    }
  }

  /**
   * Transition to the next game phase.
   * Handles the state machine logic for phase progression.
   */
  private advancePhase(): void {
    switch (this.state.phase) {
      case GamePhase.BUY_PHASE:
        /* Buy phase -> Strategy phase */
        this.state.phase = GamePhase.STRATEGY_PHASE;
        this.state.timeRemaining = PHASE_DURATIONS[GamePhase.STRATEGY_PHASE];
        console.log(`[Phase] Strategy Phase - Plan your tactics (${this.state.timeRemaining}s)`);
        break;

      case GamePhase.STRATEGY_PHASE:
        /* Strategy phase -> Live phase (round begins!) */
        this.state.phase = GamePhase.LIVE_PHASE;
        this.state.timeRemaining = PHASE_DURATIONS[GamePhase.LIVE_PHASE];
        this.state.tick = 0;
        this.gameTime = 0;
        console.log(`[Phase] LIVE - Round ${this.state.roundNumber} started!`);
        break;

      case GamePhase.LIVE_PHASE:
        /* Live phase timer expired without bomb plant = defenders win */
        this.endRound(Side.DEFENDER);
        break;

      case GamePhase.POST_PLANT:
        /* Bomb timer expired = bomb detonates, attackers win */
        this.endRound(Side.ATTACKER);
        console.log('[Phase] BOMB DETONATED! Attackers win the round');
        break;

      case GamePhase.ROUND_END:
        /* Start next round or end match */
        this.startNextRound();
        break;
    }
  }

  /**
   * End the current round with a winner.
   * Awards money, updates score, transitions to ROUND_END phase.
   */
  private endRound(winner: Side): void {
    /* Determine which player won based on current sides */
    const player1Won =
      (this.state.player1Side === winner);

    /* Update score */
    if (player1Won) {
      this.state.score.player1++;
    } else {
      this.state.score.player2++;
    }

    /* Award round money */
    /* TODO: Full economy calculation using EconomyConstants */
    const winnerEcon = player1Won ? this.state.player1Economy : this.state.player2Economy;
    const loserEcon = player1Won ? this.state.player2Economy : this.state.player1Economy;
    winnerEcon.money = Math.min(16000, winnerEcon.money + 3250);
    winnerEcon.lossStreak = 0;
    loserEcon.lossStreak++;
    const lossRewards = [1400, 1900, 2400, 2900];
    const lossReward = lossRewards[Math.min(loserEcon.lossStreak - 1, 3)];
    loserEcon.money = Math.min(16000, loserEcon.money + lossReward);

    /* Transition to round end phase */
    this.state.phase = GamePhase.ROUND_END;
    this.state.timeRemaining = PHASE_DURATIONS[GamePhase.ROUND_END];

    console.log(`[Round] Round ${this.state.roundNumber} won by ${winner}. Score: ${this.state.score.player1}-${this.state.score.player2}`);

    /* Check for match end */
    if (this.state.score.player1 >= 5 || this.state.score.player2 >= 5) {
      this.state.phase = GamePhase.MATCH_END;
      const matchWinner = this.state.score.player1 >= 5 ? 'Player 1' : 'Player 2';
      console.log(`[Match] MATCH OVER! ${matchWinner} wins ${this.state.score.player1}-${this.state.score.player2}`);
    }
  }

  /**
   * Start the next round. Reset soldiers, advance round counter,
   * handle side swap at the halfway point.
   */
  private startNextRound(): void {
    this.state.roundNumber++;

    /* Side swap at round 5 (after 4 rounds per side) */
    if (this.state.roundNumber === 5) {
      this.state.player1Side =
        this.state.player1Side === Side.ATTACKER ? Side.DEFENDER : Side.ATTACKER;
      console.log(`[Match] Side swap! Player 1 is now ${this.state.player1Side}`);
    }

    /* Round 9 tiebreaker */
    if (this.state.roundNumber === 9 && this.state.score.player1 === 4 && this.state.score.player2 === 4) {
      /* Both teams get $10,000 for the final round */
      this.state.player1Economy.money = 10000;
      this.state.player2Economy.money = 10000;
      console.log('[Match] TIEBREAKER ROUND! Both teams receive $10,000');
    }

    /* Reset round state */
    this.state.bombPlanted = false;
    this.state.bombPosition = null;
    this.state.bombSite = null;
    this.state.bombTimer = 0;
    this.commandSystem.clearAll();

    /* Reset soldiers to spawn positions */
    /* TODO: Proper spawn position calculation from map data */
    for (const soldier of [...this.state.player1Soldiers, ...this.state.player2Soldiers]) {
      soldier.health = 100;
      soldier.alive = true;
      soldier.isMoving = false;
      soldier.isInCombat = false;
      soldier.currentTarget = null;
      soldier.waypoints = [];
      soldier.isPlanting = false;
      soldier.isDefusing = false;
      soldier.actionProgress = 0;
    }

    /* Start buy phase */
    this.state.phase = GamePhase.BUY_PHASE;
    this.state.timeRemaining = PHASE_DURATIONS[GamePhase.BUY_PHASE];
    this.state.tick = 0;
    this.gameTime = 0;

    console.log(`[Phase] Round ${this.state.roundNumber} - Buy Phase`);
  }

  // ============================================================
  // Visual Updates - Called every frame
  // ============================================================

  /**
   * Update all visual representations to match the current game state.
   * This runs every frame for smooth rendering.
   */
  private updateVisuals(): void {
    /* Update all soldier positions and visual state */
    const updateTeam = (soldiers: SoldierRuntimeState[], prefix: string) => {
      for (const soldier of soldiers) {
        this.soldierRenderer.updateSoldier(
          `${prefix}_${soldier.index}`,
          soldier.position,
          soldier.rotation,
          soldier.health,
          soldier.alive
        );
      }
    };

    updateTeam(this.state.player1Soldiers, 'p1');
    updateTeam(this.state.player2Soldiers, 'p2');
  }

  // ============================================================
  // Utility Helpers
  // ============================================================

  /**
   * Find if a soldier is near a clicked world position.
   * Used for click-to-select.
   *
   * @param soldiers - Array of soldiers to check
   * @param clickPos - World position that was clicked
   * @param radius - How close the click needs to be (in world units)
   * @returns Index of the closest soldier within radius, or null
   */
  private findSoldierAtPosition(
    soldiers: SoldierRuntimeState[],
    clickPos: Position,
    radius: number
  ): number | null {
    let closestIndex: number | null = null;
    let closestDist = radius;

    for (const soldier of soldiers) {
      if (!soldier.alive) continue;
      const dx = soldier.position.x - clickPos.x;
      const dz = soldier.position.z - clickPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < closestDist) {
        closestDist = dist;
        closestIndex = soldier.index;
      }
    }

    return closestIndex;
  }

  /**
   * Get the current game state (for UI rendering, debugging, etc.)
   */
  getState(): GameState {
    return this.state;
  }

  /**
   * Stop the game loop and clean up resources.
   */
  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrameId);
    this.input.destroy();
    console.log('[Game] Destroyed');
  }
}
