# Adding the Dealer-Prover

## Why It's Needed

In Phase 1, the map is generated on-chain or from a public seed — all players know the full map. Phase 2 adds terrain fog of war: tiles are hidden until explored. This requires a party that holds the full map and serves tiles incrementally.

## What It Is

A simple HTTP server that:
1. Generates the map from an agreed seed
2. Commits the map Merkle root on-chain
3. Serves tile data to players when they prove valid exploration

## Implementation Steps

### Step 1: Map Seed Agreement

Same as Phase 1 but the seed is used by the dealer, not by players:

```
1. Each player commits H(random_i) on-chain
2. Each player reveals random_i
3. Combined seed = Poseidon(random_1, random_2)
4. Dealer uses the seed — players do NOT run generation themselves
```

### Step 2: Dealer Generates Map

```python
# Dealer server (Python/Rust/Node — not Cairo, runs off-chain)
def generate_map(seed, map_size):
    tiles = procedural_generate(seed, map_size)
    master_secret = poseidon(seed, "MAP_SALT_DERIVATION")
    
    leaves = []
    for i, tile in enumerate(tiles):
        tile_salt = poseidon(master_secret, i)
        leaf_hash = poseidon(tile.terrain, tile.feature, tile.resource, 
                            tile.river_bitmask, tile_salt)
        leaves.append(leaf_hash)
    
    merkle_root = compute_merkle_root(leaves)
    return tiles, tile_salts, merkle_root
```

### Step 3: Post Commitment On-Chain

The dealer calls `set_map_commitment(game_id, merkle_root)`. Only the registered dealer address (set during `create_game`) can call this.

### Step 4: Serve Tiles on Exploration

```
GET /tile?game_id=42&col=5&row=3&proof=<exploration_proof>

Response:
{
    "terrain": 4,
    "feature": 1,
    "resource": 0,
    "river_bitmask": 5,
    "tile_salt": "0x1a2b...",
    "merkle_proof": ["0xabc...", "0xdef...", ...]
}
```

The `exploration_proof` is a signature or proof that the player has a unit with vision over (5, 3). For MVP, this can be a simple signature from the player's StarkNet account (the dealer trusts that the player's on-chain turn proof already validated the exploration). For higher security, the dealer can verify a standalone exploration proof.

### Step 5: Client Verifies Tile Data

When the client receives tile data from the dealer:

```
leaf_hash = Poseidon(terrain, feature, resource, river_bitmask, tile_salt)
assert verify_merkle_proof(leaf_hash, tile_index, merkle_proof, on_chain_root)
```

If the proof passes, the tile is genuine. The dealer cannot serve fake tiles.

### Step 6: Include TileRevealed in Turn Proof

The player's TurnProof includes `TileRevealed(col, row, terrain, feature, resource)` as a public action. The proof verifies the player had vision over the tile.

The tile data is now stored on-chain (in `revealed_tiles`) so both players can see explored terrain.

## Dealer Trust Model

| Concern | Mitigation |
|---|---|
| Dealer changes the map after committing | Impossible — commitment is on-chain, Merkle proof would fail |
| Dealer serves wrong tile data | Client verifies Merkle proof against on-chain root |
| Dealer refuses to serve tiles | Fallback: any player can regenerate from seed (breaks fog of war but unblocks game) |
| Dealer reads exploration patterns | Minor info leak; dealer already sees transactions. Acceptable for MVP. |

## Deployment

For Phase 2, the dealer is a simple server. Options:
- **Simplest**: Express/Flask server hosted by the game operator
- **Better**: Serverless function (AWS Lambda / Vercel) — scales automatically
- **Best (post-MVP)**: MPC among N nodes, no single party knows full map
