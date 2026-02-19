/**
 * @file StrategyEditor.ts
 * @description Strategy phase UI for planning soldier movements and stances.
 *
 * Displayed during STRATEGY_PHASE (15 seconds before the round goes live).
 * Allows the commander to:
 *   - Select soldiers (tabs 1-5) to view and edit their plan
 *   - Place waypoints on the map (click to add, shown as lines)
 *   - Set stance per soldier (AGGRESSIVE / DEFENSIVE / PASSIVE)
 *   - Clear waypoints for the selected soldier
 *
 * Future additions (not yet implemented):
 *   - Timing links between soldiers (sync movement triggers)
 *   - Formation presets (spread, stack, wedge)
 *
 * Integration:
 *   - Game.ts shows the editor during STRATEGY_PHASE and hides during LIVE_PHASE
 *   - Soldier selection syncs with Game.ts selectedSoldier
 *   - Stance changes are applied directly to the soldier's runtime state
 *   - Waypoints are placed by clicking the map (handled by Game.ts processInput)
 *
 * Uses DOM manipulation for crisp, responsive UI.
 */

import type { SoldierRuntimeState, Position } from '../game/GameState';
import type { Stance } from '@shared/types/SoldierTypes';

// ============================================================================
// --- Callback Types ---
// ============================================================================

/**
 * Callback fired when the user selects a different soldier in the editor.
 * Game.ts uses this to sync the selectedSoldier index.
 */
export type OnSoldierSelectCallback = (soldierIndex: number) => void;

/**
 * Callback fired when the user changes a soldier's stance.
 * Game.ts applies the stance to the soldier's runtime state.
 */
export type OnStanceChangeCallback = (soldierIndex: number, stance: Stance) => void;

/**
 * Callback fired when the user clears waypoints for a soldier.
 * Game.ts empties the soldier's waypoints array.
 */
export type OnClearWaypointsCallback = (soldierIndex: number) => void;

// ============================================================================
// --- StrategyEditor Class ---
// ============================================================================

/**
 * Strategy phase UI panel for planning soldier movements and behavior.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────────┐
 * │  STRATEGY PHASE — Plan your approach (15s)                  │
 * │  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐                            │
 * │  │ 1 │ │ 2 │ │ 3 │ │ 4 │ │ 5 │   ← Soldier tabs           │
 * │  └───┘ └───┘ └───┘ └───┘ └───┘                            │
 * │                                                             │
 * │  Stance: [AGGRESSIVE] [DEFENSIVE] [PASSIVE]                │
 * │  Waypoints: 3 set  [Clear]                                  │
 * │                                                             │
 * │  Click on map to add waypoints for the selected soldier     │
 * └──────────────────────────────────────────────────────────────┘
 */
export class StrategyEditor {
  /** The strategy editor container element */
  private container: HTMLElement;

  /** Whether the editor is currently visible */
  private visible: boolean = false;

  /** Currently selected soldier index (0-4) */
  private selectedIndex: number = 0;

  /** Reference to the current team's soldiers (set by update) */
  private soldiers: SoldierRuntimeState[] = [];

  // --- Callbacks ---
  /** Fired when the user selects a soldier tab */
  public onSoldierSelect: OnSoldierSelectCallback | null = null;
  /** Fired when the user changes a soldier's stance */
  public onStanceChange: OnStanceChangeCallback | null = null;
  /** Fired when the user clears waypoints */
  public onClearWaypoints: OnClearWaypointsCallback | null = null;

  /**
   * Create the strategy editor UI.
   * Injects a new container into the DOM since there isn't a pre-existing one.
   */
  constructor() {
    /* Create the container element */
    this.container = document.createElement('div');
    this.container.id = 'strategy-editor';
    this.container.className = 'hidden';

    /* Add it to the UI overlay */
    const overlay = document.getElementById('ui-overlay');
    if (overlay) {
      overlay.appendChild(this.container);
    }

    /* Inject styles */
    this.injectStyles();
  }

  // --------------------------------------------------------------------------
  // Visibility Controls
  // --------------------------------------------------------------------------

  /**
   * Show the strategy editor and populate it with soldier data.
   *
   * @param soldiers - The local player's soldiers for this round
   * @param selectedIndex - Currently selected soldier index (0-4)
   */
  show(soldiers: SoldierRuntimeState[], selectedIndex: number): void {
    this.soldiers = soldiers;
    this.selectedIndex = selectedIndex >= 0 && selectedIndex < soldiers.length
      ? selectedIndex
      : 0;

    this.render();
    this.container.classList.remove('hidden');
    this.visible = true;
  }

  /** Hide the strategy editor. */
  hide(): void {
    this.container.classList.add('hidden');
    this.visible = false;
  }

  /** Check whether the editor is currently visible. */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Update the editor display with current soldier data.
   * Called every frame during the strategy phase to reflect changes
   * (e.g., new waypoints added via map click).
   *
   * @param soldiers - Updated soldier state array
   * @param selectedIndex - Currently selected soldier index
   */
  update(soldiers: SoldierRuntimeState[], selectedIndex: number): void {
    if (!this.visible) return;

    /* Only re-render if selection changed or waypoint count changed.
     * Re-rendering every frame destroys DOM elements and breaks click handlers. */
    const newIndex = selectedIndex >= 0 && selectedIndex < soldiers.length
      ? selectedIndex
      : this.selectedIndex;
    const currentSoldier = this.soldiers[this.selectedIndex];
    const newSoldier = soldiers[newIndex];
    const waypointsChanged = currentSoldier && newSoldier
      && currentSoldier.waypoints.length !== newSoldier.waypoints.length;
    const selectionChanged = newIndex !== this.selectedIndex;

    this.soldiers = soldiers;
    this.selectedIndex = newIndex;

    /* Skip re-render if nothing changed (prevents DOM thrashing at 60fps) */
    if (!selectionChanged && !waypointsChanged) return;

    this.render();
  }

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  /**
   * Render the full strategy editor HTML.
   * Rebuilds the DOM content based on current soldier data and selection.
   */
  private render(): void {
    const soldier = this.soldiers[this.selectedIndex];
    if (!soldier) return;

    this.container.innerHTML = `
      <div class="se-content">
        <!-- Header -->
        <div class="se-header">
          <span class="se-title">STRATEGY PHASE</span>
          <span class="se-hint">Click on the map to place waypoints</span>
        </div>

        <!-- Soldier Tabs -->
        <div class="se-soldier-tabs">
          ${this.renderSoldierTabs()}
        </div>

        <!-- Stance Selector -->
        <div class="se-row">
          <span class="se-label">Stance:</span>
          ${this.renderStanceButtons(soldier.stance)}
        </div>

        <!-- Waypoint Info -->
        <div class="se-row">
          <span class="se-label">Waypoints:</span>
          <span class="se-waypoint-count">${soldier.waypoints.length} set</span>
          <button class="se-btn se-btn-clear" data-action="clear-waypoints">Clear</button>
        </div>

        <!-- Soldier Info -->
        <div class="se-soldier-info">
          <span>Weapon: ${soldier.currentWeapon}</span>
          <span>Armor: ${soldier.armor ?? 'None'}</span>
          <span>Utility: ${soldier.utility.length > 0 ? soldier.utility.join(', ') : 'None'}</span>
        </div>
      </div>
    `;

    /* Attach event listeners */
    this.attachEventListeners();
  }

  /**
   * Render the soldier selection tabs (1-5).
   * The currently selected soldier tab is highlighted.
   */
  private renderSoldierTabs(): string {
    return this.soldiers.map((soldier, i) => {
      const isActive = i === this.selectedIndex;
      const classes = `se-tab ${isActive ? 'se-tab-active' : ''}`;
      /** Show soldier role based on index (matches createVariedStats profiles) */
      const roles = ['Entry', 'Support', 'AWP', 'Lurker', 'Anchor'];
      const role = roles[i] ?? 'Soldier';
      return `
        <button class="${classes}" data-soldier-index="${i}">
          <span class="se-tab-number">${i + 1}</span>
          <span class="se-tab-role">${role}</span>
        </button>
      `;
    }).join('');
  }

  /**
   * Render the three stance selection buttons.
   * The currently active stance is highlighted.
   *
   * @param currentStance - The selected soldier's current stance
   */
  private renderStanceButtons(currentStance: Stance): string {
    const stances: { value: Stance; label: string; desc: string }[] = [
      { value: 'AGGRESSIVE', label: 'AGG', desc: 'Push forward, prioritize kills' },
      { value: 'DEFENSIVE', label: 'DEF', desc: 'Hold angles, play safe' },
      { value: 'PASSIVE', label: 'PAS', desc: 'Avoid fights, gather info' },
    ];

    return stances.map(s => {
      const isActive = currentStance === s.value;
      const classes = `se-btn se-btn-stance ${isActive ? 'se-btn-active' : ''}`;
      return `<button class="${classes}" data-stance="${s.value}" title="${s.desc}">${s.label}</button>`;
    }).join('');
  }

  // --------------------------------------------------------------------------
  // Event Handling
  // --------------------------------------------------------------------------

  /**
   * Attach click handlers to the rendered buttons.
   * Uses event delegation on the container for efficiency.
   */
  private attachEventListeners(): void {
    /* Soldier tab clicks */
    const tabs = this.container.querySelectorAll('.se-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const index = parseInt(target.dataset.soldierIndex ?? '0', 10);
        this.selectedIndex = index;
        if (this.onSoldierSelect) {
          this.onSoldierSelect(index);
        }
        this.render();
      });
    });

    /* Stance button clicks */
    const stanceButtons = this.container.querySelectorAll('.se-btn-stance');
    stanceButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const stance = target.dataset.stance as Stance;
        if (stance && this.onStanceChange) {
          this.onStanceChange(this.selectedIndex, stance);
        }
        /** Update the soldier's stance locally for immediate visual feedback */
        const soldier = this.soldiers[this.selectedIndex];
        if (soldier) {
          soldier.stance = stance;
        }
        this.render();
      });
    });

    /* Clear waypoints button */
    const clearBtn = this.container.querySelector('[data-action="clear-waypoints"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (this.onClearWaypoints) {
          this.onClearWaypoints(this.selectedIndex);
        }
        /** Clear waypoints locally for immediate visual feedback */
        const soldier = this.soldiers[this.selectedIndex];
        if (soldier) {
          soldier.waypoints = [];
        }
        this.render();
      });
    }
  }

  // --------------------------------------------------------------------------
  // Styles
  // --------------------------------------------------------------------------

  /**
   * Inject CSS styles for the strategy editor.
   * All styles prefixed with .se- to avoid conflicts.
   */
  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      /* --- Strategy Editor Container --- */
      #strategy-editor {
        position: absolute;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(20, 20, 30, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 16px 24px;
        pointer-events: auto;
        z-index: 10;
      }

      .se-content {
        min-width: 500px;
      }

      /* --- Header --- */
      .se-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .se-title {
        font-size: 13px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 3px;
        color: #ffcc00;
      }
      .se-hint {
        font-size: 11px;
        opacity: 0.5;
        font-style: italic;
      }

      /* --- Soldier Tabs --- */
      .se-soldier-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 12px;
      }
      .se-tab {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 6px 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        color: #aaa;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        min-width: 60px;
      }
      .se-tab:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      .se-tab-active {
        background: rgba(255, 204, 0, 0.15);
        border-color: #ffcc00;
        color: #ffcc00;
      }
      .se-tab-number {
        font-size: 16px;
        font-weight: bold;
      }
      .se-tab-role {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 1px;
        opacity: 0.7;
      }

      /* --- Rows --- */
      .se-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .se-label {
        font-size: 12px;
        opacity: 0.6;
        min-width: 75px;
      }

      /* --- Buttons --- */
      .se-btn {
        padding: 5px 12px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 3px;
        color: #ccc;
        cursor: pointer;
        font-size: 11px;
        font-weight: bold;
        font-family: inherit;
        letter-spacing: 1px;
        transition: all 0.15s ease;
      }
      .se-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
      }
      .se-btn-active {
        background: rgba(255, 204, 0, 0.2);
        border-color: #ffcc00;
        color: #ffcc00;
      }
      .se-btn-clear {
        margin-left: 8px;
        color: #ff6666;
        border-color: rgba(255, 100, 100, 0.3);
      }
      .se-btn-clear:hover {
        background: rgba(255, 100, 100, 0.15);
      }

      /* --- Waypoint Count --- */
      .se-waypoint-count {
        font-size: 13px;
        color: #aaa;
      }

      /* --- Soldier Info --- */
      .se-soldier-info {
        display: flex;
        gap: 16px;
        font-size: 11px;
        opacity: 0.4;
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }
    `;
    document.head.appendChild(style);
  }
}
