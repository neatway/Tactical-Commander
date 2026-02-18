/**
 * Game.ts - Main game controller and state machine
 *
 * This is the central orchestrator that ties together rendering, input,
 * simulation, and UI. It runs the game loop, manages phase transitions,
 * and coordinates all subsystems.
 *
 * The game loop runs at 60fps for rendering, but the simulation ticks
 * at 5 ticks/second (200ms intervals) matching the server tick rate.
 *
 * Simulation tick order (each 200ms):
 *   1. Process ready commands
 *   2. Run bot AI decision-making (player 2)
 *   3. Update movement (A* pathfinding + stat-driven speed)
 *   4. Run detection (vision cone + LOS + probabilistic detection)
 *   5. Run combat resolution (stat-driven firefights)
 *   6. Check round end conditions (elimination, timer)
 */

import * as THREE from 'three';
import { Renderer } from '../rendering/Renderer';
import { MapRenderer } from '../rendering/MapRenderer';
import { SoldierRenderer } from '../rendering/SoldierRenderer';
import { CameraController } from '../rendering/Camera';
import { FogOfWar } from '../rendering/FogOfWar';
import { InputManager, MouseButton } from './InputManager';
import { CommandSystem, CommandType } from './CommandSystem';
import { MovementSystem } from '../simulation/Movement';
import { DetectionSystem } from '../simulation/Detection';
import { UtilitySystem } from '../simulation/Utility';
import { BombLogic } from '../simulation/BombLogic';
import { EconomyManager } from '../simulation/EconomyManager';
import type { EconomyUpdate } from '../simulation/EconomyManager';
import { HUD } from '../ui/HUD';
import { BuyMenu } from '../ui/BuyMenu';
import { RoundSummary } from '../ui/RoundSummary';
import { BotAI } from './BotAI';
import {
  GamePhase,
  Side,
  WeaponId,
  GameState,
  SoldierRuntimeState,
  Position,
  KillRecord,
  createInitialGameState,
  createSoldierRuntimeState,
} from './GameState';

/* Shared stat formulas for simulation calculations */
import {
  calculateMovementSpeed,
  calculateDetectionRadius,
  calculateStealthModifier,
  calculateBaseHitChance,
  calculateFinalHitChance,
  calculateHeadshotChance,
  calculateDamage,
  calculateSprayAccuracy,
  calculateComposureModifier,
  calculateClutchModifier,
  calculateTeamworkModifier,
  calculateReactionTime,
} from '@shared/constants/StatFormulas';

/* Weapon stat lookup table and utility type enum */
import { WEAPONS } from '@shared/constants/WeaponData';
import { UtilityType } from '@shared/types/WeaponTypes';

/* Seeded PRNG for deterministic combat */
import { SeededRandom } from '@shared/util/RandomUtils';

/* Math utilities */
import { distance as vecDistance } from '@shared/util/MathUtils';

import type { Wall } from '@shared/types/MapTypes';

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

/**
 * Distance threshold in pixels for the teamwork bonus.
 * If an allied soldier is within this range, the TWK stat bonus activates.
 */
const TEAMWORK_RANGE = 300;

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
  /** A* pathfinding system - created when the map loads */
  private movementSystem: MovementSystem | null = null;
  /** Line-of-sight and enemy detection system - created when the map loads */
  private detectionSystem: DetectionSystem | null = null;
  /** In-game HUD overlay showing score, timer, money, etc. */
  private hud: HUD;
  /** Buy menu UI overlay for purchasing equipment */
  private buyMenu: BuyMenu;
  /** Round summary screen shown during ROUND_END phase */
  private roundSummary: RoundSummary;
  /** Utility system managing active smokes, flashes, frags, molotovs, decoys */
  private utilitySystem: UtilitySystem;
  /** Economy manager — calculates kill rewards, round rewards, bomb bonuses */
  private economyManager: EconomyManager;
  /** Bomb plant/defuse logic — zone checks, progress tracking */
  private bombLogic: BombLogic | null = null;
  /** Fog of war overlay — texture-based visibility masking */
  private fogOfWar: FogOfWar | null = null;
  /** AI opponent controlling player 2's soldiers */
  private botAI: BotAI | null = null;

  // --- Game state ---
  /** The complete current state of the game */
  private state: GameState;
  /** Which player we are (1 or 2) - determines which soldiers we control */
  private localPlayer: 1 | 2 = 1;
  /** Currently selected soldier index (0-4) or null */
  private selectedSoldier: number | null = null;
  /** Seeded random number generator for deterministic simulation */
  private rng!: SeededRandom;
  /** Map wall data (cached for LOS checks) */
  private walls: Wall[] = [];
  /** Cached map data (for respawning soldiers between rounds) */
  private mapData: { spawnZones: { attacker: { x: number; z: number; width: number; height: number }; defender: { x: number; z: number; width: number; height: number } } } | null = null;

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
   * When the player presses 1-5 to select a utility slot, this stores
   * the utility type waiting to be thrown. The next left-click on the
   * map will throw this utility at that position, then clear the slot.
   */
  private pendingUtilityType: UtilityType | null = null;
  /**
   * Whether the player is currently holding the plant key (P).
   * Tracked each frame; the simulation tick reads this to progress planting.
   */
  private isRequestingPlant: boolean = false;
  /**
   * Whether the player is currently holding the defuse key (E).
   * Tracked each frame; the simulation tick reads this to progress defusing.
   */
  private isRequestingDefuse: boolean = false;
  /**
   * Stores the economy changes from the last completed round.
   * Used by the round summary screen to display kill rewards, bonuses, etc.
   * Reset at the start of each new round.
   */
  private lastRoundEconomyUpdate: EconomyUpdate | null = null;

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

    /* Initialize the HUD overlay */
    this.hud = new HUD('hud');

    /* Initialize the buy menu (hidden by default, shown during BUY_PHASE) */
    this.buyMenu = new BuyMenu('buy-menu');

    /* Initialize the round summary screen (hidden by default, shown during ROUND_END) */
    this.roundSummary = new RoundSummary('round-summary');

    /* Initialize the utility system (manages active smokes, flashes, etc.) */
    this.utilitySystem = new UtilitySystem();

    /* Initialize the economy manager for round reward calculations */
    this.economyManager = new EconomyManager();

    /* Create initial game state with a random seed */
    this.state = createInitialGameState(Date.now());

    /* Initialize the seeded RNG from the match seed */
    this.rng = new SeededRandom(this.state.matchSeed);

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

    /* Cache the wall data for LOS checks */
    this.walls = BAZAAR_MAP.walls;

    /* Cache the full map data for respawning soldiers between rounds */
    this.mapData = BAZAAR_MAP;

    /* Initialize pathfinding on the loaded map */
    this.movementSystem = new MovementSystem(BAZAAR_MAP);
    console.log('[Game] Pathfinding grid generated for Bazaar');

    /* Initialize the detection system with the map walls */
    this.detectionSystem = new DetectionSystem(BAZAAR_MAP.walls);
    console.log('[Game] Detection system initialized');

    /* Initialize bomb plant/defuse logic with the map's bomb sites */
    this.bombLogic = new BombLogic(BAZAAR_MAP.bombSites);
    console.log('[Game] Bomb logic initialized with', BAZAAR_MAP.bombSites.length, 'bomb sites');

    /* Initialize fog of war overlay on the map */
    this.fogOfWar = new FogOfWar(
      this.renderer.getScene(),
      BAZAAR_MAP.dimensions.width,
      BAZAAR_MAP.dimensions.height
    );
    console.log('[Game] Fog of war initialized');

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

    /* Initialize the AI opponent for player 2 */
    this.botAI = new BotAI(this.movementSystem);
    /** Bot plays the opposite side to player 1 */
    const botSide = this.state.player1Side === Side.ATTACKER
      ? Side.DEFENDER
      : Side.ATTACKER;
    this.botAI.initializeRound(botSide);
    console.log(`[Game] Bot AI initialized as ${botSide}`);

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
   * Attacker soldiers face right (toward defender side),
   * defender soldiers face left (toward attacker side).
   */
  private spawnSoldiers(mapData: { spawnZones: { attacker: { x: number; z: number; width: number; height: number }; defender: { x: number; z: number; width: number; height: number } } }): void {
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
      /* Attackers face right (toward defenders) */
      soldierState.rotation = 0;
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
      /* Defenders face left (toward attackers) */
      soldierState.rotation = Math.PI;
      this.state.player2Soldiers.push(soldierState);

      /* Create visual representation */
      this.soldierRenderer.createSoldier(`p2_${i}`, 'blue', pos);
    }

    console.log('[Game] Soldiers spawned: 5 attackers (red), 5 defenders (blue)');
  }

  /**
   * Respawn all soldiers at their team's spawn positions for a new round.
   *
   * Between rounds, soldiers need to be moved back to spawn zones.
   * Player 1's side determines which spawn zone each team uses:
   *   - If P1 is attacker: P1 soldiers → attacker spawn, P2 → defender spawn
   *   - If P1 is defender: P1 soldiers → defender spawn, P2 → attacker spawn
   *
   * This is called at the start of each new round by startNextRound().
   */
  private respawnSoldiersAtSpawn(): void {
    if (!this.mapData) return;

    const attackerSpawn = this.mapData.spawnZones.attacker;
    const defenderSpawn = this.mapData.spawnZones.defender;

    /** Determine which spawn zone each player gets based on current sides */
    const p1IsAttacker = this.state.player1Side === Side.ATTACKER;
    const p1Spawn = p1IsAttacker ? attackerSpawn : defenderSpawn;
    const p2Spawn = p1IsAttacker ? defenderSpawn : attackerSpawn;

    /* Respawn player 1's soldiers */
    for (let i = 0; i < this.state.player1Soldiers.length; i++) {
      const soldier = this.state.player1Soldiers[i];
      soldier.position.x = p1Spawn.x + p1Spawn.width * 0.2 + (p1Spawn.width * 0.6 * (i / 4));
      soldier.position.z = p1Spawn.z + p1Spawn.height / 2;
      /* Attackers face right (0 rad), defenders face left (PI rad) */
      soldier.rotation = p1IsAttacker ? 0 : Math.PI;
    }

    /* Respawn player 2's soldiers */
    for (let i = 0; i < this.state.player2Soldiers.length; i++) {
      const soldier = this.state.player2Soldiers[i];
      soldier.position.x = p2Spawn.x + p2Spawn.width * 0.2 + (p2Spawn.width * 0.6 * (i / 4));
      soldier.position.z = p2Spawn.z + p2Spawn.height / 2;
      /* Player 2 is the opposite side of player 1 */
      soldier.rotation = p1IsAttacker ? Math.PI : 0;
    }
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

    /* --- Bomb plant/defuse (hold keys P and E) --- */
    /**
     * Track whether the plant and defuse keys are being held this frame.
     * The simulation tick will read these flags and accumulate progress.
     * Releasing the key resets progress (must hold continuously).
     */
    this.isRequestingPlant = this.input.isKeyDown('KeyP');
    this.isRequestingDefuse = this.input.isKeyDown('KeyE');

    if (this.input.wasKeyPressed('KeyB')) {
      /* Toggle buy menu — only during buy phase */
      if (this.state.phase === GamePhase.BUY_PHASE) {
        this.buyMenu.toggle();
        if (this.buyMenu.isVisible()) {
          /* Update the menu with current soldier/economy when opening */
          const mySoldiers = this.localPlayer === 1
            ? this.state.player1Soldiers
            : this.state.player2Soldiers;
          const myEconomy = this.localPlayer === 1
            ? this.state.player1Economy
            : this.state.player2Economy;
          const selectedSoldier = this.selectedSoldier !== null
            ? mySoldiers[this.selectedSoldier]
            : null;
          this.buyMenu.update(selectedSoldier, myEconomy, this.state.player1Side);
        }
      } else if (this.buyMenu.isVisible()) {
        /* Close buy menu if it's open outside buy phase */
        this.buyMenu.hide();
      }
    }
    if (this.input.wasKeyPressed('Tab')) {
      /* Toggle scoreboard */
      // TODO: Toggle scoreboard UI
      console.log('[Input] Scoreboard toggle (TODO)');
    }

    /* --- Utility slot selection (keys 1-4) --- */
    /* Press a number key to select a utility slot, then click to throw */
    if (this.selectedSoldier !== null && (
      this.state.phase === GamePhase.LIVE_PHASE ||
      this.state.phase === GamePhase.POST_PLANT
    )) {
      const mySoldiers = this.localPlayer === 1
        ? this.state.player1Soldiers
        : this.state.player2Soldiers;
      const soldier = mySoldiers[this.selectedSoldier];

      if (soldier && soldier.alive) {
        /* Keys 1-4 map to utility inventory slots 0-3 */
        const utilityKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
        for (let i = 0; i < utilityKeys.length; i++) {
          if (this.input.wasKeyPressed(utilityKeys[i])) {
            if (i < soldier.utility.length) {
              this.pendingUtilityType = soldier.utility[i] as UtilityType;
              console.log(`[Input] Utility slot ${i + 1} selected: ${this.pendingUtilityType}`);
            } else {
              console.log(`[Input] Utility slot ${i + 1} is empty`);
              this.pendingUtilityType = null;
            }
          }
        }

        /* Escape cancels pending utility throw */
        if (this.input.wasKeyPressed('Escape')) {
          if (this.pendingUtilityType) {
            console.log('[Input] Utility throw cancelled');
            this.pendingUtilityType = null;
          }
        }
      }
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
      /* Clicked on a soldier - select it, and cancel any pending utility throw */
      this.selectedSoldier = clickedSoldierIndex;
      this.pendingUtilityType = null;
      const prefix = this.localPlayer === 1 ? 'p1' : 'p2';
      this.soldierRenderer.setSelected(`${prefix}_${clickedSoldierIndex}`);
      console.log(`[Input] Selected soldier ${clickedSoldierIndex}`);
    } else if (this.selectedSoldier !== null && this.pendingUtilityType !== null) {
      /* Utility throw mode: click on map to throw the selected utility */
      if (this.state.phase === GamePhase.LIVE_PHASE || this.state.phase === GamePhase.POST_PLANT) {
        const soldier = mySoldiers[this.selectedSoldier];
        if (soldier && soldier.alive) {
          this.throwUtility(
            this.selectedSoldier,
            this.pendingUtilityType,
            { x: worldPos.x, z: worldPos.z }
          );
        }
        /* Clear pending utility after throwing */
        this.pendingUtilityType = null;
      }
    } else if (this.selectedSoldier !== null) {
      /* Clicked on empty map - issue move command to selected soldier */
      if (this.state.phase === GamePhase.LIVE_PHASE || this.state.phase === GamePhase.POST_PLANT) {
        this.issueCommand(CommandType.MOVE, this.selectedSoldier, {
          x: worldPos.x,
          z: worldPos.z,
        });
      } else if (this.state.phase === GamePhase.STRATEGY_PHASE) {
        /* During strategy phase, add waypoint (direct placement, no A*) */
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
  // Utility Throwing
  // ============================================================

  /**
   * Throw a utility item from a soldier's inventory to a target position.
   *
   * Removes the utility from the soldier's inventory and creates an active
   * effect at the target position via the UtilitySystem.
   *
   * @param soldierIndex - Index of the soldier throwing the utility (0-4)
   * @param utilityType - Which utility type to throw
   * @param targetPos - World position to throw the utility at
   */
  private throwUtility(
    soldierIndex: number,
    utilityType: UtilityType,
    targetPos: Position
  ): void {
    const mySoldiers = this.localPlayer === 1
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;

    const soldier = mySoldiers[soldierIndex];
    if (!soldier || !soldier.alive) return;

    /* Find the utility in the soldier's inventory */
    const utilIndex = soldier.utility.indexOf(utilityType);
    if (utilIndex === -1) {
      console.log(`[Utility] Soldier ${soldierIndex} doesn't have ${utilityType}`);
      return;
    }

    /* Remove the utility from inventory (consume it) */
    soldier.utility.splice(utilIndex, 1);

    /* Determine which team this soldier is on */
    const ownerTeam: 1 | 2 = this.localPlayer;

    /* Create the active effect in the world */
    this.utilitySystem.throwUtility(
      utilityType,
      targetPos,
      soldier.soldierId,
      ownerTeam
    );

    console.log(
      `[Utility] Soldier ${soldierIndex} threw ${utilityType}` +
      ` at (${Math.round(targetPos.x)}, ${Math.round(targetPos.z)})`
    );
  }

  // ============================================================
  // Simulation - Fixed timestep updates
  // ============================================================

  /**
   * Run one simulation tick (every 200ms).
   * This is where game logic happens: movement, detection, combat.
   *
   * Tick order:
   *   1. Process ready commands from the command queue
   *   2. Run bot AI decision-making (sets waypoints for P2 soldiers)
   *   3. Update movement (A* + SPD stat)
   *   4. Run detection (vision cone + LOS + AWR/STL stats)
   *   5. Run combat resolution (ACC, REA, CMP, CLT, TWK stats)
   *   6. Check round end conditions (all dead, timer expired)
   */
  private simulationTick(): void {
    this.state.tick++;
    this.gameTime += TICK_RATE_MS / 1000;

    /* Only simulate during active phases */
    if (this.state.phase !== GamePhase.LIVE_PHASE && this.state.phase !== GamePhase.POST_PLANT) {
      return;
    }

    /* Step 1: Process ready commands from the command queue */
    const readyCommands = this.commandSystem.getReadyCommands(this.gameTime);
    for (const cmd of readyCommands) {
      this.executeCommand(cmd);
    }

    /* Step 2: Run AI decision-making for player 2's soldiers */
    this.updateBotAI();

    /* Step 3: Update soldier movement (stat-driven speed) */
    this.updateMovement();

    /* Step 4: Run detection system (vision cone + LOS + probabilistic roll) */
    this.updateDetection();

    /* Step 5: Run combat resolution for soldiers that detect each other */
    this.updateCombat();

    /* Step 6: Tick utility effects (smoke, molotov DPS, flash timers) */
    this.updateUtility();

    /* Step 7: Update bomb plant/defuse progress */
    this.updateBombActions();

    /* Step 8: Update fog of war based on friendly soldier positions */
    this.updateFogOfWar();

    /* Step 9: Check round end conditions */
    this.checkRoundEndConditions();
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
        if (cmd.targetPosition && this.movementSystem) {
          /* Use A* pathfinding to find a wall-avoiding path */
          const rawPath = this.movementSystem.findPath(
            soldier.position,
            cmd.targetPosition
          );
          if (rawPath.length > 0) {
            /* Smooth the path to remove unnecessary zigzag */
            const smoothed = this.movementSystem.smoothPath(rawPath);
            /* Convert Vec2 (readonly) to mutable Position objects for waypoints */
            soldier.waypoints = smoothed.map(p => ({ x: p.x, z: p.z }));
          } else {
            /* No path found — fall back to direct movement */
            soldier.waypoints = [{ ...cmd.targetPosition }];
          }
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

  // ============================================================
  // Bot AI (Sim Step 2)
  // ============================================================

  /**
   * Run the bot AI's decision-making for player 2's soldiers.
   * The AI sets waypoints directly on the soldiers (no command delay).
   * Called once per simulation tick during LIVE_PHASE and POST_PLANT.
   */
  private updateBotAI(): void {
    if (!this.botAI) return;

    /**
     * Determine which soldiers belong to the bot and which are enemies.
     * The bot always controls player 2.
     */
    const botSoldiers = this.state.player2Soldiers;
    const enemySoldiers = this.state.player1Soldiers;

    this.botAI.update(
      this.state,
      botSoldiers,
      enemySoldiers,
      this.state.tick
    );
  }

  // ============================================================
  // Movement System (Sim Step 3)
  // ============================================================

  /**
   * Update soldier positions based on their waypoints and SPD stat.
   *
   * Uses calculateMovementSpeed() from StatFormulas with the soldier's
   * SPD stat, current weapon speed modifier, and armor penalty.
   * Soldiers in combat move at 50% speed (suppression effect).
   */
  private updateMovement(): void {
    const allSoldiers = [
      ...this.state.player1Soldiers,
      ...this.state.player2Soldiers,
    ];

    /** Time per tick in seconds (0.2s at 5 ticks/sec) */
    const dt = TICK_RATE_MS / 1000;

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

      /* --- Calculate stat-driven movement speed --- */

      /** Look up the current weapon's speed modifier from WeaponData */
      const weaponStats = WEAPONS[soldier.currentWeapon];
      const weaponSpeedMod = weaponStats ? weaponStats.speedModifier : 0.95;

      /**
       * Armor speed penalty: heavy armor slows you down.
       * TODO: Look up actual armor stats from WeaponData.ARMOR
       * For now: no armor = 1.0, any armor = 0.95 (light) or 0.92 (heavy)
       */
      const armorPenalty = soldier.armor ? 0.95 : 1.0;

      /**
       * Calculate final movement speed using the StatFormulas function.
       * Formula: BASE_SPEED * (0.5 + SPD/100) * weaponSpeedMod * armorPenalty
       * At SPD=50, weaponMod=1.0, no armor: 200 * 1.0 * 1.0 * 1.0 = 200 px/s
       */
      let speed = calculateMovementSpeed(
        soldier.stats.SPD,
        weaponSpeedMod,
        armorPenalty
      );

      /* Soldiers in combat move at 50% speed (suppression) */
      if (soldier.isInCombat) {
        speed *= 0.5;
      }

      /** Waypoint arrival threshold in game units */
      const ARRIVAL_DIST = 5;

      if (dist < ARRIVAL_DIST) {
        /* Close enough to waypoint - snap to it and advance to next */
        soldier.position.x = target.x;
        soldier.position.z = target.z;
        soldier.waypoints.shift();
        soldier.isMoving = soldier.waypoints.length > 0;
      } else {
        /* Move toward waypoint at calculated speed */
        const moveAmount = speed * dt;
        const ratio = Math.min(moveAmount / dist, 1);
        soldier.position.x += dx * ratio;
        soldier.position.z += dz * ratio;
        /* Face movement direction */
        soldier.rotation = Math.atan2(dz, dx);
        soldier.isMoving = true;
      }
    }
  }

  // ============================================================
  // Detection System (Sim Step 3)
  // ============================================================

  /**
   * Run the detection system for all alive soldiers.
   *
   * For each alive soldier, checks every alive enemy through the
   * detection pipeline:
   *   1. Range check (AWR stat → detection radius, enemy STL → stealth mod)
   *   2. Vision cone (120° forward arc + 30° peripheral on each side)
   *   3. Line of sight (ray vs walls)
   *   4. Probabilistic detection roll (per tick)
   *
   * Results are stored in each soldier's `detectedEnemies` array.
   * When a soldier detects an enemy, they automatically face toward them.
   */
  private updateDetection(): void {
    if (!this.detectionSystem) return;

    const p1Soldiers = this.state.player1Soldiers;
    const p2Soldiers = this.state.player2Soldiers;

    /* Run detection for player 1 soldiers against player 2 enemies */
    this.detectEnemiesForTeam(p1Soldiers, p2Soldiers);

    /* Run detection for player 2 soldiers against player 1 enemies */
    this.detectEnemiesForTeam(p2Soldiers, p1Soldiers);
  }

  /**
   * Run detection for all soldiers on one team against the enemy team.
   * Updates each soldier's detectedEnemies array and facing direction.
   *
   * @param team - Array of friendly soldiers doing the detecting
   * @param enemies - Array of enemy soldiers that might be detected
   */
  private detectEnemiesForTeam(
    team: SoldierRuntimeState[],
    enemies: SoldierRuntimeState[]
  ): void {
    if (!this.detectionSystem) return;

    for (const soldier of team) {
      /* Dead soldiers can't detect anyone */
      if (!soldier.alive) {
        soldier.detectedEnemies = [];
        continue;
      }

      /* Blinded soldiers can't detect anyone (flash grenade effect) */
      if (soldier.isBlinded) {
        soldier.detectedEnemies = [];
        continue;
      }

      /* Check each alive enemy through the full detection pipeline */
      const newDetected: string[] = [];

      for (const enemy of enemies) {
        if (!enemy.alive) continue;

        /**
         * Run the detection check from DetectionSystem.
         * Uses the soldier's AWR stat for detection radius and
         * the enemy's STL stat for stealth modifier.
         */
        const detected = this.detectionSystem.checkDetection(
          soldier,
          enemy,
          this.rng,
          soldier.stats.AWR,
          enemy.stats.STL
        );

        if (detected) {
          /**
           * Additional check: smoke blocks LOS even if the geometry
           * and probability checks pass. If a smoke cloud is between
           * the observer and target, detection fails.
           */
          const blockedBySmoke = this.utilitySystem.isLOSBlockedBySmoke(
            soldier.position,
            enemy.position
          );

          if (!blockedBySmoke) {
            newDetected.push(enemy.soldierId);
          }
        }
      }

      /**
       * Also keep previously detected enemies visible if they are still
       * within LOS (prevents flickering from probabilistic detection).
       * Once detected, a soldier stays visible until LOS is lost.
       */
      for (const prevId of soldier.detectedEnemies) {
        /* Don't duplicate entries */
        if (newDetected.includes(prevId)) continue;

        /* Find the previously detected enemy */
        const prevEnemy = enemies.find(e => e.soldierId === prevId);
        if (!prevEnemy || !prevEnemy.alive) continue;

        /* Keep them detected if we still have wall LOS AND no smoke blocks the view */
        if (this.detectionSystem.hasLineOfSight(soldier.position, prevEnemy.position)
            && !this.utilitySystem.isLOSBlockedBySmoke(soldier.position, prevEnemy.position)) {
          /**
           * Also verify they're still within detection range.
           * Use a generous 1.2x multiplier to prevent edge-case flickering
           * right at the boundary of the detection radius.
           */
          const baseRadius = calculateDetectionRadius(soldier.stats.AWR);
          const stealthMod = calculateStealthModifier(prevEnemy.stats.STL);
          const effectiveRadius = baseRadius * stealthMod * 1.2;
          const dist = vecDistance(soldier.position, prevEnemy.position);

          if (dist <= effectiveRadius) {
            newDetected.push(prevId);
          }
        }
      }

      /* Update the soldier's detected enemies list */
      soldier.detectedEnemies = newDetected;

      /**
       * If this soldier detects enemies and isn't currently moving,
       * face toward the nearest detected enemy (auto-aim behavior).
       */
      if (newDetected.length > 0 && !soldier.isMoving) {
        const nearestEnemy = this.findNearestDetectedEnemy(soldier, enemies);
        if (nearestEnemy) {
          const dx = nearestEnemy.position.x - soldier.position.x;
          const dz = nearestEnemy.position.z - soldier.position.z;
          soldier.rotation = Math.atan2(dz, dx);
        }
      }
    }
  }

  /**
   * Find the nearest detected enemy for a soldier.
   * Used for auto-aiming when standing still.
   *
   * @param soldier - The observing soldier
   * @param enemies - Array of enemy soldiers
   * @returns The nearest detected enemy, or null
   */
  private findNearestDetectedEnemy(
    soldier: SoldierRuntimeState,
    enemies: SoldierRuntimeState[]
  ): SoldierRuntimeState | null {
    let nearest: SoldierRuntimeState | null = null;
    let nearestDist = Infinity;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (!soldier.detectedEnemies.includes(enemy.soldierId)) continue;

      const dist = vecDistance(soldier.position, enemy.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    }

    return nearest;
  }

  // ============================================================
  // Combat System (Sim Step 4)
  // ============================================================

  /**
   * Resolve combat between soldiers that mutually detect each other.
   *
   * Combat triggers when two soldiers detect each other (mutual detection).
   * Each tick, combatants exchange fire with probabilities determined by:
   *   - ACC → base hit chance
   *   - REA → who fires first (reaction time)
   *   - RCL → accuracy decay during sustained fire
   *   - CMP → composure under pressure (low HP or outnumbered)
   *   - CLT → clutch bonus when last alive
   *   - TWK → teamwork bonus when allies are nearby
   *
   * Damage is calculated using the weapon's bodyDamage, headshotMultiplier,
   * and the target's armor and helmet.
   */
  private updateCombat(): void {
    const p1Soldiers = this.state.player1Soldiers;
    const p2Soldiers = this.state.player2Soldiers;

    /**
     * Track which pairs have already been resolved this tick
     * to prevent double-processing (A shoots B AND B shoots A).
     */
    const resolvedPairs = new Set<string>();

    /* Check all player 1 soldiers for combat engagements */
    for (const soldier of p1Soldiers) {
      if (!soldier.alive) continue;

      for (const enemyId of soldier.detectedEnemies) {
        /* Find the enemy in player 2's roster */
        const enemy = p2Soldiers.find(e => e.soldierId === enemyId);
        if (!enemy || !enemy.alive) continue;

        /* Create a unique key for this pair to prevent double-processing */
        const pairKey = [soldier.soldierId, enemy.soldierId].sort().join(':');
        if (resolvedPairs.has(pairKey)) continue;
        resolvedPairs.add(pairKey);

        /**
         * Check for mutual detection — both soldiers see each other.
         * If only one sees the other, the detected soldier gets a free
         * "ambush" shot before the other reacts.
         */
        const mutualDetection = enemy.detectedEnemies.includes(soldier.soldierId);

        /* Mark both as in combat */
        soldier.isInCombat = true;
        soldier.currentTarget = enemy.soldierId;
        if (mutualDetection) {
          enemy.isInCombat = true;
          enemy.currentTarget = soldier.soldierId;
        }

        /* Resolve the exchange of fire */
        this.resolveCombatTick(soldier, enemy, p1Soldiers, p2Soldiers, mutualDetection);
      }
    }

    /* Also check player 2 soldiers for one-sided detection (ambushes) */
    for (const soldier of p2Soldiers) {
      if (!soldier.alive) continue;

      for (const enemyId of soldier.detectedEnemies) {
        const enemy = p1Soldiers.find(e => e.soldierId === enemyId);
        if (!enemy || !enemy.alive) continue;

        const pairKey = [soldier.soldierId, enemy.soldierId].sort().join(':');
        if (resolvedPairs.has(pairKey)) continue;
        resolvedPairs.add(pairKey);

        /* One-sided detection: soldier sees enemy but enemy doesn't see soldier */
        soldier.isInCombat = true;
        soldier.currentTarget = enemy.soldierId;

        this.resolveCombatTick(soldier, enemy, p2Soldiers, p1Soldiers, false);
      }
    }

    /* Clear combat status for soldiers with no detected enemies */
    for (const soldier of [...p1Soldiers, ...p2Soldiers]) {
      if (!soldier.alive) continue;
      if (soldier.detectedEnemies.length === 0) {
        soldier.isInCombat = false;
        soldier.currentTarget = null;
        soldier.shotsFired = 0; /* Reset spray counter when not in combat */
      }
    }
  }

  /**
   * Resolve one tick of combat between two soldiers.
   *
   * Uses the full stat-driven combat pipeline:
   *   1. Calculate hit chance (ACC + distance + movement + weapon + modifiers)
   *   2. Roll hit/miss
   *   3. Determine hit location (head/body/legs)
   *   4. Calculate damage (weapon + armor + helmet)
   *   5. Apply damage
   *
   * If mutual detection, both fire. If one-sided, only the detecting
   * soldier fires (ambush advantage).
   *
   * @param shooterA - First soldier (always fires)
   * @param shooterB - Second soldier (fires only if mutualDetection)
   * @param teamA - Shooter A's full team (for counting allies alive)
   * @param teamB - Shooter B's full team (for counting allies alive)
   * @param mutualDetection - Whether both soldiers see each other
   */
  private resolveCombatTick(
    shooterA: SoldierRuntimeState,
    shooterB: SoldierRuntimeState,
    teamA: SoldierRuntimeState[],
    teamB: SoldierRuntimeState[],
    mutualDetection: boolean
  ): void {
    /* Resolve A shooting at B */
    if (shooterA.alive && shooterB.alive) {
      this.resolveShot(shooterA, shooterB, teamA, teamB);
    }

    /* Resolve B shooting at A (only if mutual detection and B is still alive) */
    if (mutualDetection && shooterB.alive && shooterA.alive) {
      this.resolveShot(shooterB, shooterA, teamB, teamA);
    }
  }

  /**
   * Resolve a single shot from one soldier at another.
   * This is the core accuracy + damage pipeline from the GDD.
   *
   * Hit chance calculation:
   *   1. Base hit = 0.15 + ACC * 0.007
   *   2. Distance modifier = max(0.3, 1.0 - distance/1500)
   *   3. Moving penalty = 0.5x if shooter is moving
   *   4. Weapon accuracy modifier (from WeaponData)
   *   5. Spray degradation (shots fired in burst → RCL mitigates)
   *   6. Composure modifier (CMP under stress)
   *   7. Clutch modifier (CLT when last alive)
   *   8. Teamwork modifier (TWK with allies nearby)
   *   → Final = clamp(product of all, 0.02, 0.98)
   *
   * @param shooter - The soldier firing
   * @param target - The soldier being fired at
   * @param shooterTeam - Shooter's full team (for counting allies)
   * @param targetTeam - Target's full team
   */
  private resolveShot(
    shooter: SoldierRuntimeState,
    target: SoldierRuntimeState,
    shooterTeam: SoldierRuntimeState[],
    targetTeam: SoldierRuntimeState[]
  ): void {
    /**
     * Blinded soldiers cannot aim — skip their shot entirely.
     * Flash grenades set isBlinded=true which prevents firing until it wears off.
     */
    if (shooter.isBlinded) {
      return;
    }

    /* Increment shot counter for spray tracking */
    shooter.shotsFired++;

    /* --- Step 1: Base hit chance from ACC stat --- */
    const baseHit = calculateBaseHitChance(shooter.stats.ACC);

    /* --- Step 2: Apply distance modifier --- */
    const dist = vecDistance(shooter.position, target.position);

    /* --- Step 3: Get weapon stats --- */
    const weaponStats = WEAPONS[shooter.currentWeapon];
    const weaponAccMod = weaponStats ? weaponStats.accuracyModifier : 0.85;

    /**
     * Step 4: Calculate final hit chance using StatFormulas.
     * Combines base accuracy, distance, movement penalty, and weapon modifier.
     */
    let hitChance = calculateFinalHitChance(
      shooter.stats.ACC,
      dist,
      shooter.isMoving,
      weaponAccMod
    );

    /**
     * Step 5: Apply spray degradation for sustained fire.
     * After the first shot, accuracy degrades based on shots fired
     * and the soldier's RCL (Recoil Control) stat.
     */
    if (shooter.shotsFired > 1) {
      const sprayAcc = calculateSprayAccuracy(
        hitChance,
        shooter.shotsFired,
        shooter.stats.RCL
      );
      hitChance = sprayAcc;
    }

    /* --- Step 6: Composure modifier (CMP) --- */
    /**
     * Count alive allies and detected enemies for stress calculation.
     * Stress triggers when: HP < 30 OR enemiesVisible > alliesNearby + 1
     */
    const alliesAlive = shooterTeam.filter(
      s => s.alive && s.soldierId !== shooter.soldierId
    ).length;
    const enemiesDetected = shooter.detectedEnemies.length;

    const composureMod = calculateComposureModifier(
      shooter.stats.CMP,
      shooter.health,
      enemiesDetected,
      alliesAlive
    );
    hitChance *= composureMod;

    /* --- Step 7: Clutch modifier (CLT) --- */
    /** Clutch activates when the soldier is the last one alive on their team */
    const clutchMod = calculateClutchModifier(shooter.stats.CLT, alliesAlive);
    hitChance *= clutchMod;

    /* --- Step 8: Teamwork modifier (TWK) --- */
    /** Check if any alive ally is within TEAMWORK_RANGE (300px) */
    const hasAllyNearby = shooterTeam.some(ally => {
      if (ally.soldierId === shooter.soldierId || !ally.alive) return false;
      return vecDistance(shooter.position, ally.position) <= TEAMWORK_RANGE;
    });
    const teamworkMod = calculateTeamworkModifier(shooter.stats.TWK, hasAllyNearby);
    hitChance *= teamworkMod;

    /* --- Clamp final hit chance --- */
    hitChance = Math.max(0.02, Math.min(0.98, hitChance));

    /* --- Roll hit/miss --- */
    const hitRoll = this.rng.next();
    const isHit = hitRoll < hitChance;

    if (!isHit) {
      /* Shot missed — no damage */
      return;
    }

    /* --- Determine hit location (head/body/legs) --- */
    const headshotChance = calculateHeadshotChance(shooter.stats.ACC);

    /** Reduce headshot chance during spray by 30% */
    const effectiveHeadshotChance = shooter.shotsFired > 1
      ? headshotChance * 0.7
      : headshotChance;

    const locationRoll = this.rng.next();
    let hitLocation: 'head' | 'body' | 'legs';
    if (locationRoll < effectiveHeadshotChance) {
      hitLocation = 'head';
    } else if (locationRoll < effectiveHeadshotChance + (1 - effectiveHeadshotChance) * 0.8) {
      hitLocation = 'body';
    } else {
      hitLocation = 'legs';
    }

    /* --- Calculate damage --- */
    /**
     * Look up armor reduction values.
     * TODO: Use actual ARMOR lookup table when buy menu is wired.
     * For now: no armor = 0% reduction, "light" = 30%, "heavy" = 50%.
     */
    let armorBodyReduction = 0;
    let armorLegReduction = 0;
    if (target.armor === 'HEAVY_ARMOR') {
      armorBodyReduction = 0.50;
      armorLegReduction = 0.15;
    } else if (target.armor === 'LIGHT_VEST') {
      armorBodyReduction = 0.30;
      armorLegReduction = 0;
    }

    /** Check if the weapon is an AWP (ignores helmet protection) */
    const isAwp = shooter.currentWeapon === WeaponId.AWP;

    const damage = calculateDamage(
      weaponStats ? weaponStats.bodyDamage : 25,
      weaponStats ? weaponStats.headshotMultiplier : 2.5,
      hitLocation,
      armorBodyReduction,
      armorLegReduction,
      target.helmet,
      isAwp
    );

    /* --- Apply damage to target --- */
    target.health -= damage;

    /**
     * Interrupt plant/defuse action if the target takes damage.
     * Taking a bullet breaks concentration and resets action progress.
     */
    if (target.isPlanting || target.isDefusing) {
      console.log(`[Bomb] ${target.soldierId} interrupted while ${target.isPlanting ? 'planting' : 'defusing'} (took damage)`);
      target.isPlanting = false;
      target.isDefusing = false;
      target.actionProgress = 0;
    }

    /* Check if target was killed */
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      target.isMoving = false;
      target.isInCombat = false;
      target.currentTarget = null;
      target.waypoints = [];
      target.detectedEnemies = [];

      /* Log the kill */
      const killRecord: KillRecord = {
        killerId: shooter.soldierId,
        victimId: target.soldierId,
        weapon: shooter.currentWeapon,
        headshot: hitLocation === 'head',
        tick: this.state.tick,
      };
      this.state.currentRoundKills.push(killRecord);

      console.log(
        `[Combat] ${shooter.soldierId} killed ${target.soldierId}` +
        ` with ${shooter.currentWeapon}` +
        `${hitLocation === 'head' ? ' (HEADSHOT!)' : ''}` +
        ` — ${damage.toFixed(0)} damage`
      );
    }
  }

  // ============================================================
  // Utility System (Sim Step 6)
  // ============================================================

  /**
   * Tick all active utility effects and update blind timers.
   *
   * This method:
   *   1. Ticks the UtilitySystem (applies frag/molotov damage, expires effects)
   *   2. Ticks blind timers on all soldiers (flash blind wears off over time)
   *
   * Called once per simulation tick (every 200ms).
   */
  private updateUtility(): void {
    const dt = TICK_RATE_MS / 1000;
    const allSoldiers = [
      ...this.state.player1Soldiers,
      ...this.state.player2Soldiers,
    ];

    /* Tick active utility effects (applies molotov DPS, expires effects) */
    this.utilitySystem.tick(dt, allSoldiers);

    /* Tick blind timers on all soldiers */
    this.utilitySystem.tickBlindTimers(dt, allSoldiers);
  }

  // ============================================================
  // Bomb Plant/Defuse (Sim Step 7)
  // ============================================================

  /**
   * Update bomb plant and defuse actions each simulation tick.
   *
   * Plant logic:
   *   - The selected attacker soldier must be alive and inside a plant zone
   *   - The player must be holding the P key
   *   - Progress accumulates by dt each tick (3 seconds to plant)
   *   - The soldier cannot move while planting (waypoints are cleared)
   *   - If the player releases P or the soldier leaves the zone, progress resets
   *   - When plant completes: bomb is placed, phase transitions to POST_PLANT
   *
   * Defuse logic:
   *   - A defender soldier must be alive and near the planted bomb
   *   - The player must be holding the E key
   *   - Progress accumulates by dt each tick (5s without kit, 3s with kit)
   *   - The soldier cannot move while defusing
   *   - If interrupted, progress resets
   *   - When defuse completes: defenders win the round
   */
  private updateBombActions(): void {
    if (!this.bombLogic) return;

    const dt = TICK_RATE_MS / 1000;

    /**
     * Determine which soldiers are attackers and which are defenders.
     * Player 1's side determines this; player 2 is the opposite.
     */
    const p1IsAttacker = this.state.player1Side === Side.ATTACKER;
    const attackerSoldiers = p1IsAttacker
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;
    const defenderSoldiers = p1IsAttacker
      ? this.state.player2Soldiers
      : this.state.player1Soldiers;

    /* Which player controls the attackers? */
    const attackerPlayer: 1 | 2 = p1IsAttacker ? 1 : 2;
    const defenderPlayer: 1 | 2 = p1IsAttacker ? 2 : 1;

    // --- PLANT LOGIC ---
    if (!this.state.bombPlanted && this.state.phase === GamePhase.LIVE_PHASE) {
      this.updatePlantAction(attackerSoldiers, attackerPlayer, dt);
    }

    // --- DEFUSE LOGIC ---
    if (this.state.bombPlanted && this.state.phase === GamePhase.POST_PLANT) {
      this.updateDefuseAction(defenderSoldiers, defenderPlayer, dt);
    }
  }

  /**
   * Handle bomb plant progress for the attacking team.
   *
   * Only the local player's selected soldier can plant (if they're an attacker).
   * The bot AI handles plant logic independently in BotAI.ts.
   *
   * @param attackerSoldiers - The attacking team's soldiers
   * @param attackerPlayer - Which player (1 or 2) controls the attackers
   * @param dt - Time delta for this tick (seconds)
   */
  private updatePlantAction(
    attackerSoldiers: SoldierRuntimeState[],
    attackerPlayer: 1 | 2,
    dt: number
  ): void {
    if (!this.bombLogic) return;

    /**
     * Check if the local player is the attacker and is requesting a plant.
     * The bot AI handles its own plant logic separately.
     */
    const localIsAttacker = this.localPlayer === attackerPlayer;

    for (const soldier of attackerSoldiers) {
      if (!soldier.alive || !soldier.hasBomb) continue;

      /**
       * Determine if this soldier should be planting:
       * - Local player: must be holding P key and have this soldier selected
       * - Bot AI: BotAI sets isPlanting directly
       */
      const shouldPlant = localIsAttacker
        ? (this.isRequestingPlant &&
           this.selectedSoldier === soldier.index)
        : soldier.isPlanting; /* Bot AI sets this directly */

      if (shouldPlant) {
        /* Check if the soldier is inside a plant zone */
        const siteId = this.bombLogic.isInPlantZone(soldier.position);

        if (siteId) {
          /* Start or continue planting */
          soldier.isPlanting = true;
          soldier.isMoving = false;
          soldier.waypoints = [];
          soldier.actionProgress += dt;

          /* Check if plant is complete */
          if (this.bombLogic.isPlantComplete(soldier.actionProgress)) {
            this.completeBombPlant(soldier, siteId);
          }
        } else {
          /* Not in a plant zone — reset plant progress */
          if (soldier.isPlanting) {
            console.log(`[Bomb] ${soldier.soldierId} left the plant zone — plant cancelled`);
          }
          soldier.isPlanting = false;
          soldier.actionProgress = 0;
        }
      } else {
        /* Not holding plant key — reset progress */
        if (soldier.isPlanting) {
          soldier.isPlanting = false;
          soldier.actionProgress = 0;
        }
      }
    }
  }

  /**
   * Handle bomb defuse progress for the defending team.
   *
   * @param defenderSoldiers - The defending team's soldiers
   * @param defenderPlayer - Which player (1 or 2) controls the defenders
   * @param dt - Time delta for this tick (seconds)
   */
  private updateDefuseAction(
    defenderSoldiers: SoldierRuntimeState[],
    defenderPlayer: 1 | 2,
    dt: number
  ): void {
    if (!this.bombLogic || !this.state.bombPosition) return;

    const localIsDefender = this.localPlayer === defenderPlayer;

    for (const soldier of defenderSoldiers) {
      if (!soldier.alive) continue;

      /**
       * Determine if this soldier should be defusing:
       * - Local player: must be holding E key and have this soldier selected
       * - Bot AI: BotAI sets isDefusing directly
       */
      const shouldDefuse = localIsDefender
        ? (this.isRequestingDefuse &&
           this.selectedSoldier === soldier.index)
        : soldier.isDefusing; /* Bot AI sets this directly */

      if (shouldDefuse) {
        /* Check if the soldier is within defuse range of the bomb */
        const inRange = this.bombLogic.isInDefuseRange(
          soldier.position,
          this.state.bombPosition
        );

        if (inRange) {
          /* Start or continue defusing */
          soldier.isDefusing = true;
          soldier.isMoving = false;
          soldier.waypoints = [];
          soldier.actionProgress += dt;

          /* Check if defuse is complete */
          if (this.bombLogic.isDefuseComplete(soldier.actionProgress, soldier.defuseKit)) {
            this.completeBombDefuse(soldier);
          }
        } else {
          /* Out of range — reset defuse progress */
          if (soldier.isDefusing) {
            console.log(`[Bomb] ${soldier.soldierId} moved out of defuse range — defuse cancelled`);
          }
          soldier.isDefusing = false;
          soldier.actionProgress = 0;
        }
      } else {
        /* Not holding defuse key — reset progress */
        if (soldier.isDefusing) {
          soldier.isDefusing = false;
          soldier.actionProgress = 0;
        }
      }
    }
  }

  /**
   * Complete the bomb plant action.
   * Places the bomb at the soldier's position, transitions to POST_PLANT phase.
   *
   * @param planter - The soldier who planted the bomb
   * @param siteId - Which bomb site the bomb was planted at ('A' or 'B')
   */
  private completeBombPlant(planter: SoldierRuntimeState, siteId: string): void {
    /* Update game state */
    this.state.bombPlanted = true;
    this.state.bombPosition = { ...planter.position };
    this.state.bombSite = siteId;
    this.state.bombTimer = PHASE_DURATIONS[GamePhase.POST_PLANT];

    /* Reset the planter's action state */
    planter.isPlanting = false;
    planter.actionProgress = 0;
    planter.hasBomb = false;

    /* Transition to POST_PLANT phase */
    this.state.phase = GamePhase.POST_PLANT;
    this.state.timeRemaining = PHASE_DURATIONS[GamePhase.POST_PLANT];

    console.log(
      `[Bomb] ${planter.soldierId} planted the bomb at site ${siteId}` +
      ` (${Math.round(planter.position.x)}, ${Math.round(planter.position.z)})` +
      ` — ${PHASE_DURATIONS[GamePhase.POST_PLANT]}s until detonation`
    );
  }

  /**
   * Complete the bomb defuse action.
   * Defenders win the round. Transitions to ROUND_END.
   *
   * @param defuser - The soldier who defused the bomb
   */
  private completeBombDefuse(defuser: SoldierRuntimeState): void {
    /* Reset the defuser's action state */
    defuser.isDefusing = false;
    defuser.actionProgress = 0;

    /* Mark the bomb as defused */
    this.state.bombDefused = true;

    console.log(
      `[Bomb] ${defuser.soldierId} DEFUSED the bomb!` +
      ` (kit: ${defuser.defuseKit ? 'yes' : 'no'})`
    );

    /* Defenders win the round */
    this.endRound(Side.DEFENDER);
  }

  // ============================================================
  // Fog of War (Sim Step 8)
  // ============================================================

  /**
   * Update the fog of war overlay based on friendly soldier positions.
   *
   * The fog reveals circular areas around each alive friendly soldier.
   * The radius is determined by the soldier's AWR stat (detection radius).
   *
   * Called once per simulation tick (5 times/second) for performance.
   */
  private updateFogOfWar(): void {
    if (!this.fogOfWar) return;

    /* Get the local player's soldiers */
    const mySoldiers = this.localPlayer === 1
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;

    /* Update the fog texture with current soldier positions */
    this.fogOfWar.update(mySoldiers);
  }

  // ============================================================
  // Round End Conditions (Sim Step 9)
  // ============================================================

  /**
   * Check if the round should end due to elimination.
   *
   * The round ends immediately when:
   *   - All attackers are dead → Defenders win
   *   - All defenders are dead → Attackers win
   *
   * Other round-end conditions (bomb plant/defuse, timer) are handled
   * by the phase timer in advancePhase().
   */
  private checkRoundEndConditions(): void {
    /* Don't check during non-live phases */
    if (this.state.phase !== GamePhase.LIVE_PHASE && this.state.phase !== GamePhase.POST_PLANT) {
      return;
    }

    /**
     * Determine which team is attacking and which is defending.
     * Player 1's side determines this — player 2 is always the opposite.
     */
    const attackers = this.state.player1Side === Side.ATTACKER
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;

    const defenders = this.state.player1Side === Side.DEFENDER
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;

    const attackersAlive = attackers.filter(s => s.alive).length;
    const defendersAlive = defenders.filter(s => s.alive).length;

    if (attackersAlive === 0) {
      /* All attackers eliminated — defenders win */
      console.log('[Round] All attackers eliminated! Defenders win.');
      this.endRound(Side.DEFENDER);
    } else if (defendersAlive === 0) {
      /**
       * All defenders eliminated — attackers win.
       * Exception: if the bomb is planted, the round continues
       * (bomb can still detonate even with no defenders alive).
       * But if bomb is NOT planted and all defenders die, attackers
       * still need to plant... Actually in CS:GO if all defenders die
       * the attackers win immediately, regardless of bomb status.
       */
      console.log('[Round] All defenders eliminated! Attackers win.');
      this.endRound(Side.ATTACKER);
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
    if (this.state.phase === GamePhase.MATCH_END) {
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
   * Uses the EconomyManager to calculate proper rewards including:
   *   - Win/loss streak round rewards
   *   - Per-kill weapon rewards
   *   - Bomb plant/defuse objective bonuses
   * Updates score, economy, and transitions to ROUND_END phase.
   */
  private endRound(winner: Side): void {
    /* Determine which player won based on current sides */
    const player1Won = (this.state.player1Side === winner);

    /* Update score */
    if (player1Won) {
      this.state.score.player1++;
    } else {
      this.state.score.player2++;
    }

    /**
     * Calculate full economy rewards using the EconomyManager.
     * This handles win/loss rewards, kill rewards by weapon, and bomb bonuses.
     */
    const economyUpdate = this.economyManager.calculateRoundRewards(
      winner,
      this.state.player1Side,
      this.state.player1Economy,
      this.state.player2Economy,
      this.state.currentRoundKills,
      this.state.bombPlanted,
      this.state.bombDefused
    );

    /* Apply the economy changes to both players */
    this.economyManager.applyUpdate(
      this.state.player1Economy,
      this.state.player2Economy,
      economyUpdate
    );

    /* Store the economy update for the round summary screen */
    this.lastRoundEconomyUpdate = economyUpdate;

    /* Save the round kills before clearing (needed for summary screen) */
    const roundKills = [...this.state.currentRoundKills];

    /* Save the round result to history */
    this.state.roundHistory.push({
      roundNumber: this.state.roundNumber,
      winningSide: winner,
      bombPlanted: this.state.bombPlanted,
      bombDefused: this.state.bombDefused,
      bombDetonated: this.state.phase === GamePhase.POST_PLANT,
      kills: roundKills,
    });

    /* Clear current round kills */
    this.state.currentRoundKills = [];

    /* Transition to round end phase */
    this.state.phase = GamePhase.ROUND_END;
    this.state.timeRemaining = PHASE_DURATIONS[GamePhase.ROUND_END];

    console.log(
      `[Round] Round ${this.state.roundNumber} won by ${winner}.` +
      ` Score: ${this.state.score.player1}-${this.state.score.player2}`
    );

    /* Log economy details */
    console.log(
      `[Economy] P1: +$${economyUpdate.player1.totalEarned}` +
      ` (round: $${economyUpdate.player1.roundReward}` +
      ` kills: $${economyUpdate.player1.killRewards}` +
      ` obj: $${economyUpdate.player1.objectiveBonus})` +
      ` | P2: +$${economyUpdate.player2.totalEarned}` +
      ` (round: $${economyUpdate.player2.roundReward}` +
      ` kills: $${economyUpdate.player2.killRewards}` +
      ` obj: $${economyUpdate.player2.objectiveBonus})`
    );

    /**
     * Show the round summary screen with kill feed, MVP, and economy.
     * The local player's economy details are shown in detail, enemy's is summarized.
     */
    const localSide = this.localPlayer === 1
      ? this.state.player1Side
      : (this.state.player1Side === Side.ATTACKER ? Side.DEFENDER : Side.ATTACKER);
    const localEcon = this.localPlayer === 1 ? economyUpdate.player1 : economyUpdate.player2;
    const enemyEcon = this.localPlayer === 1 ? economyUpdate.player2 : economyUpdate.player1;

    this.roundSummary.show(
      winner,
      this.state.roundNumber,
      this.state.score,
      roundKills,
      localSide,
      localEcon,
      enemyEcon,
      this.state.bombPlanted,
      this.state.bombDefused,
    );

    /* Check for match end */
    if (this.state.score.player1 >= 5 || this.state.score.player2 >= 5) {
      this.state.phase = GamePhase.MATCH_END;
      const matchWinner = this.state.score.player1 >= 5 ? 'Player 1' : 'Player 2';
      console.log(
        `[Match] MATCH OVER! ${matchWinner} wins` +
        ` ${this.state.score.player1}-${this.state.score.player2}`
      );
    }
  }

  /**
   * Start the next round. Reset soldiers, advance round counter,
   * handle side swap at the halfway point.
   */
  private startNextRound(): void {
    /* Hide the round summary screen from the previous round */
    this.roundSummary.hide();

    this.state.roundNumber++;

    /* Side swap at round 5 (after 4 rounds per side) */
    if (this.state.roundNumber === 5) {
      this.state.player1Side =
        this.state.player1Side === Side.ATTACKER ? Side.DEFENDER : Side.ATTACKER;
      console.log(`[Match] Side swap! Player 1 is now ${this.state.player1Side}`);
    }

    /* Round 9 tiebreaker — use EconomyManager for overtime money */
    if (this.state.roundNumber === 9 && this.state.score.player1 === 4 && this.state.score.player2 === 4) {
      this.economyManager.applyOvertimeMoney(
        this.state.player1Economy,
        this.state.player2Economy
      );
      console.log('[Match] TIEBREAKER ROUND! Both teams receive overtime money');
    }

    /* Reset round state */
    this.state.bombPlanted = false;
    this.state.bombDefused = false;
    this.state.bombPosition = null;
    this.state.bombSite = null;
    this.state.bombTimer = 0;
    this.state.currentRoundKills = [];
    this.commandSystem.clearAll();

    /**
     * Reset soldiers for the new round with equipment persistence.
     *
     * Equipment persistence rules:
     *   - Surviving soldiers keep their weapon, armor, helmet, defuse kit
     *   - Dead soldiers lose all equipment → reset to pistol, no armor
     *   - All soldiers are revived to full health at spawn positions
     *   - Utility is consumed when used, so survivors keep unspent utility
     *   - On side swap (round 5), ALL equipment resets (fresh economy)
     */
    const isSideSwapRound = this.state.roundNumber === 5;

    for (const soldier of [...this.state.player1Soldiers, ...this.state.player2Soldiers]) {
      /**
       * If the soldier died this round OR it's a side swap round,
       * strip all equipment back to default pistol loadout.
       */
      if (!soldier.alive || isSideSwapRound) {
        soldier.currentWeapon = WeaponId.PISTOL;
        soldier.armor = null;
        soldier.helmet = false;
        soldier.utility = [];
        soldier.defuseKit = false;
      }
      /* Surviving soldiers keep their equipment (weapon, armor, helmet, utility, kit) */

      /* Reset round-specific state for all soldiers */
      soldier.health = 100;
      soldier.alive = true;
      soldier.isMoving = false;
      soldier.isInCombat = false;
      soldier.currentTarget = null;
      soldier.waypoints = [];
      soldier.isPlanting = false;
      soldier.isDefusing = false;
      soldier.actionProgress = 0;
      soldier.detectedEnemies = [];
      soldier.shotsFired = 0;
      soldier.isBlinded = false;
      soldier.blindedTimer = 0;
      soldier.hasBomb = false;
    }

    /* Re-spawn soldiers at spawn positions for the new round */
    this.respawnSoldiersAtSpawn();

    /**
     * Assign the bomb to the first attacker soldier (index 0).
     * The bomb carrier must be on the attacking team.
     */
    const p1IsAttacker = this.state.player1Side === Side.ATTACKER;
    const attackerSoldiers = p1IsAttacker
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;
    if (attackerSoldiers.length > 0) {
      attackerSoldiers[0].hasBomb = true;
    }

    /* Clear all active utility effects from the previous round */
    this.utilitySystem.clearAll();

    /* Reset fog of war for the new round */
    if (this.fogOfWar) {
      this.fogOfWar.reset();
    }

    /* Re-initialize bot AI for the new round with updated side */
    if (this.botAI) {
      const botSide = this.state.player1Side === Side.ATTACKER
        ? Side.DEFENDER
        : Side.ATTACKER;
      this.botAI.initializeRound(botSide);
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
    /* Determine which soldiers are friendly and which are enemy */
    const mySoldiers = this.localPlayer === 1
      ? this.state.player1Soldiers
      : this.state.player2Soldiers;
    const enemySoldiers = this.localPlayer === 1
      ? this.state.player2Soldiers
      : this.state.player1Soldiers;
    const myPrefix = this.localPlayer === 1 ? 'p1' : 'p2';
    const enemyPrefix = this.localPlayer === 1 ? 'p2' : 'p1';

    /* Update friendly soldiers — always visible to the player */
    for (const soldier of mySoldiers) {
      this.soldierRenderer.updateSoldier(
        `${myPrefix}_${soldier.index}`,
        soldier.position,
        soldier.rotation,
        soldier.health / 100,
        soldier.alive
      );
    }

    /**
     * Update enemy soldiers — only show them if they are detected
     * by at least one of our soldiers (fog of war enforcement).
     * Undetected enemies are hidden by passing alive=false to the renderer.
     */
    for (const enemy of enemySoldiers) {
      /* Check if any of our soldiers currently detect this enemy */
      const isDetected = mySoldiers.some(
        s => s.alive && s.detectedEnemies.includes(enemy.soldierId)
      );

      /**
       * Show the enemy if: they're detected AND alive.
       * If not detected, hide them regardless of alive status.
       */
      const showEnemy = enemy.alive && isDetected;

      this.soldierRenderer.updateSoldier(
        `${enemyPrefix}_${enemy.index}`,
        enemy.position,
        enemy.rotation,
        enemy.health / 100,
        showEnemy
      );
    }

    /* Update the HUD overlay with current game state */
    this.hud.update(this.state, this.localPlayer, this.selectedSoldier);

    /* Update the buy menu if it's visible */
    if (this.buyMenu.isVisible()) {
      const mySoldiers = this.localPlayer === 1
        ? this.state.player1Soldiers
        : this.state.player2Soldiers;
      const myEconomy = this.localPlayer === 1
        ? this.state.player1Economy
        : this.state.player2Economy;
      const selectedSoldier = this.selectedSoldier !== null
        ? mySoldiers[this.selectedSoldier]
        : null;
      this.buyMenu.update(selectedSoldier, myEconomy, this.state.player1Side);

      /* Auto-close the buy menu when leaving the buy phase */
      if (this.state.phase !== GamePhase.BUY_PHASE) {
        this.buyMenu.hide();
      }
    }
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
   * Get the economy changes from the last completed round.
   * Used by the round summary screen to display kill rewards, bonuses, etc.
   * Returns null if no round has been completed yet.
   */
  getLastRoundEconomyUpdate(): EconomyUpdate | null {
    return this.lastRoundEconomyUpdate;
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
