/**
 * @file BotAI.ts
 * @description Basic AI opponent that controls player 2's soldiers.
 *
 * The AI provides a simple but functional opponent for single-player testing.
 * It runs once per simulation tick and directly sets waypoints/state on its
 * soldiers (no command delay — the AI IS the commander giving orders).
 *
 * DESIGN:
 * - Each soldier has a BotSoldierState tracking their current objective
 * - Attackers: Pick a bomb site, advance through a staging point, plant bomb
 * - Defenders: Split across sites, hold key angles, rotate on contact
 * - Both: Stop and engage when enemies are detected, take cover if able
 *
 * The AI uses the same MovementSystem (A* pathfinding) as the player,
 * ensuring soldiers navigate around walls correctly.
 *
 * INTENTIONAL LIMITATIONS (this is "Basic AI"):
 * - No utility usage (smokes, flashes)
 * - No fake rotations or advanced mind-games
 * - No economy management (buys are handled separately)
 * - Limited to preset positioning and simple reactive behavior
 */

import { MovementSystem } from '../simulation/Movement';
import {
  GamePhase,
  Side,
  type GameState,
  type SoldierRuntimeState,
  type Position,
} from './GameState';
import { distance as vecDistance } from '@shared/util/MathUtils';

// ============================================================================
// --- Bot Soldier State Machine ---
// ============================================================================

/**
 * Possible states for an individual bot-controlled soldier.
 * These drive the decision-making for each soldier independently.
 */
export enum BotSoldierPhase {
  /** Waiting at spawn — not yet given an objective */
  IDLE = 'IDLE',
  /** Moving toward an assigned staging point or objective */
  MOVING_TO_OBJECTIVE = 'MOVING_TO_OBJECTIVE',
  /** Arrived at objective, holding an angle and watching for enemies */
  HOLDING_POSITION = 'HOLDING_POSITION',
  /** Detected an enemy, stopping to engage in combat */
  ENGAGING = 'ENGAGING',
  /** (Attacker only) Moving to bomb plant zone */
  MOVING_TO_PLANT = 'MOVING_TO_PLANT',
  /** (Defender only) Rotating to help a teammate who called contact */
  ROTATING = 'ROTATING',
}

/**
 * Per-soldier state tracked by the AI system.
 * This sits alongside the SoldierRuntimeState and tracks AI-specific data.
 */
export interface BotSoldierState {
  /** Current AI phase for this soldier */
  phase: BotSoldierPhase;
  /** Assigned target position (objective, staging point, etc.) */
  targetPosition: Position | null;
  /** Which bomb site this soldier is assigned to ('A' or 'B') */
  assignedSite: string;
  /** How long the soldier has been holding position (in ticks) */
  holdTicks: number;
  /** Whether this soldier has been given initial orders this round */
  initialized: boolean;
  /** Tick when the soldier last changed phase (prevents rapid flipping) */
  lastPhaseChangeTick: number;
}

// ============================================================================
// --- Preset Positions ---
// ============================================================================

/**
 * Strategic positions on the Bazaar map for AI decision-making.
 * All coordinates are hand-placed based on the map layout.
 *
 * MAP LAYOUT REMINDER:
 *   T Spawn (left, x:100-400)  |  CT Spawn (right, x:2550-2850)
 *   A Site (top-right, x:1600-2200, z:100-500)
 *   B Site (bottom-right, x:1600-2200, z:1500-1900)
 *   Mid corridor (center, z:700-1300)
 */
const MAP_POSITIONS = {
  /** Attacker staging points — positions where T soldiers group before pushing */
  attackerStaging: {
    /** A Long staging — near A Long Doors chokepoint */
    aLong: { x: 700, z: 300 },
    /** A Short staging — approach A site from mid connector */
    aShort: { x: 1400, z: 400 },
    /** Mid staging — outside mid doors */
    mid: { x: 1200, z: 1000 },
    /** B Tunnels staging — inside B tunnels before site */
    bTunnels: { x: 1000, z: 1700 },
    /** B Short staging — approach B site from tunnels exit */
    bShort: { x: 1500, z: 1650 },
  },

  /** Defender hold positions — angles defenders watch from */
  defenderHold: {
    /** A Site — watching A Long from inside the site */
    aSiteDefault: { x: 2000, z: 300 },
    /** A Long — holding the long angle from CT side */
    aLong: { x: 1700, z: 250 },
    /** A Short — watching the A Short connector */
    aShort: { x: 1900, z: 450 },
    /** Mid window — watching mid corridor from elevated position */
    midWindow: { x: 1850, z: 820 },
    /** B Site — watching B entrance from inside site */
    bSiteDefault: { x: 1950, z: 1650 },
    /** B entrance — holding the B tunnel exit */
    bEntrance: { x: 1700, z: 1600 },
    /** CT connector — middle position between sites */
    ctConnector: { x: 2350, z: 1000 },
  },

  /** Bomb plant positions — centers of plant zones */
  plantZones: {
    A: { x: 1950, z: 325 },
    B: { x: 1950, z: 1675 },
  },
};

/**
 * Default attacker plan: assigns each soldier to a staging point.
 * Index 0-1: Push A site through A Long
 * Index 2: Mid control
 * Index 3-4: Push B site through B Tunnels
 *
 * The 3-2 split (or 2-1-2) is a common default strategy.
 */
const ATTACKER_DEFAULT_PLAN: { staging: Position; site: string }[] = [
  { staging: MAP_POSITIONS.attackerStaging.aLong, site: 'A' },
  { staging: MAP_POSITIONS.attackerStaging.aShort, site: 'A' },
  { staging: MAP_POSITIONS.attackerStaging.mid, site: 'MID' },
  { staging: MAP_POSITIONS.attackerStaging.bTunnels, site: 'B' },
  { staging: MAP_POSITIONS.attackerStaging.bShort, site: 'B' },
];

/**
 * Default defender setup: assigns each soldier to a hold position.
 * Index 0-1: Hold A site from two angles
 * Index 2: Hold mid corridor
 * Index 3-4: Hold B site from two angles
 *
 * Classic 2-1-2 defensive setup.
 */
const DEFENDER_DEFAULT_PLAN: { hold: Position; site: string }[] = [
  { hold: MAP_POSITIONS.defenderHold.aSiteDefault, site: 'A' },
  { hold: MAP_POSITIONS.defenderHold.aLong, site: 'A' },
  { hold: MAP_POSITIONS.defenderHold.midWindow, site: 'MID' },
  { hold: MAP_POSITIONS.defenderHold.bSiteDefault, site: 'B' },
  { hold: MAP_POSITIONS.defenderHold.bEntrance, site: 'B' },
];

// ============================================================================
// --- Tuning Constants ---
// ============================================================================

/**
 * Minimum ticks between AI phase changes for a single soldier.
 * Prevents the AI from rapidly flipping between ENGAGING and MOVING.
 */
const MIN_PHASE_CHANGE_INTERVAL = 3;

/**
 * Distance threshold for "arrived at objective" (in game units).
 * When a soldier is within this distance of their target, they transition
 * to HOLDING_POSITION.
 */
const ARRIVAL_DISTANCE = 80;

/**
 * Maximum ticks a soldier will hold position before repositioning.
 * Prevents soldiers from standing still forever if no enemies appear.
 * At 5 ticks/sec, 50 ticks = 10 seconds.
 */
const MAX_HOLD_TICKS = 50;

/**
 * Distance at which a rotating defender will stop and hold.
 * Prevents defenders from running all the way to a teammate's exact position.
 */
const ROTATION_STOP_DISTANCE = 200;

/**
 * After how many ticks of engagement with no target, return to objective.
 * At 5 ticks/sec, 5 ticks = 1 second of no enemies before moving again.
 */
const DISENGAGE_TICKS = 5;

// ============================================================================
// --- BotAI Class ---
// ============================================================================

/**
 * Controls player 2's soldiers with basic tactical AI.
 *
 * Usage:
 *   - Created once when the match starts (in Game.ts)
 *   - `initializeRound()` called at the start of each round
 *   - `update()` called once per simulation tick during LIVE_PHASE
 *
 * The AI does NOT go through the CommandSystem (no radio delay).
 * Instead it directly sets waypoints on the soldiers, which the
 * movement system then executes using A* pathfinding.
 */
export class BotAI {
  /** A* pathfinding system — same instance used by the player */
  private movementSystem: MovementSystem;

  /** Per-soldier AI state, indexed by soldier index (0-4) */
  private soldierStates: BotSoldierState[];

  /** Which side the bot is playing (ATTACKER or DEFENDER) */
  private botSide: Side;

  /** Ticks since the last enemy was detected by any bot soldier */
  private ticksSinceLastContact: number = 0;

  /** Current simulation tick (passed in from Game.ts) */
  private currentTick: number = 0;

  /**
   * Create a new BotAI instance.
   *
   * @param movementSystem - The A* pathfinding system for the map
   */
  constructor(movementSystem: MovementSystem) {
    this.movementSystem = movementSystem;
    this.botSide = Side.DEFENDER;
    this.soldierStates = [];
  }

  // --------------------------------------------------------------------------
  // Round Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Initialize the AI for a new round.
   * Resets all per-soldier state and assigns default objectives
   * based on which side the bot is playing.
   *
   * @param botSide - Which side the bot is playing this round
   */
  initializeRound(botSide: Side): void {
    this.botSide = botSide;
    this.ticksSinceLastContact = 0;
    this.currentTick = 0;

    /* Create fresh state for each of the 5 soldiers */
    this.soldierStates = [];
    for (let i = 0; i < 5; i++) {
      const plan = botSide === Side.ATTACKER
        ? ATTACKER_DEFAULT_PLAN[i]
        : DEFENDER_DEFAULT_PLAN[i];

      this.soldierStates.push({
        phase: BotSoldierPhase.IDLE,
        targetPosition: null,
        assignedSite: plan.site,
        holdTicks: 0,
        initialized: false,
        lastPhaseChangeTick: 0,
      });
    }

    console.log(`[BotAI] Round initialized — playing as ${botSide}`);
  }

  // --------------------------------------------------------------------------
  // Main Update Loop (called once per simulation tick)
  // --------------------------------------------------------------------------

  /**
   * Run one tick of AI decision-making for all bot soldiers.
   *
   * Decision priority per soldier:
   *   1. If dead → skip
   *   2. If enemies detected → ENGAGING (stop and fight)
   *   3. If not initialized → assign first objective
   *   4. If at objective → HOLDING_POSITION (watch for enemies)
   *   5. If holding too long → reposition
   *   6. If teammate has contact → consider rotating
   *
   * @param state - Current game state (full access to both teams)
   * @param botSoldiers - Array of the bot's soldiers (direct reference)
   * @param enemySoldiers - Array of enemy soldiers (for checking contact)
   * @param tick - Current simulation tick number
   */
  update(
    state: GameState,
    botSoldiers: SoldierRuntimeState[],
    enemySoldiers: SoldierRuntimeState[],
    tick: number
  ): void {
    this.currentTick = tick;

    /* Track whether any bot soldier has contact (for rotation decisions) */
    let anyContact = false;
    let contactPosition: Position | null = null;

    for (let i = 0; i < botSoldiers.length; i++) {
      const soldier = botSoldiers[i];
      if (!soldier.alive) continue;

      if (soldier.detectedEnemies.length > 0) {
        anyContact = true;
        /* Use the soldier's position as the contact location */
        contactPosition = { ...soldier.position };
      }
    }

    /* Update global contact tracking */
    if (anyContact) {
      this.ticksSinceLastContact = 0;
    } else {
      this.ticksSinceLastContact++;
    }

    /* Run decision-making for each alive soldier */
    for (let i = 0; i < botSoldiers.length; i++) {
      const soldier = botSoldiers[i];
      const aiState = this.soldierStates[i];

      /* Skip dead soldiers */
      if (!soldier.alive) continue;

      /* Step 1: Check for enemy contact — highest priority */
      if (soldier.detectedEnemies.length > 0) {
        this.handleEngagement(soldier, aiState, enemySoldiers);
        continue;
      }

      /* Step 2: If was engaging but enemies gone, wait a bit before resuming */
      if (aiState.phase === BotSoldierPhase.ENGAGING) {
        aiState.holdTicks++;
        if (aiState.holdTicks >= DISENGAGE_TICKS) {
          /* No enemies for a while, return to objective */
          this.changePhase(aiState, BotSoldierPhase.IDLE);
          aiState.holdTicks = 0;
        }
        continue;
      }

      /* Step 3: First-time initialization — send to assigned position */
      if (!aiState.initialized) {
        this.assignInitialObjective(soldier, aiState, i);
        continue;
      }

      /* Step 4: Check if arrived at objective */
      if (aiState.phase === BotSoldierPhase.MOVING_TO_OBJECTIVE ||
          aiState.phase === BotSoldierPhase.ROTATING ||
          aiState.phase === BotSoldierPhase.MOVING_TO_PLANT) {
        if (aiState.targetPosition) {
          const dist = vecDistance(soldier.position, aiState.targetPosition);
          if (dist < ARRIVAL_DISTANCE || soldier.waypoints.length === 0) {
            /* Arrived — switch to holding position */
            this.changePhase(aiState, BotSoldierPhase.HOLDING_POSITION);
            soldier.waypoints = [];
            soldier.isMoving = false;
            aiState.holdTicks = 0;
          }
        }
      }

      /* Step 5: While holding, count ticks and consider repositioning */
      if (aiState.phase === BotSoldierPhase.HOLDING_POSITION) {
        aiState.holdTicks++;

        /* Face toward the most likely threat direction */
        this.faceTowardThreat(soldier, i);

        /* If holding too long, pick a new nearby position to shuffle to */
        if (aiState.holdTicks >= MAX_HOLD_TICKS) {
          this.repositionNearby(soldier, aiState);
        }
      }

      /* Step 6: Consider rotation if a teammate has contact and we're idle/holding */
      if (contactPosition &&
          (aiState.phase === BotSoldierPhase.HOLDING_POSITION ||
           aiState.phase === BotSoldierPhase.IDLE)) {
        /**
         * Only rotate if the contact is far from our position.
         * Don't rotate if we're already close to the action.
         */
        const distToContact = vecDistance(soldier.position, contactPosition);
        if (distToContact > ROTATION_STOP_DISTANCE * 2) {
          /* Only rotate some soldiers — keep at least 1-2 on site */
          const shouldRotate = this.shouldRotate(i, aiState);
          if (shouldRotate) {
            this.rotateToward(soldier, aiState, contactPosition);
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Decision Handlers
  // --------------------------------------------------------------------------

  /**
   * Assign the initial objective to a soldier at round start.
   * Uses the preset plans (attacker staging or defender hold positions).
   *
   * @param soldier - The bot soldier to assign
   * @param aiState - The AI state for this soldier
   * @param index - Soldier index (0-4), used to look up the plan
   */
  private assignInitialObjective(
    soldier: SoldierRuntimeState,
    aiState: BotSoldierState,
    index: number
  ): void {
    let targetPos: Position;

    if (this.botSide === Side.ATTACKER) {
      /* Attackers move to their staging positions first */
      targetPos = { ...ATTACKER_DEFAULT_PLAN[index].staging };
    } else {
      /* Defenders move directly to their hold positions */
      targetPos = { ...DEFENDER_DEFAULT_PLAN[index].hold };
    }

    /* Set waypoints using A* pathfinding */
    this.pathfindTo(soldier, targetPos);
    aiState.targetPosition = targetPos;
    aiState.initialized = true;
    this.changePhase(aiState, BotSoldierPhase.MOVING_TO_OBJECTIVE);
  }

  /**
   * Handle a soldier who has detected enemies.
   * Stops the soldier and marks them as engaging.
   * The actual shooting is handled by the combat system in Game.ts.
   *
   * @param soldier - The bot soldier who detected enemies
   * @param aiState - The AI state for this soldier
   * @param enemies - Array of all enemy soldiers (for position lookup)
   */
  private handleEngagement(
    soldier: SoldierRuntimeState,
    aiState: BotSoldierState,
    enemies: SoldierRuntimeState[]
  ): void {
    /* Only change phase if not already engaging (prevent flicker) */
    if (aiState.phase !== BotSoldierPhase.ENGAGING) {
      this.changePhase(aiState, BotSoldierPhase.ENGAGING);
    }

    /* Stop moving — hold position and fight */
    soldier.waypoints = [];
    soldier.isMoving = false;
    aiState.holdTicks = 0;

    /**
     * Face the nearest detected enemy.
     * (The detection system in Game.ts also does this, but we do it here
     * to ensure immediate facing even on the first tick of engagement.)
     */
    let nearestDist = Infinity;
    let nearestPos: Position | null = null;

    for (const enemyId of soldier.detectedEnemies) {
      const enemy = enemies.find(e => e.soldierId === enemyId);
      if (!enemy || !enemy.alive) continue;

      const dist = vecDistance(soldier.position, enemy.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPos = enemy.position;
      }
    }

    if (nearestPos) {
      const dx = nearestPos.x - soldier.position.x;
      const dz = nearestPos.z - soldier.position.z;
      soldier.rotation = Math.atan2(dz, dx);
    }
  }

  /**
   * Face the soldier toward the most likely threat direction.
   * Based on their assigned site and the map layout.
   *
   * @param soldier - The soldier to orient
   * @param index - Soldier index (determines default facing)
   */
  private faceTowardThreat(soldier: SoldierRuntimeState, index: number): void {
    /**
     * Default facing directions:
     * - Defenders face left (toward T spawn, angle = PI)
     * - Attackers face right (toward CT spawn, angle = 0)
     *
     * Specific overrides based on position assignment can be added later.
     */
    if (this.botSide === Side.DEFENDER) {
      /* Defenders generally face toward T side (left, angle = PI) */
      const plan = DEFENDER_DEFAULT_PLAN[index];
      if (plan.site === 'A') {
        /* A site defenders face left-ish (toward A Long approach) */
        soldier.rotation = Math.PI;
      } else if (plan.site === 'B') {
        /* B site defenders face left-ish (toward B Tunnels approach) */
        soldier.rotation = Math.PI;
      } else {
        /* Mid player faces left (toward T mid approach) */
        soldier.rotation = Math.PI;
      }
    } else {
      /* Attackers at staging face right (toward sites) */
      soldier.rotation = 0;
    }
  }

  /**
   * Reposition a soldier to a nearby location after holding too long.
   * Adds a small random offset to prevent soldiers from being completely static.
   *
   * @param soldier - The soldier to reposition
   * @param aiState - The AI state for this soldier
   */
  private repositionNearby(
    soldier: SoldierRuntimeState,
    aiState: BotSoldierState
  ): void {
    /**
     * Pick a random offset within ±100 game units.
     * Using simple math rather than the seeded RNG since this is just
     * cosmetic repositioning, not gameplay-critical.
     */
    const offsetX = (Math.random() - 0.5) * 200;
    const offsetZ = (Math.random() - 0.5) * 200;

    const newTarget: Position = {
      x: Math.max(50, Math.min(2950, soldier.position.x + offsetX)),
      z: Math.max(50, Math.min(1950, soldier.position.z + offsetZ)),
    };

    this.pathfindTo(soldier, newTarget);
    aiState.targetPosition = newTarget;
    aiState.holdTicks = 0;
    this.changePhase(aiState, BotSoldierPhase.MOVING_TO_OBJECTIVE);
  }

  /**
   * Determine whether a soldier should rotate toward a contact.
   * Only some soldiers rotate — at least 1-2 should stay on their assigned site.
   *
   * @param index - Soldier index (0-4)
   * @param aiState - AI state for this soldier
   * @returns True if this soldier should rotate
   */
  private shouldRotate(index: number, aiState: BotSoldierState): boolean {
    /**
     * Rotation rules:
     * - Mid player (index 2) always rotates toward contact
     * - Site players: only one per site rotates (the one with higher index)
     * - Never rotate if we changed phase very recently
     */
    if (this.currentTick - aiState.lastPhaseChangeTick < MIN_PHASE_CHANGE_INTERVAL * 3) {
      return false;
    }

    /* Mid player always rotates */
    if (aiState.assignedSite === 'MID') return true;

    /* For site players, only index 1 (A) and index 4 (B) rotate */
    if (this.botSide === Side.DEFENDER) {
      return index === 1 || index === 4;
    } else {
      return index === 1 || index === 4;
    }
  }

  /**
   * Send a soldier rotating toward a contact position.
   * The soldier doesn't go directly to the enemy — they go to a position
   * that's closer to the contact but still somewhat safe.
   *
   * @param soldier - The soldier to rotate
   * @param aiState - AI state for this soldier
   * @param contactPos - Where the contact was reported
   */
  private rotateToward(
    soldier: SoldierRuntimeState,
    aiState: BotSoldierState,
    contactPos: Position
  ): void {
    /**
     * Move to a point that is ROTATION_STOP_DISTANCE from the contact.
     * This puts the soldier close enough to help but not directly on top.
     */
    const dx = contactPos.x - soldier.position.x;
    const dz = contactPos.z - soldier.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < ROTATION_STOP_DISTANCE) return; /* Already close enough */

    /* Calculate a target that is ROTATION_STOP_DISTANCE away from contact */
    const ratio = (dist - ROTATION_STOP_DISTANCE) / dist;
    const target: Position = {
      x: soldier.position.x + dx * ratio,
      z: soldier.position.z + dz * ratio,
    };

    this.pathfindTo(soldier, target);
    aiState.targetPosition = target;
    this.changePhase(aiState, BotSoldierPhase.ROTATING);
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Use A* pathfinding to set waypoints for a soldier.
   * Falls back to direct movement if no path is found.
   *
   * @param soldier - The soldier to move
   * @param target - The destination position
   */
  private pathfindTo(soldier: SoldierRuntimeState, target: Position): void {
    const rawPath = this.movementSystem.findPath(soldier.position, target);

    if (rawPath.length > 0) {
      /* Smooth the A* path to remove unnecessary zigzag */
      const smoothed = this.movementSystem.smoothPath(rawPath);
      soldier.waypoints = smoothed.map(p => ({ x: p.x, z: p.z }));
    } else {
      /* No path found — try direct movement as fallback */
      soldier.waypoints = [{ ...target }];
    }
  }

  /**
   * Change a soldier's AI phase with cooldown tracking.
   * Records the tick of the change to prevent rapid phase flipping.
   *
   * @param aiState - The AI state to update
   * @param newPhase - The new phase to transition to
   */
  private changePhase(aiState: BotSoldierState, newPhase: BotSoldierPhase): void {
    /* Don't change if not enough time has passed (prevents rapid flipping) */
    if (this.currentTick - aiState.lastPhaseChangeTick < MIN_PHASE_CHANGE_INTERVAL &&
        newPhase !== BotSoldierPhase.ENGAGING) {
      /* Always allow transition to ENGAGING regardless of cooldown */
      return;
    }

    aiState.phase = newPhase;
    aiState.lastPhaseChangeTick = this.currentTick;
  }

  // --------------------------------------------------------------------------
  // Debug / Info
  // --------------------------------------------------------------------------

  /**
   * Get the current AI state for all soldiers (for debugging display).
   * @returns Array of BotSoldierState objects
   */
  getSoldierStates(): BotSoldierState[] {
    return [...this.soldierStates];
  }

  /**
   * Get a human-readable description of the AI's current strategy.
   * Useful for debug overlay or console logging.
   */
  getStrategyDescription(): string {
    const phases = this.soldierStates.map((s, i) =>
      `S${i}: ${s.phase} (${s.assignedSite})`
    );
    return `[BotAI ${this.botSide}] ${phases.join(' | ')}`;
  }
}
