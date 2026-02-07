# Program Interfaces

All code is Cairo. The contract is modular internally — each module exposes pure functions that take data in and return data out. This makes them testable in isolation and reusable as the Phase 2 ZK circuit.

## Project Structure

```
cairo_civ/
├── src/
│   ├── lib.cairo              # Module declarations
│   ├── contract.cairo         # StarkNet contract (ICairoCiv) — glue layer
│   ├── types.cairo            # All shared data types
│   ├── constants.cairo        # Game constants (lookup tables, costs, stats)
│   ├── hex.cairo              # Hex math (distance, neighbors, LOS)
│   ├── map_gen.cairo          # Map generation from seed
│   ├── movement.cairo         # Movement validation + execution
│   ├── combat.cairo           # Combat resolution
│   ├── city.cairo             # City founding, yields, growth, territory
│   ├── tech.cairo             # Tech tree logic
│   ├── economy.cairo          # Gold income/expenses, purchases
│   ├── turn.cairo             # End-of-turn processing orchestration
│   └── victory.cairo          # Victory condition checks
├── tests/
│   ├── test_hex.cairo
│   ├── test_map_gen.cairo
│   ├── test_movement.cairo
│   ├── test_combat.cairo
│   ├── test_city.cairo
│   ├── test_tech.cairo
│   ├── test_economy.cairo
│   ├── test_turn.cairo
│   ├── test_victory.cairo
│   ├── test_contract.cairo    # Integration tests via contract interface
│   └── test_system.cairo      # Full game scenarios
```

---

## Module 1: `types`

All shared data types. No logic — pure definitions.

```cairo
// --- Coordinates ---
const Q_OFFSET: u8 = 16;
const R_OFFSET: u8 = 0;
const MAP_WIDTH: u8 = 32;
const MAP_HEIGHT: u8 = 20;

// --- Terrain types (u8) ---
const TERRAIN_OCEAN: u8 = 0;
const TERRAIN_COAST: u8 = 1;
const TERRAIN_GRASSLAND: u8 = 2;
const TERRAIN_GRASSLAND_HILLS: u8 = 3;
const TERRAIN_PLAINS: u8 = 4;
const TERRAIN_PLAINS_HILLS: u8 = 5;
const TERRAIN_DESERT: u8 = 6;
const TERRAIN_DESERT_HILLS: u8 = 7;
const TERRAIN_TUNDRA: u8 = 8;
const TERRAIN_TUNDRA_HILLS: u8 = 9;
const TERRAIN_SNOW: u8 = 10;
const TERRAIN_SNOW_HILLS: u8 = 11;
const TERRAIN_MOUNTAIN: u8 = 12;

// --- Feature types (u8) ---
const FEATURE_NONE: u8 = 0;
const FEATURE_WOODS: u8 = 1;
const FEATURE_RAINFOREST: u8 = 2;
const FEATURE_MARSH: u8 = 3;
const FEATURE_OASIS: u8 = 4;

// --- Resource types (u8) ---
const RESOURCE_NONE: u8 = 0;
// 1=Wheat, 2=Rice, 3=Cattle, 4=Stone, 5=Fish,
// 6=Horses, 7=Iron, 8=Silver, 9=Silk, 10=Dyes

// --- Unit types (u8) ---
const UNIT_SETTLER: u8 = 0;
const UNIT_BUILDER: u8 = 1;
const UNIT_SCOUT: u8 = 2;
const UNIT_WARRIOR: u8 = 3;
const UNIT_SLINGER: u8 = 4;
const UNIT_ARCHER: u8 = 5;

// --- Improvement types (u8) ---
const IMPROVEMENT_NONE: u8 = 0;
const IMPROVEMENT_FARM: u8 = 1;
const IMPROVEMENT_MINE: u8 = 2;
const IMPROVEMENT_QUARRY: u8 = 3;
const IMPROVEMENT_PASTURE: u8 = 4;
const IMPROVEMENT_LUMBER_MILL: u8 = 5;

// --- Building bit indices (for City.buildings: u32) ---
const BUILDING_MONUMENT: u8 = 0;
const BUILDING_GRANARY: u8 = 1;
const BUILDING_WALLS: u8 = 2;
const BUILDING_LIBRARY: u8 = 3;
const BUILDING_MARKET: u8 = 4;
const BUILDING_BARRACKS: u8 = 5;
const BUILDING_WATER_MILL: u8 = 6;

// --- Production item IDs (u8, range-separated) ---
// 0 = none/idle
// 1-63 = units (1=Settler, 2=Builder, 3=Scout, 4=Warrior, 5=Slinger, 6=Archer)
// 64-127 = buildings (64=Monument, 65=Granary, 66=Walls, 67=Library, 68=Market, 69=Barracks, 70=WaterMill)
//
// IMPORTANT: production_item_id = unit_type + 1   (Settler: type=0, prod_id=1)
//            production_item_id = building_bit + 64 (Monument: bit=0, prod_id=64)

// --- Game status ---
const STATUS_LOBBY: u8 = 0;
const STATUS_ACTIVE: u8 = 1;
const STATUS_FINISHED: u8 = 2;

// --- Victory types ---
const VICTORY_DOMINATION: u8 = 0;
const VICTORY_SCORE: u8 = 1;
const VICTORY_FORFEIT: u8 = 2;

// --- Diplomacy status ---
const DIPLO_PEACE: u8 = 0;
const DIPLO_WAR: u8 = 1;

// --- Shared Structs ---
// Unit, City, TileData, PendingCombat, Action enum
// (as defined in 03_starknet_contracts.md)

/// Yield for a single tile (used by map_gen for starting position validation
/// and by city for yield computation). Lives in types, not in a specific module.
struct TileYield {
    food: u8,
    production: u8,
    gold: u8,
}
```

---

## Module 2: `hex`

Pure math functions. No storage access.

```cairo
/// Distance between two hex positions in storage coordinates.
fn hex_distance(q1: u8, r1: u8, q2: u8, r2: u8) -> u8;

/// Returns the 6 neighbor positions (storage coords). Invalid (off-map) neighbors
/// return Option::None.
fn hex_neighbors(q: u8, r: u8) -> Array<(u8, u8)>;

/// Check if a storage coordinate is within map bounds.
fn in_bounds(q: u8, r: u8) -> bool;

/// Check line of sight between two hexes. Returns true if unblocked.
/// `get_tile` is a closure/callback that returns terrain+feature for a position.
fn has_line_of_sight(
    from_q: u8, from_r: u8,
    to_q: u8, to_r: u8,
    terrain_at: fn(u8, u8) -> (u8, u8),  // returns (terrain, feature)
) -> bool;

/// Get all hexes within `radius` of (q, r), filtered to in-bounds.
fn hexes_in_range(q: u8, r: u8, radius: u8) -> Array<(u8, u8)>;

/// Check if two adjacent hexes share a river edge.
/// `river_edges_at` returns the river_edges bitmask for a tile.
fn is_river_crossing(
    from_q: u8, from_r: u8,
    to_q: u8, to_r: u8,
    river_edges_from: u8,
) -> bool;

/// Convert axial (signed) coordinates to storage (unsigned) coordinates.
fn axial_to_storage(q: i16, r: i16) -> (u8, u8);

/// Convert storage (unsigned) coordinates to axial (signed) coordinates.
fn storage_to_axial(q: u8, r: u8) -> (i16, i16);

/// Get the direction index (0-5) from one hex to an adjacent hex.
/// Returns Option::None if not adjacent.
fn direction_between(from_q: u8, from_r: u8, to_q: u8, to_r: u8) -> Option<u8>;
```

---

## Module 3: `map_gen`

Map generation from a seed. Called once per game during `join_game`.

```cairo
// TileYield is defined in types.cairo (shared between map_gen and city)

/// Generate the full map. Returns an array of (q, r, TileData) for all tiles.
/// Called once during join_game.
fn generate_map(seed: felt252, width: u8, height: u8) -> Array<(u8, u8, TileData)>;

/// Assign terrain type from hash values (h=height, m=moisture, t=temperature).
fn assign_terrain(h: u16, m: u16, t: u16) -> u8;

/// Assign feature (woods, marsh, etc.) for a given terrain and noise values.
fn assign_feature(terrain: u8, m: u16, t: u16, seed: felt252, q: u8, r: u8) -> u8;

/// Assign resource for a given terrain+feature and noise.
fn assign_resource(terrain: u8, feature: u8, seed: felt252, q: u8, r: u8) -> u8;

/// Generate rivers for the map. Returns array of (q, r, river_edges_bitmask).
fn generate_rivers(seed: felt252, tiles: Span<(u8, u8, TileData)>) -> Array<(u8, u8, u8)>;

/// Find valid starting positions for 2 players (at least 10 hexes apart,
/// with minimum food/production within 2 tiles).
fn find_starting_positions(
    tiles: Span<(u8, u8, TileData)>,
    seed: felt252,
) -> Option<((u8, u8), (u8, u8))>;

/// Validate that a map is playable (has starting positions, has land connectivity).
fn validate_map(tiles: Span<(u8, u8, TileData)>, seed: felt252) -> bool;

/// Compute latitude bias for temperature calculation.
fn latitude_bias(r: u8, height: u8) -> u16;
```

---

## Module 4: `movement`

Movement validation. Pure functions operating on game state data.

```cairo
/// Check if a unit can move from its current position to a destination.
/// Returns the movement cost if valid, or an error.
fn validate_move(
    unit: @Unit,
    dest_q: u8, dest_r: u8,
    tile_at_dest: @TileData,
    river_crossing: bool,
    friendly_military_at_dest: bool,
    enemy_at_dest: bool,
) -> Result<u8, MoveError>;  // Ok(cost) or Err

/// Get the movement cost for entering a tile.
fn terrain_movement_cost(terrain: u8, feature: u8) -> Option<u8>;
// Returns None if impassable, Some(cost) otherwise.

/// Check if a terrain is impassable for land units.
fn is_impassable(terrain: u8) -> bool;

/// Check if a unit has enough movement remaining for a move.
fn has_movement(unit: @Unit, cost: u8) -> bool;

/// Apply a move: update unit position and deduct movement.
fn apply_move(ref unit: Unit, dest_q: u8, dest_r: u8, cost: u8);

/// Reset all units' movement points at start of turn.
fn reset_movement(unit_type: u8) -> u8;  // returns max movement for type

/// Error types for movement validation.
enum MoveError {
    NotAdjacent,
    Impassable,
    InsufficientMovement,
    FriendlyUnitBlocking,
    OutOfBounds,
}
```

---

## Module 5: `combat`

Combat resolution. Pure functions — no storage access.

```cairo
/// Full result of a combat engagement.
struct CombatResult {
    damage_to_defender: u8,
    damage_to_attacker: u8,   // 0 for ranged attacks
    defender_killed: bool,
    attacker_killed: bool,
}

/// Resolve melee combat between attacker and defender.
fn resolve_melee_combat(
    attacker_cs: u8,
    defender_cs: u8,
    defender_terrain: u8,
    defender_feature: u8,
    defender_fortify_turns: u8,
    river_crossing: bool,
    random_factor: u8,   // 75-125
) -> CombatResult;

/// Resolve ranged combat (no counter-damage to attacker).
fn resolve_ranged_combat(
    attacker_rs: u8,
    defender_cs: u8,
    defender_terrain: u8,
    defender_feature: u8,
    defender_fortify_turns: u8,
    random_factor: u8,
) -> CombatResult;

/// Compute effective combat strength with defense modifiers.
fn effective_defense_cs(
    base_cs: u8,
    terrain: u8,
    feature: u8,
    fortify_turns: u8,
    river_crossing: bool,
    in_city_with_walls: bool,
    city_wall_bonus: u8,
) -> u8;

/// Look up base damage from the damage table for a given delta.
fn lookup_damage(delta: i16) -> u8;  // delta clamped to [-40, +40]

/// Compute combat random factor from game state.
fn combat_random(
    map_seed: felt252,
    game_turn: u32,
    attacker_id: u32,
    defender_id: u32,
) -> u8;  // returns 75-125

/// Compute city combat strength.
fn city_combat_strength(population: u8, wall_bonus: u8) -> u8;

/// Check if a ranged attack is valid (range + LOS).
fn validate_ranged_attack(
    attacker_q: u8, attacker_r: u8,
    target_q: u8, target_r: u8,
    attacker_range: u8,
    terrain_at: fn(u8, u8) -> (u8, u8),
) -> bool;

/// Get base combat/ranged strength for a unit type.
fn unit_combat_strength(unit_type: u8) -> u8;
fn unit_ranged_strength(unit_type: u8) -> u8;
fn unit_range(unit_type: u8) -> u8;
```

---

## Module 6: `city`

City founding, yields, growth, territory, buildings.

```cairo
/// Validate if a settler can found a city at (q, r).
fn validate_city_founding(
    q: u8, r: u8,
    terrain: u8,
    existing_cities: Span<(u8, u8)>,  // (q, r) of all cities in game
    min_distance: u8,                  // 3 for MVP
) -> Result<(), CityFoundError>;

/// Create a new city at the given position.
fn create_city(
    name: felt252,
    q: u8, r: u8,
    founder_player: u8,
    is_first_city: bool,  // if true, set is_capital = true
    turn: u16,
) -> City;

/// Compute total yields for a city (sum of worked tiles + buildings + palace).
fn compute_city_yields(
    city: @City,
    worked_tiles: Span<TileYield>,
) -> CityYields;

struct CityYields {
    food: u16,
    production: u16,
    gold: u16,
    half_science: u16,   // tracked in half-points
}

/// Compute yield for a single tile (terrain + feature + resource + improvement).
fn compute_tile_yield(
    terrain: u8, feature: u8, resource: u8,
    improvement: u8,
    has_sailing_tech: bool,  // for coast food bonus
) -> TileYield;

/// Get building yield bonuses for a city.
fn building_yield_bonuses(buildings: u32, is_capital: bool) -> CityYields;

/// Compute housing capacity for a city.
fn compute_housing(buildings: u32, has_river: bool, has_coast: bool) -> u8;

/// Process population growth for one city. Returns new population and food_stockpile.
fn process_growth(
    population: u8,
    food_stockpile: u16,
    food_surplus: i16,   // can be negative (starvation)
    housing: u8,
) -> (u8, u16);  // (new_pop, new_food_stockpile)

/// Compute territory radius from population.
fn territory_radius(population: u8) -> u8;

/// Auto-assign citizens to tiles. Returns indices of worked tiles.
/// Priority: food > production > gold.
fn auto_assign_citizens(
    population: u8,
    available_tiles: Span<TileYield>,
) -> Array<u8>;  // indices into available_tiles

/// Check if a city has a specific building.
fn has_building(buildings: u32, building_bit: u8) -> bool;

/// Add a building to a city's bitmask.
fn add_building(buildings: u32, building_bit: u8) -> u32;

/// Get production cost for an item (unit or building).
fn production_cost(item_id: u8) -> u16;

/// Check if a city can produce an item (tech requirements met, not already built).
fn can_produce(
    item_id: u8,
    completed_techs: u64,
    current_buildings: u32,
    has_river: bool,
) -> bool;

/// Process production for one city. Returns completed item (if any).
fn process_production(
    production_stockpile: u16,
    production_per_turn: u16,
    current_item: u8,
) -> (u16, Option<u8>);  // (new_stockpile, completed_item_id)

enum CityFoundError {
    OnMountain,
    OnWater,
    TooCloseToCity,
    OutOfBounds,
}
```

---

## Module 7: `tech`

Tech tree logic.

```cairo
/// Check if all prerequisites for a tech are met.
fn has_prerequisites(tech_id: u8, completed_techs: u64) -> bool;

/// Mark a tech as completed in the bitmask.
fn complete_tech(completed_techs: u64, tech_id: u8) -> u64;

/// Check if a specific tech is completed.
fn is_tech_completed(completed_techs: u64, tech_id: u8) -> bool;

/// Get the science cost (in half-points) for a tech.
fn tech_cost_half(tech_id: u8) -> u32;

/// Process science for one turn. Returns (new_progress, completed_tech_id or None).
fn process_science(
    current_tech: u8,
    tech_half_progress: u32,
    half_science_per_turn: u16,
    completed_techs: u64,
) -> (u32, Option<u8>);

/// Get what a tech unlocks (for applying effects on completion).
fn tech_unlocks(tech_id: u8) -> TechUnlock;

struct TechUnlock {
    reveals_resource: u8,        // 0 = none, else resource type
    unlocks_building: u8,        // 0 = none, else building bit
    unlocks_unit: u8,            // 0 = none, else unit type
    unlocks_improvement: u8,     // 0 = none, else improvement type
    passive_effect: u8,          // 0 = none, see doc for specific effects
}

/// Get the required tech for a building.
fn building_required_tech(building_bit: u8) -> u8;  // tech_id, 0 = no requirement

/// Get the required tech for an improvement.
fn improvement_required_tech(improvement: u8) -> u8;

/// Check if an improvement type is valid for a given terrain/feature/resource.
fn is_valid_improvement_for_tile(
    improvement: u8,
    terrain: u8,
    feature: u8,
    resource: u8,
) -> bool;

/// Count completed techs (popcount of bitmask).
fn count_completed_techs(completed_techs: u64) -> u8;
```

---

## Module 8: `economy`

Gold management.

```cairo
/// Compute gold income for a player (sum of city gold yields + palace).
fn compute_gold_income(city_yields: Span<CityYields>) -> u32;

/// Compute gold expenses (1 per military unit).
fn compute_gold_expenses(military_unit_count: u32) -> u32;

/// Process gold for one turn. Returns (new_treasury, units_to_disband).
fn process_gold(
    treasury: u32,
    income: u32,
    expenses: u32,
) -> (u32, u32);  // (new_treasury, disband_count — 0 if treasury >= 0)

/// Get gold purchase cost for an item.
fn purchase_cost(item_id: u8) -> u32;  // production_cost × 4

/// Get unit upgrade cost (50% of new unit's production cost, in gold).
fn upgrade_cost(from_type: u8, to_type: u8) -> Option<u32>;

/// Check if a unit type can be upgraded to another.
fn can_upgrade(from_type: u8, completed_techs: u64) -> Option<u8>;
// Returns the target unit type if upgradable, None otherwise.
```

---

## Module 9: `turn`

End-of-turn orchestration. Calls into other modules.

```cairo
/// Process all end-of-turn effects for the current player.
/// This is the main "game tick" function.
///
/// Order of operations:
///   1. Reset unit movement for next turn
///   2. For each city: compute yields, process growth, process production
///   3. Process science (tech progress)
///   4. Process gold (income - expenses, disband if bankrupt)
///   5. Heal units
///   6. Increment fortify counters for fortified units
///   7. Check victory conditions
///
/// In Phase 1, this runs on-chain inside submit_turn.
/// In Phase 2, this runs off-chain inside the prover.

fn process_end_of_turn(
    // This function orchestrates calls to city, tech, economy modules.
    // The exact signature depends on how state is passed — either as
    // storage references (Phase 1) or mutable struct references (Phase 2).
    // See contract.cairo for the concrete implementation.
);

/// Heal a unit based on territory type.
fn heal_unit(
    hp: u8, max_hp: u8,
    in_friendly_territory: bool,
    in_neutral: bool,
    is_fortified: bool,
) -> u8;  // new HP

/// Reset movement points for a unit at start of turn.
fn reset_unit_movement(unit_type: u8) -> u8;

/// Check if a tile is in friendly territory for a player.
/// tile_owner_player comes from the tile_owner_player map.
fn is_friendly_territory(
    player: u8,
    tile_owner_player: u8,
    tile_owner_city_id: u32,
) -> bool;  // true if city_id != 0 AND tile_owner_player == player
```

---

## Module 10: `victory`

Victory condition checking.

```cairo
/// Check if domination victory has been achieved.
/// Returns the winning player index if a capital was just captured.
fn check_domination(
    captured_city: @City,
) -> Option<u8>;  // winning player index

/// Compute score for a player.
fn compute_score(
    total_population: u16,
    city_count: u8,
    techs_completed: u8,
    tiles_explored: u16,
    lifetime_kills: u32,
    captured_cities_held: u8,
    buildings_completed: u16,
) -> u32;

/// Check if the game has reached the turn limit.
fn is_turn_limit_reached(game_turn: u32) -> bool;  // turn >= 150
```

---

## Module 11: `contract` — External Interface

### Write Functions (state-changing)

```cairo
#[starknet::interface]
trait ICairoCiv<TContractState> {
    // --- Game Lifecycle ---
    fn create_game(ref self: TContractState, map_size: u8) -> u64;
    fn join_game(ref self: TContractState, game_id: u64);

    // --- Turn ---
    fn submit_turn(
        ref self: TContractState,
        game_id: u64,
        actions: Span<Action>,
    );

    // --- Timeout ---
    fn claim_timeout(ref self: TContractState, game_id: u64);
}
```

### View Functions (read-only — needed by UI)

```cairo
#[starknet::interface]
trait ICairoCivView<TContractState> {
    // --- Game Metadata ---
    fn get_game_status(self: @TContractState, game_id: u64) -> u8;
    fn get_turn(self: @TContractState, game_id: u64) -> u32;
    fn get_current_player(self: @TContractState, game_id: u64) -> ContractAddress;
    fn get_player_address(self: @TContractState, game_id: u64, player_idx: u8) -> ContractAddress;
    fn get_player_count(self: @TContractState, game_id: u64) -> u8;
    fn get_map_seed(self: @TContractState, game_id: u64) -> felt252;
    fn get_winner(self: @TContractState, game_id: u64) -> ContractAddress;
    fn get_turn_timestamp(self: @TContractState, game_id: u64) -> u64;
    fn get_timeout_count(self: @TContractState, game_id: u64, player_idx: u8) -> u8;

    // --- Map ---
    fn get_tile(self: @TContractState, game_id: u64, q: u8, r: u8) -> TileData;
    fn get_tile_improvement(self: @TContractState, game_id: u64, q: u8, r: u8) -> u8;
    fn get_tile_owner(self: @TContractState, game_id: u64, q: u8, r: u8) -> (u8, u32);
    // returns (player_idx, city_id). city_id = 0 means unclaimed.

    // --- Units ---
    fn get_unit(self: @TContractState, game_id: u64, player_idx: u8, unit_id: u32) -> Unit;
    fn get_unit_count(self: @TContractState, game_id: u64, player_idx: u8) -> u32;

    // --- Cities ---
    fn get_city(self: @TContractState, game_id: u64, player_idx: u8, city_id: u32) -> City;
    fn get_city_count(self: @TContractState, game_id: u64, player_idx: u8) -> u32;

    // --- Economy & Research ---
    fn get_gold(self: @TContractState, game_id: u64, player_idx: u8) -> u32;
    fn get_current_tech(self: @TContractState, game_id: u64, player_idx: u8) -> u8;
    fn get_tech_progress(self: @TContractState, game_id: u64, player_idx: u8) -> u32;
    fn get_completed_techs(self: @TContractState, game_id: u64, player_idx: u8) -> u64;
    fn get_kills(self: @TContractState, game_id: u64, player_idx: u8) -> u32;

    // --- Diplomacy ---
    fn get_diplo_status(self: @TContractState, game_id: u64, player_a: u8, player_b: u8) -> u8;

    // --- Computed Helpers (convenience for UI) ---
    fn get_score(self: @TContractState, game_id: u64, player_idx: u8) -> u32;
    fn get_city_yields(self: @TContractState, game_id: u64, player_idx: u8, city_id: u32) -> CityYields;
    fn get_gold_per_turn(self: @TContractState, game_id: u64, player_idx: u8) -> i32;
    fn get_science_per_turn(self: @TContractState, game_id: u64, player_idx: u8) -> u16;
    // returns half-science; client divides by 2 for display
}
```

### Events

```cairo
#[event]
enum Event {
    GameCreated: GameCreated,
    PlayerJoined: PlayerJoined,
    GameStarted: GameStarted,
    TurnSubmitted: TurnSubmitted,
    CombatResolved: CombatResolved,
    CityFounded: CityFounded,
    UnitKilled: UnitKilled,
    TechCompleted: TechCompleted,
    BuildingCompleted: BuildingCompleted,
    GameEnded: GameEnded,
}

// Struct definitions per 03_starknet_contracts.md, plus:

struct UnitKilled {
    #[key] game_id: u64,
    player: u8,
    unit_id: u32,
    unit_type: u8,
    q: u8,
    r: u8,
}

struct TechCompleted {
    #[key] game_id: u64,
    player: ContractAddress,
    tech_id: u8,
}

struct BuildingCompleted {
    #[key] game_id: u64,
    player: ContractAddress,
    city_id: u32,
    building_bit: u8,
}
```

---

## Client Interface (TypeScript)

The client interacts with the contract via starknet.js. Key interfaces:

```typescript
// --- Contract Interaction Layer ---
interface CairoCivClient {
  // Write
  createGame(mapSize: number): Promise<bigint>;  // returns game_id
  joinGame(gameId: bigint): Promise<void>;
  submitTurn(gameId: bigint, actions: Action[]): Promise<void>;
  claimTimeout(gameId: bigint): Promise<void>;

  // Read — all game state
  getGameState(gameId: bigint): Promise<FullGameState>;
  getTile(gameId: bigint, q: number, r: number): Promise<TileData>;
  getUnits(gameId: bigint, playerIdx: number): Promise<Unit[]>;
  getCities(gameId: bigint, playerIdx: number): Promise<City[]>;
  getPlayerEconomy(gameId: bigint, playerIdx: number): Promise<PlayerEconomy>;

  // Events
  onTurnSubmitted(gameId: bigint, callback: (event: TurnSubmitted) => void): void;
  onCombatResolved(gameId: bigint, callback: (event: CombatResolved) => void): void;
  onGameEnded(gameId: bigint, callback: (event: GameEnded) => void): void;
}

// --- Full game state snapshot (for rendering) ---
interface FullGameState {
  gameId: bigint;
  status: number;
  turn: number;
  currentPlayerIdx: number;
  players: PlayerState[];
  map: TileData[][];   // 2D array indexed by [q][r]
  improvements: Map<string, number>;  // "q,r" -> improvement type
  tileOwners: Map<string, { playerIdx: number; cityId: number }>;  // "q,r" -> owner info
}

interface PlayerState {
  address: string;
  units: Unit[];
  cities: City[];
  gold: number;
  currentTech: number;
  techProgress: number;
  completedTechs: bigint;
  kills: number;
  score: number;
  goldPerTurn: number;
  sciencePerTurn: number;
}
```
