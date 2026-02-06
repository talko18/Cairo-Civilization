# Future: 3+ Players & Simultaneous Turns

## 3+ Player Games

### What Changes

The core architecture scales to N players with minimal changes:

| Aspect | 2-Player | N-Player |
|---|---|---|
| Turn order | A → B → A → B | A → B → C → D → A → ... (rotating start) |
| Commitments | 1 per player (same) | 1 per player (same) |
| Salt derivation | Uses 1 opponent's commitment | Uses Poseidon(all opponents' commitments) |
| External events | From 1 opponent | From N-1 opponents (merged into one hash) |
| Zone bitmask | Check 1 opponent | Check N-1 opponents (still 1 bit-check per unit per opponent) |
| Combat | Always 1v1 | Still 1v1 (attacker picks target) |

### Salt Derivation for N Players

```
new_salt = Poseidon(old_salt, turn_number, 
    Poseidon(opponent_1_commitment, opponent_2_commitment, ...))
```

All opponents' commitments are public inputs. The contract supplies them.

### External Events for N Players

```
external_events_hash = Poseidon(
    events_from_player_B,
    events_from_player_C,
    events_from_player_D,
    ...
)
```

The contract maintains `event_chain_hash` per player (not per game), tracking events since that player's last turn.

### Contract Changes

- Turn rotation logic: `current_player = (game_turn % player_count)`
- Per-player event chain hashes instead of per-game
- No other structural changes

---

## Simultaneous Turns

### What Changes

All players submit turns within a time window. No sequential ordering.

### Protocol

```
1. SUBMIT PHASE (all players, within time window):
   - Each player submits their turn proof
   - External events = results from LAST round's resolution (not this round)

2. RESOLVE PHASE (contract, after all submit or timeout):
   - Process all public actions
   - Detect conflicts:
     - Two units target the same tile → combat between them
     - Two players both attack the same defender → resolve sequentially by priority
   - Resolve all combats deterministically
   - Emit results as events

3. NEXT ROUND:
   - All players incorporate resolution results as external events
```

### Priority System

When two players act on the same tile simultaneously, resolve by:
```
priority = Poseidon(player_commitment, round_number) % player_count
```
This is unpredictable (commitment-dependent) and fair (rotates naturally).

### Key Complexity

- Players don't know each other's actions when submitting → can't incorporate them
- Conflict resolution is non-trivial (multiple simultaneous attacks)
- Timeout handling: if a player doesn't submit, their turn is skipped (no actions, state unchanged except salt update)

### Estimated Effort

3+ Players: Low. Mostly parameter changes (turn rotation, event hash aggregation).
Simultaneous Turns: High. Conflict resolution, priority system, timeout handling, different external event model. Should be the last major feature.
