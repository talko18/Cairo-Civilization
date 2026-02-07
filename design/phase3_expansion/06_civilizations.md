# Civilizations & Leader Abilities

## 1. Design Goal

Add asymmetric starting conditions and passive bonuses that give each player a distinct playstyle, faithful to Civ VI's civilization system. Must work within the existing MVP architecture with **zero changes to pure game logic modules**.

## 2. Architecture: The Modifier Pattern

The MVP separates game logic (pure functions) from state management (contract). Civilization abilities exploit this separation:

```
                Pure modules                    Contract (glue layer)
                ──────────                      ─────────────────────
                                                read civ_id for player
compute_tile_yield(terrain, ...)  ──────────►   apply_civ_yield_modifier(civ_id, yield)
effective_defense_cs(base_cs, ...)  ────────►   apply_civ_combat_modifier(civ_id, cs)
process_growth(pop, food, ...)  ────────────►   apply_civ_growth_modifier(civ_id, ...)
production_cost(item_id)  ──────────────────►   apply_civ_production_modifier(civ_id, cost)
```

**The rule**: pure modules compute base values. The contract applies civ-specific modifiers after. No pure module ever reads `civ_id`. This means:
- Adding a new civ = adding entries to modifier lookup tables
- No existing function signatures change
- All existing tests remain valid (they test base values)
- New civ-specific tests are added separately

## 3. What Each Civilization Gets

Following Civ VI's structure, adapted to our mechanical scope:

| Component | Description | Implementation |
|---|---|---|
| **Civilization Ability** | A passive bonus active throughout the game | Modifier applied in contract after pure function calls |
| **Unique Unit** | Replaces a standard unit with different stats | New unit_type ID in constants.cairo, replacement mapping in civ config |
| **Unique Building** | Replaces a standard building with different yields | New building bit in City.buildings (u32), replacement mapping in civ config |
| **Starting Bonus** | Extra units, free building, or other one-time effect | Applied during join_game |

## 4. Storage Changes

Minimal additions to the contract:

```cairo
// New storage entries
player_civilization: LegacyMap<(u64, u8), u8>,  // (game_id, player_idx) → civ_id

// New constant tables (in constants.cairo)
// CIV_NONE: u8 = 0  (MVP default — no bonuses)
// CIV_ROME: u8 = 1
// CIV_EGYPT: u8 = 2
// etc.
```

No changes to Unit, City, TileData, or any existing struct. The `civ_id` is read from storage only in the contract — never passed to pure modules.

## 5. Interface Changes

### Lobby

```cairo
// Updated create_game — player A picks civ at creation
fn create_game(ref self: TContractState, map_size: u8, civilization: u8) -> u64;

// Updated join_game — player B picks civ
fn join_game(ref self: TContractState, game_id: u64, civilization: u8);
```

### View Functions

```cairo
// New view function
fn get_player_civilization(self: @TContractState, game_id: u64, player_idx: u8) -> u8;
```

### No Changes To

- `submit_turn` — actions are the same regardless of civ
- All pure module interfaces — they never see civ_id
- All existing view functions — they return the same data

## 6. Modifier System

All modifiers live in a single lookup module: `src/civ.cairo`.

```cairo
/// Civ-specific configuration. One entry per civilization.
struct CivConfig {
    // Yield modifiers (added to base yields in specific conditions)
    river_production_bonus: u8,     // e.g., Egypt: +1 production for river cities
    farm_food_bonus: u8,            // e.g., +1 food from farms
    mine_production_bonus: u8,      // e.g., +1 production from mines
    
    // Combat modifiers
    defense_cs_bonus: u8,           // e.g., +3 CS when defending in own territory
    attack_cs_bonus: u8,            // e.g., +3 CS when attacking
    heal_on_kill: u8,               // e.g., Scythia: heal 30 HP on kill
    
    // Economic modifiers
    unit_maintenance_discount: u8,  // e.g., 0 = no discount, 1 = -1 gold per unit
    purchase_discount_pct: u8,      // e.g., 10 = 10% cheaper gold purchases
    
    // Growth modifiers  
    housing_bonus: u8,              // e.g., +2 base housing
    growth_food_bonus_pct: u8,      // e.g., 10 = 10% faster growth
    
    // Production modifiers
    building_production_bonus: u8,  // e.g., Rome: +1 production when building buildings
    unit_production_bonus: u8,      // e.g., Scythia: +1 production when building light cav
    
    // Science modifiers
    science_per_city_bonus: u8,     // e.g., +1 science per city owned (in half-points)
    
    // Unique replacements
    unique_unit_type: u8,           // 0 = none, else the unique unit_type ID
    replaces_unit_type: u8,         // which standard unit it replaces (for production/upgrade)
    unique_building_bit: u8,        // 0xFF = none, else the building bit index
    replaces_building_bit: u8,      // which standard building it replaces
    
    // Starting bonuses
    starting_bonus: u8,             // encoded: 0=none, 1=free monument, 2=extra builder, etc.
}

/// Get the config for a civilization. Pure lookup.
fn get_civ_config(civ_id: u8) -> CivConfig;

/// Apply yield modifier to a computed tile yield.
fn apply_yield_modifier(
    config: @CivConfig,
    base_yield: TileYield,
    terrain: u8,
    improvement: u8,
    has_river: bool,
) -> TileYield;

/// Apply combat modifier.
fn apply_combat_modifier(
    config: @CivConfig,
    base_cs: u8,
    is_attacking: bool,
    in_own_territory: bool,
) -> u8;

/// Apply production cost modifier.
fn apply_production_modifier(
    config: @CivConfig,
    base_cost: u16,
    item_id: u8,  // to distinguish unit vs building
) -> u16;
```

### How the Contract Uses It

```cairo
// In submit_turn action handler for AttackUnit:
fn handle_attack(game_id, attacker_player, attacker_id, target_q, target_r) {
    let attacker = read_unit(game_id, attacker_player, attacker_id);
    let defender = read_unit(game_id, defender_player, defender_id);
    
    // Base combat (pure function — unchanged from MVP)
    let attacker_cs = combat::unit_combat_strength(attacker.unit_type);
    let defender_cs = combat::effective_defense_cs(
        combat::unit_combat_strength(defender.unit_type),
        terrain, feature, fortify, river_crossing, in_city, wall_bonus
    );
    
    // Civ modifier (NEW — applied in contract only)
    let attacker_civ = get_civ_config(read_civ(game_id, attacker_player));
    let defender_civ = get_civ_config(read_civ(game_id, defender_player));
    let attacker_cs = civ::apply_combat_modifier(@attacker_civ, attacker_cs, true, in_own_territory);
    let defender_cs = civ::apply_combat_modifier(@defender_civ, defender_cs, false, in_own_territory);
    
    // Resolve with modified values (same pure function)
    let result = combat::resolve_melee_combat(attacker_cs, defender_cs, random);
    
    // Civ on-kill bonus
    if result.defender_killed && attacker_civ.heal_on_kill > 0 {
        attacker_hp = min(attacker.hp + attacker_civ.heal_on_kill, 100);
    }
    
    // ... write results
}
```

## 7. Example Civilizations (Initial Set)

Designed for 2-player duels using only MVP mechanics (no religion, culture, wonders, policies).

### Rome — The Expansionist
| Component | Detail |
|---|---|
| **Ability**: All Roads Lead to Rome | First city founded gets a free Monument. +1 production in cities when producing buildings. |
| **Unique Unit**: Legion | Replaces Warrior. CS 25 (vs 20). Can build 1 improvement (like a Builder with 1 charge). |
| **Unique Building**: Bath | Replaces Granary. +2 food, +3 housing (vs +1 food, +2 housing). |

```cairo
CivConfig {
    building_production_bonus: 1,  // +1 prod when building buildings
    unique_unit_type: 6,           // UNIT_LEGION
    replaces_unit_type: 3,         // replaces Warrior
    unique_building_bit: 7,        // BUILDING_BATH
    replaces_building_bit: 1,      // replaces Granary
    starting_bonus: 1,             // free Monument in first city
    // all other fields: 0
}
```

### Egypt — The River Builder
| Component | Detail |
|---|---|
| **Ability**: Iteru | +15% production in cities adjacent to a river (applied as +1 production per 7 base production, rounded down). |
| **Unique Unit**: Maryannu Chariot Archer | Replaces Slinger. CS 8, RS 18, Range 1, Move 3. Faster but same era. |
| **Unique Building**: Sphinx | Replaces Monument. +2 science, +1 food (vs +1 science, +1 production). |

### Sumeria — The Early Aggressor
| Component | Detail |
|---|---|
| **Ability**: Epic Quest | Units earn +50% more gold from capturing cities. Defeated enemy units grant +5 gold. |
| **Unique Unit**: War-Cart | Replaces Warrior. CS 28, Move 3. No tech required. Extremely strong early. |
| **Unique Building**: Ziggurat | Replaces Library. +3 science, +1 production (vs +2 science). Does NOT require Writing tech (available immediately). |

### Scythia — The Cavalry Raider
| Component | Detail |
|---|---|
| **Ability**: People of the Steppe | All units heal 20 HP when they kill an enemy unit. Scouts have +5 CS. |
| **Unique Unit**: Saka Horse Archer | Replaces Slinger. CS 8, RS 15, Range 1, Move 4. Very fast ranged unit. |
| **Unique Building**: Kurgan | Replaces Monument. +1 production, +1 gold, +1 housing (vs +1 science, +1 production). |

### Greece — The Strategist
| Component | Detail |
|---|---|
| **Ability**: Plato's Republic | +1 science per city owned (in half-points: +2 half-science per city). |
| **Unique Unit**: Hoplite | Replaces Warrior. CS 22. +5 CS when adjacent to another friendly military unit. |
| **Unique Building**: Acropolis | Replaces Library. +2 science, +1 production. Costs 80 (vs 90). |

### Nubia — The Archer Nation
| Component | Detail |
|---|---|
| **Ability**: Ta-Seti | +50% production when building ranged units. Ranged units get +1 range after researching Archery. |
| **Unique Unit**: Pitati Archer | Replaces Archer. CS 12, RS 28, Range 2, Move 3. Faster and stronger. |
| **Unique Building**: Nubian Pyramid | Replaces Monument. +2 science on desert/desert hills tiles, +1 food elsewhere. |

## 8. Unique Unit Implementation

Unique units are just new entries in the unit stats table:

```cairo
// constants.cairo additions
// Standard units: 0-5
const UNIT_LEGION: u8 = 6;          // Rome, replaces Warrior
const UNIT_MARYANNU: u8 = 7;        // Egypt, replaces Slinger
const UNIT_WAR_CART: u8 = 8;        // Sumeria, replaces Warrior
const UNIT_SAKA_HORSE_ARCHER: u8 = 9;  // Scythia, replaces Slinger
const UNIT_HOPLITE: u8 = 10;        // Greece, replaces Warrior
const UNIT_PITATI: u8 = 11;         // Nubia, replaces Archer

// Production IDs for unique units: 7-12 (unit range 1-63)
// Unique units use the SAME production_cost as the unit they replace
// (or a custom cost if specified in CivConfig)
```

The existing `unit_combat_strength(unit_type)`, `unit_ranged_strength(unit_type)`, `unit_range(unit_type)`, and `reset_movement(unit_type)` functions in constants.cairo already dispatch by `unit_type: u8`. Adding new entries is just extending the match statement — no structural change.

**Replacement logic**: When a player with civ_id=Rome tries to produce a Warrior (prod_id=4), the contract substitutes it with Legion (prod_id=7). The `can_produce` check uses the replacement's tech requirement (if any). This substitution happens in the contract, not in the pure modules.

**Upgrade paths**: Unique units upgrade to the next standard unit in line (e.g., Legion → Swordsman when added post-MVP). The `can_upgrade` function in economy.cairo takes `unit_type` and looks up the upgrade path — adding entries for unique units is just extending the lookup table.

## 9. Unique Building Implementation

Same pattern as unique units:

```cairo
// constants.cairo additions
const BUILDING_BATH: u8 = 7;           // Rome, replaces Granary
const BUILDING_SPHINX: u8 = 8;         // Egypt, replaces Monument
const BUILDING_ZIGGURAT: u8 = 9;       // Sumeria, replaces Library
const BUILDING_KURGAN: u8 = 10;        // Scythia, replaces Monument
const BUILDING_ACROPOLIS: u8 = 11;     // Greece, replaces Library
const BUILDING_NUBIAN_PYRAMID: u8 = 12;  // Nubia, replaces Monument

// Production IDs: 71-76 (building range 64-127)
```

`building_yield_bonuses(buildings, is_capital)` already dispatches by checking individual bits in the u32 bitmask. Adding new bits = extending the function. The building yields table in constants.cairo gets new entries.

**Replacement logic**: When Rome tries to build a Granary, the contract substitutes it with Bath (different bit, different yields). A civ can only build their unique building, not the standard one it replaces. The `can_produce` check enforces this.

**Mutual exclusion**: The unique building and the replaced building use different bits. The contract ensures a civ can only produce their version. Standard civs (or MVP with no civ selected) use the original bits 0-6.

## 10. Starting Bonuses

Applied during `join_game` after placing starting units:

```cairo
match civ_config.starting_bonus {
    0 => {},  // no bonus (MVP default)
    1 => {    // free Monument — Rome
        let city = read_city(game_id, player_idx, 0);
        let city = City { buildings: add_building(city.buildings, BUILDING_MONUMENT), ..city };
        write_city(game_id, player_idx, 0, city);
    },
    2 => {    // extra Builder
        create_unit(game_id, player_idx, UNIT_BUILDER, start_q, start_r);
    },
    // ... more bonus types
}
```

This runs after the player's first city is founded (or after starting units are placed, depending on the bonus type). Since it's in the contract's `join_game`, no pure modules are affected.

## 11. Balance Considerations

### Power Budget
Each civ should have roughly equivalent total power, distributed differently:
- **Combat-focused** civs (Sumeria, Scythia) get strong unique units but weaker economy
- **Economy-focused** civs (Egypt, Rome) get yield bonuses but standard military
- **Science-focused** civs (Greece, Nubia) get faster research but no economic bonus

### Testing
For each civilization, add tests:
- Unique unit stats are correct
- Unique building yields are correct
- Ability modifier is applied correctly
- Replacement substitution works (can't build both standard and unique)
- Starting bonus is applied correctly
- Score calculation handles unique buildings correctly

Estimated: ~10 tests per civilization × 6 civs = ~60 new tests.

## 12. Why the MVP Design Already Supports This

| MVP Design Choice | How It Enables Civs |
|---|---|
| **Pure function modules** | Civ modifiers applied in contract after pure function calls — no module changes |
| **u8 unit_type with 0-5 used** | 57 free IDs for unique units |
| **u32 building bitmask with bits 0-6 used** | 25 free bits for unique buildings |
| **Range-separated production IDs** | Units 7-63 and buildings 71-127 are free |
| **u64 tech bitmask with 18 used** | 46 free slots for civ-specific tech bonuses |
| **Constants in lookup tables** | Adding unit stats = extending match statement |
| **Contract as glue layer** | Only place that needs civ awareness |
| **Storage helpers (read_unit, write_unit)** | Civ substitution happens at storage/dispatch boundary |
| **StorePacking for Unit** | Unit.unit_type is u8 — new IDs pack identically |

### No MVP Code Changes Required

The MVP can ship with `CIV_NONE` (id=0) as the default. All modifier functions return base values unchanged when `civ_id == 0`. When Phase 3 adds civilizations:
1. Add `player_civilization` to storage
2. Add `civ.cairo` module with `CivConfig` and modifier functions
3. Add civ-specific entries to constants.cairo (unit stats, building yields)
4. Add modifier calls in contract action handlers (after pure function calls)
5. Update `create_game` / `join_game` to accept civilization parameter

Steps 1-3 are additive (new code). Step 4 is the only change to existing code, and it's localized to the contract glue layer. Step 5 is a minor interface extension.
