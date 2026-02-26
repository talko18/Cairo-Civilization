# Cairo Civ — Agent Handoff Document

## What Is This Project?

Cairo Civ is a **Civilization VI-inspired turn-based strategy game** built as a StarkNet smart contract in Cairo, with a browser-based UI. Two players simultaneously plan their turns, submit actions independently, and the round resolves once all players have submitted — all validated on-chain via a local Katana devnet. Randomness is derived from the combined transaction hashes of all players via Poseidon hashing.

**Tech stack:**
- **Smart contract:** Cairo 2.15.0 / Scarb / snforge (StarkNet Foundry v0.56.0)
- **Local devnet:** Katana (from Dojo/Starknet Foundry)
- **Frontend server:** Node.js + Express (`starknet.js` v6.23.1 for RPC)
- **Frontend UI:** Single-file HTML5 Canvas app (`ui/index.html`, ~3,430 lines) + scenario replay (`ui/scenarios.js`, ~510 lines)

---

## Repository Layout

```
cairo_civ/
├── Scarb.toml              # Cairo package manifest
├── src/                    # Cairo smart contract source (5,341 lines)
│   ├── lib.cairo           # Module declarations
│   ├── types.cairo         # All shared types, enums, StorePacking (351 lines)
│   ├── constants.cairo     # Game balance constants, yields, costs (491 lines)
│   ├── contract.cairo      # THE contract — all storage + action dispatch (2,067 lines)
│   ├── city.cairo          # Pure city logic: yields, growth, amenities (441 lines)
│   ├── combat.cairo        # Combat resolution: melee + ranged (232 lines)
│   ├── hex.cairo           # Hex grid math: neighbors, distance, range (373 lines)
│   ├── map_gen.cairo       # Procedural map generation (920 lines)
│   ├── movement.cairo      # Unit movement validation (102 lines)
│   ├── tech.cairo          # Tech tree: prereqs, unlocks (107 lines)
│   ├── turn.cairo          # Turn order logic (94 lines)
│   ├── economy.cairo       # Gold income/maintenance (51 lines)
│   └── victory.cairo       # Win conditions: domination, score (95 lines)
├── tests/                  # Cairo tests (10,934 lines, 579 tests all passing)
│   ├── test_system.cairo   # End-to-end integration tests S1-S61 (4,227 lines)
│   ├── test_contract.cairo # Contract-level tests (3,065 lines)
│   ├── test_city.cairo     # City logic unit tests (888 lines)
│   └── ...                 # Per-module unit tests
├── ui/
│   ├── server.js           # Express API server — lobby + game endpoints (651 lines)
│   ├── index.html          # Full game UI — lobby, canvas, action validation (3,429 lines)
│   ├── scenarios.js        # AI scenario replay system — generator-based (509 lines)
│   ├── package.json        # Node deps: express, starknet
│   └── package-lock.json
├── design/                 # Design docs (architecture, game rules, ZK plans, future phases)
└── target/dev/             # Build artifacts (sierra + casm JSON)
```

**Total: ~20,860 lines of code.**

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

# 2. Run tests (579 tests, ~67s)
snforge test

# 3. Start Katana devnet (in a separate terminal)
katana --dev --dev.no-fee --dev.no-account-validation

# 4. Start the UI server
cd ui && npm install && npm start

# 5. Open browser to http://localhost:3000
```

### Using the Lobby

The UI opens with a multi-step lobby screen:

1. **Deploy** — Click "Deploy Contract" to declare and deploy the Cairo contract to the running Katana devnet. Displays the contract address and both player accounts on success.
2. **Create Game** — Click "Create Game" to call `create_game(2)` on-chain. Shows the new game ID.
3. **Join Game** — Click "Join Game" to join as Player 2. Once joined, the game status changes to Active and you can enter the game.
4. **Enter Game** — Click "Enter Game" to transition from the lobby to the main game canvas.

Alternatively, select a **scenario** from the dropdown to auto-deploy and replay a predefined AI-vs-AI action sequence (see Scenario Replay below).

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
- `player_turn_submitted: Map<(game_id, player), bool>` — whether player has submitted this round
- `player_turn_hash: Map<(game_id, player), felt252>` — transaction hash from player's submission
- `turn_seed: Map<(game_id, turn), felt252>` — combined seed for the round (Poseidon hash of all tx hashes)

**Entry points:**
- `create_game(num_players) -> game_id` — creates map, places starting units
- `join_game(game_id)` — second player joins
- `submit_turn(game_id, actions)` — processes actions, validates state (production/research set), marks player as submitted. When all players have submitted, triggers `resolve_round` which applies end-of-turn effects for all players, increments the turn counter, and resets movement. `Action::EndTurn` is ignored.
- `submit_actions(game_id, actions)` — mid-turn actions (no submission marking, no round resolution). `Action::EndTurn` is ignored.
- `forfeit(game_id)` — instant loss

**Simultaneous turn model:**
- All players submit their turns independently via `submit_turn`. Order does not matter.
- Each player's transaction hash is stored on submission.
- When all players have submitted, `resolve_round` runs: it Poseidon-hashes all transaction hashes to produce a `turn_seed`, processes end-of-turn effects for each player, increments `game_current_turn` by 1, and resets all players' movement and submission status.
- `get_current_player` returns the first player who has not yet submitted (for hotseat UI routing).
- `get_player_submitted(game_id, player_idx)` checks if a player has submitted this round.
- `get_turn_seed(game_id, turn)` returns the combined seed for a given turn.

**Error handling model (blockchain-appropriate):**
- **Individual actions use soft failure:** All `act_*` handlers validate preconditions and `return;` early on failure instead of panicking. Invalid actions are silently skipped — they do not revert the transaction. This is critical for blockchain games where stale client state or race conditions could otherwise cause entire transactions to fail.
- **Turn submission validation uses hard failure:** `validate_turn_submission()` asserts that the player's state is valid before marking them as submitted: every city must have a production target, and research must be set if techs are available. These checks DO revert the transaction.
- **Auth checks use hard failure:** Game status (`STATUS_ACTIVE`), double-submission (`Already submitted`), and lobby operations still revert on failure — these are not user-correctable within a transaction.

**Scalar view functions:**
- `get_score(game_id, player) -> u32` — computed score (population, cities, techs, buildings, kills, captures)
- `get_winner(game_id) -> u8` — winner player index (0 if game not finished)
- `get_victory_type(game_id) -> u8` — 0=Domination, 1=Score, 2=Forfeit

**Batch view functions (performance):**
- `get_map_batch(game_id) -> Array<felt252>` — all 640 tiles packed
- `get_all_units(game_id, player) -> Array<felt252>` — all units packed
- `get_all_cities(game_id, player) -> Array<felt252>` — all cities (3 words each)
- `get_player_summary(game_id, player) -> Array<felt252>` — 8 scalar values (unit_count, city_count, treasury, completed_techs, current_research, accumulated_half_science, diplomacy, submitted)

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

Express server with two groups of endpoints:

**Lobby endpoints (step-by-step game creation):**
- `POST /api/deploy` — Connects to Katana, fetches predeployed accounts, declares and deploys the contract. Returns `{ contractAddress, accounts: [{address, pubKey}, ...] }`.
- `POST /api/create-game` — Player A calls `create_game(2)` on-chain. Returns `{ gameId }`.
- `POST /api/join-game` — Player B calls `join_game(gameId)`. Returns `{ success: true }`.
- `GET /api/game-status` — Reads game status from the contract. Returns `{ status, numPlayers }`.

**Legacy setup (for scenarios):**
- `POST /api/setup` — One-shot endpoint: deploy + create + join in a single call. Used by scenario replay system.

**Game endpoints:**
- `GET /api/state` — Calls batch view functions (10 parallel RPC calls), decodes packed felt252 data, returns full game state JSON. Includes `submitted` flag per player.
- `POST /api/actions` — Encodes action array into calldata, calls `submit_actions` (no turn commitment).
- `POST /api/turn` — Encodes action array into calldata, calls `submit_turn` (commits the turn). Accepts empty action arrays.

**Critical: the `ACTION` enum indices in `server.js` MUST match the Cairo `Action` enum order in `types.cairo`.** If you add/reorder actions in Cairo, update `server.js` accordingly.

### Scenario Replay (`ui/scenarios.js`)

A generator-based system for replaying predefined AI-vs-AI action sequences in the UI:

- **`SCENARIOS`** — Array of scenario definitions, each with `{ name, seed, numPlayers, runner }`. The `runner` is a generator function that yields arrays of actions per player per turn.
- **AI logic functions** — `scScoutActions`, `scSettlerActions`, `scMilitaryActions`, `scChooseProduction`, `scStrategicTech` — simulate basic AI decision-making (scouting, settling, building improvements, researching, combat).
- **`TECH_PREREQS`** — Global constant mapping tech IDs to their prerequisites (used by both `scenarios.js` and `index.html` for validation).

Scenarios are listed in the lobby dropdown. Selecting one and clicking "Run Scenario" auto-deploys the contract and feeds actions turn-by-turn, with animations playing at accelerated speed.

### UI (`ui/index.html`)

Single-file HTML/CSS/JS app (~3,430 lines) with two main screens: a **lobby** and the **game canvas**.

**Lobby screen:**
- Multi-step card UI: Deploy → Create → Join → Enter Game.
- `lobbyAction(step)` handles each step, calling the corresponding server endpoint and updating UI feedback.
- Scenario dropdown populated by `populateScenarios()` from `SCENARIOS` array in `scenarios.js`.
- `runScenario(idx)` auto-deploys and feeds AI actions turn-by-turn with animation delays.

**Game state:** Stored in global `G` object (mirrors server JSON). Tile index in `tileIdx` for O(1) lookup.

**Camera system:**
- `camX, camY` — screen-space offset
- `zoom` — scale factor (default 1.8, range 0.6–3.5)
- Arrow keys pan, scroll wheel zooms (centered on cursor), +/- keys zoom center

**Client-side action validation:**
- `validateAction(action)` mirrors contract `act_*` validation rules in JavaScript. Returns `{valid, reason}`.
- Checks include: movement costs, attack range, city founding distance, tech prerequisites, improvement terrain compatibility, builder charges, unit ownership, diplomacy state, and more.
- `queueAction(action)` calls `validateAction()` first — if invalid, shows a toast error and rejects the action before it reaches `pendingActions[]`.
- Helper constants at global scope: `UNIT_COMBAT_STRENGTH`, `UNIT_RANGED_STRENGTH`, `UNIT_RANGE`, `CIVILIAN_TYPES`, `BLDG_REQ_TECH_MAP`, `IMP_REQ_TECH`, `tileMoveCost()`, `playerHasTech()`, `canResearchTech()`, `isValidImpForTile()`.

**Action queue (optimistic updates):**
- ALL player actions are queued locally in `pendingActions[]` (after passing validation)
- `applyOptimistic(action)` updates `G` immediately (moves units, creates cities, sets production, etc.)
- Animations play instantly
- "Submit Turn" flushes the entire batch to the blockchain via `POST /api/turn`
- On transaction failure, state reverts via `refreshState()`

**Simultaneous turn flow in UI:**
- Each player plans and submits independently. After Player A submits, `G.currentPlayer` switches to Player B (the first unsubmitted player).
- When all players have submitted, the contract resolves the round and `refreshState()` loads the new turn state.
- "Submit Turn" button label (E key shortcut) triggers `endTurn()`.

**Animation system:**
- `activeAnimations[]` — array of animation objects with `{type, startTime, duration, ...params}`
- `animLoop(now)` — requestAnimationFrame loop, redraws map each frame, removes completed anims
- Animation types: `unitWalk` (bobbing slide), `meleeCharge` (3-phase charge→clash→recoil), `archerFire` + `projectile` (arrow arc), `clashSparks`, `unitShake`, `rangedImpact`, `screenFlash`, `floatingText`, `dustParticle`, `cityFound`
- `animT(anim, now)` returns progress 0–1, supports `delay` property

**Minimap:** Bottom-right, 192x120 canvas. Click to pan. Shows terrain, territory, cities, units, viewport rectangle.

**Key keyboard shortcuts:** M=Move, A=Attack, R=Ranged, F=Fortify, S=Skip, B=Found City, T=Tech, P=Production, E=Submit Turn, Tab=Next Unit, Arrows=Pan, +/-=Zoom, Esc=Cancel

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
- **City garrison protection:** units on a city tile cannot be targeted directly — attacks always hit the city instead. When a city is captured (HP→0 via melee), all garrisoned units are killed. Ranged attacks on cities reduce HP but cannot go below 1 (only melee can capture).
- City combat: cities have 200 HP, can make ranged attacks with Walls

### Victory
- **Domination:** capture all enemy capitals (checked immediately on city capture)
- **Score:** at turn 150, highest score wins. Score = 5/pop + 10/city + 3/tech + 4/kill + 15/captured_city + 10/building. Tiebreaker: most cities, then player 0.
- **Forfeit:** player quits (UI forfeit button or contract `forfeit()`)

### Bankruptcy
- When treasury goes negative, maintenance-costing units (Slinger, Archer, future advanced units) are disbanded from the end of the unit list until the deficit is covered.

### Diplomacy
- Peace/War state between players
- Must declare war before attacking

---

## Testing

579 tests, all passing. Run with:

```bash
snforge test                           # all tests (~67s)
snforge test "test_batch_view"         # filter by name
snforge test "test_system"             # integration tests only
```

Test files:
- `test_system.cairo` — 61 end-to-end scenarios (S1–S61) covering full game flows, including improvement placement/removal, city garrison protection, and simultaneous turn submission (4,227 lines)
- `test_contract.cairo` — contract-level transaction/batch tests (3,065 lines)
- `test_city.cairo` — city yield calculation, growth, amenities (888 lines)
- `test_combat.cairo` — combat resolution edge cases (417 lines)
- `test_hex.cairo` — hex grid math (382 lines)
- `test_map_gen.cairo` — procedural map generation (508 lines)
- `test_movement.cairo` — unit movement validation (336 lines)
- `test_tech.cairo` — tech tree prerequisites (237 lines)
- `test_turn.cairo` — turn order (220 lines)
- `test_economy.cairo` — gold income (171 lines)
- `test_victory.cairo` — win conditions (175 lines)
- `test_constants.cairo` — constant lookups (228 lines)
- `test_types.cairo` — type packing/unpacking (80 lines)

---

## Known Issues & Caveats

1. **Contract size warning:** `CASM program exceeds maximum byte-code size on Starknet` (91,476 vs 81,920 limit). This only matters for mainnet deployment; Katana ignores this limit.

2. **Unused import warning:** `IMPROVEMENT_NONE` in `city.cairo` -- harmless.

3. **Optimistic state is approximate:** The client-side optimistic updates (especially for combat) don't replicate exact server logic. After EndTurn flush, `refreshState()` replaces local state with the authoritative server state. Combat animations show generic "Hit!" text since damage amounts aren't pre-computed client-side.

   **Note:** Because the contract silently skips invalid actions rather than reverting, an optimistic update that doesn't match the contract's validation will simply be ignored on-chain. The authoritative state from `refreshState()` will correct the client.

4. **No fog of war:** Both players see the entire map. The `design/phase2_zk_privacy/` docs describe a future ZK-based fog of war system.

5. **2 players only:** The contract supports `num_players` parameter but the UI is hardcoded for 2 players.

6. **Single browser:** Both players play from the same browser tab (hotseat). No networking/multiplayer.

7. **No save/load:** Game state lives only in Katana memory. Restarting Katana loses the game.

8. **Tile `pixelToHex` brute-force:** Iterates all 640 tiles per mouse move. Fine for 32x20 but would need optimization for larger maps.

9. **No turn timer:** The design docs describe a 5-minute turn timer with `claim_timeout`, but this is not implemented. Adding it risks leaving the game in an unrecoverable state if a player disconnects (no one can claim timeout in hotseat mode). Deferred to multiplayer phase.

---

## Suggested Next Steps

These are potential areas for improvement, roughly ordered by impact:

### Gameplay
- **More unit types:** Spearman, Horseman, Swordsman (constants exist but no contract logic)
- **Great People / trade routes** (see `design/future/`)
- **Barbarian camps** (see `design/phase3_expansion/02_barbarians.md`)
- **City-states** (see `design/phase3_expansion/03_city_states.md`)
- **Religion system** (see `design/future/01_religion.md`)
- ~~**Score victory implementation**~~ — now fully implemented: `get_score()` computes real scores, score victory triggers at turn 150, kill/capture counters tracked

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
7. Add validation case in `validateAction()` in `ui/index.html` — must mirror contract preconditions
8. Write tests in appropriate `tests/*.cairo` file — test invalid actions by verifying state is unchanged (no `#[should_panic]` for action-level errors)

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
7. Add validation constants (`UNIT_COMBAT_STRENGTH`, etc.) if needed in `ui/index.html`
8. Write tests

### Adding a new Scenario
1. Create a generator function in `ui/scenarios.js` that yields `[p0Actions, p1Actions]` per turn
2. Add entry to `SCENARIOS` array: `{ name, seed, numPlayers, runner: function*(state) { ... } }`
3. Use helper functions (`scScoutActions`, `scChooseProduction`, `scStrategicTech`, etc.) for AI logic
4. The `state` object passed to the generator mirrors the server JSON structure from `GET /api/state`
5. Scenarios auto-appear in the lobby dropdown via `populateScenarios()`

### Modifying Client-side Validation
When contract action validation logic changes, the corresponding JavaScript validation in `validateAction()` (`ui/index.html`) must be updated to match. The validator uses global helper functions and constants that mirror the Cairo contract:
- `tileMoveCost(tile)` — movement cost by terrain/feature
- `playerHasTech(player, techId)` — checks completed tech bitmask
- `canResearchTech(player, techId)` — checks prerequisites
- `isValidImpForTile(impType, tile)` — terrain/resource compatibility for improvements
- `BLDG_REQ_TECH_MAP` — building→tech requirement mapping
- `IMP_REQ_TECH` — improvement→tech requirement mapping

### Data Flow: Player Action → On-Chain (Simultaneous Turns)
```
Player A clicks UI
  → doAction() or queuePredicted() [index.html]
  → applyOptimistic() updates local G, starts animations
  → action pushed to pendingActions[]
  → (player continues planning immediately)
  ...
Player A clicks "Submit Turn"
  → endTurn() validates locally (production/research set?)
  → submitBatch() sends queued actions to server
  → POST /api/turn [server.js]
  → encodeAction() converts to felt252 calldata
  → accounts[0].execute('submit_turn', calldata) [starknet.js]
  → Contract processes actions, validates state, marks player as submitted
  → Contract stores transaction hash for seed derivation
  → refreshState() → G.currentPlayer switches to Player B (first unsubmitted)
  ...
Player B clicks "Submit Turn" (same flow)
  → Contract marks Player B as submitted
  → All players submitted → resolve_round() triggers:
    → Poseidon hash of all tx hashes → turn_seed
    → process_end_of_turn() for each player (growth, production, research, gold, healing)
    → Increment game_current_turn
    → Reset all players' movement and submission status
    → Check score victory
  → refreshState() → new turn begins, G.currentPlayer = 0
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

*Last updated: 2026-02-22. 579 tests passing, ~20,860 lines of code. Contract builds successfully. Simultaneous turns: all players submit independently, round resolves when all have submitted, turn_seed derived from Poseidon hash of all tx hashes. UI features: multi-step lobby (deploy → create → join → enter), client-side action validation (mirrors contract rules), scenario replay system (AI-vs-AI generator-based), optimistic updates with animation. City garrison protection: attacks on city tiles always hit the city, garrisoned units destroyed on capture. Score victory, bankruptcy disbandment, kill/capture tracking, game-over UI, and forfeit all implemented. Action handlers use soft failure (silent skip) for blockchain compatibility; only turn-submission validation reverts.*
