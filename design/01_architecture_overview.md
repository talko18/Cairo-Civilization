# Architecture Overview — Cairo Civ on StarkNet

> This is the authoritative design document. Other docs in this directory provide deeper detail on specific topics. When in conflict, this document wins.

## 1. MVP Scope

The MVP is a **2-player duel** on a **small hex map** with these mechanics only:

- Hex map with fog of war (terrain hidden until explored)
- Units: Settler, Builder, Scout, Warrior, Slinger, Archer (6 types)
- Cities: founding, population growth, production queue
- Basic combat (melee + ranged, deterministic)
- Technology tree (abbreviated, ~20 techs)
- Gold economy
- Domination victory (capture opponent's capital)
- Sequential turns

**Explicitly deferred to post-MVP**: religion, espionage, great people, trade routes, city-states, cultural borders, multiple victory types, simultaneous turns, 3+ player games.

## 2. Core Idea

The game is built in two phases:

**Phase 1 (Public Game)**: All game state lives on-chain. The contract validates every action directly. No ZK proofs, no hidden information. This is a fully playable on-chain strategy game — it just has no fog of war on private data (production, research, gold are visible).

**Phase 2 (ZK Privacy)**: Players keep their game state private on their own device. On-chain, only a **hash** of each player's state is stored. Each turn, a player generates a **STARK proof** that their state transition was legal, and submits the proof + new hash to the chain. The chain verifies the proof without ever seeing the actual state.

## 3. Two Proof Systems (Don't Confuse Them)

| Proof System | Who Generates | Purpose | Privacy? |
|---|---|---|---|
| **Client privacy proofs** | Player's browser (off-chain Cairo) | Prove private state transitions are legal | Yes — chain never sees private state |
| **StarkNet L2→L1 proofs** | StarkNet sequencer (automatic) | Prove L2 execution was correct to L1 | No — all L2 state is public on the L2 |

**Critical**: Storing data in StarkNet contract storage does NOT make it private. Every sequencer and full node can read it. Privacy comes entirely from the client-side proofs.

## 4. Architecture

### Phase 1 (Public Game)

```
PLAYER CLIENT
  ├── Browser UI (HTML/JS)
  └── Reads full game state from chain
         │
         │  tx: (game_id, actions[])
         ▼
STARKNET L2
  └── Game Contract (single Cairo contract)
        ├── Validates each action against on-chain state
        ├── Stores FULL game state (units, cities, economy, research)
        ├── Runs end-of-turn processing (yields, growth, production)
        ├── Map generated on-chain from hash-based seed
        └── Emits events for client UI updates
```

**One contract. Actions validated on-chain. Full state stored.**

### Phase 2 (ZK Privacy)

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
  ├── Generates map from agreed seed (Perlin noise, off-chain)
  ├── Posts map commitment on-chain
  └── Serves tile data to players on valid exploration
```

**One contract. One proof per turn. Minimal on-chain state.**

## 5. Turn Flow

### Phase 1

```
1. It's Player A's turn
2. Player A reads game state from the contract (all state is public)
3. Player A decides actions (move units, found cities, set production, etc.)
4. Player A submits one transaction: submit_turn(game_id, actions[])
5. Contract validates each action, applies state changes, runs end-of-turn
6. Player B's turn begins
```

### Phase 2

```
1. It's Player A's turn
2. Player A reads pending events from Player B's last turn
3. Player A applies external events + own actions to private state
4. Player A's off-chain prover generates a STARK proof
5. Player A submits: (game_id, new_hash, proof, public_actions)
6. Contract verifies proof, stores new hash, processes public actions
7. Player B's turn begins
```

## 6. What's Public vs. Private

### Phase 1: Everything is public (on-chain state)

All game state is stored in the contract — both players can see everything. This is acceptable for Phase 1 because the focus is on getting the game mechanics right.

### Phase 2: Privacy via ZK

| Public (on-chain / in events) | Private (in player's commitment only) |
|---|---|
| Turn number, game status | City production queues |
| Map commitment (hash) | Current research choice |
| City locations (on founding) | Gold amount |
| **Unit positions and types** (each turn) | Explored tile set |
| Combat results | Unit health (until combat) |
| War/peace declarations | Completed techs (until visible effect) |
| Revealed terrain tiles | |

## 7. Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Number of contracts | **1** | Avoids inter-contract calls, access control bugs, upgrade coordination |
| Commitment scheme | **Flat Poseidon hash** of serialized state | Simple. State is ~10K felts — hashing is fast. No Merkle tree complexity for MVP. |
| Combat (Phase 1) | **Immediate resolution** on attacker's turn | Contract sees both units — no need for pending combat. Randomness from map seed. |
| Combat (Phase 2) | **2-tx split proof** (attacker turn + defender turn) | Each player proves their own unit. Contract resolves deterministically. |
| Map generation | **Phase 1**: hash-based on-chain. **Phase 2**: dealer-prover | Phase 1 uses integer math. Phase 2 uses Perlin noise off-chain. |
| Unit positions | **Public** (Phase 2: revealed each turn as proof output) | Unit fog of war requires interaction between two private states — no simple mechanism exists. |
| State backup | **Browser localStorage** | Sufficient for MVP. Player forfeits on device loss. |
| Turn structure | **Sequential** | Eliminates all conflict resolution complexity |
| Randomness (Phase 1) | **Poseidon(map_seed, turn, attacker, defender)** | Deterministic, set before gameplay, non-manipulable |
| Randomness (Phase 2) | **Derived from committed turn salts** | No extra transactions for random commit-reveal |
| Combat salt (Phase 2) | **Separate from state salt** | State salt never revealed, even during combat |
| Buildings storage | **u32 bitmask** (32 slots) | u8 only fits 8 buildings — not enough for future expansion |
| Tech storage | **u64 bitmask** (64 slots) | u32 only fits 32 techs — not enough for Medieval+ eras |
| Production IDs | **Range-separated** (1-63 units, 64-127 buildings) | Adding units doesn't renumber buildings |
| Territory | **Per-tile ownership map** (not per-city array) | O(1) tile conflict check, no array storage in LegacyMap |
| Code reuse | **Phase 1 Cairo = Phase 2 ZK circuit** | No rewrite on ZK transition |

## 8. Key Architectural Advantage: Phase 1 Code IS the Phase 2 ZK Circuit

Both Phase 1 and Phase 2 are written in Cairo. This is deliberate:

- **Phase 1**: The game validation logic (movement rules, combat resolution, yield computation, tech prerequisites) runs on-chain as normal Cairo contract code.
- **Phase 2**: The exact same validation logic runs off-chain as the ZK prover circuit. The contract just verifies the proof.

The Cairo functions that check "is this move legal?" and "what damage does this combat deal?" are **identical** in both phases. Phase 1 isn't throwaway prototype code — it's the production game engine that gets reused as the ZK circuit.

This means:
- No rewrite when transitioning to Phase 2
- Bugs found in Phase 1 are automatically fixed in Phase 2
- Game rule changes only need to happen in one place
- Phase 1 is a complete integration test of the Phase 2 circuit logic

## 9. Technology Stack

| Layer | Technology |
|---|---|
| Smart contract | Cairo (StarkNet), single contract |
| Off-chain proofs | Cairo compiled to WASM, run in browser |
| Client UI | HTML5 / JS (existing prototype) |
| State hashing | Poseidon (ZK-friendly) |
| Map dealer | Simple HTTP server + on-chain commitment |
| Indexing | StarkNet events + Torii |

## 10. Post-MVP Upgrade Path

These features are designed to be added incrementally without breaking the core:

| Feature | What Changes |
|---|---|
| Merkle tree commitment | Swap flat hash for SMT → enables partial reveals (faster combat proofs) |
| Unit fog of war | Add zone bitmask to turn proof (zero extra txs, scales to any player count) + Merkle tree for combat non-membership proofs |
| Encrypted DA backups | Add IPFS upload step after turn → enables cross-device play |
| 3+ player games | Extend turn rotation logic, no contract changes |
| Religion / espionage / etc. | New action types in the state transition proof, new public action variants |

## 11. Document Index

### Core Design (Phase 1 MVP)

| Document | Contents |
|---|---|
| `01_architecture_overview.md` | This document — the authoritative simplified design |
| `02_hidden_information_and_zk.md` | The one ZK circuit that matters (state transition proof) |
| `03_starknet_contracts.md` | Single contract interface and data types |
| `04_game_state_and_commitments.md` | Private state structure and commitment scheme |
| `05_fog_of_war.md` | Map dealer-prover, tile exploration, and unit visibility upgrade path |
| `06_combat_and_interactions.md` | Combat resolution and basic diplomacy |
| `07_challenges_and_roadmap.md` | Risks and 3-phase roadmap |

### Phase 2: ZK Privacy (`phase2_zk_privacy/`)

| Document | Contents |
|---|---|
| `01_transition_overview.md` | What changes from Phase 1 to Phase 2 |
| `02_commitment_scheme.md` | Poseidon hashing, salt derivation, commitment storage |
| `03_off_chain_prover.md` | TurnProof circuit, WASM compilation, client integration |
| `04_dealer_prover.md` | Map generation service, tile serving, trust model |
| `05_event_sync.md` | External event incorporation, event chain hash |

### Phase 3: Expansion (`phase3_expansion/`)

| Document | Contents |
|---|---|
| `01_unit_fog_of_war.md` | Zone bitmask, Merkle tree, combat non-membership proofs |
| `02_barbarians.md` | Public NPC state, deterministic AI |
| `03_city_states.md` | Public NPCs, envoy system, suzerainty |
| `04_encrypted_backups.md` | IPFS-based state recovery |
| `05_expanded_units_and_techs.md` | Full Ancient–Renaissance era content |

### Future Features (`future/`)

| Document | Contents |
|---|---|
| `01_religion.md` | Founding, spreading, theological combat, religious victory |
| `02_espionage.md` | Spy placement, missions, detection |
| `03_great_people_and_trade.md` | Great People points, trade routes |
| `04_multiplayer_and_simultaneous.md` | 3+ players, simultaneous turn protocol |

### Game Rules (`game_rules/`)

| Document | Contents |
|---|---|
| `01_hex_and_map.md` | Axial hex coordinates, distance/neighbor/LOS formulas, hash-based (Phase 1) and Perlin (Phase 2) map generation |
| `02_units_and_combat.md` | 6 unit types (Civ VI stats), movement costs, combat lookup table, ranged/city combat |
| `03_cities_and_economy.md` | Terrain yields, 10 resources, 7 buildings, population growth, gold economy |
| `04_tech_tree.md` | 18 techs across Ancient + Classical eras, prerequisites and unlocks |
| `05_game_flow.md` | On-chain lobby, 5-min turn timer, domination + score victory |

### Pre-Implementation

| Document | Contents |
|---|---|
| `10_pre_implementation_plan.md` | Checklist of decisions needed before coding (all resolved in game_rules/) |

### Historical

| Document | Contents |
|---|---|
| `08_pothole_analysis.md` | Architectural flaws found in earlier design |
| `09_design_validation.md` | Design choices validated against alternatives; bugs found and fixed |
