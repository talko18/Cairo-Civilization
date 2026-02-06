# Adding the Commitment Scheme

## Phase 1 State (What We're Replacing)

In Phase 1, the contract stores everything directly:

```cairo
// Phase 1: full state in storage (PUBLIC)
units: LegacyMap<(u64, u8, u32), Unit>,  // (game, player_idx, unit_id)
// where Unit has: unit_type, q, r, hp, movement_remaining, charges, fortify_turns
city_production: LegacyMap<(u64, u32), u8>,
player_gold: LegacyMap<(u64, ContractAddress), u32>,
player_current_tech: LegacyMap<(u64, ContractAddress), u8>,
// ... everything readable by anyone
```

## Phase 2 State (What We're Adding)

Replace all per-player state with one commitment:

```cairo
// Phase 2: only commitments in storage (PRIVATE)
player_commitments: LegacyMap<(u64, ContractAddress), felt252>,  // one hash per player
```

The full state lives on the player's device. The commitment is:

```
commitment = Poseidon(Poseidon(serialized_state), salt)
```

## Migration Steps

### Step 1: Add Poseidon Hashing Library

Write Cairo functions that serialize and hash the game state:

```cairo
fn compute_commitment(state: @GameState) -> felt252 {
    let serialized = serialize_game_state(state);
    poseidon_hash_span(
        array![poseidon_hash_span(serialized.span()), state.salt].span()
    )
}
```

This code is used BOTH off-chain (in the prover) and potentially on-chain (for verification). Test it extensively — if the off-chain and on-chain hashing diverge, proofs will fail.

### Step 2: Add Salt Derivation

```
new_salt = Poseidon(old_salt, turn_number, opponent_last_commitment)
```

The salt must be derived identically in the off-chain prover and verified in the proof constraints. The opponent's commitment is a public input that the contract supplies.

### Step 3: Add Combat Salt

```
combat_salt = Poseidon(state_salt, "COMBAT_SALT")
```

This is revealed during combat instead of the state salt. The proof verifies the derivation.

### Step 4: Modify Contract Storage

Remove all per-player game state storage. Keep only:
- `player_commitments` (one felt252 per player per game)
- `event_chain_hash` (one felt252 per game)
- Public registries that were already public: cities, revealed tiles, diplo status
- Pending combats

### Step 5: Modify submit_turn

Before (Phase 1):
```
fn submit_turn(game_id, actions):
    validate each action against stored state
    apply actions to stored state
    emit events
```

After (Phase 2):
```
fn submit_turn(game_id, new_commitment, proof, external_events_hash, public_actions):
    verify proof against (old_commitment, new_commitment, opponent_commitment)
    verify external_events_hash matches event_chain_hash
    store new_commitment
    process public_actions (store cities, resolve combat, etc.)
    update event_chain_hash
    emit events
```

The contract no longer executes game logic — it verifies that the player did it correctly off-chain.

## Testing Strategy

1. Run Phase 1 and Phase 2 in parallel on the same game. Phase 1 computes the expected state; Phase 2 verifies the commitment matches. Any mismatch = bug.
2. The Phase 1 contract serves as a reference implementation for what the off-chain prover must compute.
