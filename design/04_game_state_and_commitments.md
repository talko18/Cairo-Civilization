# Game State & Commitments

## 1. Private State Structure (MVP)

Each player's private state. This is the data that gets hashed into the on-chain commitment.

```cairo
struct GameState {
    // Identity
    player_id: u8,

    // Map knowledge (explored tiles only — rest is fog)
    explored_tiles: Array<(u8, u8, TileInfo)>,  // (q, r, data) in storage coords

    // Units (MVP: Settler, Builder, Scout, Warrior, Slinger, Archer)
    units: Array<Unit>,        // In Phase 2: includes dead units (hp=0) for stable indexing
    next_unit_id: u32,

    // Cities
    cities: Array<City>,
    next_city_id: u32,

    // Tile improvements (player-built)
    improvements: Array<(u8, u8, u8)>,  // (q, r, improvement_type)

    // Economy
    gold: u32,

    // Research
    completed_techs: u64,    // *** bitmask — 64 tech slots for future expansion ***
    current_tech: u8,
    tech_progress: u32,

    // Score tracking
    lifetime_kills: u32,     // enemy units killed (for score victory)

    // Diplomacy
    at_war_with: Array<u8>,  // player IDs

    // Turn tracking
    turn_number: u32,
    salt: felt252,  // changes every turn (Phase 2 only)
}

struct Unit {
    id: u32,
    unit_type: u8,           // 0=Settler,1=Builder,2=Scout,3=Warrior,4=Slinger,5=Archer
    q: u8,                   // storage coordinate
    r: u8,                   // storage coordinate
    hp: u8,                  // 0-200 (0 = dead in Phase 2; removed from storage in Phase 1)
    movement_remaining: u8,
    charges: u8,             // builders only (starts at 3)
    fortify_turns: u8,       // 0=not fortified, 1=one turn, 2+=max defense bonus
}

struct City {
    id: u32,
    name: felt252,
    q: u8,                   // storage coordinate
    r: u8,                   // storage coordinate
    population: u8,          // 1-30 easily fits u8
    hp: u8,                  // 0-200 (city hitpoints, for city combat)
    food_stockpile: u16,
    production_stockpile: u16,
    current_production: u8,  // item ID, 0 = none (uses range-separated IDs)
    buildings: u32,          // *** bitmask — 32 building slots ***
    founded_turn: u16,       // turn number when city was founded
    original_owner: u8,      // player index who founded it (for score tracking)
    is_capital: bool,        // true = original capital
}
// Territory is NOT stored per city. It's derived from population + city position,
// with conflicts resolved by a per-tile owner map (see contract storage).
```

**Note**: This is intentionally minimal compared to full Civ VI. No religion, no policies, no great people, no espionage. Those are post-MVP.

**Phase 1 vs Phase 2**: In Phase 1, this struct maps directly to on-chain storage (via LegacyMap entries). In Phase 2, it becomes the private witness data hashed into the commitment. The `salt` field is only used in Phase 2.

**Key extensibility choices**:
- `buildings: u32` not `u8` — 32 building slots vs 8. Adding districts later just uses more bits.
- `completed_techs: u64` not `u32` — 64 tech slots. Enough for Ancient through Renaissance.
- Production item IDs use separated ranges (1-63 units, 64-127 buildings) — each category grows independently.
- Territory is per-tile (not per-city array) — adding culture-based expansion or multi-city overlap just changes the per-tile assignment logic.

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

### Phase 1 (Public Game)

In Phase 1, turn processing happens entirely on-chain:

```
1. Contract receives actions from the current player
2. Contract validates each action against on-chain state
3. Contract applies state changes (move units, found cities, etc.)
4. Contract runs end-of-turn: yields, growth, production, research, healing
5. Contract checks victory conditions
6. Turn advances to next player
```

No external events mechanism — the contract owns all state and applies everything directly.

### Phase 2 (ZK Game)

In Phase 2, turn processing is split into off-chain (proof generation) and on-chain (verification):

```
Off-chain:
    Phase A: Incorporate external events
        - Read pending events from other players (combat results, war declarations)
        - Apply them to private state
    Phase B: Player's own actions
        - Apply actions to state, collect public outputs
        - Update salt, increment turn number
    Phase C: Generate STARK proof

On-chain:
    - Verify proof
    - Store new commitment
    - Process public actions (combat, city founding)
    - Update event_chain_hash
```

## 5. Actions (MVP)

Defined in `03_starknet_contracts.md` § Data Types. The `Action` enum is:

```
MoveUnit, AttackUnit, RangedAttack, FoundCity, SetProduction,
SetResearch, BuildImprovement, RemoveImprovement, FortifyUnit,
SkipUnit, PurchaseWithGold, UpgradeUnit, DeclareWar, EndTurn
```

All use `u8` storage coordinates.

## 6. External Events (Phase 2 Only)

In Phase 1, external events don't exist — the contract manages everything.

In Phase 2, things other players did that affect your state:

```cairo
enum ExternalEvent {
    CombatResult: (u64, u8, bool),      // combat_id, damage_to_your_unit, your_unit_survived
    CityLost: (u8, u8),                 // city_q, city_r (public knowledge)
    WarDeclaredOnYou: u8,               // player_id
    PeaceMade: u8,                       // player_id
}
```

The player internally maps `combat_id` to their unit — they know which unit they attacked with or which position was attacked (positions are public).

The contract maintains a rolling `event_chain_hash` per game. When you submit your turn, the contract checks that your `external_events_hash` matches, ensuring you didn't skip or fabricate events.

## 7. State Size Estimate (Phase 2 — for proving cost)

| Component | Size |
|---|---|
| 5 units × 8 fields | ~40 felts |
| 3 cities × 10 fields + tiles | ~60 felts |
| 200 explored tiles × 4 fields | ~800 felts |
| techs (bitmask) + economy + meta | ~10 felts |
| **Total (early game)** | **~1,000 felts** |
| **Total (late game)** | **~5,000 felts** |

Hashing 5K felts with Poseidon: well under 1 second in a STARK circuit. Flat hash is fine for Phase 2.
