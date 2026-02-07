# Feature Map — MVP Implementation Order

TDD approach: for each feature, write its tests first, then implement, then verify all tests pass before moving on.

---

## Dependency Graph

```
                    types + constants
                          │
                         hex
                        / | \
                 map_gen  |  movement
                    │     |     │
                    │   tech    │
                    │   / \    │
                    │ city  \  │
                    │  |    │  │
                    │ economy  │
                    │    \   / │
                    │    turn  │
                    │     │    │
                    │  victory │
                    │     │    │
                    └─ contract ─┘
                          │
                    integration
                          │
                      system
```

Every module only depends on modules above it. We implement top-down through this graph.

---

## Feature 1: Types & Constants

**What**: All shared data types, enums, constants, lookup tables, and `StorePacking` implementations. No game logic.

**Files**:
- `src/types.cairo` — Unit, City, TileData, Action enum, CombatResult, CityYields, TileYield, StorePacking impls
- `src/constants.cairo` — terrain IDs, unit stats table, building costs, damage lookup table (81 entries), production ID ranges, tech costs, improvement valid terrain

**Tests**: Minimal — verify StorePacking round-trips (pack then unpack returns original value). Add `tests/test_types.cairo` with 3 tests:
- Pack/unpack Unit with edge values (hp=200, all fields set)
- Pack/unpack City with edge values (buildings bitmask fully set)
- Pack/unpack TileData with all fields set

**Why StorePacking here**: Without packing, every struct field occupies a separate storage slot. Unit = 7 slots instead of 1. This multiplies gas costs ~4x. See `04_gas_estimation.md` §2.

**Done when**: Project compiles with all type definitions. StorePacking round-trip tests pass.

---

## Feature 2: Hex Math

**What**: Distance, neighbors, bounds checking, LOS, coordinate conversion. The spatial foundation everything else builds on.

**Files**:
- `src/hex.cairo`
- `tests/test_hex.cairo`

**Tests (27)**: H1–H27

**Depends on**: types (coordinate types, MAP_WIDTH, MAP_HEIGHT)

**Key functions**:
- `hex_distance` — used by city founding (min distance), ranged attack (range check), territory (radius)
- `hex_neighbors` — used by movement, territory expansion, city founding
- `in_bounds` — used everywhere
- `has_line_of_sight` — used by ranged combat
- `hexes_in_range` — used by territory
- `is_river_crossing` — used by movement, combat modifiers
- `axial_to_storage` / `storage_to_axial` — used by client, display
- `direction_between` — used by river edge detection

**Done when**: All 27 hex tests pass.

---

## Feature 3: Map Generation

**What**: Generate a complete 32x20 map from a seed. Terrain, features, resources, rivers, starting positions.

**Files**:
- `src/map_gen.cairo`
- `tests/test_map_gen.cairo`

**Tests (23)**: M1–M23

**Depends on**: hex (distance for starting positions, neighbors for rivers/smoothing), constants (terrain distribution targets)

**Key functions**:
- `generate_map` — called once during `join_game`
- `find_starting_positions` — determines where players begin
- `validate_map` — ensures map is playable
- `latitude_bias` — temperature variation

**Done when**: All 23 map_gen tests pass. Generated maps have correct terrain distributions and valid starting positions.

---

## Feature 4: Tech Tree

**What**: Tech prerequisites, completion, cost lookup, unlock queries. Pure data + logic, no dependencies on city/economy.

**Files**:
- `src/tech.cairo`
- `tests/test_tech.cairo`

**Tests (22)**: T1–T22

**Depends on**: types (tech IDs, bitmask), constants (tech costs, prerequisites table, unlock table)

**Why before city/movement/combat**: City production checks (`can_produce`) need `is_tech_completed`. Improvement building needs `improvement_required_tech`. Unit upgrades need tech checks. Best to have tech ready first.

**Key functions**:
- `has_prerequisites` — used by SetResearch action validation
- `is_tech_completed` — used by can_produce, can_upgrade, improvement checks
- `tech_cost_half` — used by science processing
- `process_science` — used by end-of-turn
- `building_required_tech`, `improvement_required_tech` — used by city module
- `is_valid_improvement_for_tile` — used by BuildImprovement validation

**Done when**: All 22 tech tests pass.

---

## Feature 5: Movement

**What**: Movement validation, cost calculation, terrain passability, river crossing, stacking rules.

**Files**:
- `src/movement.cairo`
- `tests/test_movement.cairo`

**Tests (29)**: V1–V29

**Depends on**: hex (neighbors, distance, river crossing), types (Unit struct, terrain types), constants (movement costs per terrain, unit movement points)

**Key functions**:
- `validate_move` — core movement validation, used by MoveUnit action
- `terrain_movement_cost` — terrain cost table
- `is_impassable` — quick passability check
- `apply_move` — mutates unit position + deducts MP
- `reset_movement` — called at turn start

**Done when**: All 29 movement tests pass. Covers flat/hills/woods/marsh costs, impassable terrain, river crossing, stacking (military+civilian only), melee needing MP, ranged not needing MP, fortify reset on move, build/remove consuming movement.

---

## Feature 6: Combat

**What**: Damage calculation, defense modifiers, ranged vs melee, city combat, random factor, civilian capture.

**Files**:
- `src/combat.cairo`
- `tests/test_combat.cairo`

**Tests (37)**: C1–C37

**Depends on**: hex (distance for range check, LOS for ranged), types (Unit, CombatResult), constants (damage lookup table, unit CS/RS values)

**Key functions**:
- `resolve_melee_combat` — full melee resolution
- `resolve_ranged_combat` — ranged, no counter-damage
- `effective_defense_cs` — stacks all defense modifiers
- `lookup_damage` — indexes into the 81-entry table
- `combat_random` — Poseidon-based, deterministic
- `city_combat_strength` — 15 + pop×2 + wall_bonus
- `validate_ranged_attack` — range + LOS check

**Done when**: All 37 combat tests pass. Covers all defense modifiers, ranged/melee distinction, city combat, civilian capture, fortify reset on attack.

---

## Feature 7: City & Buildings

**What**: City founding, tile yields, citizen assignment, population growth, housing, territory, buildings, production, improvements.

**Files**:
- `src/city.cairo`
- `tests/test_city.cairo`

**Tests (58)**: Y1–Y53 (including Y44b–Y44f sub-tests)

**Depends on**: hex (distance for min-city-distance, hexes_in_range for territory), tech (for can_produce, improvement requirements), types, constants (terrain yields, building costs, improvement yields)

**This is the largest module.** Split implementation into sub-features:

### 7a: City Founding (Y1–Y8)
- `validate_city_founding` — terrain, distance checks
- `create_city` — defaults, capital detection

### 7b: Tile Yields (Y9–Y16, Y47–Y48)
- `compute_tile_yield` — base terrain + feature + resource + improvement + sailing

### 7c: Building Yields & Housing (Y17–Y23, Y33–Y34, Y49)
- `building_yield_bonuses` — per-building yield lookup
- `compute_housing` — base + building bonuses
- `has_building` / `add_building` — bitmask operations

### 7d: Population Growth (Y24–Y28, Y46)
- `process_growth` — food surplus, growth threshold, housing cap, starvation floor

### 7e: Territory (Y29–Y31)
- `territory_radius` — population-based ring expansion

### 7f: Citizen Assignment (Y32, Y53)
- `auto_assign_citizens` — food > production > gold priority, center tile always free

### 7g: Production (Y35–Y42, Y45, Y50–Y52)
- `production_cost` — item cost lookup
- `can_produce` — tech requirements, not-already-built, water mill river check
- `process_production` — stockpile accumulation, completion, carryover
- Unit spawn rules (city tile, adjacent if occupied)

### 7h: Improvements (Y43–Y44f)
- `is_valid_improvement_for_tile` — terrain/feature/resource match
- Build on existing reverts, remove flow, mine on flat fails

**Done when**: All 58 city tests pass.

---

## Feature 8: Economy (Gold)

**What**: Gold income, expenses, treasury management, bankruptcy disbanding, gold purchases, unit upgrades.

**Files**:
- `src/economy.cairo`
- `tests/test_economy.cairo`

**Tests (15)**: E1–E14 + E6b

**Depends on**: types, constants (unit maintenance cost, purchase multiplier, upgrade costs), city (CityYields for gold income), tech (for upgrade eligibility)

**Key functions**:
- `compute_gold_income` — sum city gold yields + palace
- `compute_gold_expenses` — 1 per military unit
- `process_gold` — treasury update, disband count
- `purchase_cost` — production_cost × 4
- `upgrade_cost` / `can_upgrade` — Slinger→Archer path

**Done when**: All 15 economy tests pass. Lowest-HP-first disbanding verified.

---

## Feature 9: End-of-Turn Processing

**What**: Orchestrates all per-turn effects: movement reset, city yields, growth, production, science, gold, healing, fortify increment.

**Files**:
- `src/turn.cairo`
- `tests/test_turn.cairo`

**Tests (14)**: N1–N12 + N5b + N5c

**Depends on**: city (yields, growth, production), tech (science processing), economy (gold processing), movement (reset), types

**Key functions**:
- `heal_unit` — territory-based healing with fortify bonus, Barracks 110HP cap interaction
- `reset_unit_movement` — per unit type
- `is_friendly_territory` — tile ownership check

**Note**: The full `process_end_of_turn` function is tested via integration tests (I38–I47) since it touches storage. The unit tests here cover the pure helper functions.

**Done when**: All 14 turn tests pass.

---

## Feature 10: Victory Conditions

**What**: Domination check (capital captured), score calculation, turn limit.

**Files**:
- `src/victory.cairo`
- `tests/test_victory.cairo`

**Tests (14)**: W1–W14

**Depends on**: types (City struct for is_capital), constants (score weights, turn limit)

**Key functions**:
- `check_domination` — is_capital check on captured city
- `compute_score` — weighted sum of all score components
- `is_turn_limit_reached` — turn >= 150

**Done when**: All 14 victory tests pass. All score components (+5 pop, +10 city, +3 tech, +4 kill, +15 captured city, +10 building, +2 explored) tested individually.

---

## Feature 11: Contract — Glue Layer

**What**: The StarkNet contract that ties everything together. Storage layout, action dispatch, access control, event emission. This is the **only** module that touches storage — all game logic is delegated to pure-function modules.

**Files**:
- `src/contract.cairo`
- `src/lib.cairo`
- `tests/test_contract.cairo`

**Tests (92)**: I1–I60 + all sub-lettered integration tests

**Depends on**: ALL modules above

**Gas optimization hooks** (see `04_gas_estimation.md`):
- All storage reads/writes use internal helpers (`read_unit`, `write_unit`, `read_tile_owner`, `write_tile_owner`, etc.) — never raw `LegacyMap` access in action handlers. This isolates storage layout changes (packing, batching) to the helper functions.
- Territory assignment uses `write_tile_owner(game_id, q, r, player_idx, city_id)` — internally writes to 1 or 2 maps depending on whether OPT-1 is applied.
- Map generation is called via a wrapper that can be swapped for chunked generation (OPT-2) without changing `join_game`'s external interface.

This is the integration layer. Split into sub-features matching the test plan sections:

### 11a: Game Lifecycle (I1–I8)
- `create_game` — game_id counter, storage init, emit GameCreated
- `join_game` — player registration, map generation, starting units, emit GameStarted

### 11b: Turn Access Control (I9–I13)
- `submit_turn` — caller check, game status check, timer check, turn increment

### 11c: Action Dispatch — Movement & Founding (I14–I19, I37g–I37h)
- MoveUnit action handler
- FoundCity action handler (consume settler, create city, assign territory)

### 11d: Action Dispatch — Combat (I20–I24, I37b–I37f, I37z)
- AttackUnit action handler (immediate resolution, emit CombatResolved)
- RangedAttack action handler (range + LOS check)
- Civilian capture handler

### 11e: Action Dispatch — City Management (I25–I26, I37i–I37j)
- SetProduction action handler

### 11f: Action Dispatch — Research (I27–I29, I37k)
- SetResearch action handler

### 11g: Action Dispatch — Improvements (I30–I32, I30b–I30e, I37l–I37m)
- BuildImprovement action handler (type param, terrain check, existing check, charge deduct, movement consume)
- RemoveImprovement action handler

### 11h: Action Dispatch — Other Actions (I33–I37, I37n–I37t)
- FortifyUnit, PurchaseWithGold, UpgradeUnit, DeclareWar handlers

### 11i: End-of-Turn Processing (I38–I47)
- Wire up turn.cairo functions to storage reads/writes

### 11j: City Capture (I37u–I37y)
- Ownership transfer, HP reset to 100, pop -1 (min 1), improvement destruction

### 11k: Timeout (I48–I51d)
- `claim_timeout` — timer check, consecutive count, forfeit

### 11l: View Functions (I52–I60)
- All `get_*` view functions for UI reads

**Done when**: All 92 integration tests pass.

---

## Feature 12: System Tests

**What**: Full game scenarios that play through multiple turns to test feature interactions.

**Files**:
- `tests/test_system.cairo`

**Tests (21)**: S1–S20 + S10b

**Depends on**: Fully working contract

These are end-to-end tests. Each scenario exercises a specific gameplay arc:

### Priority order:
1. **S4** — Settle and grow (basic city lifecycle)
2. **S11** — City production chain (Monument → Granary → Warrior)
3. **S5** — Tech chain (Mining → Masonry → Construction)
4. **S10 + S10b** — Builder improvements + replacement flow
5. **S6** — Combat sequence (move, attack, kill)
6. **S8** — Economy bankruptcy
7. **S12** — Housing limits growth
8. **S9** — Ranged combat flow (Slinger → upgrade → Archer)
9. **S14** — Barracks HP bonus
10. **S15** — Walls city attack
11. **S16** — Civilian capture
12. **S17** — Multiple combats per turn
13. **S18** — War declaration required
14. **S13** — Territory conflict
15. **S7** — City siege + capture
16. **S1** — Full game domination
17. **S2** — Full game score victory
18. **S3** — Forfeit via timeout
19. **S19** — All units lost, still plays
20. **S20** — Invalid mid-sequence reverts all

**Done when**: All 21 system tests pass.

---

## Implementation Timeline Summary

```
Feature                      Tests    Cumulative    Milestone
─────────────────────────────────────────────────────────────
 1. Types & Constants            3            3     Project compiles, packing works
 2. Hex Math                    27           30     Spatial math works
 3. Map Generation              23           53     Maps generate correctly
 4. Tech Tree                   22           75     Research system works
 5. Movement                    29          104     Units can move
 6. Combat                      37          141     Units can fight
 7. City & Buildings            58          199     Cities work fully
 8. Economy                     15          214     Gold system works
 9. End-of-Turn                 14          228     Turn processing works
10. Victory                     14          242     Win conditions work
11. Contract (integration)      92          334     Full contract works
12. System Tests                21          355     Game plays end-to-end
                                        ───────
                             + 15 manual scenarios
```

**Each row = one implementation sprint.** Write the tests, implement the code, verify all pass.

Features 1–10 are pure-function modules — fast tests, no contract deployment. Feature 11 requires StarkNet test framework (contract deployment, storage). Feature 12 is the final validation.

---

## Per-Feature Workflow

For each feature above, the cycle is:

```
1. Create the test file with ALL test function signatures (empty bodies, #[should_panic] where expected)
2. Create the source module with function SIGNATURES only (no implementation)
3. Verify: tests compile but fail
4. Implement function by function:
   a. Fill in test body with concrete values from game rules
   b. Implement the function
   c. Run tests — verify this test passes
   d. Move to next function
5. Run ALL tests for this module — verify all pass
6. Run ALL previous tests — verify no regressions
7. Move to next feature
```

---

## Critical Implementation Notes

### Types first, always
Features 4–10 all depend on types.cairo being complete. Get it right once. If a type changes later, update it and re-run all tests.

### Constants are the source of truth
Every magic number (terrain yields, unit stats, building costs, tech prerequisites, damage table) lives in constants.cairo. Tests verify against these constants. Game rules docs are the design — constants.cairo is the implementation.

### Pure functions make TDD easy
Features 2–10 are pure functions (no storage, no side effects). This means:
- Tests are fast (no contract deployment)
- Functions are composable (city calls tech, economy calls city)
- Same code is reused in Phase 2 ZK circuit

### Contract is the only stateful layer
Feature 11 is the only place with `LegacyMap`, storage reads/writes, and access control. All game logic is delegated to pure-function modules. The contract is just dispatch + storage wiring.

### StorePacking goes in types.cairo (Feature 1)
Implement `StorePacking<Unit, felt252>`, `StorePacking<TileData, felt252>`, and the City packing in types.cairo. This is essential for gas feasibility — without it, costs multiply ~4x. See `04_gas_estimation.md`.

### Storage access via helpers (gas optimization compatibility)
In contract.cairo, never access `LegacyMap` directly in action handlers. Use internal helpers like `read_unit(game_id, player, unit_id) -> Unit` and `write_unit(game_id, player, unit_id, unit: Unit)`. This isolates the storage layout so that optimizations (tile_owner packing, unit batching, chunked map gen) can be applied later by changing only the helpers — zero changes to game logic or action handlers.
