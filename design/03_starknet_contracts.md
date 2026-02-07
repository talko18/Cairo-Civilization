# StarkNet Contract

## 1. One Contract

The entire game lives in a **single Cairo contract**. No separate engine contracts, no inter-contract calls, no access control between contracts. Per-game state is stored in mappings keyed by `game_id`.

Why one contract:
- No inter-contract call bugs or reentrancy
- No access control mismatches between contracts
- Simpler to deploy, test, and upgrade
- All state is co-located for easy reads

### Phase 1 Interface (Public Game — No ZK)

```cairo
#[starknet::interface]
trait ICairoCiv<TContractState> {
    // --- Game Lifecycle ---
    fn create_game(ref self: TContractState, map_size: u8) -> u64;
    fn join_game(ref self: TContractState, game_id: u64);
    // Map seed = Poseidon(game_id, block_timestamp) — no dealer needed in Phase 1

    // --- Turn Submission (Phase 1: contract validates actions directly) ---
    fn submit_turn(
        ref self: TContractState,
        game_id: u64,
        actions: Span<Action>,      // raw actions — contract executes game logic
    );

    // --- Timeout ---
    fn claim_timeout(ref self: TContractState, game_id: u64);

    // --- Reads ---
    fn get_game_status(self: @TContractState, game_id: u64) -> u8;
    fn get_turn(self: @TContractState, game_id: u64) -> u32;
    fn get_current_player(self: @TContractState, game_id: u64) -> ContractAddress;
    // Phase 2 adds: fn get_pending_combat(...)
    // In Phase 1, combat resolves immediately — no pending combats to read.
}
```

In Phase 1, the contract stores full game state and validates each action. No proofs, no commitments, no dealer.

### Phase 2 Interface (ZK — added later)

See `phase2_zk_privacy/` for the transition. The interface changes to:

```cairo
    fn submit_turn(
        ref self: TContractState,
        game_id: u64,
        new_commitment: felt252,
        proof: Span<felt252>,
        external_events_hash: felt252,
        public_actions: Span<PublicAction>,
        unit_positions: Span<UnitPosition>,
    );
```

The contract stops executing game logic and instead verifies a STARK proof. Full state storage is replaced by one commitment per player.

## 2. Storage Layout (Phase 1 — Full State On-Chain)

In Phase 1 the contract stores the entire game state. No commitments.

```cairo
#[storage]
struct Storage {
    game_count: u64,

    // Per game — metadata
    game_status: LegacyMap<u64, u8>,              // 0=lobby, 1=active, 2=finished
    game_turn: LegacyMap<u64, u32>,
    game_current_player: LegacyMap<u64, u8>,      // index: 0 or 1
    game_player_count: LegacyMap<u64, u8>,
    game_map_seed: LegacyMap<u64, felt252>,        // Poseidon(game_id, block_timestamp)
    game_turn_timestamp: LegacyMap<u64, u64>,      // when current turn started (for timer)
    game_timeout_count: LegacyMap<(u64, u8), u8>,  // consecutive timeouts per player
    game_winner: LegacyMap<u64, ContractAddress>,

    // Per game — players
    game_players: LegacyMap<(u64, u8), ContractAddress>,

    // Per game — map tiles (generated once, immutable)
    // key: (game_id, q, r) — q, r are offset-adjusted unsigned coords
    map_tiles: LegacyMap<(u64, u8, u8), TileData>,

    // Per game + player — units
    unit_count: LegacyMap<(u64, u8), u32>,
    units: LegacyMap<(u64, u8, u32), Unit>,       // (game, player_idx, unit_id)

    // Per game + player — cities
    city_count: LegacyMap<(u64, u8), u32>,
    cities: LegacyMap<(u64, u8, u32), City>,       // (game, player_idx, city_id)

    // Per game — tile ownership (which city owns each tile for territory)
    tile_owner: LegacyMap<(u64, u8, u8), u32>,     // (game, q, r) → city_id (0 = unclaimed)
    tile_owner_player: LegacyMap<(u64, u8, u8), u8>, // (game, q, r) → player_idx
    // Both maps are set together when territory is assigned.
    // tile_owner gives the city_id, tile_owner_player gives the player.
    // This avoids ambiguity since city_ids are per-player (both players can have city_id 0).
    // Why per-tile instead of per-city array?
    //   - LegacyMap can't store arrays natively
    //   - Checking "is this tile already claimed?" is O(1) instead of scanning all cities
    //   - Multiple cities expanding into the same area can be resolved cheaply

    // Per game — tile improvements (player-built, separate from immutable terrain)
    tile_improvements: LegacyMap<(u64, u8, u8), u8>,  // (game, q, r) → improvement_type
    // 0=None, 1=Farm, 2=Mine, 3=Quarry, 4=Pasture, 5=LumberMill, 6=FishingBoats(future)
    // Improvements are destroyed on city capture. Builder charges are consumed on build.

    // Per game + player — economy & research
    player_gold: LegacyMap<(u64, u8), u32>,
    player_current_tech: LegacyMap<(u64, u8), u8>,
    player_tech_progress: LegacyMap<(u64, u8), u32>,
    player_completed_techs: LegacyMap<(u64, u8), u64>,  // *** u64 bitmask — 64 tech slots ***
    player_kills: LegacyMap<(u64, u8), u32>,             // lifetime kill count (for score)

    // Per game — pending combats (Phase 2 only — Phase 1 resolves instantly)
    // combat_count: LegacyMap<u64, u64>,
    // pending_combats: LegacyMap<(u64, u64), PendingCombat>,
    // NOTE: Uncomment when transitioning to Phase 2.
    // In Phase 1 the contract sees both units, so combat resolves immediately.

    // Per game — diplomatic status
    diplo_status: LegacyMap<(u64, u8, u8), u8>,   // (game, player_a, player_b)
}
```

### Phase 2 Storage Changes

When transitioning to ZK (Phase 2), most per-player storage is removed. What remains:

```cairo
    // Replace per-player state with one commitment each
    player_commitments: LegacyMap<(u64, ContractAddress), felt252>,
    // Add unit_positions (public in Phase 2)
    // Add event_chain_hash for sync verification
    // Add game_dealer for map commitment
    // Remove: units, cities, gold, techs (all move to private state)
```

## 3. What `submit_turn` Does (Phase 1)

```
fn submit_turn(game_id, actions):
    1. assert game is active
    2. assert caller is the current player
    3. assert block_timestamp <= turn_start + 300  (5 min timer)
    4. reset timeout counter for this player
    5. for each action in actions:
        validate action is legal given current on-chain state:
        - MoveUnit: verify unit exists, belongs to caller, has movement,
          destination is reachable, movement cost, etc.
        - AttackUnit: verify unit exists, target tile has enemy unit,
          resolve combat IMMEDIATELY (contract sees both units):
            delta = attacker_cs - defender_effective_cs
            random = Poseidon(map_seed, game_turn, attacker_id, defender_id) % 51 + 75
            damage = DAMAGE_TABLE[delta+40] × random / 100
          apply damage to both units, check kills, emit CombatResolved
        - RangedAttack: same as AttackUnit but no counter-damage, check range + LOS
        - FoundCity: verify settler exists, min distance from other cities,
          valid terrain, consume settler, create city
        - SetProduction: verify city exists, belongs to caller, item is valid
        - SetResearch: verify tech prereqs met, tech not already completed
        - BuildImprovement: verify builder exists, has charges, valid tile,
          tile has NO existing improvement, valid improvement for terrain,
          store improvement in tile_improvements map, consume all movement
        - RemoveImprovement: verify builder exists, is on tile, tile has
          improvement, remove from tile_improvements map, consume all movement
          (costs 0 builder charges)
        - FortifyUnit: set unit fortify state
        - DeclareWar: update diplo_status
        apply state changes to on-chain storage

    NOTE: Phase 1 combat resolves IMMEDIATELY. No pending combat.
    The contract can see both players' units. Randomness comes from
    Poseidon(map_seed, game_turn, attacker_id, defender_id) — deterministic,
    unpredictable (map_seed set before gameplay), and non-manipulable.
    The 2-TX pending combat protocol is only needed in Phase 2 where
    the contract can't see private unit stats.
    6. end-of-turn processing:
        - city yields → update food/production stockpiles
        - population growth check
        - production completion check
        - tech completion check
        - unit healing
    7. check victory conditions (capital captured → domination, turn 150 → score)
    8. record turn_start_timestamp for next player
    9. advance game_turn, flip current_player
   10. emit TurnSubmitted event
```

### Phase 2 `submit_turn` (ZK)

Replaces step 5 entirely with proof verification. See `phase2_zk_privacy/`.

## 4. Data Types (MVP — Phase 1)

```cairo
// --- Coordinates ---
// Axial hex coordinates stored as unsigned u8 with offset.
// For a 32×20 map: q_stored = q_axial + 16, r_stored = r_axial
// This keeps all values in 0..63 range — fits in u8.

// --- Actions (player input) ---
enum Action {
    MoveUnit: (u32, u8, u8),             // unit_id, dest_q, dest_r
    AttackUnit: (u32, u8, u8),           // unit_id, target_q, target_r
    RangedAttack: (u32, u8, u8),         // unit_id, target_q, target_r (ranged, no counter)
    FoundCity: (u32, felt252),           // settler_id, city_name
    SetProduction: (u32, u8),            // city_id, item_id
    SetResearch: u8,                     // tech_id
    BuildImprovement: (u32, u8, u8, u8),  // builder_id, q, r, improvement_type
    RemoveImprovement: (u32, u8, u8),    // builder_id, q, r (0 charges, consumes all movement)
    FortifyUnit: u32,                    // unit_id
    SkipUnit: u32,                       // unit_id
    PurchaseWithGold: (u32, u8),         // city_id, item_id (buy instead of produce)
    UpgradeUnit: u32,                    // unit_id (e.g. Slinger→Archer, costs gold)
    DeclareWar: u8,                      // target player index
    EndTurn,
}

// --- On-chain state types ---
struct Unit {
    unit_type: u8,       // 0=Settler, 1=Builder, 2=Scout, 3=Warrior, 4=Slinger, 5=Archer
    q: u8,
    r: u8,
    hp: u8,              // 0-200
    movement_remaining: u8,
    charges: u8,         // builders only
    fortify_turns: u8,   // 0=not fortified, 1=1 turn, 2+=max bonus
}
// In Phase 1: dead units are REMOVED from storage (id is freed).
// In Phase 2: dead units set hp=0, kept in state (avoids dynamic resizing in ZK circuit).

struct City {
    name: felt252,
    q: u8,
    r: u8,
    population: u8,
    hp: u8,              // 0-200 (city hitpoints for city combat)
    food_stockpile: u16,
    production_stockpile: u16,
    current_production: u8,   // item_id, 0 = none
    buildings: u32,           // *** bitmask: 32 building slots for future expansion ***
    founded_turn: u16,
    original_owner: u8,       // player index who founded it (for score: captured vs founded)
    is_capital: bool,         // true = this city is/was the player's original capital
}
// Palace bonus (+2 prod, +2 science, +5 gold) is applied if is_capital == true.
// No Palace in the buildings bitmask — it's intrinsic to the capital.

struct TileData {
    terrain: u8,         // 0=Ocean,1=Coast,2=Grassland,3=Plains,4=Desert,...
    feature: u8,         // 0=None,1=Woods,2=Rainforest,3=Marsh,4=Oasis
    resource: u8,        // 0=None,1=Wheat,2=Rice,...10=Dyes
    river_edges: u8,     // bitmask, 6 bits for 6 hex edges
}

// Improvements are stored SEPARATELY from TileData (which is immutable map terrain).
// See tile_improvements in Storage below.

struct PendingCombat {
    attacker_player: u8,
    attacker_unit_id: u32,
    target_q: u8,
    target_r: u8,
    turn_initiated: u16,
}
// NOTE: PendingCombat is only used in Phase 2 (when private state
// means combat can't resolve immediately). In Phase 1, combat
// resolves instantly — no pending combat needed.

// --- Building IDs (for the bitmask in City.buildings: u32) ---
// Bit 0: Monument     (cost 60)
// Bit 1: Granary       (cost 65, requires Pottery)
// Bit 2: Walls         (cost 80, requires Masonry)
// Bit 3: Library        (cost 90, requires Writing)
// Bit 4: Market         (cost 100, requires Currency)
// Bit 5: Barracks       (cost 90, requires Bronze Working)
// Bit 6: Water Mill     (cost 80, requires The Wheel, requires river)
// Bits 7-31: reserved for future buildings (districts, wonders, etc.)
//
// Why u32? 8 bits (u8) only supports 8 buildings total.
// Adding Medieval Walls, University, Workshop, etc. would immediately overflow.
// u32 gives 32 building slots — enough through several phases of expansion.

// --- Production item IDs (u8, range-separated for extensibility) ---
// Range 0:       none/idle
// Range 1-63:    UNITS  (1=Settler, 2=Builder, 3=Scout, 4=Warrior, 5=Slinger, 6=Archer)
// Range 64-127:  BUILDINGS (64=Monument, 65=Granary, 66=Walls, 67=Library, 68=Market, 69=Barracks, 70=WaterMill)
// Range 128-191: WONDERS (future)
// Range 192-255: PROJECTS (future)
//
// Why separate ranges? If unit IDs and building IDs are contiguous (1-6 units,
// 7-13 buildings), adding Spearman as unit 7 collides with Monument.
// Separate ranges let each category grow independently.
```

**Why `u8` instead of enums?** Simpler serialization and smaller storage. The contract interprets them via lookup tables. Enums can be used in the client for readability.

**Why `u8` for coordinates?** A 32×20 map with axial offset fits in 0..63 range. `u8` saves storage vs `u16`.

### Phase 2 Additional Types

When transitioning to ZK, add these types (not needed in Phase 1):

```cairo
enum PublicAction {
    CityFounded: (felt252, u8, u8),
    AttackUnit: (u8, u8, u8, felt252),       // unit_type, target_q, target_r, combat_salt
    DefendUnit: (u64, u8, u8, felt252),      // combat_id, unit_type, terrain, combat_salt
    WarDeclared: u8,
    PeaceMade: u8,
}

struct UnitPosition {
    unit_type: u8,
    q: u8,
    r: u8,
}
```

## 5. Events

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

struct GameCreated {
    #[key] game_id: u64,
    creator: ContractAddress,
}

struct PlayerJoined {
    #[key] game_id: u64,
    player: ContractAddress,
    player_idx: u8,
}

struct GameStarted {
    #[key] game_id: u64,
    map_seed: felt252,
}

struct TurnSubmitted {
    #[key] game_id: u64,
    #[key] player: ContractAddress,
    turn: u32,
    action_count: u32,
    // Phase 2 adds: new_commitment: felt252
}

struct CombatResolved {
    #[key] game_id: u64,
    combat_id: u64,
    attacker_damage: u8,
    defender_damage: u8,
    attacker_survived: bool,
    defender_survived: bool,
}

struct CityFounded {
    #[key] game_id: u64,
    player: ContractAddress,
    city_name: felt252,
    q: u8,
    r: u8,
}

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

struct GameEnded {
    #[key] game_id: u64,
    winner: ContractAddress,
    victory_type: u8,   // 0=domination, 1=score, 2=forfeit
}
```

In Phase 1, clients can read full state directly from contract storage. Events are still emitted for UI reactivity and client-side event listening.

## 6. Upgrades

Since it's one contract, upgrades use `replace_class_syscall`. A `game_version` field per game allows backward-compatible changes. The commitment verification logic is the one thing that must never change mid-game.
