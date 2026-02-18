# Overnight Build Log

## Session 2 — Wire Movement + Detection + Combat (2026-02-18)

### What was done this session

1. **Wire stat-driven movement (COMPLETE)**
   - Added `RuntimeStats` interface to `GameState.ts` with all 10 abbreviated stats (ACC, REA, SPD, STL, AWR, RCL, CMP, CLT, UTL, TWK)
   - Added `stats`, `detectedEnemies`, `shotsFired` fields to `SoldierRuntimeState`
   - Created `createVariedStats()` factory — each soldier index gets a unique stat profile (Entry Fragger, Support, AWPer, Lurker, Anchor)
   - Changed `primaryWeapon: string` to `currentWeapon: WeaponId` for proper weapon lookup
   - Added `currentRoundKills` to `GameState` for kill tracking
   - Replaced hardcoded `speed = 200` with `calculateMovementSpeed(SPD, weaponSpeedMod, armorPenalty)`
   - Soldiers in combat move at 50% speed (suppression effect)

2. **Wire detection system (COMPLETE)**
   - `DetectionSystem` instantiated from map walls in `startMatch()`
   - `updateDetection()` runs each tick: vision cone → LOS → probabilistic roll using AWR/STL stats
   - Once detected, enemies stay visible as long as LOS is maintained (prevents detection flicker)
   - Soldiers auto-face nearest detected enemy when standing still
   - Both teams run detection against each other independently

3. **Wire combat system (COMPLETE)**
   - `updateCombat()` runs each tick after detection
   - Full stat-driven combat pipeline: ACC → base hit, distance mod, weapon accuracy mod, movement penalty, spray degradation (RCL), composure (CMP), clutch (CLT), teamwork (TWK)
   - Hit location system: head/body/legs with ACC-based headshot chance
   - Damage calculation uses weapon data, armor reduction, helmet protection, AWP helmet bypass
   - Kill logging with killer, victim, weapon, headshot flag, tick number
   - Round-end detection: all attackers or all defenders eliminated → winner declared
   - Mutual detection = both fire; one-sided detection = ambush advantage

4. **Fixed Soldier.ts and Combat.ts compilation (COMPLETE)**
   - Rewrote both files to match shared `SoldierStats` interface (full names: accuracy, reactionTime, etc.)
   - These files are not currently used by Game.ts (all combat is inline) but now compile cleanly
   - Will be useful for future server-side simulation and unit testing

5. **Fixed HUD.ts (COMPLETE)**
   - Updated reference from `soldier.primaryWeapon` to `soldier.currentWeapon`

6. **Zero TypeScript errors, production build succeeds**

### What needs to happen next (IN THIS ORDER)
1. **Basic AI opponent** — Bot that moves soldiers toward objectives and responds to detection/combat
2. **Buy menu UI** — HTML overlay for purchasing weapons/armor/utility
3. **Utility system** — Smoke, flash, frag, molotov, decoy with area effects
4. **Bomb plant/defuse** — Progress bars, zone checks, timer transitions
5. **Fog of war** — Texture-based visibility masking

### Important notes
- ALL CODE MUST BE THOROUGHLY COMMENTED — critical requirement from the project owner
- The `RuntimeStats` (client-side, abbreviated) vs `SoldierStats` (shared, full names) split is intentional:
  - `RuntimeStats` in `GameState.ts` uses abbreviations (ACC, REA, SPD) for simulation formulas
  - `SoldierStats` in `shared/types/SoldierTypes.ts` uses full names (accuracy, reactionTime, movementSpeed) for persistence
  - When the roster/meta-game is built, we'll map from full names → abbreviated names
- Combat is per-tick (not per-engagement): each tick, detected enemies exchange fire
- SeededRandom is initialized from `matchSeed` for deterministic replay

---

## Session 1 — Integration Pass + Wiring (2026-02-18)

### What was done this session
1. **Integration pass (COMPLETE)**
   - Fixed all `@shared/` import aliases (was using wrong `../../../../shared` relative paths)
   - Rewrote `bazaar.ts` to conform to MapData interface (dimensions, spawnZones, bombSites)
   - Rewrote `MapRenderer.ts` to use correct MapData field access patterns
   - Rewrote `GameState.ts` to import/re-export shared enums (GamePhase, Side, Stance)
   - Fixed escaped `\!` characters in SoldierRenderer.ts and MapRenderer.ts
   - Removed references to nonexistent `GamePhase.LOBBY` in Game.ts and HUD.ts
   - Normalized health 0-100 to 0-1 fraction before passing to SoldierRenderer
   - Fixed simulation file import paths (Soldier, Movement, Detection, Combat)
   - Added local `angleDifference` helper in Detection.ts (not in shared MathUtils)
   - Confirmed WeaponData already uses correct field names (non-issue)
   - Confirmed no duplicate StatFormulas or SeededRandom files exist (non-issues)

2. **Vite dev server running (COMPLETE)**
   - `npm run dev` serves the game on port 3000
   - Core game loop compiles: main.ts → Game.ts → Renderer + MapRenderer + SoldierRenderer
   - Bazaar map renders with walls, cover, bomb sites, spawn zones
   - 10 soldiers spawn (5 red attackers, 5 blue defenders)
   - Camera pan/zoom works, soldier selection works, click-to-move works
   - Phase timer ticks: BUY → STRATEGY → LIVE → ROUND_END

3. **A* pathfinding wired (COMPLETE)**
   - MovementSystem generates nav grid from map walls
   - Click-to-move uses A* pathfinding + path smoothing
   - Soldiers navigate around walls and obstacles

---

## Session 0 — Initial Setup (2026-02-18)

### What exists so far
- Full project scaffolding (package.json, tsconfig, vite.config, index.html, CSS)
- All shared types: GameTypes, SoldierTypes, WeaponTypes, MapTypes, MessageTypes
- All shared constants: GameConstants, WeaponData, EconomyConstants, StatFormulas (16 formulas)
- All shared utils: MathUtils, RandomUtils/SeededRandom
- Rendering: Renderer, MapRenderer, SoldierRenderer, Camera (all Three.js)
- Simulation: Soldier, Movement (A*), Detection (LOS + vision cone), Combat (full stat-driven)
- Game logic: Game.ts (state machine + game loop), InputManager, CommandSystem
- UI: HUD overlay, main.ts entry point
- Map data: Bazaar (3000x2000, 50 walls, 16 cover, 2 bomb sites)
