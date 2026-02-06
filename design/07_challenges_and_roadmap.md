# Challenges & Roadmap

## 1. Key Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Proof generation too slow** | Players wait too long after clicking End Turn | MVP state is small (~5K felts); flat hash is fast; optimize later with Merkle trees |
| **Gas costs too high** | Full game costs too much to play | One tx per turn; minimal storage (1 commitment per player); events for history |
| **Player loses device** | Private state lost, game forfeited | Use localStorage for persistence; add encrypted backups post-MVP |
| **Dealer-prover goes down** | Can't explore new tiles | Fallback: any player can reconstruct map from seed (loses fog of war but game continues) |
| **State desync** | Players disagree on game state | Event chain hash verification ensures all external events are incorporated |
| **Modified client cheats** | Player uses info they shouldn't have | ZK proofs bind actions to committed state; player can't act on info they haven't proven they have |
| **Proof bug allows invalid moves** | Game integrity broken | Extensive testing; formal verification of core circuit; security audit |

## 2. What We're NOT Building (To Stay Simple)

- No Merkle tree commitment (flat hash is sufficient for MVP state size)
- No zone-based visibility protocol (self-reporting in turn proof is simpler)
- No delayed/shuffled tile reveals (immediate reveals are fine for MVP)
- No encrypted DA backups (localStorage is sufficient for MVP)
- No separate engine contracts (one contract handles everything)
- No simultaneous turns (sequential only)
- No religion, espionage, great people, trade routes, city-states, barbarians

Each of these is a well-defined extension that can be added without redesigning the core.

## 3. Roadmap

Each phase has a dedicated design directory with detailed docs on what to build and how.

### Phase 1: Public Game on StarkNet (Months 1-3)

All state is public (no ZK yet). Prove the game logic works.

Design: `design/` (main docs describe the MVP target)

| Task | Priority |
|---|---|
| Set up Scarb project, deploy to Katana | High |
| Single contract: create_game, join_game, submit_turn | High |
| State types in Cairo (Unit, City, GameState) | High |
| Turn validation logic (movement, combat, city founding) | High |
| Procedural map generation | High |
| Basic tech tree (~20 techs) | Medium |
| Connect HTML UI to StarkNet via starknet.js | Medium |
| Domination victory check | Medium |

### Phase 2: Add ZK Privacy (Months 4-7)

Swap public state for commitments. State stays off-chain, proofs go on-chain.

Design: `design/phase2_zk_privacy/`
- `01_transition_overview.md` — what changes from Phase 1 to Phase 2
- `02_commitment_scheme.md` — how to add Poseidon hashing, salt derivation, commitment storage
- `03_off_chain_prover.md` — TurnProof circuit, WASM compilation, client integration
- `04_dealer_prover.md` — map generation service, tile serving, trust model
- `05_event_sync.md` — external event incorporation, event chain hash

| Task | Priority |
|---|---|
| Poseidon hashing library for game state | High |
| Off-chain Cairo prover (TurnProof circuit) | High |
| On-chain proof verifier in the game contract | High |
| Commitment-based turn submission | High |
| Dealer-prover service for map tiles | High |
| External event incorporation + event chain hash | High |
| Combat split proofs (attacker/defender) | High |
| Client-side prover integration (WASM in browser) | High |

### Phase 3: Polish & Expand (Months 8-10)

Optimize, add features, prepare for testnet.

Design: `design/phase3_expansion/`
- `01_unit_fog_of_war.md` — zone bitmask, Merkle tree commitment, combat non-membership proofs
- `02_barbarians.md` — public NPC state, deterministic AI
- `03_city_states.md` — public NPCs, envoy system, suzerainty
- `04_encrypted_backups.md` — IPFS-based state recovery
- `05_expanded_units_and_techs.md` — full Ancient–Renaissance era content

| Task | Priority |
|---|---|
| Proof optimization (circuit size reduction) | High |
| Gas optimization | High |
| Unit fog of war (zone bitmask + Merkle tree) | High |
| Additional unit types, expanded tech tree | Medium |
| Barbarians (public NPC state) | Medium |
| City-states (public NPC state) | Medium |
| Encrypted state backups (IPFS) | Medium |
| Testnet deployment + playtesting | High |
| Security audit of proof circuit | High |

### Future Features

Design: `design/future/`
- `01_religion.md` — founding, spreading, theological combat, religious victory
- `02_espionage.md` — spy placement, missions, detection, counter-espionage
- `03_great_people_and_trade.md` — point tracking, trade routes, plundering
- `04_multiplayer_and_simultaneous.md` — 3+ player scaling, simultaneous turn protocol

## 4. Success Criteria

1. Two players complete a full game on StarkNet testnet
2. Neither player can see the other's units, production, or research
3. Map terrain is hidden until explored
4. One transaction per turn, < 15 seconds total (proof gen + on-chain verification)
5. Game is fun to play, not just technically interesting
