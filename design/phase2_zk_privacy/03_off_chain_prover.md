# Adding the Off-Chain Prover

## What It Is

A Cairo program that runs on the player's device (compiled to WASM for the browser). It takes the player's private state + actions as input, executes the game logic, and produces a STARK proof that the state transition was valid.

## The TurnProof Circuit

One circuit handles everything:

```
PUBLIC INPUTS:
    old_commitment, new_commitment, turn_number,
    opponent_last_commitment, external_events_hash,
    unit_positions, public_actions

PRIVATE INPUTS (witness):
    old_state, new_state, external_events, actions, salt_old, salt_new

CONSTRAINTS:
    1. Poseidon(old_state, salt_old) == old_commitment
    2. Poseidon(new_state, salt_new) == new_commitment
    3. salt_new == Poseidon(salt_old, turn_number, opponent_last_commitment)
    4. mid_state = apply_external_events(old_state, external_events)
    5. new_state = apply_actions(mid_state, actions)
    6. All actions are legal given the state
    7. public_actions ⊆ actions
    8. Poseidon(external_events) == external_events_hash
    9. unit_positions matches all units in new_state
```

## Implementation Steps

### Step 1: Write Game Logic in Cairo (Already Done in Phase 1)

The Phase 1 contract already has all game rules in Cairo: movement validation, combat formulas, city founding rules, tech prerequisites, yield calculations. This same code becomes the core of the prover.

### Step 2: Wrap Game Logic in a Provable Program

The key difference between a Cairo contract and a Cairo provable program:
- Contract: runs on StarkNet, reads/writes storage
- Provable program: runs off-chain, takes inputs, produces proof + public outputs

Refactor the game logic into pure functions that take state as input and return new state. No storage reads — everything comes from function arguments.

### Step 3: Add Commitment Constraints

Before and after the game logic, add the hashing constraints:
- Hash old_state → verify it matches old_commitment
- Hash new_state → verify it matches new_commitment
- Derive new salt → verify it uses opponent's commitment

### Step 4: Compile to WASM

Use the Cairo-to-WASM compilation pipeline (via `cairo-run` or the Stwo prover compiled to WASM). The browser loads the WASM module and calls it when the player clicks "End Turn."

### Step 5: Add On-Chain Verifier

The contract needs a function that takes a STARK proof and public inputs and returns true/false. Options:
- Use StarkNet's built-in Cairo verifier (if available)
- Deploy a STARK verifier contract (e.g., from the Stone/Stwo ecosystem)
- Use a proof-verification precompile (if StarkNet adds one)

This is the most ecosystem-dependent step — verify what's available at implementation time.

## Performance Budget

| Operation | Estimated Cost (constraints) |
|---|---|
| Hash full state (~5K felts) × 2 | ~10K Poseidon ops |
| Salt derivation | ~3 Poseidon ops |
| Apply external events (~5 events) | ~500 ops |
| Apply player actions (~20 actions) | ~5K ops |
| Action legality checks | ~5K ops |
| **Total** | **~20K constraints** |

Estimated proving time: 2–10 seconds on consumer hardware. Acceptable for a turn-based game.

## Client Integration

```
Player clicks "End Turn"
  → Client serializes: (old_state, actions, external_events)
  → WASM prover runs TurnProof circuit
  → Proof + public outputs returned (~2-10 seconds)
  → Client submits transaction: (new_commitment, proof, public_actions)
  → UI shows "Submitting turn..." during on-chain confirmation
```

Show a progress indicator during proving. The player's thinking time (1-5 minutes per turn) can partially overlap with background proof pre-computation.
