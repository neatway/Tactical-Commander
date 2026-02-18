/**
 * @file ServerSimulation.ts
 * @description Server-authoritative game simulation engine.
 *
 * This is the server-side equivalent of the client's Game.ts simulation tick loop.
 * It runs at 5 ticks/sec and is the single source of truth for the game state.
 * The client's local simulation runs in parallel for prediction, but the server
 * state always wins when there's a conflict.
 *
 * Simulation tick pipeline (same as client):
 *   1. Process queued commands (both players)
 *   2. Update movement (A* pathfinding + SPD stat)
 *   3. Run detection (vision cone + LOS + probabilistic roll)
 *   4. Resolve combat (stat-driven firefights)
 *   5. Tick utility effects (smoke, molotov, flash timers)
 *   6. Update bomb plant/defuse progress
 *   7. Check round-end conditions
 *   8. Generate events and fog-of-war filtered state updates
 *
 * Architecture:
 *   GameRoom
 *     └── ServerSimulation (this file)
 *           ├── Uses shared StatFormulas for all calculations
 *           ├── Uses shared WeaponData for item stats
 *           ├── Uses shared PRNG (SeededRandom) for determinism
 *           └── Produces GameEvent[] and filtered state per tick
 *
 * NOTE: This is the initial scaffolding. The full simulation mirrors the
 * client code in Game.ts (movement, detection, combat, utility, bomb).
 * The concrete implementations are marked TODO and will be filled in
 * as we wire up the server-authoritative flow.
 */

import { SeededRandom } from '../../../shared/util/RandomUtils.js';
import { WEAPONS } from '../../../shared/constants/WeaponData.js';
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
} from '../../../shared/constants/StatFormulas.js';
import { TIMING } from '../../../shared/constants/GameConstants.js';
import { ServerPathfinding } from './ServerPathfinding.js';

// ============================================================================
// --- Types ---
// ============================================================================

/**
 * Position in the game world (same as client Position).
 * Using inline type to avoid importing client-specific modules.
 */
interface Position {
  x: number;
  z: number;
}

/**
 * Soldier runtime state for the server simulation.
 * Mirrors client SoldierRuntimeState but defined here to keep
 * server code independent from client modules.
 */
interface ServerSoldierState {
  /** Index of this soldier in the team (0-4) */
  index: number;
  /** Reference ID to the soldier's persistent data */
  soldierId: string;
  /** Current world position */
  position: Position;
  /** Direction the soldier is facing, in radians */
  rotation: number;
  /** Current health points (0-100) */
  health: number;
  /** Whether the soldier is still alive this round */
  alive: boolean;
  /** Currently equipped weapon */
  currentWeapon: string;
  /** Armor type equipped (null if none) */
  armor: string | null;
  /** Whether the soldier has a helmet */
  helmet: boolean;
  /** Remaining utility items */
  utility: string[];
  /** Whether this soldier has a defuse kit */
  defuseKit: boolean;
  /** Current stance: AGGRESSIVE, DEFENSIVE, PASSIVE */
  stance: string;
  /** Whether the soldier is currently moving */
  isMoving: boolean;
  /** Whether the soldier is in active combat */
  isInCombat: boolean;
  /** ID of current combat target */
  currentTarget: string | null;
  /** Queue of positions to move to */
  waypoints: Position[];
  /** Whether this soldier carries the bomb */
  hasBomb: boolean;
  /** Whether this soldier is planting the bomb */
  isPlanting: boolean;
  /** Whether this soldier is defusing the bomb */
  isDefusing: boolean;
  /** Plant/defuse action progress in seconds */
  actionProgress: number;
  /** The 10 core combat stats */
  stats: {
    ACC: number;
    REA: number;
    SPD: number;
    STL: number;
    AWR: number;
    RCL: number;
    CMP: number;
    CLT: number;
    UTL: number;
    TWK: number;
  };
  /** IDs of enemies this soldier currently detects */
  detectedEnemies: string[];
  /** Number of consecutive shots fired */
  shotsFired: number;
  /** Whether this soldier is blinded */
  isBlinded: boolean;
  /** Seconds remaining on blind effect */
  blindedTimer: number;
}

/**
 * A queued command waiting to be executed.
 * Commands have a delay period before they take effect
 * (simulates radio communication delay).
 */
interface QueuedCommand {
  /** Which player issued the command (1 or 2) */
  playerNumber: 1 | 2;
  /** The command type */
  type: string;
  /** Target soldier index (0-4) */
  soldierIndex: number;
  /** Target position for movement commands */
  targetPosition?: Position;
  /** Utility type for USE_UTILITY commands */
  utilityType?: string;
  /** Game time when this command becomes executable */
  executeAt: number;
}

/**
 * A game event generated during simulation.
 * Sent to clients for rendering visual/audio effects.
 */
export interface SimEvent {
  /** Event type (SHOT_FIRED, HIT, KILL, etc.) */
  type: string;
  /** Tick when the event occurred */
  tick: number;
  /** Event-specific data payload */
  data: Record<string, unknown>;
}

/**
 * Kill record generated when a soldier dies.
 */
interface KillRecord {
  killerId: string;
  victimId: string;
  weapon: string;
  headshot: boolean;
  tick: number;
}

/**
 * Result of a simulation tick. Contains events and round-end info.
 */
export interface TickResult {
  /** Events generated this tick (shots, kills, etc.) */
  events: SimEvent[];
  /** Whether the round ended this tick */
  roundEnded: boolean;
  /** Winning side if the round ended, null otherwise */
  winningSide: 'ATTACKER' | 'DEFENDER' | null;
  /** Kill records generated this tick */
  kills: KillRecord[];
}

/**
 * Fog-of-war filtered state for one player.
 * Contains their own soldiers (full state) and visible enemies (partial state).
 */
export interface FilteredGameState {
  /** All of the player's own soldiers (full information) */
  ownSoldiers: ServerSoldierState[];
  /** Enemy soldiers that are currently visible (detected by own team) */
  visibleEnemies: Partial<ServerSoldierState>[];
  /** Whether the bomb has been planted */
  bombPlanted: boolean;
  /** Bomb position (null if not planted or not visible) */
  bombPosition: Position | null;
  /** Bomb site identifier */
  bombSite: string | null;
  /** Bomb timer (only visible to defenders when planted) */
  bombTimer: number;
  /** Current tick number */
  tick: number;
}

// ============================================================================
// --- Constants ---
// ============================================================================

/** Simulation tick rate in milliseconds */
const TICK_RATE_MS = 200;

/** Command delay range (0.3 to 0.8 seconds, simulates radio comms) */
const MIN_COMMAND_DELAY = 0.3;
const MAX_COMMAND_DELAY = 0.8;

/** Range within which allies provide a teamwork bonus (300px) */
const TEAMWORK_RANGE = 300;

// ============================================================================
// --- ServerSimulation Class ---
// ============================================================================

/**
 * Server-authoritative game simulation for a single match.
 *
 * Manages:
 *   - Complete game state for both teams
 *   - Command queue with radio delay
 *   - Per-tick simulation of movement, detection, combat, utility, bomb
 *   - Event generation for client rendering
 *   - Fog-of-war filtered state output
 */
export class ServerSimulation {
  /** Seeded PRNG for deterministic simulation */
  private rng: SeededRandom;

  /** Current game time in seconds (accumulated from ticks) */
  private gameTime: number = 0;

  /** Current simulation tick number */
  private tick: number = 0;

  /** Player 1's soldiers (5 total) */
  private player1Soldiers: ServerSoldierState[] = [];

  /** Player 2's soldiers (5 total) */
  private player2Soldiers: ServerSoldierState[] = [];

  /** Which side player 1 is on */
  private player1Side: 'ATTACKER' | 'DEFENDER' = 'ATTACKER';

  /** Queued commands waiting to be executed */
  private commandQueue: QueuedCommand[] = [];

  /** Kill records for the current round */
  private roundKills: KillRecord[] = [];

  /** Whether the bomb has been planted this round */
  private bombPlanted: boolean = false;

  /** Bomb position (null if not planted) */
  private bombPosition: Position | null = null;

  /** Bomb site identifier */
  private bombSite: string | null = null;

  /** Bomb timer in seconds (counts down when planted) */
  private bombTimer: number = 0;

  /** Whether the bomb was defused this round */
  private bombDefused: boolean = false;

  /** Events generated during the current tick (reset each tick) */
  private tickEvents: SimEvent[] = [];

  /** Wall data for LOS checks (loaded from map) */
  private walls: Array<{ x: number; z: number; width: number; height: number }> = [];

  /** A* pathfinding system for wall-aware movement (null until walls are set) */
  private pathfinder: ServerPathfinding | null = null;

  /** Map width in game units (set when walls are loaded) */
  private mapWidth: number = 3000;

  /** Map height in game units (set when walls are loaded) */
  private mapHeight: number = 2000;

  /**
   * Create a new server simulation.
   *
   * @param seed - RNG seed for deterministic simulation
   */
  constructor(seed: number) {
    this.rng = new SeededRandom(seed);
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize soldiers for a new round.
   * Places soldiers at spawn positions and assigns default equipment.
   *
   * @param player1Side - Which side player 1 is on
   * @param attackerSpawn - Spawn zone for the attacking team
   * @param defenderSpawn - Spawn zone for the defending team
   */
  initializeRound(
    player1Side: 'ATTACKER' | 'DEFENDER',
    attackerSpawn: { x: number; z: number; width: number; height: number },
    defenderSpawn: { x: number; z: number; width: number; height: number },
  ): void {
    this.player1Side = player1Side;
    this.gameTime = 0;
    this.tick = 0;
    this.commandQueue = [];
    this.roundKills = [];
    this.bombPlanted = false;
    this.bombPosition = null;
    this.bombSite = null;
    this.bombTimer = 0;
    this.bombDefused = false;

    /** Determine spawn zones based on player 1's side */
    const p1Spawn = player1Side === 'ATTACKER' ? attackerSpawn : defenderSpawn;
    const p2Spawn = player1Side === 'ATTACKER' ? defenderSpawn : attackerSpawn;

    /** Create soldiers for both teams */
    this.player1Soldiers = this.createTeamSoldiers('p1', p1Spawn, player1Side === 'ATTACKER');
    this.player2Soldiers = this.createTeamSoldiers('p2', p2Spawn, player1Side !== 'ATTACKER');
  }

  /**
   * Create 5 soldiers for a team at their spawn positions.
   *
   * @param teamPrefix - ID prefix ('p1' or 'p2')
   * @param spawn - Spawn zone rectangle
   * @param isAttacker - Whether this team is attacking
   * @returns Array of 5 initialized soldier states
   */
  private createTeamSoldiers(
    teamPrefix: string,
    spawn: { x: number; z: number; width: number; height: number },
    isAttacker: boolean
  ): ServerSoldierState[] {
    const soldiers: ServerSoldierState[] = [];

    /** Default stat profiles per soldier index (same as client createVariedStats) */
    const profiles = [
      { ACC: 65, REA: 70, SPD: 60, STL: 30, AWR: 50, RCL: 55, CMP: 55, CLT: 40, UTL: 35, TWK: 45 },
      { ACC: 45, REA: 45, SPD: 50, STL: 45, AWR: 55, RCL: 45, CMP: 50, CLT: 35, UTL: 70, TWK: 65 },
      { ACC: 75, REA: 60, SPD: 35, STL: 40, AWR: 55, RCL: 50, CMP: 60, CLT: 45, UTL: 30, TWK: 40 },
      { ACC: 50, REA: 55, SPD: 55, STL: 75, AWR: 65, RCL: 40, CMP: 50, CLT: 70, UTL: 35, TWK: 25 },
      { ACC: 55, REA: 45, SPD: 40, STL: 50, AWR: 65, RCL: 70, CMP: 70, CLT: 40, UTL: 40, TWK: 55 },
    ];

    for (let i = 0; i < 5; i++) {
      const soldier: ServerSoldierState = {
        index: i,
        soldierId: `${teamPrefix}_soldier_${i}`,
        position: {
          x: spawn.x + spawn.width * 0.2 + (spawn.width * 0.6 * (i / 4)),
          z: spawn.z + spawn.height / 2,
        },
        rotation: isAttacker ? 0 : Math.PI,
        health: 100,
        alive: true,
        currentWeapon: 'PISTOL',
        armor: null,
        helmet: false,
        utility: [],
        defuseKit: false,
        stance: 'DEFENSIVE',
        isMoving: false,
        isInCombat: false,
        currentTarget: null,
        waypoints: [],
        hasBomb: isAttacker && i === 0,
        isPlanting: false,
        isDefusing: false,
        actionProgress: 0,
        stats: profiles[i],
        detectedEnemies: [],
        shotsFired: 0,
        isBlinded: false,
        blindedTimer: 0,
      };
      soldiers.push(soldier);
    }

    return soldiers;
  }

  /**
   * Set the wall data for LOS checks and initialize pathfinding.
   * Called once when the map is loaded.
   *
   * @param walls - Array of wall rectangles
   * @param mapWidth - Map width in game units (default 3000)
   * @param mapHeight - Map height in game units (default 2000)
   */
  setWalls(
    walls: Array<{ x: number; z: number; width: number; height: number }>,
    mapWidth: number = 3000,
    mapHeight: number = 2000
  ): void {
    this.walls = walls;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    /**
     * Create the A* pathfinding system from the wall data.
     * This generates a navigation grid (60x40 for a 3000x2000 map with 50px cells).
     */
    this.pathfinder = new ServerPathfinding(mapWidth, mapHeight, walls);
  }

  // --------------------------------------------------------------------------
  // Command Queue
  // --------------------------------------------------------------------------

  /**
   * Queue a command from a player. The command will be executed after
   * a radio delay (0.3-0.8 seconds).
   *
   * @param playerNumber - Which player sent the command (1 or 2)
   * @param type - Command type (MOVE, RUSH, HOLD, etc.)
   * @param soldierIndex - Target soldier index (0-4)
   * @param targetPosition - Target position for movement commands
   * @param utilityType - Utility type for USE_UTILITY commands
   */
  queueCommand(
    playerNumber: 1 | 2,
    type: string,
    soldierIndex: number,
    targetPosition?: Position,
    utilityType?: string
  ): void {
    /** Calculate radio delay: random between 0.3 and 0.8 seconds */
    const delay = MIN_COMMAND_DELAY + this.rng.next() * (MAX_COMMAND_DELAY - MIN_COMMAND_DELAY);

    this.commandQueue.push({
      playerNumber,
      type,
      soldierIndex,
      targetPosition,
      utilityType,
      executeAt: this.gameTime + delay,
    });
  }

  // --------------------------------------------------------------------------
  // Simulation Tick
  // --------------------------------------------------------------------------

  /**
   * Run one simulation tick. This is the main entry point called by GameRoom
   * at TICK_RATE_MS intervals during LIVE_PHASE and POST_PLANT.
   *
   * @returns TickResult containing events and round-end status
   */
  runTick(): TickResult {
    this.tick++;
    this.gameTime += TICK_RATE_MS / 1000;

    /** Accumulates events generated during this tick */
    this.tickEvents = [];
    const kills: KillRecord[] = [];

    /* Step 1: Process commands that have passed their delay */
    this.processCommands();

    /* Step 2: Update movement */
    this.updateMovement();

    /* Step 3: Update detection */
    this.updateDetection();

    /* Step 4: Resolve combat (generates SHOT_FIRED, HIT, KILL events) */
    const combatKills = this.updateCombat();
    kills.push(...combatKills);
    this.roundKills.push(...combatKills);

    /* Step 5: Update blind timers (flash grenade effect) */
    this.updateBlindTimers();

    /* Step 6: Update bomb actions (may generate BOMB_PLANTED, BOMB_DEFUSED, BOMB_EXPLODED) */
    this.updateBombActions();

    /* Step 7: Check round-end conditions */
    const roundEnd = this.checkRoundEnd();

    return {
      events: this.tickEvents,
      roundEnded: roundEnd.ended,
      winningSide: roundEnd.winner,
      kills,
    };
  }

  // --------------------------------------------------------------------------
  // Sim Step 1: Process Commands
  // --------------------------------------------------------------------------

  /**
   * Process all commands in the queue that have passed their delay period.
   * Removes executed commands from the queue.
   */
  private processCommands(): void {
    const readyCommands: QueuedCommand[] = [];
    const remaining: QueuedCommand[] = [];

    for (const cmd of this.commandQueue) {
      if (cmd.executeAt <= this.gameTime) {
        readyCommands.push(cmd);
      } else {
        remaining.push(cmd);
      }
    }
    this.commandQueue = remaining;

    for (const cmd of readyCommands) {
      this.executeCommand(cmd);
    }
  }

  /**
   * Execute a single command. Updates the target soldier's state.
   * Uses A* pathfinding for movement commands to navigate around walls.
   */
  private executeCommand(cmd: QueuedCommand): void {
    const soldiers = cmd.playerNumber === 1 ? this.player1Soldiers : this.player2Soldiers;
    const soldier = soldiers[cmd.soldierIndex];
    if (!soldier || !soldier.alive) return;

    switch (cmd.type) {
      case 'MOVE':
      case 'RUSH':
        if (cmd.targetPosition) {
          /**
           * Use A* pathfinding to find a wall-aware path from the soldier's
           * current position to the target. Falls back to direct movement
           * if pathfinding is unavailable or returns no path.
           */
          if (this.pathfinder) {
            const path = this.pathfinder.findPath(soldier.position, cmd.targetPosition);
            if (path.length > 1) {
              /* Skip the first waypoint (it's the current position) */
              soldier.waypoints = path.slice(1);
            } else {
              /* No valid path found — try direct movement as fallback */
              soldier.waypoints = [{ ...cmd.targetPosition }];
            }
          } else {
            /* Pathfinder not initialized — direct movement */
            soldier.waypoints = [{ ...cmd.targetPosition }];
          }
        }
        break;

      case 'HOLD':
        soldier.waypoints = [];
        soldier.isMoving = false;
        break;

      case 'RETREAT':
        soldier.waypoints = [];
        soldier.isMoving = false;
        break;

      case 'PLANT_BOMB':
        if (soldier.hasBomb && !this.bombPlanted) {
          soldier.isPlanting = true;
          soldier.actionProgress = 0;
          soldier.waypoints = [];
          soldier.isMoving = false;
        }
        break;

      case 'DEFUSE_BOMB':
        if (this.bombPlanted && !this.bombDefused) {
          soldier.isDefusing = true;
          soldier.actionProgress = 0;
          soldier.waypoints = [];
          soldier.isMoving = false;
        }
        break;

      case 'REGROUP': {
        /**
         * Find the nearest alive ally and move toward them.
         * Useful for consolidating forces before a push.
         */
        let nearestAlly: Position | null = null;
        let nearestDist = Infinity;
        for (const ally of soldiers) {
          if (ally.soldierId === soldier.soldierId || !ally.alive) continue;
          const d = this.distance(soldier.position, ally.position);
          if (d < nearestDist) {
            nearestDist = d;
            nearestAlly = { ...ally.position };
          }
        }
        if (nearestAlly) {
          if (this.pathfinder) {
            const path = this.pathfinder.findPath(soldier.position, nearestAlly);
            if (path.length > 1) {
              soldier.waypoints = path.slice(1);
            } else {
              soldier.waypoints = [nearestAlly];
            }
          } else {
            soldier.waypoints = [nearestAlly];
          }
        }
        break;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Sim Step 2: Movement
  // --------------------------------------------------------------------------

  /**
   * Update soldier positions based on their waypoints and SPD stat.
   * Uses calculateMovementSpeed() from StatFormulas.
   */
  private updateMovement(): void {
    const allSoldiers = [...this.player1Soldiers, ...this.player2Soldiers];
    const dt = TICK_RATE_MS / 1000;

    for (const soldier of allSoldiers) {
      if (!soldier.alive || soldier.waypoints.length === 0) {
        soldier.isMoving = false;
        continue;
      }

      const target = soldier.waypoints[0];
      const dx = target.x - soldier.position.x;
      const dz = target.z - soldier.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      /** Calculate speed from SPD stat, weapon weight, and armor */
      const weaponStats = WEAPONS[soldier.currentWeapon as keyof typeof WEAPONS];
      const weaponSpeedMod = weaponStats ? weaponStats.speedModifier : 0.95;
      const armorPenalty = soldier.armor ? 0.95 : 1.0;
      let speed = calculateMovementSpeed(soldier.stats.SPD, weaponSpeedMod, armorPenalty);

      /* Soldiers in combat move at 50% speed (suppression) */
      if (soldier.isInCombat) speed *= 0.5;

      const ARRIVAL_DIST = 5;

      if (dist < ARRIVAL_DIST) {
        soldier.position.x = target.x;
        soldier.position.z = target.z;
        soldier.waypoints.shift();
        soldier.isMoving = soldier.waypoints.length > 0;
      } else {
        const moveAmount = speed * dt;
        const ratio = Math.min(moveAmount / dist, 1);
        soldier.position.x += dx * ratio;
        soldier.position.z += dz * ratio;
        soldier.rotation = Math.atan2(dz, dx);
        soldier.isMoving = true;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Sim Step 3: Detection
  // --------------------------------------------------------------------------

  /**
   * Run detection for all alive soldiers.
   * Simplified server-side detection: uses distance + angle + LOS check.
   */
  private updateDetection(): void {
    this.detectEnemiesForTeam(this.player1Soldiers, this.player2Soldiers);
    this.detectEnemiesForTeam(this.player2Soldiers, this.player1Soldiers);
  }

  /**
   * Run detection for one team against the enemy team.
   */
  private detectEnemiesForTeam(
    team: ServerSoldierState[],
    enemies: ServerSoldierState[]
  ): void {
    for (const soldier of team) {
      if (!soldier.alive || soldier.isBlinded) {
        soldier.detectedEnemies = [];
        continue;
      }

      const newDetected: string[] = [];
      const detectionRadius = calculateDetectionRadius(soldier.stats.AWR);

      for (const enemy of enemies) {
        if (!enemy.alive) continue;

        const dx = enemy.position.x - soldier.position.x;
        const dz = enemy.position.z - soldier.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        /** Apply stealth modifier to detection radius */
        const stealthMod = calculateStealthModifier(enemy.stats.STL);
        const effectiveRadius = detectionRadius * stealthMod;

        if (dist > effectiveRadius) continue;

        /**
         * Check if enemy is within the soldier's vision cone.
         * Forward cone: 120° (±60° from facing direction)
         * Peripheral: additional 30° on each side at 50% detection chance
         */
        const angleToEnemy = Math.atan2(dz, dx);
        let angleDiff = angleToEnemy - soldier.rotation;
        /* Normalize to [-PI, PI] */
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const inForwardCone = Math.abs(angleDiff) < Math.PI / 3; // 60° half-angle
        const inPeripheral = Math.abs(angleDiff) < Math.PI / 2;  // 90° half-angle

        if (!inForwardCone && !inPeripheral) continue;

        /** Peripheral detection has 50% chance per tick */
        if (!inForwardCone && inPeripheral) {
          if (this.rng.next() > 0.5) continue;
        }

        /**
         * Check line of sight against walls.
         * Uses simple ray-rectangle intersection.
         */
        if (!this.hasLineOfSight(soldier.position, enemy.position)) continue;

        /**
         * Probabilistic detection roll.
         * Closer enemies are more likely to be detected.
         * Base chance = 0.8 at 0 distance, scales down to 0.3 at max radius.
         */
        const distRatio = dist / effectiveRadius;
        const detectChance = 0.8 - distRatio * 0.5;
        if (this.rng.next() > detectChance) continue;

        newDetected.push(enemy.soldierId);
      }

      /**
       * Keep previously detected enemies visible if they're still in LOS
       * (prevents flickering from probabilistic detection).
       */
      for (const prevId of soldier.detectedEnemies) {
        if (newDetected.includes(prevId)) continue;
        const prevEnemy = enemies.find(e => e.soldierId === prevId);
        if (!prevEnemy || !prevEnemy.alive) continue;

        if (this.hasLineOfSight(soldier.position, prevEnemy.position)) {
          const dx = prevEnemy.position.x - soldier.position.x;
          const dz = prevEnemy.position.z - soldier.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const stealthMod = calculateStealthModifier(prevEnemy.stats.STL);
          const effectiveRadius = detectionRadius * stealthMod * 1.2;
          if (dist <= effectiveRadius) {
            newDetected.push(prevId);
          }
        }
      }

      soldier.detectedEnemies = newDetected;

      /* Auto-aim toward nearest detected enemy when standing still */
      if (newDetected.length > 0 && !soldier.isMoving) {
        let nearestDist = Infinity;
        let nearestEnemy: ServerSoldierState | null = null;

        for (const enemy of enemies) {
          if (!enemy.alive || !newDetected.includes(enemy.soldierId)) continue;
          const dx = enemy.position.x - soldier.position.x;
          const dz = enemy.position.z - soldier.position.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < nearestDist) {
            nearestDist = d;
            nearestEnemy = enemy;
          }
        }

        if (nearestEnemy) {
          const dx = nearestEnemy.position.x - soldier.position.x;
          const dz = nearestEnemy.position.z - soldier.position.z;
          soldier.rotation = Math.atan2(dz, dx);
        }
      }
    }
  }

  /**
   * Check line of sight between two positions.
   * Returns false if any wall blocks the view.
   */
  private hasLineOfSight(a: Position, b: Position): boolean {
    for (const wall of this.walls) {
      if (this.lineIntersectsRect(a, b, wall)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if a line segment intersects a rectangle.
   * Uses separating axis test.
   */
  private lineIntersectsRect(
    a: Position,
    b: Position,
    rect: { x: number; z: number; width: number; height: number }
  ): boolean {
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.z;
    const bottom = rect.z + rect.height;

    /**
     * Check if the line segment from a to b intersects the rectangle.
     * Uses parametric line clipping (Cohen-Sutherland style).
     */
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dz = b.z - a.z;

    const edges = [
      { p: -dx, q: a.x - left },
      { p: dx, q: right - a.x },
      { p: -dz, q: a.z - top },
      { p: dz, q: bottom - a.z },
    ];

    for (const { p, q } of edges) {
      if (Math.abs(p) < 1e-10) {
        if (q < 0) return false;
      } else {
        const r = q / p;
        if (p < 0) {
          t0 = Math.max(t0, r);
        } else {
          t1 = Math.min(t1, r);
        }
        if (t0 > t1) return false;
      }
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // Sim Step 4: Combat
  // --------------------------------------------------------------------------

  /**
   * Resolve combat between mutually detected soldiers.
   * Returns kill records generated this tick.
   */
  private updateCombat(): KillRecord[] {
    const kills: KillRecord[] = [];
    const resolvedPairs = new Set<string>();

    /** Check P1 soldiers shooting at P2 */
    for (const soldier of this.player1Soldiers) {
      if (!soldier.alive) continue;
      for (const enemyId of soldier.detectedEnemies) {
        const enemy = this.player2Soldiers.find(e => e.soldierId === enemyId);
        if (!enemy || !enemy.alive) continue;

        const pairKey = [soldier.soldierId, enemy.soldierId].sort().join(':');
        if (resolvedPairs.has(pairKey)) continue;
        resolvedPairs.add(pairKey);

        const mutualDetection = enemy.detectedEnemies.includes(soldier.soldierId);
        soldier.isInCombat = true;
        soldier.currentTarget = enemy.soldierId;
        if (mutualDetection) {
          enemy.isInCombat = true;
          enemy.currentTarget = soldier.soldierId;
        }

        /* Resolve shots */
        const killA = this.resolveShot(soldier, enemy, this.player1Soldiers, this.player2Soldiers);
        if (killA) kills.push(killA);

        if (mutualDetection && enemy.alive && soldier.alive) {
          const killB = this.resolveShot(enemy, soldier, this.player2Soldiers, this.player1Soldiers);
          if (killB) kills.push(killB);
        }
      }
    }

    /** Check P2 soldiers for one-sided detection */
    for (const soldier of this.player2Soldiers) {
      if (!soldier.alive) continue;
      for (const enemyId of soldier.detectedEnemies) {
        const enemy = this.player1Soldiers.find(e => e.soldierId === enemyId);
        if (!enemy || !enemy.alive) continue;

        const pairKey = [soldier.soldierId, enemy.soldierId].sort().join(':');
        if (resolvedPairs.has(pairKey)) continue;
        resolvedPairs.add(pairKey);

        soldier.isInCombat = true;
        soldier.currentTarget = enemy.soldierId;

        const kill = this.resolveShot(soldier, enemy, this.player2Soldiers, this.player1Soldiers);
        if (kill) kills.push(kill);
      }
    }

    /* Clear combat status for soldiers with no detected enemies */
    for (const soldier of [...this.player1Soldiers, ...this.player2Soldiers]) {
      if (!soldier.alive) continue;
      if (soldier.detectedEnemies.length === 0) {
        soldier.isInCombat = false;
        soldier.currentTarget = null;
        soldier.shotsFired = 0;
      }
    }

    return kills;
  }

  /**
   * Resolve a single shot from shooter at target.
   * Uses the full stat-driven combat pipeline.
   *
   * @returns KillRecord if the target was killed, null otherwise
   */
  private resolveShot(
    shooter: ServerSoldierState,
    target: ServerSoldierState,
    shooterTeam: ServerSoldierState[],
    targetTeam: ServerSoldierState[]
  ): KillRecord | null {
    if (shooter.isBlinded) return null;

    shooter.shotsFired++;

    /* Calculate hit chance using the full stat pipeline */
    const weaponStats = WEAPONS[shooter.currentWeapon as keyof typeof WEAPONS];
    const weaponAccMod = weaponStats ? weaponStats.accuracyModifier : 0.85;
    const dist = this.distance(shooter.position, target.position);

    let hitChance = calculateFinalHitChance(
      shooter.stats.ACC,
      dist,
      shooter.isMoving,
      weaponAccMod
    );

    /* Spray degradation */
    if (shooter.shotsFired > 1) {
      hitChance = calculateSprayAccuracy(hitChance, shooter.shotsFired, shooter.stats.RCL);
    }

    /* Composure modifier */
    const alliesAlive = shooterTeam.filter(s => s.alive && s.soldierId !== shooter.soldierId).length;
    const enemiesDetected = shooter.detectedEnemies.length;
    hitChance *= calculateComposureModifier(shooter.stats.CMP, shooter.health, enemiesDetected, alliesAlive);

    /* Clutch modifier */
    hitChance *= calculateClutchModifier(shooter.stats.CLT, alliesAlive);

    /* Teamwork modifier */
    const hasAllyNearby = shooterTeam.some(ally => {
      if (ally.soldierId === shooter.soldierId || !ally.alive) return false;
      return this.distance(shooter.position, ally.position) <= TEAMWORK_RANGE;
    });
    hitChance *= calculateTeamworkModifier(shooter.stats.TWK, hasAllyNearby);

    /* Clamp */
    hitChance = Math.max(0.02, Math.min(0.98, hitChance));

    /**
     * Generate SHOT_FIRED event for rendering muzzle flash and sound.
     * This fires even if the shot misses.
     */
    this.tickEvents.push({
      type: 'SHOT_FIRED',
      tick: this.tick,
      data: {
        shooterId: shooter.soldierId,
        weaponId: shooter.currentWeapon,
        originX: shooter.position.x,
        originZ: shooter.position.z,
        directionRad: Math.atan2(
          target.position.z - shooter.position.z,
          target.position.x - shooter.position.x
        ),
      },
    });

    /* Roll hit/miss */
    if (this.rng.next() >= hitChance) return null;

    /* Determine hit location */
    const headshotChance = calculateHeadshotChance(shooter.stats.ACC);
    const effectiveHsChance = shooter.shotsFired > 1 ? headshotChance * 0.7 : headshotChance;
    const locationRoll = this.rng.next();
    let hitLocation: 'head' | 'body' | 'legs';
    if (locationRoll < effectiveHsChance) {
      hitLocation = 'head';
    } else if (locationRoll < effectiveHsChance + (1 - effectiveHsChance) * 0.8) {
      hitLocation = 'body';
    } else {
      hitLocation = 'legs';
    }

    /* Calculate damage */
    let armorBodyReduction = 0;
    let armorLegReduction = 0;
    if (target.armor === 'HEAVY_ARMOR') {
      armorBodyReduction = 0.50;
      armorLegReduction = 0.15;
    } else if (target.armor === 'LIGHT_VEST') {
      armorBodyReduction = 0.30;
    }

    const isAwp = shooter.currentWeapon === 'AWP';
    const damage = calculateDamage(
      weaponStats ? weaponStats.bodyDamage : 25,
      weaponStats ? weaponStats.headshotMultiplier : 2.5,
      hitLocation,
      armorBodyReduction,
      armorLegReduction,
      target.helmet,
      isAwp
    );

    /* Apply damage */
    target.health -= damage;

    /** Generate HIT event for rendering hit markers */
    this.tickEvents.push({
      type: 'HIT',
      tick: this.tick,
      data: {
        shooterId: shooter.soldierId,
        victimId: target.soldierId,
        damage,
        hitLocation,
        isHeadshot: hitLocation === 'head',
      },
    });

    /* Interrupt plant/defuse on hit */
    if (target.isPlanting || target.isDefusing) {
      target.isPlanting = false;
      target.isDefusing = false;
      target.actionProgress = 0;
    }

    /* Check for kill */
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      target.isMoving = false;
      target.isInCombat = false;
      target.currentTarget = null;
      target.waypoints = [];
      target.detectedEnemies = [];

      /** Generate KILL event for kill feed */
      this.tickEvents.push({
        type: 'KILL',
        tick: this.tick,
        data: {
          killerId: shooter.soldierId,
          victimId: target.soldierId,
          weaponId: shooter.currentWeapon,
          headshot: hitLocation === 'head',
        },
      });

      return {
        killerId: shooter.soldierId,
        victimId: target.soldierId,
        weapon: shooter.currentWeapon,
        headshot: hitLocation === 'head',
        tick: this.tick,
      };
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Sim Step 5: Blind Timers
  // --------------------------------------------------------------------------

  /**
   * Decrement blind timers for all soldiers.
   * When the timer reaches 0, the soldier is no longer blinded.
   */
  private updateBlindTimers(): void {
    const dt = TICK_RATE_MS / 1000;
    for (const soldier of [...this.player1Soldiers, ...this.player2Soldiers]) {
      if (soldier.isBlinded) {
        soldier.blindedTimer -= dt;
        if (soldier.blindedTimer <= 0) {
          soldier.isBlinded = false;
          soldier.blindedTimer = 0;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Sim Step 6: Bomb Actions
  // --------------------------------------------------------------------------

  /**
   * Update bomb plant/defuse progress.
   */
  private updateBombActions(): void {
    const dt = TICK_RATE_MS / 1000;

    for (const soldier of [...this.player1Soldiers, ...this.player2Soldiers]) {
      if (!soldier.alive) continue;

      /* Update planting progress */
      if (soldier.isPlanting) {
        soldier.actionProgress += dt;
        if (soldier.actionProgress >= (TIMING?.plantSeconds ?? 3)) {
          soldier.isPlanting = false;
          soldier.actionProgress = 0;
          soldier.hasBomb = false;
          this.bombPlanted = true;
          this.bombPosition = { ...soldier.position };

          /**
           * Determine which bomb site based on soldier position.
           * Site A is in the upper half (z < 1000), Site B in the lower half.
           */
          this.bombSite = soldier.position.z < 1000 ? 'A' : 'B';
          this.bombTimer = TIMING?.postPlantSeconds ?? 40;

          /** Generate BOMB_PLANTED event */
          this.tickEvents.push({
            type: 'BOMB_PLANTED',
            tick: this.tick,
            data: {
              planterId: soldier.soldierId,
              siteId: this.bombSite,
              x: soldier.position.x,
              z: soldier.position.z,
            },
          });
        }
      }

      /* Update defusing progress */
      if (soldier.isDefusing) {
        const defuseTime = soldier.defuseKit
          ? (TIMING?.defuseWithKitSeconds ?? 3)
          : (TIMING?.defuseSeconds ?? 5);
        soldier.actionProgress += dt;
        if (soldier.actionProgress >= defuseTime) {
          soldier.isDefusing = false;
          soldier.actionProgress = 0;
          this.bombDefused = true;

          /** Generate BOMB_DEFUSED event */
          this.tickEvents.push({
            type: 'BOMB_DEFUSED',
            tick: this.tick,
            data: {
              defuserId: soldier.soldierId,
              hadKit: soldier.defuseKit,
            },
          });
        }
      }
    }

    /* Tick bomb timer when planted */
    if (this.bombPlanted && !this.bombDefused) {
      this.bombTimer -= dt;

      /* Bomb exploded — generate event */
      if (this.bombTimer <= 0) {
        this.tickEvents.push({
          type: 'BOMB_EXPLODED',
          tick: this.tick,
          data: {
            x: this.bombPosition?.x ?? 0,
            z: this.bombPosition?.z ?? 0,
          },
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Sim Step 7: Round End Check
  // --------------------------------------------------------------------------

  /**
   * Check for round-end conditions.
   *
   * @returns Whether the round ended and which side won
   */
  private checkRoundEnd(): { ended: boolean; winner: 'ATTACKER' | 'DEFENDER' | null } {
    /* Bomb defused → defenders win */
    if (this.bombDefused) {
      return { ended: true, winner: 'DEFENDER' };
    }

    /* Bomb detonated → attackers win */
    if (this.bombPlanted && this.bombTimer <= 0) {
      return { ended: true, winner: 'ATTACKER' };
    }

    /* All attackers dead → defenders win */
    const p1IsAttacker = this.player1Side === 'ATTACKER';
    const attackerSoldiers = p1IsAttacker ? this.player1Soldiers : this.player2Soldiers;
    const defenderSoldiers = p1IsAttacker ? this.player2Soldiers : this.player1Soldiers;

    const attackersAlive = attackerSoldiers.filter(s => s.alive).length;
    const defendersAlive = defenderSoldiers.filter(s => s.alive).length;

    if (attackersAlive === 0 && !this.bombPlanted) {
      return { ended: true, winner: 'DEFENDER' };
    }

    /* All defenders dead → attackers win */
    if (defendersAlive === 0) {
      return { ended: true, winner: 'ATTACKER' };
    }

    return { ended: false, winner: null };
  }

  // --------------------------------------------------------------------------
  // Fog-of-War Filtered State
  // --------------------------------------------------------------------------

  /**
   * Get the fog-of-war filtered game state for a specific player.
   * Players can only see their own soldiers and enemies that are detected.
   *
   * @param playerNumber - Which player's view to generate (1 or 2)
   * @returns FilteredGameState with own soldiers and visible enemies
   */
  getFilteredState(playerNumber: 1 | 2): FilteredGameState {
    const ownSoldiers = playerNumber === 1 ? this.player1Soldiers : this.player2Soldiers;
    const enemySoldiers = playerNumber === 1 ? this.player2Soldiers : this.player1Soldiers;

    /**
     * Collect all enemy soldier IDs that any friendly soldier detects.
     * Union of all detectedEnemies arrays from the team.
     */
    const visibleEnemyIds = new Set<string>();
    for (const soldier of ownSoldiers) {
      if (!soldier.alive) continue;
      for (const id of soldier.detectedEnemies) {
        visibleEnemyIds.add(id);
      }
    }

    /**
     * Filter enemy soldiers: only include those that are visible.
     * For visible enemies, include position, health, weapon, and movement.
     * Do NOT reveal stats, utility, or internal state.
     */
    const visibleEnemies: Partial<ServerSoldierState>[] = [];
    for (const enemy of enemySoldiers) {
      if (!visibleEnemyIds.has(enemy.soldierId)) continue;

      visibleEnemies.push({
        index: enemy.index,
        soldierId: enemy.soldierId,
        position: { ...enemy.position },
        rotation: enemy.rotation,
        health: enemy.health,
        alive: enemy.alive,
        currentWeapon: enemy.currentWeapon,
        isMoving: enemy.isMoving,
        isInCombat: enemy.isInCombat,
        isPlanting: enemy.isPlanting,
        isDefusing: enemy.isDefusing,
      });
    }

    return {
      ownSoldiers: ownSoldiers.map(s => ({ ...s, position: { ...s.position } })),
      visibleEnemies,
      bombPlanted: this.bombPlanted,
      bombPosition: this.bombPosition ? { ...this.bombPosition } : null,
      bombSite: this.bombSite,
      bombTimer: this.bombTimer,
      tick: this.tick,
    };
  }

  // --------------------------------------------------------------------------
  // Utility Helpers
  // --------------------------------------------------------------------------

  /** Calculate distance between two positions. */
  private distance(a: Position, b: Position): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Get the current kill records for the round. */
  getRoundKills(): KillRecord[] {
    return [...this.roundKills];
  }

  /** Get the current tick number. */
  getTick(): number {
    return this.tick;
  }
}
