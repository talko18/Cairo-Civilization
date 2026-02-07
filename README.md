# Cairo Civ

A Civilization VI-style strategy game running on StarkNet, written in Cairo.

## Development Approach

The game is built in two phases:

**Phase 1 (MVP — current focus)**: All game state lives on-chain. The contract validates every action directly. No ZK proofs, no hidden information. This is a fully playable on-chain strategy game.

**Phase 2 (future)**: Players keep their game state private locally. On-chain, only a **hash** of each player's state is stored. Each turn, a STARK proof verifies the moves are legal without revealing the private state.

The key architectural advantage: Phase 1 Cairo game logic becomes the Phase 2 ZK circuit with zero rewrite.

## MVP Scope

2-player duel on a 32×20 hex map with:

- 6 unit types (Settler, Builder, Scout, Warrior, Slinger, Archer)
- Cities with population growth, production queues, territory expansion
- 7 buildings (Monument, Granary, Walls, Library, Market, Barracks, Water Mill)
- 5 tile improvements (Farm, Mine, Quarry, Pasture, Lumber Mill)
- 18-tech research tree (Ancient + Classical eras)
- Gold economy with unit maintenance
- Deterministic combat (melee + ranged, exponential damage table)
- Domination + Score victory (turn 150 limit)
- Sequential turns with 5-minute timer

**Not in MVP**: fog of war, religion, espionage, great people, trade routes, city-states, districts, 3+ players, simultaneous turns.

## Project Structure

```
cairo_civ/
├── design/
│   ├── 01_architecture_overview.md     # Authoritative high-level design
│   ├── 03_starknet_contracts.md        # Contract interface, storage, data types
│   ├── 04_game_state_and_commitments.md
│   ├── game_rules/                     # Detailed MVP game mechanics
│   │   ├── 01_hex_and_map.md
│   │   ├── 02_units_and_combat.md
│   │   ├── 03_cities_and_economy.md
│   │   ├── 04_tech_tree.md
│   │   └── 05_game_flow.md
│   ├── implementation/                 # Interfaces, tests, feature map
│   │   ├── 01_interfaces.md            # All Cairo module interfaces
│   │   ├── 02_test_plan.md             # 352 automated tests + 15 manual
│   │   └── 03_feature_map.md           # 12-feature TDD implementation order
│   ├── phase2_zk_privacy/             # ZK transition design (future)
│   ├── phase3_expansion/              # Unit fog of war, barbarians, etc.
│   └── future/                        # Religion, espionage, great people
├── base_game_mechanics/               # Civ VI rules reference
├── game_mechanics/                    # Adapted mechanics reference
└── ui/                                # Browser client prototype
```

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Contracts | Single Cairo contract | No inter-contract complexity |
| Hex system | Axial (q,r) with u8 storage offset | Symmetric math, ZK-friendly |
| Combat formula | Lookup table (81 entries) for `30 × e^(Δ/25)` | Exact Civ VI, no floating point |
| Movement | Civ VI terrain costs, no zone of control | Strategic terrain without ZoC complexity |
| Buildings storage | u32 bitmask (32 slots) | Extensible beyond MVP 7 buildings |
| Tech storage | u64 bitmask (64 slots) | Extensible for future eras |
| Production IDs | Range-separated (1-63 units, 64-127 buildings) | Each category grows independently |
| Territory | Per-tile ownership map | O(1) conflict check |
| Science tracking | Half-points (u16) | Preserves 0.5 science/citizen precision |
| Turns | Sequential alternation | Eliminates conflict resolution |
| Code reuse | Phase 1 Cairo = Phase 2 ZK circuit | No rewrite on ZK transition |

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | Cairo (StarkNet), single contract |
| Client UI | HTML5 / JavaScript |
| Hashing | Poseidon (ZK-friendly) |
| Indexing | StarkNet events |

## Implementation Plan

Following TDD: write tests first, then implement, verify all pass before moving on.

12 features in dependency order (see `design/implementation/03_feature_map.md`):

1. Types & Constants → 2. Hex Math → 3. Map Gen → 4. Tech Tree → 5. Movement → 6. Combat → 7. City & Buildings → 8. Economy → 9. End-of-Turn → 10. Victory → 11. Contract Integration → 12. System Tests

Features 1-10 are pure functions (fast TDD, no contract deployment). Feature 11 wires them to storage. Feature 12 validates end-to-end.
