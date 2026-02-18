Tactical Commander - Game Design Document & Implementation Plan
Context
Building a 1v1 online multiplayer tactical strategy game where each player commands a team of 5 mercenary soldiers in a bomb defusal scenario. "Football Manager meets CS:GO" - you're the commander, not the shooter. Web-based (browser), built with Three.js + Node.js + Socket.io.

Phase 1: Game Design Document (First Deliverable)
Core Loop

MATCH: Best of 24 rounds, first to 13 wins
  Half 1 (Rounds 1-12): Player A attacks, Player B defends
  Side Swap at Round 13
  Half 2 (Rounds 13-24): Roles reversed

SINGLE ROUND:
  Buy Phase (20s)      -> Purchase weapons/armor/utility, set starting positions
  Strategy Phase (15s) -> Draw waypoints, set stances, assign utility, sync timings
  Live Phase (1:45)    -> Soldiers execute, commander gives live orders, combat resolves
  Post-Plant (40s)     -> If bomb planted, defenders retake/defuse
  Round End            -> Award money, show summary
The 10 Soldier Stats (each 1-100)
#	Stat	Effect
1	Accuracy (ACC)	Hit probability per shot
2	Reaction Time (REA)	Who shoots first in encounters
3	Movement Speed (SPD)	Traversal speed on map
4	Stealth (STL)	Reduces enemy detection radius
5	Awareness (AWR)	Detection radius, vision quality
6	Recoil Control (RCL)	Accuracy decay during sustained fire
7	Composure (CMP)	Stat retention when low HP or outnumbered
8	Utility Usage (UTL)	Grenade accuracy, flash duration, smoke density
9	Clutch Factor (CLT)	Stat bonus when last alive
10	Teamwork (TWK)	Bonus near allies, trade-kill speed
Stat Ranges by Rarity
Rarity	Color	Total Points	Drop Rate
Common	Grey	300-400	50%
Uncommon	Green	400-500	25%
Rare	Blue	500-600	15%
Epic	Purple	600-700	8%
Legendary	Gold	700-800	2%
Stats are NOT even -- each soldier has a "profile" (Entry Fragger, Support, AWPer, Lurker, Anchor, Flex) that weights stats.

Combat Resolution System
When two soldiers detect each other:

Reaction Phase - Each rolls reaction time: reaction_ms = max(100, 800 - (REA * 6) + random(-50, 50)). Faster shooter fires first. If within 50ms, simultaneous.

Shot Resolution - Per shot:

base_hit = 0.15 + (ACC * 0.007) (ACC=50 -> 50% hit)
Distance modifier: max(0.3, 1.0 - (distance / 1500))
Moving penalty: 0.5x if shooter is moving
Weapon modifier: Pistol 0.85, SMG 0.80, Rifle 1.0, AWP 1.15
Head chance: 10% + (ACC/500) (10-30%), Body: 60%, Legs: remainder
Sustained Fire - Accuracy decays: spray_acc = base * max(0.3, 1.0 - (shots * 0.08) + (RCL * 0.0006 * shots))

Modifiers:

Composure (HP<30 or outnumbered): 0.6 + (CMP * 0.004) applied to ACC/REA
Clutch (last alive): 1.0 + (CLT * 0.003) bonus to ACC/REA/AWR
Teamwork (ally within 300px): 1.0 + (TWK * 0.002) bonus + trade-kill window
Detection System
Vision cone: 120 degrees forward
Detection radius: 400 * (0.4 + (AWR / 83.3)) modified by enemy stealth
Stealth modifier: 1.0 - (enemy_STL / 200)
Detection is probabilistic per 200ms tick, not instant
Weapon Table
Weapon	Cost	Body DMG	Head Mult	Fire Rate
Pistol	$200	25	2.5x	400ms
SMG	$1200	22	2.0x	100ms
Rifle	$2700	30	4.0x	120ms
AWP	$4750	85	1.2x	1500ms
Shotgun	$1800	18x8	1.0x	900ms
LMG	$5200	28	3.0x	80ms
Armor: Light Vest ($400, 30% body reduction), Heavy Armor ($1000, 50%), Helmet ($350, halves headshot mult). All soldiers have 100 HP.

Economy System
Team money pool (not per-soldier), max $16,000
Round 1 start: $800
Win: $3,250 | Loss streak: $1,400 -> $1,900 -> $2,400 -> $2,900 -> $3,400
Kill rewards vary by weapon ($100-$1500)
Bomb plant/defuse: +$300 to team
Commander Actions (Live Phase)
Click soldier + click map = move order
Right-click position = rush order
H = hold position, R = retreat
1-4 keys + click = throw utility
P = plant bomb, D = defuse
G + click = regroup all soldiers
Command delay: 0.3-0.8s (prevents inhuman micro)
Cooldown: 0.5s between commands to same soldier
Map Design: "Compound" (First Map)
3000x2000px game world, 2 bomb sites (A and B), 3 lanes, choke points
Maps stored as JSON (walls, cover, zones, nav data)
Crate/Loot System
Crate	Cost	Guarantee
Standard	500 coins	Common+
Premium	1,500 coins	Uncommon+
Elite	4,000 coins	Rare+
Mega	10,000 coins (3 soldiers)	1 Epic+
Earning: ~400-600 coins/match. Soldier generation uses profile templates + rarity-weighted stat distribution.

Soldier Progression
Training: +1 stat point costs 100 * (current/50) * rarity_mult coins. Cap: +20 per stat, +30 total, max 95
XP/Leveling: Max level 20, each level +1 random stat (profile-biased)
Recycling: Common=50, Uncommon=150, Rare=400, Epic=1000, Legendary=3000 coins
Roster limit: 30 soldiers
Matchmaking
Glicko-2 rating, starting 1500
Ranks: Bronze/Silver/Gold/Platinum/Diamond/Champion
Ranked roster power cap: 2,750 total team stats (prevents pay-to-win)
Map ban: pool of 3, each bans 1
Phase 2: Implementation Roadmap
Tech Stack
Choice	Rationale
TypeScript	Shared code client/server, type safety
Three.js (OrthographicCamera)	3D depth with top-down view
Vite	Fast dev, great TS support
Socket.io	WebSocket + rooms + reconnection
Node.js + Express	Same language as client
PostgreSQL + Prisma	Relational data, type-safe queries
Seeded PRNG (Mulberry32)	Deterministic simulation for replays
Project Structure

d:/1v1_Strat_Game/
  client/src/
    game/        -> Game.ts, GameState.ts, InputManager.ts, Camera.ts, CommandSystem.ts, FogOfWar.ts
    rendering/   -> Renderer.ts, MapRenderer.ts, SoldierRenderer.ts, EffectsRenderer.ts, UIOverlay.ts
    simulation/  -> Soldier.ts, Movement.ts, Combat.ts, Detection.ts, Utility.ts, BombLogic.ts
    ui/          -> BuyMenu.ts, HUD.ts, Scoreboard.ts, StrategyEditor.ts, MainMenu.ts, InventoryUI.ts, CrateOpener.ts
    network/     -> SocketClient.ts, NetworkManager.ts, Interpolation.ts
  server/src/
    game/        -> GameRoom.ts, RoundManager.ts, PhaseManager.ts, EconomyManager.ts
    simulation/  -> ServerSimulation.ts (authoritative tick loop), mirrors client sim
    network/     -> SocketServer.ts, MessageHandler.ts, StateSync.ts, AntiCheat.ts
    matchmaking/ -> MatchmakingQueue.ts, Glicko2.ts
    meta/        -> AccountService.ts, InventoryService.ts, CrateService.ts, TrainingService.ts
    db/          -> schema.prisma
  shared/
    types/       -> GameTypes.ts, SoldierTypes.ts, WeaponTypes.ts, MapTypes.ts, MessageTypes.ts
    constants/   -> GameConstants.ts, WeaponData.ts, EconomyConstants.ts, StatFormulas.ts
    util/        -> MathUtils.ts, RandomUtils.ts, ValidationUtils.ts
Milestone 1: Core Prototype (4-6 weeks)
Project scaffolding (npm, Vite, TypeScript, folder structure)
Shared types + constants + stat formulas
Map system (JSON map data + Three.js rendering with OrthographicCamera)
Soldier rendering (colored capsules, vision cones, health bars, selection)
Input system (raycasting, click-to-select, click-to-move, keyboard shortcuts)
Pathfinding (grid-based A* on 50px cells) + movement with SPD stat
Line of sight + detection system + fog of war (texture-based)
Combat system (full engagement resolution with all stat modifiers)
Game state machine (buy -> strategy -> live -> post-plant -> round end)
Basic AI opponent for testing
Utility system (smoke, flash, frag, molotov)
Milestone 2: Full Round Loop + Economy (3-4 weeks)
Round manager (24 rounds, side swap, overtime)
Economy manager (money pool, rewards, loss bonus)
Buy menu UI (HTML overlay, per-soldier purchases)
Strategy phase UI (waypoint editor, stances, timing links)
Round summary screen
Bomb plant/defuse polish
Milestone 3: Online Multiplayer (4-6 weeks)
Server-authoritative simulation (5 ticks/sec)
Socket.io networking with command/state protocol
Client-side interpolation for smooth 60fps
Matchmaking queue
Reconnection handling (60s timeout)
Fog of war server enforcement (anti-cheat)
Milestone 4: Meta-Game (4-5 weeks)
PostgreSQL + Prisma database
Auth (register/login with JWT)
Crate system + soldier generation
Inventory/roster management UI
Training + progression
Currency system + post-match rewards
Milestone 5: Polish & Balance (4-6 weeks)
Glicko-2 matchmaking with ranks
2 additional maps
Visual polish (low-poly models, effects)
Balance simulator (thousands of simulated fights)
Audio (Web Audio API, positional)
Replay system (deterministic from seed + commands)
Tutorial, settings, QoL
Verification Plan
Milestone 1 test: Open browser, see top-down map, select soldiers, issue move commands, watch pathfinding, see fog of war, watch combat resolve with correct stat influences, use grenades
Each stat formula: Unit test every formula in StatFormulas.ts with known inputs/outputs
Combat balance: Run balance simulator - high-stat soldier should win ~65-70% of 1v1s vs low-stat (not 95%)
Economy: Simulate 24-round match economies, verify full buy possible every 2-3 rounds
Multiplayer: Two browser tabs connected to same server, full match with fog of war
Meta-game: Create account, open crates, build roster, play match, earn rewards