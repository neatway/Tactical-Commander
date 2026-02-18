/**
 * @file RoundSummary.ts
 * @description Round summary screen shown during ROUND_END phase.
 *
 * Displays:
 *   - Round winner announcement (large centered text)
 *   - Kill feed: each kill with weapon icon and headshot indicator
 *   - Round MVP: soldier with the most kills this round
 *   - Economy breakdown: round reward, kill rewards, objective bonus, new balance
 *   - Match score update
 *
 * The summary appears automatically when a round ends and hides when
 * the next buy phase begins. Uses DOM manipulation for crisp UI.
 *
 * Integration:
 *   - Game.ts calls `show()` at the start of ROUND_END phase
 *   - Game.ts calls `hide()` when transitioning to the next BUY_PHASE
 *   - Economy data comes from EconomyManager.EconomyUpdate
 */

import type { KillRecord, MatchScore } from '../game/GameState';
import { Side } from '../game/GameState';
import type { PlayerEconomyChange } from '../simulation/EconomyManager';

// ============================================================================
// --- RoundSummary Class ---
// ============================================================================

/**
 * Displays the round-end summary screen with kill feed, MVP, and economy.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────┐
 * │              ATTACKERS WIN ROUND 3               │
 * │                   3 — 1                          │
 * │                                                  │
 * │  ── Kill Feed ──                                 │
 * │  p1_soldier_0  [Rifle] → p2_soldier_2  ★         │
 * │  p2_soldier_1  [SMG]   → p1_soldier_3            │
 * │  p1_soldier_0  [Rifle] → p2_soldier_4            │
 * │                                                  │
 * │  ── MVP ──                                       │
 * │  ★ p1_soldier_0 — 2 kills (1 headshot)          │
 * │                                                  │
 * │  ── Economy ──                                   │
 * │  Your Team:    +$3,850  (Win: $3,250 + Kills: $600)│
 * │  Enemy Team:   +$1,400  (Loss: $1,400)           │
 * │  Your Balance: $5,050                            │
 * └──────────────────────────────────────────────────┘
 */
export class RoundSummary {
  /** The round summary container element */
  private container: HTMLElement;

  /** Whether the summary is currently visible */
  private visible: boolean = false;

  /**
   * Create the round summary UI.
   * @param containerId - ID of the container element in index.html
   */
  constructor(containerId: string = 'round-summary') {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`RoundSummary container #${containerId} not found`);
    }
    this.container = container;

    /* Inject styles for the round summary */
    this.injectStyles();
  }

  // --------------------------------------------------------------------------
  // Visibility Controls
  // --------------------------------------------------------------------------

  /**
   * Show the round summary screen with the given round data.
   *
   * @param winningSide - Which side won the round (ATTACKER or DEFENDER)
   * @param roundNumber - The round number that just ended
   * @param score - Current match score after this round
   * @param kills - All kills that occurred this round
   * @param localPlayerSide - Which side the local player is on
   * @param localEconomy - Economy changes for the local player
   * @param enemyEconomy - Economy changes for the enemy player
   * @param bombPlanted - Whether the bomb was planted this round
   * @param bombDefused - Whether the bomb was defused this round
   */
  show(
    winningSide: Side,
    roundNumber: number,
    score: MatchScore,
    kills: KillRecord[],
    localPlayerSide: Side,
    localEconomy: PlayerEconomyChange,
    enemyEconomy: PlayerEconomyChange,
    bombPlanted: boolean,
    bombDefused: boolean,
  ): void {
    /* Build the summary HTML */
    this.container.innerHTML = this.buildSummaryHTML(
      winningSide,
      roundNumber,
      score,
      kills,
      localPlayerSide,
      localEconomy,
      enemyEconomy,
      bombPlanted,
      bombDefused,
    );

    /* Show the container */
    this.container.classList.remove('hidden');
    this.visible = true;
  }

  /** Hide the round summary screen. */
  hide(): void {
    this.container.classList.add('hidden');
    this.visible = false;
  }

  /** Check whether the summary is currently visible. */
  isVisible(): boolean {
    return this.visible;
  }

  // --------------------------------------------------------------------------
  // HTML Generation
  // --------------------------------------------------------------------------

  /**
   * Build the complete HTML for the round summary screen.
   * Assembles the winner banner, kill feed, MVP, and economy sections.
   */
  private buildSummaryHTML(
    winningSide: Side,
    roundNumber: number,
    score: MatchScore,
    kills: KillRecord[],
    localPlayerSide: Side,
    localEconomy: PlayerEconomyChange,
    enemyEconomy: PlayerEconomyChange,
    bombPlanted: boolean,
    bombDefused: boolean,
  ): string {
    const localWon = localPlayerSide === winningSide;
    const winnerLabel = winningSide === Side.ATTACKER ? 'ATTACKERS' : 'DEFENDERS';
    const resultClass = localWon ? 'rs-win' : 'rs-loss';

    /** Determine how the round ended (elimination, bomb, or time) */
    const endMethod = this.getEndMethod(winningSide, bombPlanted, bombDefused);

    return `
      <div class="rs-content ${resultClass}">
        <!-- Winner Banner -->
        <div class="rs-winner-banner">
          <div class="rs-result-text">${localWon ? 'VICTORY' : 'DEFEAT'}</div>
          <div class="rs-winner-detail">${winnerLabel} WIN ROUND ${roundNumber}</div>
          <div class="rs-end-method">${endMethod}</div>
          <div class="rs-score">${score.player1} — ${score.player2}</div>
        </div>

        <!-- Kill Feed -->
        ${this.buildKillFeedHTML(kills)}

        <!-- MVP -->
        ${this.buildMVPHTML(kills)}

        <!-- Economy Breakdown -->
        ${this.buildEconomyHTML(localEconomy, enemyEconomy, localWon)}
      </div>
    `;
  }

  /**
   * Get a human-readable description of how the round ended.
   *
   * @param winningSide - Which side won
   * @param bombPlanted - Whether the bomb was planted
   * @param bombDefused - Whether the bomb was defused
   * @returns Description string (e.g., "Bomb Detonated", "All Enemies Eliminated")
   */
  private getEndMethod(
    winningSide: Side,
    bombPlanted: boolean,
    bombDefused: boolean
  ): string {
    if (bombDefused) return 'Bomb Defused';
    if (bombPlanted && winningSide === Side.ATTACKER) return 'Bomb Detonated';
    if (!bombPlanted && winningSide === Side.DEFENDER) return 'Time Expired';
    return 'All Enemies Eliminated';
  }

  /**
   * Build the kill feed section showing each kill that occurred this round.
   * Each entry shows: killer [weapon] -> victim, with a star for headshots.
   */
  private buildKillFeedHTML(kills: KillRecord[]): string {
    if (kills.length === 0) {
      return `
        <div class="rs-section">
          <div class="rs-section-title">Kill Feed</div>
          <div class="rs-no-kills">No kills this round</div>
        </div>
      `;
    }

    const killRows = kills.map(kill => {
      /** Format the soldier IDs into readable names (e.g., "P1 Soldier 1") */
      const killerName = this.formatSoldierId(kill.killerId);
      const victimName = this.formatSoldierId(kill.victimId);

      /** Add headshot indicator if applicable */
      const headshotIcon = kill.headshot ? ' <span class="rs-headshot">★</span>' : '';

      /** Determine team color for killer */
      const killerClass = kill.killerId.startsWith('p1') ? 'rs-p1' : 'rs-p2';
      const victimClass = kill.victimId.startsWith('p1') ? 'rs-p1' : 'rs-p2';

      return `
        <div class="rs-kill-row">
          <span class="${killerClass}">${killerName}</span>
          <span class="rs-weapon">[${kill.weapon}]</span>
          <span class="rs-arrow">→</span>
          <span class="${victimClass}">${victimName}</span>
          ${headshotIcon}
        </div>
      `;
    }).join('');

    return `
      <div class="rs-section">
        <div class="rs-section-title">Kill Feed</div>
        ${killRows}
      </div>
    `;
  }

  /**
   * Build the MVP section showing the player with the most kills.
   * MVP is determined by kill count, with headshot count as tiebreaker.
   */
  private buildMVPHTML(kills: KillRecord[]): string {
    if (kills.length === 0) return '';

    /**
     * Count kills per soldier. Track headshot count for tiebreaking.
     * The MVP is the soldier with the most kills; ties broken by headshots.
     */
    const killCounts = new Map<string, { kills: number; headshots: number }>();

    for (const kill of kills) {
      const existing = killCounts.get(kill.killerId) ?? { kills: 0, headshots: 0 };
      existing.kills++;
      if (kill.headshot) existing.headshots++;
      killCounts.set(kill.killerId, existing);
    }

    /** Find the soldier with the highest kill count */
    let mvpId = '';
    let mvpStats = { kills: 0, headshots: 0 };

    for (const [id, stats] of killCounts) {
      if (
        stats.kills > mvpStats.kills ||
        (stats.kills === mvpStats.kills && stats.headshots > mvpStats.headshots)
      ) {
        mvpId = id;
        mvpStats = stats;
      }
    }

    const mvpName = this.formatSoldierId(mvpId);
    const mvpClass = mvpId.startsWith('p1') ? 'rs-p1' : 'rs-p2';
    const headshotText = mvpStats.headshots > 0
      ? ` (${mvpStats.headshots} headshot${mvpStats.headshots > 1 ? 's' : ''})`
      : '';

    return `
      <div class="rs-section">
        <div class="rs-section-title">Round MVP</div>
        <div class="rs-mvp">
          <span class="rs-mvp-star">★</span>
          <span class="${mvpClass}">${mvpName}</span>
          <span class="rs-mvp-stats">— ${mvpStats.kills} kill${mvpStats.kills > 1 ? 's' : ''}${headshotText}</span>
        </div>
      </div>
    `;
  }

  /**
   * Build the economy breakdown section showing money earned this round.
   * Shows round reward, kill rewards, objective bonus, and new balance.
   */
  private buildEconomyHTML(
    localEconomy: PlayerEconomyChange,
    enemyEconomy: PlayerEconomyChange,
    localWon: boolean
  ): string {
    /**
     * Format the local player's economy breakdown.
     * Show each component: round reward + kill rewards + objective bonus.
     */
    const localParts: string[] = [];
    localParts.push(`${localWon ? 'Win' : 'Loss'}: $${localEconomy.roundReward.toLocaleString()}`);
    if (localEconomy.killRewards > 0) {
      localParts.push(`Kills: $${localEconomy.killRewards.toLocaleString()}`);
    }
    if (localEconomy.objectiveBonus > 0) {
      localParts.push(`Objective: $${localEconomy.objectiveBonus.toLocaleString()}`);
    }

    /** Format the enemy's total earned (no detailed breakdown needed) */
    const enemyParts: string[] = [];
    enemyParts.push(`${localWon ? 'Loss' : 'Win'}: $${enemyEconomy.roundReward.toLocaleString()}`);
    if (enemyEconomy.killRewards > 0) {
      enemyParts.push(`Kills: $${enemyEconomy.killRewards.toLocaleString()}`);
    }

    return `
      <div class="rs-section">
        <div class="rs-section-title">Economy</div>
        <div class="rs-econ-row">
          <span class="rs-econ-label">Your Team:</span>
          <span class="rs-econ-amount rs-positive">+$${localEconomy.totalEarned.toLocaleString()}</span>
          <span class="rs-econ-detail">(${localParts.join(' + ')})</span>
        </div>
        <div class="rs-econ-row">
          <span class="rs-econ-label">Enemy Team:</span>
          <span class="rs-econ-amount">+$${enemyEconomy.totalEarned.toLocaleString()}</span>
          <span class="rs-econ-detail">(${enemyParts.join(' + ')})</span>
        </div>
        <div class="rs-econ-balance">
          Your Balance: <span class="rs-balance-amount">$${localEconomy.newBalance.toLocaleString()}</span>
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // Formatting Helpers
  // --------------------------------------------------------------------------

  /**
   * Format a soldier ID into a readable display name.
   * Converts "p1_soldier_2" → "P1 Soldier 3" (1-indexed for display).
   *
   * @param soldierId - The internal soldier ID string
   * @returns Human-readable name
   */
  private formatSoldierId(soldierId: string): string {
    const match = soldierId.match(/^(p\d)_soldier_(\d)$/);
    if (!match) return soldierId;

    const team = match[1].toUpperCase();
    const index = parseInt(match[2], 10) + 1; // Convert 0-indexed to 1-indexed
    return `${team} #${index}`;
  }

  // --------------------------------------------------------------------------
  // Styles
  // --------------------------------------------------------------------------

  /**
   * Inject CSS styles for the round summary screen.
   * All styles are self-contained and prefixed with .rs- to avoid conflicts.
   */
  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      /* --- Round Summary Container --- */
      .rs-content {
        min-width: 500px;
        max-width: 650px;
      }

      /* --- Winner Banner --- */
      .rs-winner-banner {
        margin-bottom: 20px;
      }
      .rs-result-text {
        font-size: 36px;
        font-weight: bold;
        letter-spacing: 6px;
        margin-bottom: 4px;
      }
      /* Victory is gold, defeat is red-grey */
      .rs-win .rs-result-text {
        color: #ffd700;
        text-shadow: 0 0 20px rgba(255, 215, 0, 0.4);
      }
      .rs-loss .rs-result-text {
        color: #cc4444;
        text-shadow: 0 0 20px rgba(204, 68, 68, 0.3);
      }
      .rs-winner-detail {
        font-size: 14px;
        opacity: 0.7;
        text-transform: uppercase;
        letter-spacing: 2px;
        margin-bottom: 4px;
      }
      .rs-end-method {
        font-size: 12px;
        opacity: 0.5;
        font-style: italic;
        margin-bottom: 8px;
      }
      .rs-score {
        font-size: 28px;
        font-weight: bold;
        letter-spacing: 8px;
      }

      /* --- Section Styling --- */
      .rs-section {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        text-align: left;
      }
      .rs-section-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 2px;
        opacity: 0.5;
        margin-bottom: 8px;
      }

      /* --- Kill Feed --- */
      .rs-kill-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0;
        font-size: 13px;
      }
      .rs-no-kills {
        font-size: 13px;
        opacity: 0.4;
        font-style: italic;
      }
      .rs-p1 { color: #ff6666; }
      .rs-p2 { color: #6688ff; }
      .rs-weapon {
        color: #888;
        font-size: 11px;
        min-width: 70px;
        text-align: center;
      }
      .rs-arrow {
        color: #555;
      }
      .rs-headshot {
        color: #ffd700;
        font-size: 14px;
      }

      /* --- MVP --- */
      .rs-mvp {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
      }
      .rs-mvp-star {
        color: #ffd700;
        font-size: 20px;
      }
      .rs-mvp-stats {
        opacity: 0.7;
        font-size: 13px;
      }

      /* --- Economy --- */
      .rs-econ-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0;
        font-size: 13px;
      }
      .rs-econ-label {
        min-width: 100px;
        opacity: 0.7;
      }
      .rs-econ-amount {
        font-weight: bold;
        min-width: 70px;
      }
      .rs-econ-amount.rs-positive {
        color: #44dd44;
      }
      .rs-econ-detail {
        font-size: 11px;
        opacity: 0.5;
      }
      .rs-econ-balance {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        font-size: 15px;
        font-weight: bold;
        text-align: center;
      }
      .rs-balance-amount {
        color: #44dd44;
        font-size: 18px;
      }
    `;
    document.head.appendChild(style);
  }
}
