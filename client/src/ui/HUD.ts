/**
 * HUD.ts - Heads-Up Display overlay
 *
 * Renders game information on top of the 3D scene using HTML/CSS.
 * Shows: phase indicator, round timer, score, money, alive counts,
 * and selected soldier info.
 *
 * Uses DOM manipulation (not Three.js) so it's crisp at any resolution
 * and easy to style with CSS.
 */

import { GamePhase, Side, type GameState, type SoldierRuntimeState } from '../game/GameState';

// ============================================================
// HUD Class
// ============================================================

/**
 * The in-game HUD overlay showing essential match information.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────┐
 * │  [Score]     [Phase: LIVE | Timer: 1:23]     [Money] │
 * │  P1: 2       Round 3 of 9                    $4,250  │
 * │  P2: 1       Alive: 4 vs 5                           │
 * └──────────────────────────────────────────────────────┘
 * │                                                       │
 * │              (3D game scene here)                     │
 * │                                                       │
 * ├──────────────────────────────────────────────────────┤
 * │  [Selected: Soldier 2]  HP: 75  Weapon: Rifle        │
 * │  Stance: Aggressive   [H]old [R]etreat               │
 * └──────────────────────────────────────────────────────┘
 */
export class HUD {
  /** Reference to the HUD container element */
  private container: HTMLElement;

  /** Cached element references for efficient updates */
  private elements: {
    topBar: HTMLElement;
    scoreDisplay: HTMLElement;
    phaseDisplay: HTMLElement;
    timerDisplay: HTMLElement;
    roundDisplay: HTMLElement;
    moneyDisplay: HTMLElement;
    aliveDisplay: HTMLElement;
    bottomBar: HTMLElement;
    selectedInfo: HTMLElement;
  };

  /**
   * Create the HUD and inject HTML elements into the container.
   * @param containerId - ID of the HUD container element in index.html
   */
  constructor(containerId: string = 'hud') {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`HUD container #${containerId} not found`);
    }
    this.container = container;

    /* Build the HUD HTML structure */
    this.container.innerHTML = `
      <div class="hud-top-bar">
        <div class="hud-left">
          <div class="hud-score" id="hud-score">0 - 0</div>
          <div class="hud-round" id="hud-round">Round 1 / 9</div>
        </div>
        <div class="hud-center">
          <div class="hud-phase" id="hud-phase">BUY PHASE</div>
          <div class="hud-timer" id="hud-timer">0:20</div>
        </div>
        <div class="hud-right">
          <div class="hud-money" id="hud-money">$800</div>
          <div class="hud-alive" id="hud-alive">5 vs 5</div>
        </div>
      </div>
      <div class="hud-bottom-bar" id="hud-bottom-bar">
        <div class="hud-selected" id="hud-selected">Click a soldier to select</div>
      </div>
    `;

    /* Cache references to frequently updated elements */
    this.elements = {
      topBar: this.container.querySelector('.hud-top-bar')!,
      scoreDisplay: document.getElementById('hud-score')!,
      phaseDisplay: document.getElementById('hud-phase')!,
      timerDisplay: document.getElementById('hud-timer')!,
      roundDisplay: document.getElementById('hud-round')!,
      moneyDisplay: document.getElementById('hud-money')!,
      aliveDisplay: document.getElementById('hud-alive')!,
      bottomBar: document.getElementById('hud-bottom-bar')!,
      selectedInfo: document.getElementById('hud-selected')!,
    };

    /* Inject HUD-specific styles */
    this.injectStyles();
  }

  /**
   * Update the HUD to reflect the current game state.
   * Called every frame by the game loop.
   *
   * @param state - Current game state
   * @param localPlayer - Which player we are (1 or 2)
   * @param selectedSoldierIndex - Currently selected soldier index, or null
   */
  update(state: GameState, localPlayer: 1 | 2, selectedSoldierIndex: number | null): void {
    /* --- Score --- */
    this.elements.scoreDisplay.textContent = `${state.score.player1} - ${state.score.player2}`;

    /* --- Round number --- */
    this.elements.roundDisplay.textContent = `Round ${state.roundNumber} / 9`;

    /* --- Phase indicator --- */
    this.elements.phaseDisplay.textContent = this.getPhaseLabel(state.phase);
    this.elements.phaseDisplay.className = `hud-phase phase-${state.phase.toLowerCase()}`;

    /* --- Timer (format as M:SS) --- */
    const minutes = Math.floor(Math.max(0, state.timeRemaining) / 60);
    const seconds = Math.floor(Math.max(0, state.timeRemaining) % 60);
    this.elements.timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    /* Flash timer red when under 10 seconds */
    this.elements.timerDisplay.style.color =
      state.timeRemaining < 10 && state.phase === GamePhase.LIVE_PHASE ? '#ff4444' : '#ffffff';

    /* --- Money --- */
    const myEconomy = localPlayer === 1 ? state.player1Economy : state.player2Economy;
    this.elements.moneyDisplay.textContent = `$${myEconomy.money.toLocaleString()}`;

    /* Color money based on amount: green if rich, yellow if mid, red if poor */
    if (myEconomy.money >= 4000) {
      this.elements.moneyDisplay.style.color = '#44ff44';
    } else if (myEconomy.money >= 2000) {
      this.elements.moneyDisplay.style.color = '#ffff44';
    } else {
      this.elements.moneyDisplay.style.color = '#ff4444';
    }

    /* --- Alive counts --- */
    const p1Alive = state.player1Soldiers.filter((s) => s.alive).length;
    const p2Alive = state.player2Soldiers.filter((s) => s.alive).length;
    this.elements.aliveDisplay.textContent = `${p1Alive} vs ${p2Alive}`;

    /* --- Selected soldier info --- */
    if (selectedSoldierIndex !== null) {
      const mySoldiers = localPlayer === 1 ? state.player1Soldiers : state.player2Soldiers;
      const soldier = mySoldiers[selectedSoldierIndex];
      if (soldier) {
        this.elements.selectedInfo.innerHTML = this.getSoldierInfoHTML(soldier);
      }
    } else {
      this.elements.selectedInfo.textContent = 'Click a soldier to select';
    }
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Get a human-readable label for the current game phase.
   */
  private getPhaseLabel(phase: GamePhase): string {
    const labels: Record<string, string> = {
      [GamePhase.BUY_PHASE]: 'BUY PHASE',
      [GamePhase.STRATEGY_PHASE]: 'STRATEGY PHASE',
      [GamePhase.LIVE_PHASE]: 'LIVE',
      [GamePhase.POST_PLANT]: 'BOMB PLANTED',
      [GamePhase.ROUND_END]: 'ROUND OVER',
      [GamePhase.MATCH_END]: 'MATCH OVER',
    };
    return labels[phase] ?? phase;
  }

  /**
   * Generate HTML for the selected soldier's info panel.
   */
  private getSoldierInfoHTML(soldier: SoldierRuntimeState): string {
    const healthColor = soldier.health > 60 ? '#44ff44' : soldier.health > 30 ? '#ffff44' : '#ff4444';
    const weapon = soldier.primaryWeapon ?? 'Pistol';
    return `
      <span class="soldier-name">Soldier ${soldier.index + 1}</span>
      <span class="soldier-hp" style="color:${healthColor}">HP: ${soldier.health}</span>
      <span class="soldier-weapon">${weapon}</span>
      <span class="soldier-stance">${soldier.stance}</span>
      <span class="soldier-keys">[H]old [R]etreat [G]regroup</span>
    `;
  }

  /**
   * Inject CSS styles specific to the HUD.
   * Uses a <style> tag so all HUD styling is self-contained.
   */
  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      .hud-top-bar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 12px 24px;
        background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%);
        pointer-events: none;
        user-select: none;
      }
      .hud-left, .hud-center, .hud-right {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .hud-left { align-items: flex-start; }
      .hud-right { align-items: flex-end; }
      .hud-score {
        font-size: 28px;
        font-weight: bold;
        letter-spacing: 4px;
      }
      .hud-round {
        font-size: 12px;
        opacity: 0.6;
        text-transform: uppercase;
        letter-spacing: 2px;
      }
      .hud-phase {
        font-size: 14px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 3px;
        padding: 4px 16px;
        border-radius: 4px;
        background: rgba(255,255,255,0.1);
      }
      .hud-timer {
        font-size: 36px;
        font-weight: bold;
        font-family: 'Courier New', monospace;
      }
      .hud-money {
        font-size: 24px;
        font-weight: bold;
      }
      .hud-alive {
        font-size: 14px;
        opacity: 0.7;
      }
      .hud-bottom-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        padding: 12px 24px;
        background: linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%);
        pointer-events: none;
        user-select: none;
      }
      .hud-selected {
        display: flex;
        gap: 20px;
        align-items: center;
        font-size: 14px;
      }
      .soldier-name {
        font-weight: bold;
        font-size: 16px;
      }
      .soldier-keys {
        opacity: 0.5;
        font-size: 12px;
        margin-left: auto;
      }
    `;
    document.head.appendChild(style);
  }
}
