/**
 * @file BuyMenu.ts
 * @description Buy menu UI overlay for purchasing weapons, armor, and utility.
 *
 * Displayed during BUY_PHASE when the player presses 'B'.
 * Shows a grid of purchasable items organized by category:
 *   - Weapons (Pistol, SMG, Rifle, AWP, Shotgun, LMG)
 *   - Armor (Light Vest, Heavy Armor)
 *   - Equipment (Helmet, Defuse Kit)
 *   - Utility (Smoke, Flash, Frag, Molotov, Decoy)
 *
 * Purchases are applied immediately to the selected soldier's runtime state.
 * The menu shows the current money, item costs, and greys out unaffordable items.
 *
 * Uses DOM manipulation (not Three.js) for crisp, responsive UI.
 */

import { WEAPONS, ARMOR, UTILITY, HELMET_COST, DEFUSE_KIT_COST } from '@shared/constants/WeaponData';
import { WeaponId, ArmorType, UtilityType } from '@shared/types/WeaponTypes';
import type { SoldierRuntimeState, TeamEconomy } from '../game/GameState';
import { Side } from '../game/GameState';

// ============================================================================
// --- Constants ---
// ============================================================================

/** Maximum utility items a soldier can carry */
const MAX_UTILITY = 4;

// ============================================================================
// --- Purchase Result Interface ---
// ============================================================================

/**
 * Result of a buy action. Returned to the caller so they can update
 * the economy and soldier state accordingly.
 */
export interface BuyResult {
  /** Whether the purchase was successful */
  success: boolean;
  /** Cost of the purchase (0 if failed) */
  cost: number;
  /** Human-readable message for the purchase outcome */
  message: string;
}

// ============================================================================
// --- BuyMenu Class ---
// ============================================================================

/**
 * The in-game buy menu overlay.
 * Manages its own DOM, handles purchases, and updates the display.
 *
 * Usage:
 *   - Constructed once at game start
 *   - `show()` / `hide()` / `toggle()` to control visibility
 *   - `update()` called to refresh prices and availability
 *   - `onPurchase` callback fires when a purchase succeeds
 */
export class BuyMenu {
  /** The buy menu container element */
  private container: HTMLElement;

  /** Whether the menu is currently visible */
  private visible: boolean = false;

  /** Callback fired when a purchase is made: (cost: number) => void */
  public onPurchase: ((cost: number) => void) | null = null;

  /** Reference to the currently selected soldier (set by update) */
  private currentSoldier: SoldierRuntimeState | null = null;

  /** Reference to the player's economy (set by update) */
  private currentEconomy: TeamEconomy | null = null;

  /** Which side the player is on (affects defuse kit availability) */
  private playerSide: Side = Side.ATTACKER;

  /**
   * Create the buy menu and inject HTML into the container.
   * @param containerId - ID of the buy menu container in index.html
   */
  constructor(containerId: string = 'buy-menu') {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Buy menu container #${containerId} not found`);
    }
    this.container = container;

    /* Build the menu HTML structure */
    this.buildMenuHTML();

    /* Inject CSS styles */
    this.injectStyles();

    /* Start hidden */
    this.hide();
  }

  // --------------------------------------------------------------------------
  // Visibility Control
  // --------------------------------------------------------------------------

  /** Show the buy menu overlay */
  show(): void {
    this.visible = true;
    this.container.classList.remove('hidden');
  }

  /** Hide the buy menu overlay */
  hide(): void {
    this.visible = false;
    this.container.classList.add('hidden');
  }

  /** Toggle the buy menu visibility */
  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /** Check if the menu is currently showing */
  isVisible(): boolean {
    return this.visible;
  }

  // --------------------------------------------------------------------------
  // Update (called each frame when visible)
  // --------------------------------------------------------------------------

  /**
   * Update the buy menu display with current soldier and economy data.
   *
   * @param soldier - The currently selected soldier (or null)
   * @param economy - The player's economy
   * @param playerSide - Which side the player is on
   */
  update(
    soldier: SoldierRuntimeState | null,
    economy: TeamEconomy,
    playerSide: Side
  ): void {
    this.currentSoldier = soldier;
    this.currentEconomy = economy;
    this.playerSide = playerSide;

    if (!this.visible) return;

    /* Update the money display */
    const moneyEl = document.getElementById('buy-money-display');
    if (moneyEl) {
      moneyEl.textContent = `$${economy.money.toLocaleString()}`;
      moneyEl.style.color = economy.money >= 4000 ? '#44ff44'
        : economy.money >= 2000 ? '#ffff44'
        : '#ff4444';
    }

    /* Update the selected soldier display */
    const soldierEl = document.getElementById('buy-soldier-display');
    if (soldierEl) {
      if (soldier) {
        soldierEl.textContent = `Soldier ${soldier.index + 1} — ${soldier.currentWeapon} | ${soldier.armor ?? 'No Armor'} | ${soldier.helmet ? 'Helmet' : 'No Helmet'}`;
      } else {
        soldierEl.textContent = 'Select a soldier first';
      }
    }

    /* Update button states (enabled/disabled based on affordability) */
    this.updateButtonStates(soldier, economy);
  }

  // --------------------------------------------------------------------------
  // Purchase Logic
  // --------------------------------------------------------------------------

  /**
   * Attempt to buy a weapon for the selected soldier.
   *
   * @param weaponId - The weapon to purchase
   * @returns Purchase result
   */
  buyWeapon(weaponId: WeaponId): BuyResult {
    if (!this.currentSoldier || !this.currentEconomy) {
      return { success: false, cost: 0, message: 'No soldier selected' };
    }

    const weapon = WEAPONS[weaponId];
    if (!weapon) {
      return { success: false, cost: 0, message: 'Unknown weapon' };
    }

    /* Pistol is free (default weapon) */
    if (weaponId === WeaponId.PISTOL) {
      this.currentSoldier.currentWeapon = weaponId;
      return { success: true, cost: 0, message: `Equipped ${weapon.name}` };
    }

    /* Check if already equipped */
    if (this.currentSoldier.currentWeapon === weaponId) {
      return { success: false, cost: 0, message: 'Already equipped' };
    }

    /* Check if can afford */
    if (this.currentEconomy.money < weapon.cost) {
      return { success: false, cost: 0, message: `Cannot afford ${weapon.name} ($${weapon.cost})` };
    }

    /* Purchase successful — deduct money and equip */
    this.currentEconomy.money -= weapon.cost;
    this.currentSoldier.currentWeapon = weaponId;

    /* Notify callback */
    if (this.onPurchase) this.onPurchase(weapon.cost);

    console.log(`[Buy] Soldier ${this.currentSoldier.index} bought ${weapon.name} ($${weapon.cost})`);
    return { success: true, cost: weapon.cost, message: `Bought ${weapon.name}` };
  }

  /**
   * Attempt to buy armor for the selected soldier.
   *
   * @param armorType - The armor type to purchase
   * @returns Purchase result
   */
  buyArmor(armorType: ArmorType): BuyResult {
    if (!this.currentSoldier || !this.currentEconomy) {
      return { success: false, cost: 0, message: 'No soldier selected' };
    }

    const armor = ARMOR[armorType];
    if (!armor) {
      return { success: false, cost: 0, message: 'Unknown armor type' };
    }

    /* Check if already wearing this armor */
    if (this.currentSoldier.armor === armorType) {
      return { success: false, cost: 0, message: 'Already wearing this armor' };
    }

    /* Check if can afford */
    if (this.currentEconomy.money < armor.cost) {
      return { success: false, cost: 0, message: `Cannot afford ${armorType} ($${armor.cost})` };
    }

    /* Purchase successful */
    this.currentEconomy.money -= armor.cost;
    this.currentSoldier.armor = armorType;

    if (this.onPurchase) this.onPurchase(armor.cost);

    console.log(`[Buy] Soldier ${this.currentSoldier.index} bought ${armorType} ($${armor.cost})`);
    return { success: true, cost: armor.cost, message: `Bought ${armorType}` };
  }

  /**
   * Attempt to buy a helmet for the selected soldier.
   *
   * @returns Purchase result
   */
  buyHelmet(): BuyResult {
    if (!this.currentSoldier || !this.currentEconomy) {
      return { success: false, cost: 0, message: 'No soldier selected' };
    }

    /* Check if already has helmet */
    if (this.currentSoldier.helmet) {
      return { success: false, cost: 0, message: 'Already has helmet' };
    }

    /* Check if can afford */
    if (this.currentEconomy.money < HELMET_COST) {
      return { success: false, cost: 0, message: `Cannot afford Helmet ($${HELMET_COST})` };
    }

    /* Purchase successful */
    this.currentEconomy.money -= HELMET_COST;
    this.currentSoldier.helmet = true;

    if (this.onPurchase) this.onPurchase(HELMET_COST);

    console.log(`[Buy] Soldier ${this.currentSoldier.index} bought Helmet ($${HELMET_COST})`);
    return { success: true, cost: HELMET_COST, message: 'Bought Helmet' };
  }

  /**
   * Attempt to buy a defuse kit for the selected soldier.
   * Only available for defenders.
   *
   * @returns Purchase result
   */
  buyDefuseKit(): BuyResult {
    if (!this.currentSoldier || !this.currentEconomy) {
      return { success: false, cost: 0, message: 'No soldier selected' };
    }

    /* Only defenders can buy defuse kits */
    if (this.playerSide !== Side.DEFENDER) {
      return { success: false, cost: 0, message: 'Only defenders can buy defuse kits' };
    }

    /* Check if already has kit */
    if (this.currentSoldier.defuseKit) {
      return { success: false, cost: 0, message: 'Already has defuse kit' };
    }

    /* Check if can afford */
    if (this.currentEconomy.money < DEFUSE_KIT_COST) {
      return { success: false, cost: 0, message: `Cannot afford Defuse Kit ($${DEFUSE_KIT_COST})` };
    }

    /* Purchase successful */
    this.currentEconomy.money -= DEFUSE_KIT_COST;
    this.currentSoldier.defuseKit = true;

    if (this.onPurchase) this.onPurchase(DEFUSE_KIT_COST);

    console.log(`[Buy] Soldier ${this.currentSoldier.index} bought Defuse Kit ($${DEFUSE_KIT_COST})`);
    return { success: true, cost: DEFUSE_KIT_COST, message: 'Bought Defuse Kit' };
  }

  /**
   * Attempt to buy a utility item for the selected soldier.
   *
   * @param utilityType - The utility type to purchase
   * @returns Purchase result
   */
  buyUtility(utilityType: UtilityType): BuyResult {
    if (!this.currentSoldier || !this.currentEconomy) {
      return { success: false, cost: 0, message: 'No soldier selected' };
    }

    const util = UTILITY[utilityType];
    if (!util) {
      return { success: false, cost: 0, message: 'Unknown utility type' };
    }

    /* Check utility slot limit */
    if (this.currentSoldier.utility.length >= MAX_UTILITY) {
      return { success: false, cost: 0, message: 'Utility slots full (max 4)' };
    }

    /* Check if can afford */
    if (this.currentEconomy.money < util.cost) {
      return { success: false, cost: 0, message: `Cannot afford ${utilityType} ($${util.cost})` };
    }

    /* Purchase successful */
    this.currentEconomy.money -= util.cost;
    this.currentSoldier.utility.push(utilityType);

    if (this.onPurchase) this.onPurchase(util.cost);

    console.log(`[Buy] Soldier ${this.currentSoldier.index} bought ${utilityType} ($${util.cost})`);
    return { success: true, cost: util.cost, message: `Bought ${utilityType}` };
  }

  // --------------------------------------------------------------------------
  // HTML Construction
  // --------------------------------------------------------------------------

  /**
   * Build the full buy menu HTML and inject it into the container.
   * Creates categories: Weapons, Protection, Utility.
   */
  private buildMenuHTML(): void {
    this.container.innerHTML = `
      <div class="buy-header">
        <h2 class="buy-title">BUY MENU</h2>
        <div class="buy-info">
          <span id="buy-money-display" class="buy-money">$800</span>
          <span id="buy-soldier-display" class="buy-soldier-info">Select a soldier</span>
        </div>
        <button class="buy-close-btn" id="buy-close-btn">X</button>
      </div>

      <div class="buy-grid">
        <!-- WEAPONS -->
        <div class="buy-category">
          <h3 class="buy-category-title">WEAPONS</h3>
          <div class="buy-items">
            ${this.createWeaponButton(WeaponId.PISTOL)}
            ${this.createWeaponButton(WeaponId.SMG)}
            ${this.createWeaponButton(WeaponId.RIFLE)}
            ${this.createWeaponButton(WeaponId.AWP)}
            ${this.createWeaponButton(WeaponId.SHOTGUN)}
            ${this.createWeaponButton(WeaponId.LMG)}
          </div>
        </div>

        <!-- PROTECTION -->
        <div class="buy-category">
          <h3 class="buy-category-title">PROTECTION</h3>
          <div class="buy-items">
            ${this.createArmorButton(ArmorType.LIGHT_VEST)}
            ${this.createArmorButton(ArmorType.HEAVY_ARMOR)}
            <button class="buy-item-btn" data-type="helmet" id="buy-helmet">
              <span class="item-name">Helmet</span>
              <span class="item-cost">$${HELMET_COST}</span>
              <span class="item-desc">-50% headshot damage</span>
            </button>
            <button class="buy-item-btn" data-type="defuse-kit" id="buy-defuse-kit">
              <span class="item-name">Defuse Kit</span>
              <span class="item-cost">$${DEFUSE_KIT_COST}</span>
              <span class="item-desc">Defuse in 3s (vs 5s)</span>
            </button>
          </div>
        </div>

        <!-- UTILITY -->
        <div class="buy-category">
          <h3 class="buy-category-title">UTILITY</h3>
          <div class="buy-items">
            ${this.createUtilityButton(UtilityType.SMOKE)}
            ${this.createUtilityButton(UtilityType.FLASH)}
            ${this.createUtilityButton(UtilityType.FRAG)}
            ${this.createUtilityButton(UtilityType.MOLOTOV)}
            ${this.createUtilityButton(UtilityType.DECOY)}
          </div>
        </div>
      </div>

      <div class="buy-footer">
        <span class="buy-hint">Press [B] to close</span>
      </div>
    `;

    /* Bind click handlers to all buy buttons */
    this.bindEventHandlers();
  }

  /**
   * Create HTML for a weapon buy button.
   *
   * @param weaponId - The weapon to create a button for
   * @returns HTML string for the button element
   */
  private createWeaponButton(weaponId: WeaponId): string {
    const weapon = WEAPONS[weaponId];
    const cost = weaponId === WeaponId.PISTOL ? 'Free' : `$${weapon.cost}`;
    return `
      <button class="buy-item-btn" data-type="weapon" data-id="${weaponId}" id="buy-${weaponId}">
        <span class="item-name">${weapon.name}</span>
        <span class="item-cost">${cost}</span>
        <span class="item-desc">${weapon.bodyDamage} dmg | ${weapon.rangeRating}</span>
      </button>
    `;
  }

  /**
   * Create HTML for an armor buy button.
   *
   * @param armorType - The armor type to create a button for
   * @returns HTML string for the button element
   */
  private createArmorButton(armorType: ArmorType): string {
    const armor = ARMOR[armorType];
    const label = armorType === ArmorType.LIGHT_VEST ? 'Light Vest' : 'Heavy Armor';
    const reduction = Math.round(armor.bodyReduction * 100);
    return `
      <button class="buy-item-btn" data-type="armor" data-id="${armorType}" id="buy-${armorType}">
        <span class="item-name">${label}</span>
        <span class="item-cost">$${armor.cost}</span>
        <span class="item-desc">-${reduction}% body damage</span>
      </button>
    `;
  }

  /**
   * Create HTML for a utility buy button.
   *
   * @param utilityType - The utility type to create a button for
   * @returns HTML string for the button element
   */
  private createUtilityButton(utilityType: UtilityType): string {
    const util = UTILITY[utilityType];
    const descMap: Record<string, string> = {
      SMOKE: `${util.duration}s vision block`,
      FLASH: `${util.duration}s blind`,
      FRAG: `${util.damage} max damage`,
      MOLOTOV: `${util.damage} DPS for ${util.duration}s`,
      DECOY: `${util.duration}s fake sounds`,
    };
    return `
      <button class="buy-item-btn" data-type="utility" data-id="${utilityType}" id="buy-${utilityType}">
        <span class="item-name">${utilityType}</span>
        <span class="item-cost">$${util.cost}</span>
        <span class="item-desc">${descMap[utilityType] ?? ''}</span>
      </button>
    `;
  }

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  /**
   * Bind click handlers to all buy buttons inside the menu.
   */
  private bindEventHandlers(): void {
    /* Close button */
    const closeBtn = document.getElementById('buy-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    /* Weapon buttons */
    for (const weaponId of Object.values(WeaponId)) {
      const btn = document.getElementById(`buy-${weaponId}`);
      if (btn) {
        btn.addEventListener('click', () => {
          this.buyWeapon(weaponId as WeaponId);
          this.update(this.currentSoldier, this.currentEconomy!, this.playerSide);
        });
      }
    }

    /* Armor buttons */
    for (const armorType of Object.values(ArmorType)) {
      const btn = document.getElementById(`buy-${armorType}`);
      if (btn) {
        btn.addEventListener('click', () => {
          this.buyArmor(armorType as ArmorType);
          this.update(this.currentSoldier, this.currentEconomy!, this.playerSide);
        });
      }
    }

    /* Helmet button */
    const helmetBtn = document.getElementById('buy-helmet');
    if (helmetBtn) {
      helmetBtn.addEventListener('click', () => {
        this.buyHelmet();
        this.update(this.currentSoldier, this.currentEconomy!, this.playerSide);
      });
    }

    /* Defuse kit button */
    const defuseBtn = document.getElementById('buy-defuse-kit');
    if (defuseBtn) {
      defuseBtn.addEventListener('click', () => {
        this.buyDefuseKit();
        this.update(this.currentSoldier, this.currentEconomy!, this.playerSide);
      });
    }

    /* Utility buttons */
    for (const utilType of Object.values(UtilityType)) {
      const btn = document.getElementById(`buy-${utilType}`);
      if (btn) {
        btn.addEventListener('click', () => {
          this.buyUtility(utilType as UtilityType);
          this.update(this.currentSoldier, this.currentEconomy!, this.playerSide);
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Button State Management
  // --------------------------------------------------------------------------

  /**
   * Update all button states based on current economy and soldier loadout.
   * Disables buttons the player can't afford or already has.
   *
   * @param soldier - Current soldier (or null)
   * @param economy - Player's economy
   */
  private updateButtonStates(
    soldier: SoldierRuntimeState | null,
    economy: TeamEconomy
  ): void {
    /* If no soldier selected, disable everything */
    if (!soldier) {
      this.container.querySelectorAll('.buy-item-btn').forEach(btn => {
        (btn as HTMLButtonElement).disabled = true;
        btn.classList.add('buy-disabled');
      });
      return;
    }

    /* Weapon buttons */
    for (const weaponId of Object.values(WeaponId)) {
      const btn = document.getElementById(`buy-${weaponId}`) as HTMLButtonElement;
      if (!btn) continue;

      const weapon = WEAPONS[weaponId as WeaponId];
      const isEquipped = soldier.currentWeapon === weaponId;
      const canAfford = weaponId === WeaponId.PISTOL || economy.money >= weapon.cost;

      btn.disabled = isEquipped || !canAfford;
      btn.classList.toggle('buy-disabled', !canAfford && !isEquipped);
      btn.classList.toggle('buy-equipped', isEquipped);
    }

    /* Armor buttons */
    for (const armorType of Object.values(ArmorType)) {
      const btn = document.getElementById(`buy-${armorType}`) as HTMLButtonElement;
      if (!btn) continue;

      const armor = ARMOR[armorType as ArmorType];
      const isEquipped = soldier.armor === armorType;
      const canAfford = economy.money >= armor.cost;

      btn.disabled = isEquipped || !canAfford;
      btn.classList.toggle('buy-disabled', !canAfford && !isEquipped);
      btn.classList.toggle('buy-equipped', isEquipped);
    }

    /* Helmet button */
    const helmetBtn = document.getElementById('buy-helmet') as HTMLButtonElement;
    if (helmetBtn) {
      const hasHelmet = soldier.helmet;
      const canAfford = economy.money >= HELMET_COST;

      helmetBtn.disabled = hasHelmet || !canAfford;
      helmetBtn.classList.toggle('buy-disabled', !canAfford && !hasHelmet);
      helmetBtn.classList.toggle('buy-equipped', hasHelmet);
    }

    /* Defuse kit button */
    const defuseBtn = document.getElementById('buy-defuse-kit') as HTMLButtonElement;
    if (defuseBtn) {
      const hasKit = soldier.defuseKit;
      const canAfford = economy.money >= DEFUSE_KIT_COST;
      const isDefender = this.playerSide === Side.DEFENDER;

      defuseBtn.disabled = hasKit || !canAfford || !isDefender;
      defuseBtn.classList.toggle('buy-disabled', (!canAfford || !isDefender) && !hasKit);
      defuseBtn.classList.toggle('buy-equipped', hasKit);

      if (!isDefender) {
        defuseBtn.classList.add('buy-unavailable');
      } else {
        defuseBtn.classList.remove('buy-unavailable');
      }
    }

    /* Utility buttons */
    const utilFull = soldier.utility.length >= MAX_UTILITY;
    for (const utilType of Object.values(UtilityType)) {
      const btn = document.getElementById(`buy-${utilType}`) as HTMLButtonElement;
      if (!btn) continue;

      const util = UTILITY[utilType as UtilityType];
      const canAfford = economy.money >= util.cost;

      btn.disabled = utilFull || !canAfford;
      btn.classList.toggle('buy-disabled', !canAfford || utilFull);
      btn.classList.remove('buy-equipped');
    }
  }

  // --------------------------------------------------------------------------
  // Styles
  // --------------------------------------------------------------------------

  /**
   * Inject CSS styles for the buy menu.
   * Self-contained styling so the buy menu works independently.
   */
  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      /* --- Buy Menu Container --- */
      #buy-menu {
        pointer-events: auto;
        max-height: 80vh;
        overflow-y: auto;
      }

      /* --- Header --- */
      .buy-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      }
      .buy-title {
        font-size: 20px;
        font-weight: bold;
        letter-spacing: 4px;
        text-transform: uppercase;
        color: #ffffff;
        margin: 0;
      }
      .buy-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .buy-money {
        font-size: 22px;
        font-weight: bold;
        font-family: 'Courier New', monospace;
      }
      .buy-soldier-info {
        font-size: 11px;
        opacity: 0.6;
      }
      .buy-close-btn {
        background: rgba(255, 60, 60, 0.3);
        border: 1px solid rgba(255, 60, 60, 0.5);
        color: #ff6666;
        font-size: 16px;
        font-weight: bold;
        width: 32px;
        height: 32px;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .buy-close-btn:hover {
        background: rgba(255, 60, 60, 0.5);
      }

      /* --- Category Grid --- */
      .buy-grid {
        display: flex;
        gap: 16px;
      }
      .buy-category {
        flex: 1;
        min-width: 180px;
      }
      .buy-category-title {
        font-size: 11px;
        letter-spacing: 3px;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
        margin: 0 0 8px 0;
        padding-bottom: 4px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .buy-items {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      /* --- Item Button --- */
      .buy-item-btn {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        color: #ffffff;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s, border-color 0.15s;
        font-family: inherit;
      }
      .buy-item-btn:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.3);
      }
      .buy-item-btn:active:not(:disabled) {
        background: rgba(100, 200, 255, 0.2);
        border-color: rgba(100, 200, 255, 0.5);
      }
      .item-name {
        font-size: 13px;
        font-weight: bold;
      }
      .item-cost {
        font-size: 12px;
        color: #ffcc44;
        font-family: 'Courier New', monospace;
      }
      .item-desc {
        font-size: 10px;
        opacity: 0.5;
      }

      /* --- Button States --- */
      .buy-item-btn:disabled {
        cursor: not-allowed;
        opacity: 0.4;
      }
      .buy-item-btn.buy-equipped {
        border-color: rgba(68, 255, 68, 0.5);
        background: rgba(68, 255, 68, 0.1);
        opacity: 0.8;
      }
      .buy-item-btn.buy-equipped .item-cost {
        color: #44ff44;
      }
      .buy-item-btn.buy-equipped .item-cost::after {
        content: ' (equipped)';
        color: #44ff44;
        font-size: 10px;
      }
      .buy-item-btn.buy-unavailable {
        opacity: 0.2;
      }

      /* --- Footer --- */
      .buy-footer {
        margin-top: 12px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        text-align: center;
      }
      .buy-hint {
        font-size: 11px;
        opacity: 0.4;
        letter-spacing: 1px;
      }
    `;
    document.head.appendChild(style);
  }
}
