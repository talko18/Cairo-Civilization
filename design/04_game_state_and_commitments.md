# Game State & Commitments

## 1. Private State Structure (MVP)

Each player's private state. This is the data that gets hashed into the on-chain commitment.

```cairo
struct GameState {
    // Identity
    player_id: u8,

    // Map knowledge
    explored_tiles: Array<(u16, u16, TileInfo)>,

    // Units (MVP: Settler, Builder, Warrior, Slinger, Scout)
    units: Array<Unit>,
    next_unit_id: u32,

    // Cities
    cities: Array<City>,

    // Economy
    gold: u32,

    // Research
    completed_techs: Array<u8>,  // tech IDs
    current_tech: u8,
    tech_progress: u32,

    // Diplomacy
    at_war_with: Array<u8>,  // player IDs

    // Turn tracking
    turn_number: u32,
    salt: felt252,  // changes every turn
}

struct Unit {
    id: u32,
    unit_type: u8,
    col: u16,
    row: u16,
    hp: u16,
    movement_remaining: u8,
    combat_strength: u16,
    ranged_strength: u16,
    range: u8,
    charges: u8,  // for builders
}

struct City {
    id: u32,
    name: felt252,
    col: u16,
    row: u16,
    population: u16,
    food_stockpile: u32,
    production_stockpile: u32,
    current_production: u8,  // item ID, 0 = none
    owned_tiles: Array<(u16, u16)>,
}
```

**Note**: This is intentionally minimal compared to full Civ VI. No religion, no policies, no great people, no espionage. Those are post-MVP.

## 2. Commitment: Flat Hash

The commitment is a single Poseidon hash of the entire serialized state:

```cairo
fn compute_commitment(state: @GameState) -> felt252 {
    let serialized: Array<felt252> = serialize(state);
    poseidon_hash_span(
        array![poseidon_hash_span(serialized.span()), state.salt].span()
    )
}
```

**Why flat hash, not a Merkle tree?**

- The state is ~2K–10K felt252 values. Hashing this takes < 1 second in a STARK circuit.
- A Merkle tree adds code complexity (sparse trees, branch management, proof paths) for a performance optimization we don't need yet.
- If proving time becomes an issue later, swap to a Merkle tree. The contract interface doesn't change — it still stores one felt252 commitment.

## 3. Salt

The salt changes every turn and **must incorporate the opponent's latest commitment**:

```
new_salt = Poseidon(old_salt, turn_number, opponent_last_commitment)
```

`opponent_last_commitment` is a public input to the turn proof — the contract checks it matches the on-chain value.

Purpose:
- **Unpredictable future randomness**: Since the opponent's commitment changes every turn and isn't known until they submit, a player cannot pre-compute their own future salts. This prevents timing attacks or cherry-picking favorable combat randomness.
- **Commitment freshness**: Prevents replaying old commitments.
- **Anti-grinding**: Even if a player takes no actions, the salt changes (because the opponent's commitment changed).
- **Brute-force resistance**: Salt has full felt252 entropy.

The initial salt is chosen randomly by each player at game start.

## 4. Turn Processing

Each turn has two phases:

```
Phase 1: Incorporate external events
    - Read pending events from other players (combat damage, war declarations, etc.)
    - Apply them to private state
    - The proof verifies these were applied correctly
    - external_events_hash = Poseidon(serialized events)

Phase 2: Player's own actions
    - Move units, found cities, set production, research tech, declare war, etc.
    - Apply each action to state
    - Collect public outputs (founded cities, combat initiations, tile reveals)
    - Update salt, increment turn number
```

## 5. Actions (MVP)

```cairo
enum Action {
    MoveUnit: (u32, u16, u16),          // unit_id, dest_col, dest_row
    AttackUnit: (u32, u16, u16),        // unit_id, target_col, target_row
    FoundCity: (u32, felt252),          // settler_id, city_name
    SetProduction: (u32, u8),           // city_id, item_id
    SetResearch: u8,                     // tech_id
    BuildImprovement: (u32, u16, u16),  // builder_id, col, row
    FortifyUnit: u32,
    SkipUnit: u32,
    DeclareWar: u8,                     // target player
    EndTurn,
}
```

## 6. External Events

Things other players did that affect your state:

```cairo
enum ExternalEvent {
    CombatDamage: (u32, u16),           // unit_id, damage_amount
    UnitKilled: u32,                     // unit_id
    CityLost: u32,                       // city_id
    WarDeclaredOnYou: u8,               // player_id
    PeaceMade: u8,                       // player_id
}
```

The contract maintains a rolling `event_chain_hash` per game. When you submit your turn, the contract checks that your `external_events_hash` matches, ensuring you didn't skip or fabricate events.

## 7. State Size Estimate (MVP)

| Component | Size |
|---|---|
| 5 units × 10 fields | ~50 felts |
| 3 cities × 12 fields | ~36 felts |
| 200 explored tiles × 4 fields | ~800 felts |
| 20 techs + economy + meta | ~50 felts |
| **Total (early game)** | **~1,000 felts** |
| **Total (late game)** | **~5,000 felts** |

Hashing 5K felts with Poseidon: well under 1 second in a STARK circuit. Flat hash is fine for MVP.
