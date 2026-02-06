# Phase 2: Adding ZK Privacy

## What Changes

Phase 1 is a fully public game — all state is in contract storage, anyone can read it. Phase 2 swaps public state for commitments and adds client-side STARK proofs. The game rules don't change; only WHERE the state lives and HOW it's verified.

| Aspect | Phase 1 (Public) | Phase 2 (ZK) |
|---|---|---|
| Game state | In contract storage (public) | On player's device (private) |
| On-chain per player | Full state | 1 felt252 commitment (hash) |
| Turn validation | Contract executes game logic | Contract verifies STARK proof |
| Map terrain | Public from turn 1 | Hidden until explored (dealer-prover) |
| Unit positions | Public (in storage) | Public (in proof output) — same for MVP |
| Production/research/gold | Public (in storage) | Private (in commitment) |

## What Gets Added

1. **Poseidon hashing library** — hash the full game state into a commitment
2. **Off-chain Cairo prover** — runs in browser (WASM), generates TurnProof
3. **On-chain proof verifier** — contract function that checks STARK proofs
4. **Commitment-based storage** — replace full state storage with 1 hash per player
5. **Dealer-prover service** — generates map, serves tiles on exploration
6. **Combat salt derivation** — separate from state salt, for safe randomness reveal
7. **Event chain hash** — ensures players incorporate each other's public actions
8. **Split combat proofs** — attacker and defender each prove from their own state
