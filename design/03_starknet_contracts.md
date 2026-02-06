# StarkNet Contract

## 1. One Contract

The entire game lives in a **single Cairo contract**. No separate engine contracts, no inter-contract calls, no access control between contracts. Per-game state is stored in mappings keyed by `game_id`.

Why one contract:
- No inter-contract call bugs or reentrancy
- No access control mismatches between contracts
- Simpler to deploy, test, and upgrade
- All state is co-located for easy reads

```cairo
#[starknet::interface]
trait ICairoCiv<TContractState> {
    // --- Game Lifecycle ---
    fn create_game(ref self: TContractState, map_size: u8) -> u64;
    fn join_game(ref self: TContractState, game_id: u64);
    fn set_map_commitment(ref self: TContractState, game_id: u64, commitment: felt252);
    fn commit_initial_state(ref self: TContractState, game_id: u64, commitment: felt252, proof: Span<felt252>);

    // --- Turn Submission (the main function) ---
    fn submit_turn(
        ref self: TContractState,
        game_id: u64,
        new_commitment: felt252,
        proof: Span<felt252>,             // proof's public inputs include opponent_last_commitment
        external_events_hash: felt252,
        public_actions: Span<PublicAction>,
    );

    // --- Reads ---
    fn get_game_status(self: @TContractState, game_id: u64) -> u8;
    fn get_turn(self: @TContractState, game_id: u64) -> u32;
    fn get_current_player(self: @TContractState, game_id: u64) -> ContractAddress;
    fn get_commitment(self: @TContractState, game_id: u64, player: ContractAddress) -> felt252;
    fn get_pending_combat(self: @TContractState, game_id: u64, combat_id: u64) -> PendingCombat;
}
```

## 2. Storage Layout

All state is keyed by `game_id`:

```cairo
#[storage]
struct Storage {
    game_count: u64,

    // Per game
    game_status: LegacyMap<u64, u8>,              // 0=lobby, 1=active, 2=finished
    game_map_commitment: LegacyMap<u64, felt252>,
    game_turn: LegacyMap<u64, u32>,
    game_current_player: LegacyMap<u64, u8>,      // index: 0 or 1
    game_player_count: LegacyMap<u64, u8>,

    // Per game + player
    game_players: LegacyMap<(u64, u8), ContractAddress>,
    player_commitments: LegacyMap<(u64, ContractAddress), felt252>,

    // Per game: event chain for state sync verification
    event_chain_hash: LegacyMap<u64, felt252>,

    // Per game: pending combats
    combat_count: LegacyMap<u64, u64>,
    pending_combats: LegacyMap<(u64, u64), PendingCombat>,

    // Per game: revealed map tiles
    revealed_tiles: LegacyMap<(u64, u16, u16), TileData>,

    // Per game: public city registry (for territory computation)
    city_count: LegacyMap<u64, u32>,
    cities: LegacyMap<(u64, u32), CityInfo>,

    // Per game: diplomatic status
    diplo_status: LegacyMap<(u64, ContractAddress, ContractAddress), u8>,
}
```

## 3. What `submit_turn` Does

```
fn submit_turn(...):
    1. assert game is active
    2. assert caller is the current player
    3. look up opponent's current commitment (public input to the proof)
    4. verify STARK proof against (old_commitment, new_commitment, opponent_commitment)
    5. verify external_events_hash matches event_chain_hash
    6. store new commitment
    6. for each public_action:
       - CityFounded → store in city registry, emit event
       - AttackUnit → create pending combat, emit event
       - DefendUnit → resolve pending combat deterministically, emit event
       - TileRevealed → store in revealed_tiles
       - WarDeclared → update diplo_status
       - PeaceProposed/Accepted → update diplo_status
    7. update event_chain_hash (rolling hash of this turn's public actions)
    8. advance to next player's turn
    9. emit TurnSubmitted event
```

## 4. Data Types (MVP Subset)

```cairo
// Keep it small. Only what MVP needs.

enum PublicAction {
    CityFounded: (felt252, u16, u16),           // name, col, row
    AttackUnit: (UnitReveal, u16, u16, felt252), // unit, target_col, target_row, turn_salt
    DefendUnit: (u64, UnitReveal, u8, felt252),  // combat_id, unit, terrain, turn_salt
    TileRevealed: (u16, u16, u8, u8, u8),       // col, row, terrain, feature, resource
    WarDeclared: ContractAddress,
    PeaceMade: ContractAddress,
}

struct UnitReveal {
    unit_type: u8,
    col: u16,
    row: u16,
    hp: u16,
    combat_strength: u16,
    ranged_strength: u16,
    range: u8,
}

struct PendingCombat {
    attacker: ContractAddress,
    attacker_unit: UnitReveal,
    target_col: u16,
    target_row: u16,
    attacker_salt: felt252,
    turn_initiated: u32,
}

struct TileData {
    terrain: u8,
    feature: u8,
    resource: u8,
    has_river: bool,
}

struct CityInfo {
    owner: ContractAddress,
    name: felt252,
    col: u16,
    row: u16,
    founded_turn: u32,
}
```

**Why `u8` instead of enums for terrain/unit types?** Simpler serialization, smaller storage, and the off-chain Cairo code (in the proof circuit) handles the semantic interpretation. The on-chain contract mostly just stores and emits — it doesn't need to understand what terrain type 3 means.

## 5. Events

```cairo
#[event]
enum Event {
    GameCreated: GameCreated,
    TurnSubmitted: TurnSubmitted,
    CombatResolved: CombatResolved,
}

struct TurnSubmitted {
    #[key] game_id: u64,
    #[key] player: ContractAddress,
    turn: u32,
    new_commitment: felt252,
    action_count: u32,
}

struct CombatResolved {
    #[key] game_id: u64,
    combat_id: u64,
    attacker_damage: u16,
    defender_damage: u16,
    attacker_survived: bool,
    defender_survived: bool,
}
```

Clients reconstruct the full public game state by indexing events. No polling of storage needed.

## 6. Upgrades

Since it's one contract, upgrades use `replace_class_syscall`. A `game_version` field per game allows backward-compatible changes. The commitment verification logic is the one thing that must never change mid-game.
