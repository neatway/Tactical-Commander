/**
 * @file EconomyManager.ts
 * @description Manages all in-match economy calculations for both players.
 *
 * Handles:
 *   - Round win/loss rewards (with loss streak catch-up)
 *   - Kill rewards by weapon type (from WeaponData killReward field)
 *   - Bomb plant bonus ($300 to attacking team, even on loss)
 *   - Bomb defuse bonus ($300 to defending team)
 *   - Overtime (round 9 tiebreaker) money reset
 *   - Money capping at MAX_MONEY ($16,000)
 *
 * The economy manager does NOT handle purchases — those are done by BuyMenu.ts.
 * It only handles income that comes from round outcomes and kills.
 *
 * Integration:
 *   - Game.ts calls `calculateRoundRewards()` at end of each round
 *   - The returned EconomyUpdate describes all money changes
 *   - Game.ts applies the update to both players' TeamEconomy objects
 */

import {
  STARTING_MONEY,
  MAX_MONEY,
  ROUND_WIN_REWARD,
  LOSS_STREAK_REWARDS,
  BOMB_PLANT_BONUS,
  BOMB_DEFUSE_BONUS,
  OVERTIME_MONEY,
} from '@shared/constants/EconomyConstants';
import { WEAPONS } from '@shared/constants/WeaponData';
import { WeaponId } from '@shared/types/WeaponTypes';
import type { KillRecord, TeamEconomy } from '../game/GameState';
import { Side } from '../game/GameState';

// ============================================================================
// --- Interfaces ---
// ============================================================================

/**
 * Breakdown of money changes for one player in a single round.
 * Used by the round summary screen to display economy details.
 */
export interface PlayerEconomyChange {
  /** Base round reward (win reward or loss streak reward) */
  roundReward: number;
  /** Total kill rewards earned across all soldiers this round */
  killRewards: number;
  /** Per-kill breakdown: weapon used and reward amount */
  killDetails: { weapon: string; reward: number }[];
  /** Bomb objective bonus (plant or defuse, 0 if not applicable) */
  objectiveBonus: number;
  /** Total money earned this round (roundReward + killRewards + objectiveBonus) */
  totalEarned: number;
  /** Money balance after applying earnings (capped at MAX_MONEY) */
  newBalance: number;
  /** New loss streak value (0 if won, incremented if lost) */
  newLossStreak: number;
}

/**
 * Complete economy update for both players after a round ends.
 * Returned by `calculateRoundRewards()`.
 */
export interface EconomyUpdate {
  /** Economy change for player 1 */
  player1: PlayerEconomyChange;
  /** Economy change for player 2 */
  player2: PlayerEconomyChange;
}

// ============================================================================
// --- EconomyManager Class ---
// ============================================================================

/**
 * Calculates and applies all economy rewards at the end of each round.
 *
 * Design philosophy (from the GDD):
 *   - Winners get a flat $3,250
 *   - Losers get escalating rewards based on consecutive losses ($1,400 → $2,900)
 *   - Kill rewards vary by weapon: riskier weapons (SMG, Shotgun) give more
 *   - Bomb plant/defuse give flat $300 bonus to the team that did it
 *   - Money is hard-capped at $16,000
 *
 * @example
 * ```ts
 * const econ = new EconomyManager();
 * const update = econ.calculateRoundRewards(
 *   Side.ATTACKER,   // winner
 *   p1Side,          // player 1's side
 *   p1Economy,       // player 1's current economy
 *   p2Economy,       // player 2's current economy
 *   kills,           // this round's kill records
 *   bombPlanted,     // was bomb planted?
 *   bombDefused      // was bomb defused?
 * );
 * // Apply: p1Economy.money = update.player1.newBalance; etc.
 * ```
 */
export class EconomyManager {

  // --------------------------------------------------------------------------
  // Round Rewards
  // --------------------------------------------------------------------------

  /**
   * Calculate all economy rewards for both players at the end of a round.
   *
   * @param winningSide - Which side won the round (ATTACKER or DEFENDER)
   * @param player1Side - Which side player 1 is playing this half
   * @param p1Economy - Player 1's current economy state
   * @param p2Economy - Player 2's current economy state
   * @param kills - All kills that happened this round
   * @param bombPlanted - Whether the bomb was planted this round
   * @param bombDefused - Whether the bomb was defused this round
   * @returns Economy update for both players
   */
  calculateRoundRewards(
    winningSide: Side,
    player1Side: Side,
    p1Economy: TeamEconomy,
    p2Economy: TeamEconomy,
    kills: KillRecord[],
    bombPlanted: boolean,
    bombDefused: boolean
  ): EconomyUpdate {
    /* Determine which player won */
    const p1Won = player1Side === winningSide;
    const p2Won = !p1Won;

    /* Calculate base round rewards */
    const p1RoundReward = this.getRoundReward(p1Won, p1Economy.lossStreak);
    const p2RoundReward = this.getRoundReward(p2Won, p2Economy.lossStreak);

    /* Calculate kill rewards for each player */
    const p1KillDetails = this.getKillRewards(kills, 'p1');
    const p2KillDetails = this.getKillRewards(kills, 'p2');
    const p1KillTotal = p1KillDetails.reduce((sum, k) => sum + k.reward, 0);
    const p2KillTotal = p2KillDetails.reduce((sum, k) => sum + k.reward, 0);

    /* Calculate objective bonuses */
    const p1ObjectiveBonus = this.getObjectiveBonus(
      player1Side, bombPlanted, bombDefused
    );
    const p2ObjectiveBonus = this.getObjectiveBonus(
      player1Side === Side.ATTACKER ? Side.DEFENDER : Side.ATTACKER,
      bombPlanted, bombDefused
    );

    /* Calculate totals and new balances */
    const p1Total = p1RoundReward + p1KillTotal + p1ObjectiveBonus;
    const p2Total = p2RoundReward + p2KillTotal + p2ObjectiveBonus;

    const p1NewBalance = Math.min(MAX_MONEY, p1Economy.money + p1Total);
    const p2NewBalance = Math.min(MAX_MONEY, p2Economy.money + p2Total);

    /* Calculate new loss streaks */
    const p1NewLossStreak = p1Won ? 0 : p1Economy.lossStreak + 1;
    const p2NewLossStreak = p2Won ? 0 : p2Economy.lossStreak + 1;

    return {
      player1: {
        roundReward: p1RoundReward,
        killRewards: p1KillTotal,
        killDetails: p1KillDetails,
        objectiveBonus: p1ObjectiveBonus,
        totalEarned: p1Total,
        newBalance: p1NewBalance,
        newLossStreak: p1NewLossStreak,
      },
      player2: {
        roundReward: p2RoundReward,
        killRewards: p2KillTotal,
        killDetails: p2KillDetails,
        objectiveBonus: p2ObjectiveBonus,
        totalEarned: p2Total,
        newBalance: p2NewBalance,
        newLossStreak: p2NewLossStreak,
      },
    };
  }

  /**
   * Apply an economy update to both players' economy objects.
   * Mutates the economy objects in place.
   *
   * @param p1Economy - Player 1's economy to update
   * @param p2Economy - Player 2's economy to update
   * @param update - The economy update to apply
   */
  applyUpdate(
    p1Economy: TeamEconomy,
    p2Economy: TeamEconomy,
    update: EconomyUpdate
  ): void {
    /* Apply player 1 changes */
    p1Economy.money = update.player1.newBalance;
    p1Economy.lossStreak = update.player1.newLossStreak;
    p1Economy.totalKills += update.player1.killDetails.length;

    /* Apply player 2 changes */
    p2Economy.money = update.player2.newBalance;
    p2Economy.lossStreak = update.player2.newLossStreak;
    p2Economy.totalKills += update.player2.killDetails.length;

    console.log(
      `[Economy] P1: +$${update.player1.totalEarned} (balance: $${update.player1.newBalance})` +
      ` | P2: +$${update.player2.totalEarned} (balance: $${update.player2.newBalance})`
    );
  }

  // --------------------------------------------------------------------------
  // Round Reward Calculation
  // --------------------------------------------------------------------------

  /**
   * Get the base round reward for a player.
   *
   * Winners always receive ROUND_WIN_REWARD ($3,250).
   * Losers receive an escalating reward based on their consecutive loss count:
   *   - 1st loss:  $1,400
   *   - 2nd loss:  $1,900
   *   - 3rd loss:  $2,400
   *   - 4th+ loss: $2,900 (cap)
   *
   * @param won - Whether this player won the round
   * @param currentLossStreak - Current consecutive losses BEFORE this round
   * @returns Money reward for the round outcome
   */
  private getRoundReward(won: boolean, currentLossStreak: number): number {
    if (won) {
      return ROUND_WIN_REWARD;
    }

    /**
     * Loss streak index is based on the NEW loss streak (current + 1).
     * E.g., if this is their 1st loss (currentLossStreak was 0),
     * the new streak is 1, so index = 0 → $1,400.
     */
    const newStreak = currentLossStreak + 1;
    const streakIndex = Math.min(newStreak - 1, LOSS_STREAK_REWARDS.length - 1);
    return LOSS_STREAK_REWARDS[streakIndex];
  }

  // --------------------------------------------------------------------------
  // Kill Reward Calculation
  // --------------------------------------------------------------------------

  /**
   * Calculate kill rewards for a player based on the round's kill log.
   *
   * Each weapon has a different kill reward (defined in WeaponData.ts):
   *   - PISTOL:  $300 (standard)
   *   - SMG:     $600 (high risk, close range)
   *   - RIFLE:   $300 (standard)
   *   - AWP:     $100 (very powerful weapon, low reward)
   *   - SHOTGUN: $900 (highest risk, must get close)
   *   - LMG:     $300 (standard)
   *
   * @param kills - All kills this round
   * @param playerPrefix - 'p1' or 'p2' to filter kills by player
   * @returns Array of kill detail objects with weapon and reward
   */
  private getKillRewards(
    kills: KillRecord[],
    playerPrefix: string
  ): { weapon: string; reward: number }[] {
    const details: { weapon: string; reward: number }[] = [];

    for (const kill of kills) {
      /* Check if this kill belongs to the specified player */
      if (!kill.killerId.startsWith(playerPrefix)) continue;

      /* Look up the weapon's kill reward from WeaponData */
      const weaponId = kill.weapon as WeaponId;
      const weaponStats = WEAPONS[weaponId];
      const reward = weaponStats ? weaponStats.killReward : 300;

      details.push({
        weapon: kill.weapon,
        reward,
      });
    }

    return details;
  }

  // --------------------------------------------------------------------------
  // Objective Bonus Calculation
  // --------------------------------------------------------------------------

  /**
   * Calculate the objective bonus for a player based on bomb actions.
   *
   * - If the bomb was planted, the attacking team gets BOMB_PLANT_BONUS ($300)
   *   even if the round was lost (bomb defused by defenders).
   * - If the bomb was defused, the defending team gets BOMB_DEFUSE_BONUS ($300).
   *
   * These bonuses stack with the round reward and kill rewards.
   *
   * @param playerSide - Which side this player is on (ATTACKER or DEFENDER)
   * @param bombPlanted - Whether the bomb was planted this round
   * @param bombDefused - Whether the bomb was defused this round
   * @returns Objective bonus money (0 if no applicable bonus)
   */
  private getObjectiveBonus(
    playerSide: Side,
    bombPlanted: boolean,
    bombDefused: boolean
  ): number {
    let bonus = 0;

    /* Attackers get plant bonus whenever the bomb was planted */
    if (playerSide === Side.ATTACKER && bombPlanted) {
      bonus += BOMB_PLANT_BONUS;
    }

    /* Defenders get defuse bonus when the bomb was defused */
    if (playerSide === Side.DEFENDER && bombDefused) {
      bonus += BOMB_DEFUSE_BONUS;
    }

    return bonus;
  }

  // --------------------------------------------------------------------------
  // Overtime / Tiebreaker
  // --------------------------------------------------------------------------

  /**
   * Reset both players' money for an overtime/tiebreaker round.
   * Both players receive OVERTIME_MONEY ($10,000) regardless of current balance.
   *
   * @param p1Economy - Player 1's economy to reset
   * @param p2Economy - Player 2's economy to reset
   */
  applyOvertimeMoney(p1Economy: TeamEconomy, p2Economy: TeamEconomy): void {
    p1Economy.money = OVERTIME_MONEY;
    p2Economy.money = OVERTIME_MONEY;
    console.log(`[Economy] Overtime money applied: both players receive $${OVERTIME_MONEY}`);
  }

  // --------------------------------------------------------------------------
  // Initial Economy
  // --------------------------------------------------------------------------

  /**
   * Get the starting money for a new match.
   * @returns Starting money amount ($800)
   */
  getStartingMoney(): number {
    return STARTING_MONEY;
  }

  /**
   * Get the maximum money cap.
   * @returns Maximum money ($16,000)
   */
  getMaxMoney(): number {
    return MAX_MONEY;
  }
}
