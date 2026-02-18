/**
 * CommandSystem.ts - Handles player commands issued to soldiers
 *
 * The command system sits between player input and soldier execution.
 * When a player clicks to move a soldier, the command doesn't execute instantly -
 * there's a deliberate delay (0.3-0.8s) simulating radio communication.
 * This prevents inhuman micro and adds strategic weight to decisions.
 *
 * Commands are queued per-soldier with a cooldown between commands
 * to the same soldier, preventing spam-clicking.
 */

import type { Position } from './GameState';

// ============================================================
// Command Types
// ============================================================

/** All possible command types a player can issue */
export enum CommandType {
  /** Move soldier to a position (cautious movement) */
  MOVE = 'MOVE',
  /** Rush to a position (fast but less accurate) */
  RUSH = 'RUSH',
  /** Hold current position and face a direction */
  HOLD = 'HOLD',
  /** Retreat toward spawn */
  RETREAT = 'RETREAT',
  /** Throw a utility item at a target location */
  USE_UTILITY = 'USE_UTILITY',
  /** Begin planting the bomb (attacker at bomb site) */
  PLANT_BOMB = 'PLANT_BOMB',
  /** Begin defusing the bomb (defender at planted bomb) */
  DEFUSE_BOMB = 'DEFUSE_BOMB',
  /** All alive soldiers regroup at a position */
  REGROUP = 'REGROUP',
}

/** A command issued by the player to a specific soldier */
export interface Command {
  /** What type of command this is */
  type: CommandType;
  /** Which soldier this command is for (index 0-4 in the team) */
  soldierIndex: number;
  /** Target position for movement commands (optional for non-movement commands) */
  targetPosition?: Position;
  /** Which utility to use (for USE_UTILITY commands) */
  utilityType?: string;
  /** Direction to face (for HOLD commands, in radians) */
  facingDirection?: number;
  /** When this command was issued (game time in seconds) */
  issuedAt: number;
  /** When this command should execute (after delay) */
  executesAt: number;
  /** Whether this command has been executed */
  executed: boolean;
}

// ============================================================
// Command System Class
// ============================================================

/**
 * Manages the command queue for all soldiers on a team.
 *
 * Flow:
 * 1. Player clicks -> issueCommand() adds command with delay
 * 2. Each tick, update() checks for commands ready to execute
 * 3. Ready commands are returned to the game loop for processing
 *
 * Constraints:
 * - Command delay: 0.3-0.8 seconds (randomized per command)
 * - Cooldown: 0.5 seconds between commands to the same soldier
 * - Soldiers in combat have +0.2s extra delay
 */
export class CommandSystem {
  /** Pending commands waiting to execute, per soldier index */
  private pendingCommands: Map<number, Command[]> = new Map();

  /** Timestamp of last command issued to each soldier (for cooldown) */
  private lastCommandTime: Map<number, number> = new Map();

  /** Minimum delay before a command executes (seconds) */
  private readonly MIN_DELAY = 0.3;

  /** Maximum delay before a command executes (seconds) */
  private readonly MAX_DELAY = 0.8;

  /** Extra delay when soldier is in active combat (seconds) */
  private readonly COMBAT_EXTRA_DELAY = 0.2;

  /** Minimum time between commands to the same soldier (seconds) */
  private readonly COOLDOWN = 0.5;

  /**
   * Issue a new command to a soldier.
   *
   * @param type - The command type
   * @param soldierIndex - Which soldier (0-4)
   * @param currentTime - Current game time in seconds
   * @param isInCombat - Whether the soldier is currently in combat
   * @param options - Additional command parameters (targetPosition, utilityType, etc.)
   * @returns true if command was accepted, false if on cooldown
   */
  issueCommand(
    type: CommandType,
    soldierIndex: number,
    currentTime: number,
    isInCombat: boolean,
    options: {
      targetPosition?: Position;
      utilityType?: string;
      facingDirection?: number;
    } = {}
  ): boolean {
    /* Check cooldown - reject if too soon after last command to this soldier */
    const lastTime = this.lastCommandTime.get(soldierIndex) ?? 0;
    if (currentTime - lastTime < this.COOLDOWN) {
      return false; // Still on cooldown
    }

    /* Calculate execution delay: random between MIN and MAX, plus combat penalty */
    const baseDelay = this.MIN_DELAY + Math.random() * (this.MAX_DELAY - this.MIN_DELAY);
    const combatPenalty = isInCombat ? this.COMBAT_EXTRA_DELAY : 0;
    const totalDelay = baseDelay + combatPenalty;

    /* Create the command */
    const command: Command = {
      type,
      soldierIndex,
      targetPosition: options.targetPosition,
      utilityType: options.utilityType,
      facingDirection: options.facingDirection,
      issuedAt: currentTime,
      executesAt: currentTime + totalDelay,
      executed: false,
    };

    /* Movement commands replace any pending movement commands for this soldier.
     * This prevents a queue of 10 move commands stacking up.
     * Non-movement commands (utility, plant, defuse) can still queue. */
    const isMovementCommand = [
      CommandType.MOVE,
      CommandType.RUSH,
      CommandType.HOLD,
      CommandType.RETREAT,
      CommandType.REGROUP,
    ].includes(type);

    if (!this.pendingCommands.has(soldierIndex)) {
      this.pendingCommands.set(soldierIndex, []);
    }

    const queue = this.pendingCommands.get(soldierIndex)!;

    if (isMovementCommand) {
      /* Remove any existing pending movement commands */
      const filtered = queue.filter(
        (cmd) =>
          ![
            CommandType.MOVE,
            CommandType.RUSH,
            CommandType.HOLD,
            CommandType.RETREAT,
            CommandType.REGROUP,
          ].includes(cmd.type)
      );
      this.pendingCommands.set(soldierIndex, [...filtered, command]);
    } else {
      queue.push(command);
    }

    /* Update last command timestamp for cooldown tracking */
    this.lastCommandTime.set(soldierIndex, currentTime);

    return true; // Command accepted
  }

  /**
   * Check for commands that are ready to execute this tick.
   * Called once per game tick.
   *
   * @param currentTime - Current game time in seconds
   * @returns Array of commands ready to execute
   */
  getReadyCommands(currentTime: number): Command[] {
    const ready: Command[] = [];

    for (const [soldierIndex, commands] of this.pendingCommands) {
      /* Find commands whose delay has elapsed */
      const readyCommands = commands.filter(
        (cmd) => !cmd.executed && currentTime >= cmd.executesAt
      );

      /* Mark them as executed so they don't fire again */
      for (const cmd of readyCommands) {
        cmd.executed = true;
        ready.push(cmd);
      }

      /* Clean up executed commands from the queue */
      this.pendingCommands.set(
        soldierIndex,
        commands.filter((cmd) => !cmd.executed)
      );
    }

    return ready;
  }

  /**
   * Get pending (not yet executed) commands for a specific soldier.
   * Useful for showing command indicators in the UI.
   *
   * @param soldierIndex - Which soldier (0-4)
   * @returns Array of pending commands
   */
  getPendingCommands(soldierIndex: number): Command[] {
    return (this.pendingCommands.get(soldierIndex) ?? []).filter(
      (cmd) => !cmd.executed
    );
  }

  /**
   * Check if a soldier is on cooldown (can't receive new commands).
   *
   * @param soldierIndex - Which soldier (0-4)
   * @param currentTime - Current game time
   * @returns true if the soldier can't receive commands yet
   */
  isOnCooldown(soldierIndex: number, currentTime: number): boolean {
    const lastTime = this.lastCommandTime.get(soldierIndex) ?? 0;
    return currentTime - lastTime < this.COOLDOWN;
  }

  /**
   * Get remaining cooldown time for a soldier (for UI display).
   *
   * @param soldierIndex - Which soldier (0-4)
   * @param currentTime - Current game time
   * @returns Seconds remaining on cooldown (0 if ready)
   */
  getCooldownRemaining(soldierIndex: number, currentTime: number): number {
    const lastTime = this.lastCommandTime.get(soldierIndex) ?? 0;
    return Math.max(0, this.COOLDOWN - (currentTime - lastTime));
  }

  /**
   * Clear all pending commands. Called at the start of each round
   * when soldiers are reset to starting positions.
   */
  clearAll(): void {
    this.pendingCommands.clear();
    this.lastCommandTime.clear();
  }

  /**
   * Clear pending commands for a specific soldier.
   * Called when a soldier dies (no point executing commands for dead soldiers).
   *
   * @param soldierIndex - Which soldier (0-4)
   */
  clearForSoldier(soldierIndex: number): void {
    this.pendingCommands.delete(soldierIndex);
  }
}
