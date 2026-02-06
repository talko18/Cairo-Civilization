# Hidden Information & ZK Proofs

## 1. The Problem

On a public blockchain, all storage is readable. We need players' game state to remain private. The solution: store only a **hash** of each player's state on-chain. Players prove state transitions are legal via STARK proofs.

## 2. Commit → Prove → Reveal

1. **Commit**: Player stores `commitment = Poseidon(serialized_state, salt)` on-chain
2. **Prove**: Player generates a STARK proof that their actions are legal and produce a valid new state
3. **Reveal**: Some information becomes public when gameplay demands it (combat, city founding, etc.)

## 3. The One Circuit That Matters

There is fundamentally **one** ZK circuit in this game: the **State Transition Proof**. Everything else (combat, exploration, diplomacy) is just this circuit with different public outputs.

```
CIRCUIT: TurnProof

PUBLIC INPUTS:
    old_commitment           : felt252     // hash of state before turn
    new_commitment           : felt252     // hash of state after turn
    turn_number              : u32
    opponent_last_commitment : felt252     // opponent's on-chain commitment (for salt binding)
    external_events_hash     : felt252     // hash of events from other players we incorporated
    unit_positions           : (u8, u8, u8)[]    // all player's units: (type, q, r) in storage coords
    public_actions           : Action[]    // actions that need to be public (combat, city founding)

PRIVATE INPUTS (witness):
    old_state           : GameState   // full private state before turn
    new_state           : GameState   // full private state after turn
    external_events     : Event[]     // events from other players
    actions             : Action[]    // all actions taken (public + private)
    salt_old            : felt252
    salt_new            : felt252

CONSTRAINTS:
    1. Poseidon(old_state, salt_old) == old_commitment
    2. Poseidon(new_state, salt_new) == new_commitment
    3. salt_new == Poseidon(salt_old, turn_number, opponent_last_commitment)
    4. mid_state = apply_external_events(old_state, external_events)
    5. new_state = apply_actions(mid_state, actions)
    6. All actions are legal given the state
    7. public_actions ⊆ actions
    8. Poseidon(external_events) == external_events_hash
    9. unit_positions matches all units in new_state (type, col, row)
       // Unit positions are PUBLIC — this is how the opponent learns where your units are
```

That's it. One circuit. One proof per turn.

### Why not separate circuits for combat, visibility, etc.?

Because they're all just instances of the same proof with different public outputs:

| Scenario | What the proof does |
|---|---|
| **Normal turn** | Proves actions are legal. Public outputs = any completed buildings, founded cities |
| **Combat initiation** | Same proof, but public outputs include the attacking unit's revealed stats |
| **Combat response** | Same proof, but public outputs include the defending unit's revealed stats + terrain |
| **Exploration** | Same proof, but public outputs include newly revealed tiles |

The contract reads the `public_actions` list and routes each action to the appropriate on-chain logic (record city, initiate combat, store tile reveal, etc.).

## 4. Combat: Two Players, Two Proofs

Combat is the only interaction that spans two players. Since no single prover has both players' private states, combat uses **two separate TurnProofs** — one from each player:

1. **Attacker's turn**: Their TurnProof includes `PublicAction::AttackUnit(unit_reveal, target_pos, combat_salt)`. Contract verifies the target tile has an enemy unit (positions are public). Contract records a pending combat.
2. **Defender's next turn**: Their TurnProof includes `PublicAction::DefendUnit(unit_reveal, terrain, combat_salt)`. Contract resolves combat deterministically.

Randomness = `Poseidon(attacker_combat_salt, defender_combat_salt, combat_id) % 51 + 75` (0.75x–1.25x damage multiplier). Both combat salts are derived from each player's state salt (`combat_salt = Poseidon(state_salt, "COMBAT")`), which is committed as part of the state hash. The state salt itself is never revealed.

## 5. Hash Function

Use **Poseidon** everywhere. It's designed for ZK circuits and has low constraint count. The game state is ~10K felt252 values — hashing the whole thing takes ~10K Poseidon operations, which is fast even in a STARK circuit.

## 6. What Gets Revealed and When

| Trigger | Public Output |
|---|---|
| City founded | City name, position |
| Unit attacks | Attacker's unit type, position, combat stats, turn salt |
| Unit defends | Defender's unit type, position, stats, terrain, turn salt |
| Building/district completed | Type, city, position |
| Tech completed (with visible effect) | Tech name |
| War declared | Target player |
| Tile explored | Tile position, terrain, resource |

Everything else stays private inside the commitment.

## 7. Post-MVP: Merkle Trees for Partial Reveals

For MVP, the entire state is hashed flat. This means any reveal (e.g., a single unit for combat) requires proving against the full state hash — the proof must hash the entire state.

If this becomes a performance bottleneck, upgrade to a **Merkle tree** commitment where units, cities, and other collections are in separate branches. Then a combat reveal only needs to hash one branch (the units subtree), not the entire state.

This is a pure performance optimization that doesn't change the game logic or the contract interface. Swap the commitment function; everything else stays the same.
