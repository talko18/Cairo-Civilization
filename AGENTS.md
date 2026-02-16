# Cairo Civ — Agent Handoff Document

## What Is This Project?

Cairo Civ is a **Civilization VI-inspired turn-based strategy game** built as a StarkNet smart contract in Cairo, with a browser-based UI. Two players take turns managing cities, researching technologies, moving units, and fighting — all validated on-chain via a local Katana devnet.

**Tech stack:**
- **Smart contract:** Cairo 2.15.0 / Scarb / snforge (StarkNet Foundry v0.56.0)
- **Local devnet:** Katana (from Dojo/Starknet Foundry)
- **Frontend server:** Node.js + Express (`starknet.js` v6.23.1 for RPC)
- **Frontend UI:** Single-file HTML5 Canvas app (`ui/index.html`, ~2660 lines)

---

## Repository Layout

```
cairo_civ/
├── Scarb.toml              # Cairo package manifest
├── src/                    # Cairo smart contract source (5,199 lines)
│   ├── lib.cairo           # Module declarations
│   ├── types.cairo         # All shared types, enums, StorePacking (351 lines)
│   ├── constants.cairo     # Game balance constants, yields, costs (491 lines)
│   ├── contract.cairo      # THE contract — all storage + action dispatch (1,925 lines)
│   ├── city.cairo          # Pure city logic: yields, growth, amenities (441 lines)
│   ├── combat.cairo        # Combat resolution: melee + ranged (232 lines)
│   ├── hex.cairo           # Hex grid math: neighbors, distance, range (373 lines)
│   ├── map_gen.cairo       # Procedural map generation (920 lines)
│   ├── movement.cairo      # Unit movement validation (102 lines)
│   ├── tech.cairo          # Tech tree: prereqs, unlocks (107 lines)
│   ├── turn.cairo          # Turn order logic (94 lines)
│   ├── economy.cairo       # Gold income/maintenance (51 lines)
│   └── victory.cairo       # Win conditions: domination, score (95 lines)
├── tests/                  # Cairo tests (10,067 lines, 561 tests all passing)
│   ├── test_system.cairo   # End-to-end integration tests S1-S43 (3,319 lines)
│   ├── test_contract.cairo # Contract-level tests (3,106 lines)
│   ├── test_city.cairo     # City logic unit tests (888 lines)
│   └── ...                 # Per-module unit tests
├── ui/
│   ├── server.js           # Express API server — deploys contract, proxies RPC (576 lines)
│   ├── index.html          # Full game UI — HTML + CSS + JS Canvas app (2,658 lines)
│   ├── package.json        # Node deps: express, starknet
│   └── package-lock.json
├── design/                 # Design docs (architecture, game rules, ZK plans, future phases)
└── target/dev/             # Build artifacts (sierra + casm JSON)
```

**Total: ~18,500 lines of code.**

---

## How to Run

### Prerequisites
- **Scarb** (Cairo package manager) — installs with `curl -L https://docs.swmansion.com/scarb/install | bash`
- **snforge** (StarkNet Foundry) — `curl -L https://foundry.paradigm.xyz | bash`
- **Katana** (local devnet) — bundled with Starknet Foundry
- **Node.js** 18+

### Steps

```bash
# 1. Build the contract
scarb build

# 2. Run tests (561 tests, ~67s)
snforge test

# 3. Start Katana devnet (in a separate terminal)
katana --dev --dev.no-fee --dev.no-account-validation

# 4. Start the UI server
cd ui && npm install && npm start

# 5. Open browser to http://localhost:3000, click "Deploy & Start Game"
```

---

## Architecture Overview

### Contract (`src/contract.cairo`)

The contract is the **only stateful module**. All other `src/*.cairo` files are pure-function libraries.

**Storage layout** (key maps):
- `tiles: Map<(game_id, q, r), TileData>` — immutable terrain (set at game creation)
- `tile_ownership: Map<(game_id, q, r), u64>` — packed `(player << 32 | city_id)`
- `tile_improvement: Map<(game_id, q, r), u8>` — improvement type on tile
- `units: Map<(game_id, player, unit_id), Unit>` — unit state (StorePacked into felt252)
- `cities: Map<(game_id, player, city_id), City>` — city state (multi-slot Store)
- `player_treasury: Map<(game_id, player), u32>` — gold
- `player_completed_techs: Map<(game_id, player), u64>` — bitmask of 18 techs
- `player_current_research: Map<(game_id, player), u8>` — current research target
- `tech_accumulated_half_science: Map<(game_id, player, tech_id), u32>` — science progress

**Entry points:**
- `create_game(num_players) -> game_id` — creates map, places starting units
- `join_game(game_id)` — second player joins
- `submit_turn(game_id, actions)` — processes action array, includes EndTurn which triggers end-of-turn
- `submit_actions(game_id, actions)` — mid-turn actions (no end-of-turn processing)
- `forfeit(game_id)` — instant loss

**Error handling model (blockchain-appropriate):**
- **Individual actions use soft failure:** All `act_*` handlers validate preconditions and `return;` early on failure instead of panicking. Invalid actions are silently skipped — they do not revert the transaction. This is critical for blockchain games where stale client state or race conditions could otherwise cause entire transactions to fail.
- **End-of-turn state validation uses hard failure:** `process_end_of_turn()` asserts that the game state is valid before committing the turn: every city must have a production target, and research must be set if techs are available. These checks DO revert the transaction.
- **Auth checks use hard failure:** Game status (`STATUS_ACTIVE`), caller identity (`Not your turn`), and lobby operations still revert on failure — these are not user-correctable within a transaction.

**Batch view functions (performance):**
- `get_map_batch(game_id) -> Array<felt252>` — all 640 tiles packed
- `get_all_units(game_id, player) -> Array<felt252>` — all units packed
- `get_all_cities(game_id, player) -> Array<felt252>` — all cities (3 words each)
- `get_player_summary(game_id, player) -> Array<felt252>` — 7 scalar values

**Action enum (17 variants):**
```
0: MoveUnit(unit_id, dest_q, dest_r)
1: AttackUnit(unit_id, target_q, target_r)
2: RangedAttack(unit_id, target_q, target_r)
3: FoundCity(settler_id, name)
4: SetProduction(city_id, item_id)
5: SetResearch(tech_id)
6: BuildImprovement(builder_id, q, r, improvement_type)
7: RemoveImprovement(builder_id, q, r)
8: RemoveFeature(builder_id, q, r)
9: FortifyUnit(unit_id)
10: SkipUnit(unit_id)
11: PurchaseWithGold(city_id, item_id)
12: UpgradeUnit(unit_id)
13: DeclareWar(target_player)
14: AssignCitizen(city_id, tile_q, tile_r)
15: UnassignCitizen(city_id, tile_q, tile_r)
16: EndTurn
```

### Server (`ui/server.js`)

Express server that:
1. **On setup** (`POST /api/setup`): fetches Katana predeployed accounts, declares+deploys the contract, creates and joins a 2-player game
2. **State fetch** (`GET /api/state`): calls batch view functions (10 parallel RPC calls), decodes packed felt252 data, returns JSON
3. **Submit actions** (`POST /api/actions` and `POST /api/turn`): encodes action arrays into calldata felts, executes transaction via starknet.js, waits for confirmation

**Critical: the `ACTION` enum indices in `server.js` MUST match the Cairo `Action` enum order in `types.cairo`.** If you add/reorder actions in Cairo, update `server.js` accordingly.

### UI (`ui/index.html`)

Single-file HTML/CSS/JS app rendering on a `<canvas>`. Key subsystems:

**Game state:** Stored in global `G` object (mirrors server JSON). Tile index in `tileIdx` for O(1) lookup.

**Camera system:**
- `camX, camY` — screen-space offset
- `zoom` — scale factor (default 1.8, range 0.6–3.5)
- Arrow keys pan, scroll wheel zooms (centered on cursor), +/- keys zoom center

**Action queue (optimistic updates):**
- ALL player actions are queued locally in `pendingActions[]`
- `applyOptimistic(action)` updates `G` immediately (moves units, creates cities, sets production, etc.)
- Animations play instantly
- Only `EndTurn` flushes the entire batch to the blockchain in one transaction
- On transaction failure, state reverts via `refreshState()`

**Animation system:**
- `activeAnimations[]` — array of animation objects with `{type, startTime, duration, ...params}`
- `animLoop(now)` — requestAnimationFrame loop, redraws map each frame, removes completed anims
- Animation types: `unitWalk` (bobbing slide), `meleeCharge` (3-phase charge→clash→recoil), `archerFire` + `projectile` (arrow arc), `clashSparks`, `unitShake`, `rangedImpact`, `screenFlash`, `floatingText`, `dustParticle`, `cityFound`
- `animT(anim, now)` returns progress 0–1, supports `delay` property

**Minimap:** Bottom-right, 192x120 canvas. Click to pan. Shows terrain, territory, cities, units, viewport rectangle.

**Key keyboard shortcuts:** M=Move, A=Attack, R=Ranged, F=Fortify, S=Skip, B=Found City, T=Tech, P=Production, E=End Turn, Tab=Next Unit, Arrows=Pan, +/-=Zoom, Esc=Cancel

---

## Game Mechanics (Civ VI-inspired)

### Map
- 32x20 hex grid, flat-top orientation, offset coordinates (odd columns shifted down)
- 13 terrain types (ocean, coast, grassland/hills, plains/hills, desert/hills, tundra/hills, snow/hills, mountain)
- 4 features (woods, rainforest, marsh, oasis)
- 10 resources (wheat, rice, cattle, stone, fish, horses, iron, silver, silk, dyes)
- River edges (6-bit bitmask per tile)
- Procedurally generated via `map_gen.cairo`

### Units
- 6 types: Settler (0), Builder (1), Scout (2), Warrior (3), Slinger (4), Archer (5)
- HP 0–200, movement points per turn, builders have 3 charges
- Fortification bonus (+25% per turn, max 2 turns)
- Slinger→Archer upgrade requires Archery tech

### Cities
- Founded by settlers on valid land tiles (not water/mountain, 3+ hex from other cities)
- Population grows via food surplus (threshold: 15 + 8*(pop-1))
- Housing limits growth (base 2 or 5 if river, +2 from Granary)
- Production queue: units (cost 30–80) and buildings (cost 60–150)
- Territory: radius 1 at pop 1–2, radius 2 at pop 3–5, radius 3 at pop 6+
- Citizen tile assignment: auto-assigned by yield score, or manually locked

### Buildings (bitmask in `City.buildings: u32`)
| Bit | Name       | Cost | Requires    | Effect                     |
|-----|------------|------|-------------|----------------------------|
| 0   | Monument   | 60   | —           | +1 culture                 |
| 1   | Granary    | 65   | Pottery     | +2 housing                 |
| 2   | Walls      | 80   | Masonry     | City ranged attack          |
| 3   | Library    | 90   | Writing     | +1 science                 |
| 4   | Market     | 100  | Currency    | +3 gold                    |
| 5   | Barracks   | 90   | Bronze Work | +XP for units              |
| 6   | Water Mill | 80   | The Wheel   | +1 food if river            |
| 7   | Arena      | 150  | Construction| +1 amenity                 |

### Improvements (built by Builder)
- Farm (1), Mine (2), Quarry (3), Pasture (4), Lumber Mill (5)
- Each has terrain/resource requirements and tech prerequisites
- Builder can also remove features (chop woods/rainforest, drain marsh)

### Tech Tree
- 18 technologies across Ancient/Classical/Medieval eras
- Costs: 25–100 science points
- Science generated: 0.5 per citizen + 2 from palace + 1 from Library
- Tech unlocks: buildings, units, improvements, resource reveals

### Amenities (Happiness)
- Need: 1 amenity per 2 citizens (starting from pop 3)
- Sources: Palace (+1 for capital), Arena (+1), luxury resources (silver/silk/dyes, +1 each unique)
- Surplus modifiers:
  - Ecstatic (≥+3): +10% food growth, +10% production
  - Happy (+1 to +2): +10% food growth
  - Content (0): no modifier
  - Displeased (-1 to -2): -15% food growth, -5% production
  - Unhappy (-3 to -4): -30% food growth, -10% production
  - Unrest (≤-5): -30% food growth, -15% production

### Combat
- Melee: both attacker and defender take damage based on combat strength ratio
- Ranged: only defender takes damage (range 2)
- Base combat strengths vary by unit type
- Fortification, terrain, and river crossing modifiers apply
- City combat: cities have 200 HP, can make ranged attacks with Walls

### Victory
- **Domination:** capture all enemy capitals
- **Score:** at turn 150 (or configurable), highest score wins
- **Forfeit:** player quits

### Diplomacy
- Peace/War state between players
- Must declare war before attacking

---

## Testing

561 tests, all passing. Run with:

```bash
snforge test                           # all tests (~67s)
snforge test "test_batch_view"         # filter by name
snforge test "test_system"             # integration tests only
```

Test files:
- `test_system.cairo` — 43 end-to-end scenarios (S1–S43) covering full game flows
- `test_contract.cairo` — contract-level transaction/batch tests
- `test_city.cairo` — city yield calculation, growth, amenities
- `test_combat.cairo` — combat resolution edge cases
- `test_hex.cairo` — hex grid math
- `test_map_gen.cairo` — procedural map generation
- `test_movement.cairo` — unit movement validation
- `test_tech.cairo` — tech tree prerequisites
- `test_turn.cairo` — turn order
- `test_economy.cairo` — gold income
- `test_victory.cairo` — win conditions

---

## Known Issues & Caveats

1. **Contract size warning:** `CASM program exceeds maximum byte-code size on Starknet` (86,684 vs 81,920 limit). This only matters for mainnet deployment; Katana ignores this limit.

2. **Unused import warning:** `IMPROVEMENT_NONE` in `city.cairo` — harmless.

3. **Optimistic state is approximate:** The client-side optimistic updates (especially for combat) don't replicate exact server logic. After EndTurn flush, `refreshState()` replaces local state with the authoritative server state. Combat animations show generic "Hit!" text since damage amounts aren't pre-computed client-side.

   **Note:** Because the contract silently skips invalid actions rather than reverting, an optimistic update that doesn't match the contract's validation will simply be ignored on-chain. The authoritative state from `refreshState()` will correct the client.

4. **No fog of war:** Both players see the entire map. The `design/phase2_zk_privacy/` docs describe a future ZK-based fog of war system.

5. **2 players only:** The contract supports `num_players` parameter but the UI is hardcoded for 2 players.

6. **Single browser:** Both players play from the same browser tab (hotseat). No networking/multiplayer.

7. **No save/load:** Game state lives only in Katana memory. Restarting Katana loses the game.

8. **Tile `pixelToHex` brute-force:** Iterates all 640 tiles per mouse move. Fine for 32x20 but would need optimization for larger maps.

---

## Suggested Next Steps

These are potential areas for improvement, roughly ordered by impact:

### Gameplay
- **More unit types:** Spearman, Horseman, Swordsman (constants exist but no contract logic)
- **Great People / trade routes** (see `design/future/`)
- **Barbarian camps** (see `design/phase3_expansion/02_barbarians.md`)
- **City-states** (see `design/phase3_expansion/03_city_states.md`)
- **Religion system** (see `design/future/01_religion.md`)
- **Score victory implementation** (partially stubbed — `get_score` returns 0)

### UI/UX
- **Combat result display:** Show actual damage numbers after EndTurn resolves (compare pre/post HP)
- **Tech tree visual polish:** Connectors, progress bars, era backgrounds
- **Sound effects:** Web Audio API for move/attack/city founding
- **Production completion notifications**
- **Multi-turn production queue**
- **City screen:** Dedicated full-screen city management view

### Performance
- **Batch view functions are implemented but require contract redeployment** to Katana to take effect. The server already uses them. If you see slow state fetches, make sure you've run `scarb build` and redeployed via the Setup button.
- **Fog of war could reduce data sent** (only send visible tiles)

### Infrastructure
- **Multiplayer networking:** Replace hotseat with WebSocket-based multiplayer
- **Persistent game state:** Snapshot/restore Katana state, or deploy to a testnet
- **ZK fog of war:** Phase 2 design docs describe commitment schemes and off-chain provers

---

## Important Patterns for Contributors

### Adding a new Action
1. Add variant to `Action` enum in `src/types.cairo`
2. Add handler in `contract.cairo` `InternalImpl` (e.g., `act_new_thing`). **Use early `return;` on validation failure — never `assert()`.** Action handlers must silently skip invalid actions (see error handling model above).
3. Add dispatch case in `handle_action` in `contract.cairo`
4. Add case in `ui/server.js` `ACTION` enum AND `encodeAction()` — **indices must match Cairo enum order**
5. Add UI trigger in `ui/index.html` (`handleClick`, action bar button, keyboard shortcut)
6. Add optimistic handler in `applyOptimistic()` in `ui/index.html`
7. Write tests in appropriate `tests/*.cairo` file — test invalid actions by verifying state is unchanged (no `#[should_panic]` for action-level errors)

### Adding a new Building
1. Add `BUILDING_X: u8 = N` constant in `types.cairo`
2. Add `PROD_X: u8 = 64 + N` constant in `types.cairo`
3. Add cost in `constants::building_production_cost()`
4. Add tech requirement in `constants::building_required_tech()`
5. Add yield/effect in `city.cairo` (e.g., in `compute_city_yields` or dedicated function)
6. Apply effect in `contract.cairo` `process_end_of_turn()`
7. Add to `BUILDING_NAMES`, `PROD_ITEM_NAMES`, `PROD_ITEM_COST` in `ui/index.html`
8. Add to production panel items array in `openPanel('prod')`
9. Add to `BLDG_REQ_TECH` mapping in `openPanel('prod')`

### Adding a new Unit Type
1. Add `UNIT_X: u8 = N` in `types.cairo`
2. Add `PROD_X: u8 = N + 1` in `types.cairo`
3. Add combat stats in `constants.cairo` (`unit_combat_strength`, `unit_ranged_strength`, etc.)
4. Add movement points in `constants::unit_movement_points()`
5. Add production cost in `constants::production_cost()`
6. Add to `UNIT_NAMES`, `UNIT_ICONS` arrays in `ui/index.html`
7. Write tests

### Data Flow: Player Action → On-Chain
```
User clicks UI
  → doAction() or queuePredicted() [index.html]
  → applyOptimistic() updates local G, starts animations
  → action pushed to pendingActions[]
  → (user continues playing immediately)
  ...
User clicks "End Turn"
  → endTurn() validates locally (production/research set?)
  → submitBatch() sends all queued actions + EndTurn to server
  → POST /api/turn [server.js]
  → encodeAction() converts to felt252 calldata
  → accounts[player].execute('submit_turn', calldata) [starknet.js]
  → Katana processes transaction (Cairo contract executes)
  → provider.waitForTransaction()
  → refreshState() → GET /api/state → batch view function RPC calls
  → Server decodes packed data → JSON response
  → Client replaces G with authoritative state
  → UI redraws
```

### Packed Data Formats

**Tile (get_map_batch):** 1 felt252 per tile, row-major order (index = r*32 + q)
```
bits  0-7:   terrain
bits  8-15:  feature
bits 16-23:  resource
bits 24-31:  river_edges
bits 32-39:  improvement
bits 40-47:  owner_player
bits 48-79:  owner_city (u32)
```

**Unit (get_all_units):** 1 felt252 per unit
```
bits  0-7:   unit_type
bits  8-15:  q
bits 16-23:  r
bits 24-31:  hp
bits 32-39:  movement_remaining
bits 40-47:  charges
bits 48-55:  fortify_turns
```

**City (get_all_cities):** 3 felt252 per city
- Word 0: `name` (felt252 short string)
- Word 1: packed fields (136 bits total):
```
bits   0-7:   q
bits   8-15:  r
bits  16-23:  population
bits  24-31:  hp
bits  32-47:  food_stockpile (u16)
bits  48-63:  production_stockpile (u16)
bits  64-71:  current_production
bits  72-103: buildings (u32)
bits 104-119: founded_turn (u16)
bits 120-127: original_owner
bits 128-135: is_capital
```
- Word 2: locked tiles — byte 0 = count, then pairs of (q, r) at 16-bit intervals

---

*Last updated: 2026-02-15. 561 tests passing. Contract builds successfully. Action handlers use soft failure (silent skip) for blockchain compatibility; only end-of-turn state validation reverts.*
