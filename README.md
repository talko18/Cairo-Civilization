# Cairo Civ

A Civilization VI-style strategy game running on StarkNet, written in Cairo. Player state is kept private via ZK proofs — the blockchain verifies moves are legal without ever seeing them.

## How It Works

- Each player maintains their game state locally (units, cities, research, gold, explored tiles)
- On-chain, only a **hash** of each player's state is stored
- Each turn, the player generates a **STARK proof** that their moves are legal
- One transaction per turn: new state hash + proof + public actions
- The chain verifies the proof without seeing the private state

## MVP Scope

2-player duel on a small hex map with:

- 5 unit types (Settler, Builder, Warrior, Slinger, Scout)
- Cities with production queues
- ~20-tech research tree
- Gold economy
- Basic combat (melee + ranged)
- Fog of war (terrain hidden until explored)
- Domination victory (capture opponent's capital)
- Sequential turns

## Project Structure

```
cairo_civ/
  design/              # Architecture and technical design
    01_architecture_overview.md   # Authoritative high-level design
    02_hidden_information_and_zk.md
    03_starknet_contracts.md
    04_game_state_and_commitments.md
    05_fog_of_war.md
    06_combat_and_interactions.md
    07_challenges_and_roadmap.md
    08_pothole_analysis.md
  base_game_mechanics/  # Civ VI game rules reference
  game_mechanics/       # Adapted game mechanics for on-chain play
  ui/                   # Browser client prototype
```

## Key Design Decisions

| Decision | Choice |
|---|---|
| Contracts | Single Cairo contract (no multi-contract complexity) |
| ZK circuit | One circuit (TurnProof) handles everything |
| Commitment | Flat Poseidon hash of full state (no Merkle tree for MVP) |
| Map privacy | Dealer-prover generates map, serves tiles on valid exploration |
| Unit positions | Public (revealed each turn) — production/research/gold stay private |
| Combat | 2-tx split proof: attacker reveals on their turn, defender on theirs |
| Randomness | Derived from both players' combat salts (derived from state salts bound to opponent's last commitment) |
| Turns | Sequential |

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | Cairo (StarkNet) |
| Off-chain proofs | Cairo compiled to WASM (browser) |
| Client | HTML5 / JavaScript |
| Hashing | Poseidon |
| Map dealer | HTTP service + on-chain Merkle commitment |
| Indexing | StarkNet events + Torii |

## Roadmap

**Phase 1** (months 1-3): Public game on StarkNet — all state visible, prove the game logic works.

**Phase 2** (months 4-7): Add ZK privacy — swap public state for commitments, build client-side prover.

**Phase 3** (months 8-10): Optimize, expand features, deploy to testnet.
