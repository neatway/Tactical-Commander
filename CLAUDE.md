# CLAUDE.md — Instructions for Claude Code

## Project
Tactical Commander — a 1v1 online multiplayer tactical strategy game. "Football Manager meets CS:GO." Each player commands 5 mercenary soldiers in a bomb defusal scenario. Web-based, Three.js + Node.js + Socket.io.

## Critical Rules
1. **Comment everything properly.** Every function, every interface, every non-obvious line. Make code easy to read. This is the most important requirement.
2. **Follow the plan.** Read `tactical-commander/plan.md` for the full GDD and implementation roadmap. Read `PROGRESS.md` for what's done and what's next. Read `OVERNIGHT-LOG.md` for where the last session left off.
3. **Git commit and push after every meaningful chunk of work.** Don't accumulate hours of uncommitted changes.
4. **Update OVERNIGHT-LOG.md** at the end of each session with what you did and what's next.
5. **Update PROGRESS.md** when you complete milestone items (check off items, update percentages).

## Tech Stack
- TypeScript (strict mode)
- Three.js with OrthographicCamera (top-down tactical view)
- Vite for dev server and bundling
- Node.js + Express + Socket.io (server, when we get there)
- Seeded PRNG (Mulberry32) for deterministic simulation

## Project Structure
```
client/src/game/        — Game loop, state machine, input, commands
client/src/rendering/   — Three.js renderer, map, soldiers, camera
client/src/simulation/  — Pathfinding, detection, combat (stat-driven)
client/src/ui/          — HUD, buy menu, scoreboard
client/src/assets/maps/ — Map data (JSON-style TypeScript)
shared/types/           — All shared interfaces and enums
shared/constants/       — Stat tables, formulas, economy values
shared/util/            — Math utils, PRNG
server/src/             — Server code (not yet created)
```

## Key Design Decisions
- Simulation ticks at 5/sec (200ms), rendering at 60fps
- 10 soldier stats (ACC, REA, SPD, STL, AWR, RCL, CMP, UTL, CLT, TWK) each 1-100
- Combat is probabilistic and stat-driven (see StatFormulas.ts)
- Commands have 0.3-0.8s delay (simulates radio comms)
- Match format: 9 rounds, first to 5, side swap at round 5
- Placeholder visuals (capsules/boxes) — real 3D models come later

## Running the Project
```bash
npm install
npm run dev    # Starts Vite dev server on port 3000
```
