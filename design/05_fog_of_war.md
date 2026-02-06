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

## 4. Unit Visibility

### 4.1 MVP: Public Positions

For MVP, **unit positions are public**. Each player's turn proof includes all their unit positions as a public output (`unit_positions: Array<(u8, u8, u8)>` — type, q, r in storage coords). The proof verifies these match the actual units in the private state.

Why public positions for MVP:
- Unit fog of war requires detecting when a private unit is in another private player's vision range. No simple mechanism exists without extra infrastructure.
- Making positions public still keeps strategically important information private: city production, research, gold, explored tiles, unit health.
- Combat targeting is straightforward — the contract verifies the attacker targets a tile with an enemy unit.

### 4.2 Post-MVP: Zone Bitmask (Zero Extra Transactions, Any Player Count)

Unit fog of war is achieved by embedding visibility detection **inside the normal turn proof**. No challenge window, no extra transactions, no waiting.

**Why zone-level, not tile-level:** A tile-level vision bitmask (~1040 bits) works for 2 players but leaks too much in a 6-player game — all 5 opponents see your vision clusters and can approximate your unit positions, even players on the other side of the map who have no interaction with you. A zone bitmask (~20 bits) is coarse enough that distant players learn almost nothing ("units exist on this continent") while adjacent players get useful tactical awareness.

One mechanism for all player counts is simpler than maintaining separate approaches.

**Mechanism:**

The map is divided into fixed **zones** (8×8 hex clusters). A duel map (40×26) has ~20 zones. A standard map (84×54) has ~60 zones. Each zone fits in a single bit.

```
EACH TURN, every player's proof outputs:
  - zone_bitmask: 1 felt252 (each bit = "I have vision in this zone")
  - Proof verifies bitmask matches actual units/cities + vision ranges

EACH TURN, every player's proof also checks all opponents' zone bitmasks:
  - For each of my units at (col, row):
      zone_id = compute_zone(col, row)
      For each opponent O:
          if O.zone_bitmask[zone_id] == 1:
              MUST include ZoneReveal(opponent=O, zone=zone_id, unit_type)
              in public_actions
  - If any unit in an opponent's vision zone is omitted, proof is INVALID
```

**What gets revealed and to whom:**

| Scenario | What opponent learns |
|---|---|
| Your unit is in their vision zone | "A warrior exists somewhere in zone 7" (one of ~64 tiles). Not the exact tile. |
| Your unit is NOT in any opponent's vision zone | Nothing. Unit is fully hidden. |
| Distant opponent (no zone overlap) | Only your zone bitmask — "Player A has vision in zones 3, 5, 7." Coarse, like knowing which continent. |

**What stays hidden:**

- Exact tile position within a zone (64 possible tiles)
- Unit health, strength, promotions (until combat)
- Unit count within a zone (one reveal per unit, but zones can have multiple)
- Production, research, gold (always private)

**Security analysis:**

| Attack | Result |
|---|---|
| Player lies about zone bitmask (claims to see less) | Only hurts themselves — they miss spotting enemies. No incentive. |
| Player inflates zone bitmask (claims vision in zones without units) | Proof rejects — bitmask must match actual units/cities + vision ranges. |
| Player omits a unit in opponent's vision zone | Proof rejects — circuit iterates ALL units against ALL opponent bitmasks. |
| Player moves unit out of opponent's vision zone before revealing | Legal — the bitmask is from the opponent's LAST turn. You act THIS turn. |

**Circuit cost:**

- Publishing zone bitmask: 1 felt252 (trivial)
- Checking units against N opponents' bitmasks: for each unit, N bit-lookups. With 20 units and 5 opponents: 100 bit-lookups. Trivial in a STARK circuit.
- Scales linearly with player count, not quadratically.

**Combat targeting with hidden positions:**

The zone reveal tells you "there's a warrior in zone 7" but not which tile. To attack:

1. Attacker picks a target tile within the zone (their best guess based on zone reveal + game context)
2. Attacker submits `AttackUnit` targeting that tile (existing 2-tx combat protocol)
3. Defender's proof responds:
   - If a unit IS at that tile → normal combat (reveal unit, resolve damage)
   - If NO unit at that tile → prove non-presence via Merkle non-membership proof, combat fizzles, attacker wasted their action

This requires **Merkle tree commitments** (for efficient non-membership proofs), which is already on the post-MVP upgrade path.

The "guess wrong and waste your turn" mechanic is actually good game design — it rewards scouting and punishes blind aggression, matching how real fog of war works.

### 4.3 Upgrade Path Summary

```
MVP:       Public positions (zero complexity, works now)
Post-MVP:  Zone bitmask in proof (zero extra txs, works for any player count)
           + Merkle tree commitment (for combat non-membership proofs)
```

The upgrade from MVP to post-MVP changes:
1. Turn proof outputs `zone_bitmask` instead of `unit_positions`
2. Turn proof adds opponent bitmask checks + forced zone reveals
3. Commitment scheme swaps from flat hash to Merkle tree
4. Combat protocol adds non-presence response path

The contract interface changes are minimal — swap one public output type, add a `ZoneReveal` public action variant, add a `CombatFizzled` resolution path.

## 5. Tile Visibility States

```
UNDISCOVERED → (unit moves within vision range) → VISIBLE
VISIBLE → (all units/cities leave range) → EXPLORED (dimmed, last-known state)
EXPLORED → (unit returns) → VISIBLE
```

This is tracked entirely in the player's private state. The on-chain contract only stores publicly revealed tile terrain data (shared across all players who have explored it).
