# Overnight Build Log

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

### What needs to happen next (IN THIS ORDER)
1. **Integration pass** — Fix all type mismatches and imports so the project compiles:
   - WeaponData.ts uses old field names (`bodyDmg`, `headMult`) but WeaponTypes.ts expects (`bodyDamage`, `headshotMultiplier`) — fix WeaponData to match WeaponTypes interfaces
   - Delete duplicate `shared/formulas/StatFormulas.ts` (keep `shared/constants/StatFormulas.ts`)
   - Client `GameState.ts` defines its own GamePhase/Side/Stance enums that duplicate shared types — reconcile to use shared types
   - Fix all import paths across files (some use relative, some use @shared aliases)
2. **npm install && npm run dev** — Get it compiling and rendering in the browser
3. **Wire pathfinding** — Replace placeholder movement in Game.ts with A* from Movement.ts
4. **Wire detection** — Integrate Detection.ts into the simulation tick loop
5. **Wire combat** — Integrate Combat.ts for stat-driven firefights
6. **Basic AI opponent** — Bot that moves soldiers and responds to contact
7. **Buy menu UI** — HTML overlay for purchasing weapons/armor/utility
8. **Utility system** — Smoke, flash, frag, molotov, decoy with area effects
9. Then continue through the plan milestones (see PROGRESS.md and tactical-commander/plan.md)

### Important notes
- ALL CODE MUST BE THOROUGHLY COMMENTED — this is a critical requirement from the project owner
- Read PROGRESS.md for full milestone breakdown and file inventory
- Read tactical-commander/plan.md for the complete game design document
- The project uses TypeScript, Three.js, Vite. Run with `npm run dev`.
