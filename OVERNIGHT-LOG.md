# Overnight Build Log

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

3. **Currently working on: Wire pathfinding**
   - Simulation files still have type errors (SoldierStats uses short names like `ACC`, `REA`
     but the shared type uses full names like `accuracy`, `reaction`)
   - Will rewrite simulation files to match shared interfaces during wiring

### What needs to happen next (IN THIS ORDER)
1. **Wire pathfinding** — Rewrite Movement.ts to match shared interfaces, integrate A* into Game.ts
2. **Wire detection** — Rewrite Detection.ts, integrate into simulation tick loop
3. **Wire combat** — Rewrite Combat.ts, integrate stat-driven firefights
4. **Basic AI opponent** — Bot that moves soldiers and responds to contact
5. **Buy menu UI** — HTML overlay for purchasing weapons/armor/utility
6. **Utility system** — Smoke, flash, frag, molotov, decoy with area effects
7. **Bomb plant/defuse** — Progress bars, zone checks, timer transitions
8. **Fog of war** — Texture-based visibility masking

### Important notes
- ALL CODE MUST BE THOROUGHLY COMMENTED — critical requirement from the project owner
- Simulation files (Soldier.ts, Movement.ts, Detection.ts, Combat.ts) need substantial
  rewrites to match the shared type interfaces before they can be wired in
- The shared SoldierStats type uses full names (accuracy, reaction, speed, stealth, etc.)
  but the simulation code uses abbreviations (ACC, REA, SPD, STL) — need to reconcile
- Read PROGRESS.md for full milestone breakdown and file inventory

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
