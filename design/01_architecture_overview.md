# Architecture Overview — Cairo Civ on StarkNet

> This is the authoritative design document. Other docs in this directory provide deeper detail on specific topics. When in conflict, this document wins.

## 1. MVP Scope

The MVP is a **2-player duel** on a **small hex map** with these mechanics only:

- Hex map with fog of war (terrain hidden until explored)
- Units: Settler, Builder, Warrior, Slinger, Scout
- Cities: founding, population growth, production queue
- Basic combat (melee + ranged, deterministic)
- Technology tree (abbreviated, ~20 techs)
- Gold economy
- Domination victory (capture opponent's capital)
- Sequential turns

**Explicitly deferred to post-MVP**: religion, espionage, great people, trade routes, city-states, cultural borders, multiple victory types, simultaneous turns, 3+ player games.

## 2. Core Idea

Players keep their game state private on their own device. On-chain, only a **hash** of each player's state is stored. Each turn, a player generates a **STARK proof** that their state transition was legal, and submits the proof + new hash to the chain. The chain verifies the proof without ever seeing the actual state.

## 3. Two Proof Systems (Don't Confuse Them)

| Proof System | Who Generates | Purpose | Privacy? |
|---|---|---|---|
| **Client privacy proofs** | Player's browser (off-chain Cairo) | Prove private state transitions are legal | Yes — chain never sees private state |
| **StarkNet L2→L1 proofs** | StarkNet sequencer (automatic) | Prove L2 execution was correct to L1 | No — all L2 state is public on the L2 |

**Critical**: Storing data in StarkNet contract storage does NOT make it private. Every sequencer and full node can read it. Privacy comes entirely from the client-side proofs.

## 4. Architecture

```
PLAYER CLIENT
  ├── Browser UI (HTML/JS)
  ├── Local game state (private, never sent to chain)
  └── Off-chain Cairo prover (generates STARK proofs)
         │
         │  tx: (new_state_hash, proof, public_actions)
         ▼
STARKNET L2
  └── Game Contract (single Cairo contract)
        ├── Verifies proof
        ├── Stores new state hash (1 felt252 per player)
        ├── Stores map commitment (1 felt252)
        ├── Processes public actions (combat, city founding, etc.)
        └── Emits events (clients reconstruct public state from events)
         │
         ▼
DEALER-PROVER (off-chain service)
  ├── Generates map from agreed seed
  ├── Posts map commitment on-chain
  └── Serves tile data to players on valid exploration
```

**One contract. One proof per turn. Minimal on-chain state.**

## 5. Turn Flow

```
1. It's Player A's turn

2. Player A reads any pending events from Player B's last turn
   (combat results, war declarations, etc.)

3. Player A applies those external effects to their private state

4. Player A takes their own actions (move units, found cities, etc.)

5. Player A's off-chain prover generates a STARK proof:
   "old_hash → new_hash is a valid transition given
    external events E and my actions A"

6. Player A submits one transaction:
   (game_id, new_hash, proof, public_actions_list)

7. Contract verifies proof, stores new hash, processes public actions

8. Player B's turn begins
```

## 6. What's Public vs. Private

| Public (on-chain / in events) | Private (in player's commitment only) |
|---|---|
| Turn number, game status | Unit positions and types |
| Map commitment (hash) | City production queues |
| City locations (on founding) | Current research choice |
| Combat results | Gold amount |
| War/peace declarations | Explored tile set |
| Revealed terrain tiles | Exact military strength |

## 7. Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Number of contracts | **1** | Avoids inter-contract calls, access control bugs, upgrade coordination |
| Commitment scheme | **Flat Poseidon hash** of serialized state | Simple. State is ~10K felts — hashing is fast. No Merkle tree complexity for MVP. |
| Combat | **2-tx split proof** (attacker turn + defender turn) | Each player proves their own unit. Contract resolves deterministically. |
| Map generation | **Dealer-prover** with on-chain commitment | Only way to have fog of war without all players knowing the map |
| Visibility detection | **Self-report in turn proof** | Player's proof asserts which enemy units they can see. Simple, no challenge protocol. |
| State backup | **Browser localStorage** | Sufficient for MVP. Player forfeits on device loss. |
| Tile reveals | **Immediate** (on the turn explored) | Simple. Movement leak is minor for MVP. |
| Turn structure | **Sequential** | Eliminates all conflict resolution complexity |
| Randomness | **Derived from committed turn salts** | No extra transactions for random commit-reveal |

## 8. Technology Stack

| Layer | Technology |
|---|---|
| Smart contract | Cairo (StarkNet), single contract |
| Off-chain proofs | Cairo compiled to WASM, run in browser |
| Client UI | HTML5 / JS (existing prototype) |
| State hashing | Poseidon (ZK-friendly) |
| Map dealer | Simple HTTP server + on-chain commitment |
| Indexing | StarkNet events + Torii |

## 9. Post-MVP Upgrade Path

These features are designed to be added incrementally without breaking the core:

| Feature | What Changes |
|---|---|
| Merkle tree commitment | Swap flat hash for SMT → enables partial reveals (faster combat proofs) |
| Zone-based visibility | Add zone bitmasks to turn proof → enables unit fog of war |
| Encrypted DA backups | Add IPFS upload step after turn → enables cross-device play |
| 3+ player games | Extend turn rotation logic, no contract changes |
| Religion / espionage / etc. | New action types in the state transition proof, new public action variants |

## 10. Document Index

| Document | Contents |
|---|---|
| `01_architecture_overview.md` | This document — the authoritative simplified design |
| `02_hidden_information_and_zk.md` | The one ZK circuit that matters (state transition proof) |
| `03_starknet_contracts.md` | Single contract interface and data types |
| `04_game_state_and_commitments.md` | Private state structure and commitment scheme |
| `05_fog_of_war.md` | Map dealer-prover and tile exploration |
| `06_combat_and_interactions.md` | Combat resolution and basic diplomacy |
| `07_challenges_and_roadmap.md` | Risks and 3-phase roadmap |
| `08_pothole_analysis.md` | Historical: architectural flaws found in earlier design |
