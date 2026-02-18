# Tactical Commander - Project Progress

**Last Updated:** 2026-02-18

---

## Quick Summary

| Milestone | Description | Progress |
|-----------|-------------|----------|
| **M1** | Core Prototype (playable in browser) | ~45% |
| **M2** | Full Round Loop + Economy | ~10% |
| **M3** | Online Multiplayer | ~5% |
| **M4** | Meta-Game (crates, inventory, progression) | ~3% |
| **M5** | Polish & Balance (ranks, maps, audio, replays) | 0% |

**Overall: ~18%** — Core rendering pipeline integrated and running in browser.

---

## Milestone 1: Core Prototype

The goal is to open the browser, see a top-down map, select soldiers, move them, watch combat resolve with stat-driven outcomes.

### Done

- [x] **Project scaffolding** — package.json, tsconfig, vite.config, index.html, main.css, .gitignore
- [x] **Shared types** — GameTypes, SoldierTypes, WeaponTypes, MapTypes, MessageTypes (all with full JSDoc)
- [x] **Shared constants** — GameConstants, WeaponData, EconomyConstants, StatFormulas (all 16 formulas)
- [x] **Shared utils** — MathUtils (Vec2, distance, LOS), RandomUtils (mulberry32 PRNG, SeededRandom class)
- [x] **Three.js renderer** — WebGLRenderer, OrthographicCamera at y=800, shadows, 3-light setup
- [x] **Map renderer** — Loads MapData JSON, creates floor/walls/cover/bomb sites/spawn zones as 3D boxes
- [x] **Soldier renderer** — Capsule geometry, team colors, health bars, selection ring, vision cone, waypoint lines
- [x] **Camera controller** — WASD pan, scroll zoom, map bounds clamping, focusOn, screenToWorld
- [x] **Input manager** — Keyboard state, mouse clicks, scroll wheel, drag selection, key press detection
- [x] **Command system** — Command queue with 0.3-0.8s delay, 0.5s cooldown, combat extra delay
- [x] **Game state machine** — BUY → STRATEGY → LIVE → POST_PLANT → ROUND_END, phase timers, side swap
- [x] **Bazaar map** — 3000x2000 Middle Eastern town, 50 walls, 16 cover objects, 2 bomb sites, 3-lane layout
- [x] **HUD overlay** — Score, phase, timer, round number, money (color-coded), alive counts, selected soldier info
- [x] **Main entry point** — Boot sequence, creates Game, starts match, exposes debug global

### Written But Not Wired In

- [ ] **A* pathfinding** — Grid-based on 50px cells, 8-directional, path smoothing (in Movement.ts)
- [ ] **Detection system** — Vision cone, LOS raycasting, probabilistic detection per tick (in Detection.ts)
- [ ] **Combat system** — Full engagement resolution with all 10 stat modifiers (in Combat.ts)
- [ ] **ClientSoldier class** — Wraps stats + state, delegates to StatFormulas (in Soldier.ts)

### In Progress

- [x] **Integration pass** — Fixed imports, reconciled types, core rendering compiles and runs
- [ ] **Fog of war** — Texture-based visibility masking
- [ ] **Basic AI opponent** — Simple bot that buys/moves/shoots for single-player testing
- [ ] **Utility system** — Smoke (blocks vision), flash (blinds), frag (area damage), molotov (area denial), decoy (fake sounds)
- [ ] **Bomb plant/defuse** — Progress bars, zone checks, timer transitions

### Known Issues To Fix

- [x] ~~WeaponData.ts uses old field names~~ — Already correct (`bodyDamage`, `headshotMultiplier`)
- [x] ~~Duplicate StatFormulas.ts~~ — Only `shared/constants/StatFormulas.ts` exists (no duplicate)
- [x] ~~Client GameState.ts defines its own enums~~ — Now imports/re-exports from shared types
- [x] ~~Import paths inconsistent~~ — All now use `@shared/` aliases
- [x] ~~npm install hasn't been run~~ — Dependencies installed, Vite serves the game
- [ ] Simulation files (Soldier.ts, Movement.ts, Detection.ts, Combat.ts) have type mismatches with shared interfaces — will fix during wiring tasks

---

## Milestone 2: Full Round Loop + Economy

The goal is a complete round-to-round experience with buying, strategy planning, and economy management.

### Done

- [x] **Economy constants** — Starting money ($800), win/loss rewards, loss streak escalation, max $16k
- [x] **Crate/drop rate tables** — Standard/Premium/Elite/Mega crates, rarity drop rates, recycle values
- [x] **Basic round economy** — Win gives $3250, loss streak gives $1400-$2900 (in Game.ts)
- [x] **Round 9 tiebreaker** — Both teams get $10,000 (in Game.ts)

### Not Started

- [ ] **Buy menu UI** — HTML overlay, per-soldier weapon/armor/utility purchases, cost display
- [ ] **Strategy phase UI** — Waypoint editor, stance selection, timing links between soldiers
- [ ] **Economy manager** — Kill rewards by weapon, bomb plant/defuse bonus ($300), proper round rewards
- [ ] **Round summary screen** — Kill feed, MVP, economy changes, round winner display
- [ ] **Equipment persistence** — Surviving soldiers keep their weapons next round

---

## Milestone 3: Online Multiplayer

The goal is two players in separate browsers playing a full match against each other.

### Done

- [x] **Network message types** — All C2S and S2C message interfaces defined with discriminated unions
- [x] **Command types** — MOVE, RUSH, HOLD, RETREAT, USE_UTILITY, PLANT_BOMB, DEFUSE_BOMB, REGROUP
- [x] **Game event types** — SHOT_FIRED, HIT, KILL, BOMB_PLANTED, BOMB_DEFUSED, BOMB_EXPLODED, UTILITY_USED, SOLDIER_DETECTED

### Not Started

- [ ] **Express + Socket.io server** — HTTP server, WebSocket rooms, connection handling
- [ ] **Server-authoritative simulation** — Mirror of client sim running at 5 ticks/sec, server is truth
- [ ] **State sync** — Server sends fog-of-war filtered GameStateUpdate every tick
- [ ] **Client networking** — SocketClient, send commands, receive state, interpolation for smooth 60fps
- [ ] **Matchmaking queue** — Simple queue that pairs two players into a room
- [ ] **Reconnection handling** — 60s timeout, rejoin active match
- [ ] **Anti-cheat** — Server enforces fog of war, validates commands, rejects impossible actions

---

## Milestone 4: Meta-Game

The goal is persistent progression — collect soldiers, open crates, train stats, build a roster.

### Done

- [x] **Soldier stat ranges by rarity** — Common 300-400pts, Uncommon 400-500, Rare 500-600, Epic 600-700, Legendary 700-800
- [x] **Soldier profiles defined** — Entry Fragger, Support, AWPer, Lurker, Anchor, Flex
- [x] **Training cost formula** — `100 * (current/50) * rarity_mult`, cap +20/stat, +30 total, max 95
- [x] **Recycle values** — Common=50, Uncommon=150, Rare=400, Epic=1000, Legendary=3000 coins
- [x] **Match reward values** — Win=200 coins, Loss=100 coins, per-kill XP

### Not Started

- [ ] **PostgreSQL + Prisma schema** — Users, soldiers, inventory, match history
- [ ] **Auth system** — Register/login with JWT tokens
- [ ] **Crate opening system** — Random soldier generation with profile templates + rarity weights
- [ ] **Inventory/roster UI** — View soldiers, manage team of 5, see stats
- [ ] **Training UI** — Allocate training points to stats, see costs
- [ ] **Currency system** — Earn coins from matches, spend on crates/training
- [ ] **Soldier generation** — Random name/nationality/callsign + stat distribution by profile

---

## Milestone 5: Polish & Balance

The goal is a polished, balanced, fun game ready for real players.

### Not Started

- [ ] **Glicko-2 matchmaking** — Rating system, ranks (Bronze through Champion)
- [ ] **Roster power cap** — 2,750 total team stats for ranked (prevents pay-to-win)
- [ ] **Additional maps** — At least 2 more beyond Bazaar
- [ ] **Real 3D models** — Replace capsule placeholders with GLB models from Fab/Sketchfab
- [ ] **Audio** — Web Audio API, positional gunshots, footsteps, grenade sounds, UI clicks
- [ ] **Visual effects** — Muzzle flash, hit markers, blood particles, smoke/fire particles
- [ ] **Post-processing** — Bloom, SSAO, anti-aliasing via Three.js EffectComposer
- [ ] **Replay system** — Deterministic from seed + commands, full match playback
- [ ] **Balance simulator** — Run thousands of simulated fights, verify stat influence curves
- [ ] **Tutorial** — Interactive walkthrough for new players
- [ ] **Settings** — Graphics quality, key bindings, audio volume
- [ ] **Map ban system** — Pool of 3 maps, each player bans 1

---

## File Inventory

### Config (5 files)
```
package.json              — Dependencies and scripts
tsconfig.json             — TypeScript config with path aliases
vite.config.ts            — Vite bundler config (port 3000)
client/index.html         — HTML shell with canvas + HUD container
client/styles/main.css    — Full viewport canvas + UI overlay styles
```

### Shared Types (5 files)
```
shared/types/GameTypes.ts      — GamePhase, Side, GameState, RoundResult, MatchConfig
shared/types/SoldierTypes.ts   — SoldierStats (10 stats), Rarity, SoldierProfile, Soldier, SoldierState
shared/types/WeaponTypes.ts    — WeaponId, ArmorType, UtilityType, WeaponStats, ArmorStats, Equipment
shared/types/MapTypes.ts       — MapData, Zone, BombSite, Wall, CoverObject
shared/types/MessageTypes.ts   — CommandType, Command, BuyOrder, C2S/S2C messages, GameEvent
```

### Shared Constants (4 files)
```
shared/constants/GameConstants.ts    — MATCH, TIMING, SIMULATION, SOLDIER, MAP constants
shared/constants/WeaponData.ts       — WEAPONS, ARMOR, UTILITY stat tables, HELMET_COST, DEFUSE_KIT_COST
shared/constants/EconomyConstants.ts — Economy rewards, crate types, drop rates, recycle values
shared/constants/StatFormulas.ts     — 16 pure functions (hit chance, damage, detection, movement, etc.)
```

### Shared Utils (2 files)
```
shared/util/MathUtils.ts    — Vec2, distance, normalize, lerp, angleBetween, isInCone, lineIntersectsRect
shared/util/RandomUtils.ts  — mulberry32 PRNG, SeededRandom class (next, nextInt, shuffle, pick)
```

### Client Game Logic (4 files)
```
client/src/game/GameState.ts      — Client-side game state, factory functions (needs reconciliation)
client/src/game/Game.ts           — Main orchestrator, game loop, phase transitions, input handling
client/src/game/InputManager.ts   — Keyboard/mouse tracking, click queue, drag selection
client/src/game/CommandSystem.ts  — Command queue with delays and cooldowns
```

### Client Rendering (4 files)
```
client/src/rendering/Renderer.ts        — Three.js WebGLRenderer, camera, lights, shadows
client/src/rendering/MapRenderer.ts     — Converts MapData to 3D geometry (walls, floors, zones)
client/src/rendering/SoldierRenderer.ts — Capsule soldiers, health bars, selection rings, vision cones
client/src/rendering/Camera.ts          — Pan, zoom, bounds clamping, screen-to-world
```

### Client Simulation (4 files)
```
client/src/simulation/Soldier.ts    — ClientSoldier class wrapping stats and state
client/src/simulation/Movement.ts   — A* pathfinding on 50px grid, path smoothing
client/src/simulation/Detection.ts  — Vision cone, LOS raycasting, detection probability
client/src/simulation/Combat.ts     — Full engagement resolution with all stat modifiers
```

### Client Assets (1 file)
```
client/src/assets/maps/bazaar.ts — Bazaar map data (3000x2000, 50 walls, 16 cover, 2 bomb sites)
```

### Client UI (2 files)
```
client/src/ui/HUD.ts  — HTML/CSS overlay (score, phase, timer, money, alive counts)
client/src/main.ts    — Boot sequence, creates Game instance
```

### Duplicates (Resolved)
```
shared/formulas/StatFormulas.ts  — Does not exist (was never created)
shared/util/SeededRandom.ts      — Does not exist (SeededRandom is in RandomUtils.ts)
```

**Total: ~28 unique source files, ~8,000+ lines of TypeScript**

---

## Tech Stack

| Choice | Why |
|--------|-----|
| TypeScript | Shared types between client and server, catches bugs early |
| Three.js | 3D rendering in browser, OrthographicCamera for top-down tactical view |
| Vite | Fast dev server with hot reload, great TypeScript support |
| Socket.io (future) | WebSocket rooms, auto-reconnection, fallback to polling |
| Node.js + Express (future) | Same language as client, easy to share code |
| PostgreSQL + Prisma (future) | Relational data for soldiers/inventory, type-safe queries |
| Seeded PRNG (Mulberry32) | Deterministic simulation for replays and anti-cheat |

---

## Next Steps (In Order)

1. ~~**Integration pass**~~ — DONE. Core game renders in browser via `npm run dev`.
2. ~~**npm run dev**~~ — DONE. Vite serves the game on port 3000.
3. **Wire in pathfinding** — Replace simple movement with A* from Movement.ts
4. **Wire in detection** — Soldiers spot enemies using vision cones + LOS
5. **Wire in combat** — Stat-driven firefights when soldiers detect each other
6. **Basic AI** — Bot that moves soldiers and responds to contact
7. **Buy menu** — HTML overlay to purchase weapons/armor/utility
8. **Utility system** — Throwable grenades with area effects
9. **Server + networking** — Make it playable online
