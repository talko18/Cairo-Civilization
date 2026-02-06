# Fog of War

## 1. Two Kinds of Hidden Information

| What's hidden | How it's hidden |
|---|---|
| **Map terrain** (undiscovered tiles) | Dealer-prover holds the map; reveals tiles on valid exploration |
| **Unit positions** (enemy units you can't see) | Each player's state commitment hides their units |

This document covers **map terrain fog of war**. Unit visibility is handled by the turn proof (players report spotted enemies as public actions).

## 2. Map Generation: The Dealer-Prover

Players cannot generate the map themselves — if they know the seed, they know the full map, and fog of war is broken.

### Protocol

```
1. SEED: Each player commits H(random_i), then reveals random_i.
   Combined seed = H(random_1 || random_2). No player can bias it.

2. GENERATE: A dealer-prover service runs ProceduralGenerate(seed).
   It computes per-tile salts: tile_salt_i = Poseidon(master_secret, i).
   It computes the map Merkle root and posts it on-chain.

3. SERVE: When a player explores tile (col, row), the dealer releases:
   (tile_data, tile_salt, merkle_proof) for that tile.
   Player verifies the Merkle proof against the on-chain commitment.
```

### Trust Model

The dealer knows the full map but **cannot cheat** — the commitment is on-chain and provably matches the agreed seed. The dealer can only:
- Refuse to serve tiles (solved by: any player can reconstruct the map from the seed as a fallback, accepting that they'll see the full map)
- Read players' exploration patterns (minor; they already see the turn transactions)

For MVP, the dealer is a simple centralized server. For competitive play later, upgrade to MPC.

## 3. Tile Exploration

When a player moves a unit, newly visible tiles are revealed:

```
1. Player moves unit to (col, row)
2. Vision range = 2 (most units) or 3 (scout)
3. For each tile in vision range that player hasn't explored before:
   a. Request tile data from dealer-prover
   b. Verify Merkle proof against on-chain map commitment
   c. Add tile to explored_tiles in private state
   d. Include TileRevealed in public_actions
```

The turn proof verifies that the player had a unit with vision range covering each revealed tile.

### Per-Tile Salts

Each tile leaf in the map Merkle tree is:
```
leaf_hash = Poseidon(terrain, feature, resource, river_bitmask, tile_salt)
```

The per-tile salt (252-bit entropy) prevents brute-forcing tile contents. Even though there are only ~5K possible terrain/resource combinations, the salt makes each tile independently infeasible to guess.

## 4. Unit Visibility (Simplified for MVP)

For MVP, unit visibility uses **self-reporting**:

- Each player's turn proof includes a list of enemy units they can currently see
- The proof verifies: "for each reported sighting, I have a unit within vision range of that position"
- Spotted units become public knowledge (emitted as events)

**What this doesn't handle**: A player could theoretically omit a sighting (not report an enemy they can see). However, this only hurts themselves (they lose information about nearby threats), so the incentive to cheat is low.

For post-MVP, a **challenge protocol** can enforce complete reporting: after both players submit, either player can challenge "do you have a unit at (x, y)?" and the challenged player must prove yes or no.

## 5. Tile Visibility States

```
UNDISCOVERED → (unit moves within vision range) → VISIBLE
VISIBLE → (all units/cities leave range) → EXPLORED (dimmed, last-known state)
EXPLORED → (unit returns) → VISIBLE
```

This is tracked entirely in the player's private state. The on-chain contract only stores publicly revealed tile terrain data (shared across all players who have explored it).
