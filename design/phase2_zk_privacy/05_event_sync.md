# Adding External Event Synchronization

## Why It's Needed

In Phase 1, the contract stores all state, so Player B's actions automatically affect Player A's state (the contract applies them). In Phase 2, each player has their OWN copy of state. When Player B attacks Player A's unit, Player A must incorporate the damage into their private state. The proof must verify they did this correctly.

## What Gets Added

### Event Chain Hash

The contract maintains a rolling hash of public events per game:

```cairo
// After processing Player B's public actions:
event_chain_hash = Poseidon(old_event_chain_hash, hash_of_this_turns_public_actions)
```

### External Events in Turn Proof

When Player A submits their next turn, the proof must verify:

```
Phase 1 of turn: Incorporate external events
    - Read all public actions from Player B's last turn
    - Apply effects to private state (combat damage, war declarations, etc.)
    - Hash the events: external_events_hash = Poseidon(serialized_events)
    
Contract checks: external_events_hash == event_chain_hash
```

If the hashes don't match, Player A skipped or fabricated events → transaction reverts.

## External Event Types

```cairo
enum ExternalEvent {
    CombatResult: (u64, u8, bool),      // combat_id, damage, survived
    CityLost: (u8, u8),                 // city_q, city_r (storage coords)
    WarDeclaredOnYou: u8,               // player_id
    PeaceMade: u8,                       // player_id
}
```

## Implementation Steps

1. **Add `event_chain_hash` to contract storage** (1 felt252 per game)
2. **Update `submit_turn`** to accept `external_events_hash` parameter and check it against stored hash
3. **Update `submit_turn`** to recompute `event_chain_hash` from this turn's public actions
4. **Add event incorporation to the off-chain prover** — Phase 1's `apply_action` functions are reused, just called with external events first
5. **Client reads events from chain** (via Torii indexer) and passes them to the prover

## Edge Case: First Turn

On the very first turn of the game, there are no external events. The `external_events_hash` should be a well-known constant (e.g., Poseidon of an empty array). The contract initializes `event_chain_hash` to this value.
