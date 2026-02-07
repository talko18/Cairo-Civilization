# Gas Estimation & Optimization Plan

## 1. StarkNet Fee Model

StarkNet fees have two components:

- **L2 gas** (computation): Cairo steps, storage syscall overhead
- **L1 data gas** (state diffs): each changed storage slot ≈ 128 bytes posted to L1 blobs via EIP-4844

Storage writes are the dominant cost. Each unique storage slot modified in a transaction creates one state diff entry posted to Ethereum L1.

## 2. Storage Slot Layout (Packed)

`StorePacking` is **required** for feasibility. Without it, a `Unit` struct occupies 7 storage slots instead of 1, multiplying costs ~4x.

| Struct | Raw Fields | Packed Into | Bits Used |
|---|---|---|---|
| Unit | 7 × u8 (type, q, r, hp, move, charges, fortify) | **1 felt252** | 56 / 252 |
| City | felt252 (name) + 11 small fields | **2 felt252** | 252 + ~112 |
| TileData | 4 × u8 (terrain, feature, resource, river_edges) | **1 felt252** | 32 / 252 |
| Scalars (u8, u32, u64, felt252) | — | **1 felt252** each | varies |

### Packing Implementation

```cairo
// Unit packs into 1 felt252:
//   bits 0-7:   unit_type
//   bits 8-15:  q
//   bits 16-23: r
//   bits 24-31: hp
//   bits 32-39: movement_remaining
//   bits 40-47: charges
//   bits 48-55: fortify_turns

impl StorePackingUnit of StorePacking<Unit, felt252> {
    fn pack(value: Unit) -> felt252 { ... }
    fn unpack(value: felt252) -> Unit { ... }
}

// TileData packs into 1 felt252:
//   bits 0-7:   terrain
//   bits 8-15:  feature
//   bits 16-23: resource
//   bits 24-31: river_edges

// City packs into 2 felt252:
//   slot 0: name (felt252)
//   slot 1: q(8) + r(8) + population(8) + hp(8) + food(16) + production(16) +
//           current_production(8) + buildings(32) + founded_turn(16) +
//           original_owner(8) + is_capital(8) = 136 bits
```

### Without Packing (comparison)

| Scenario | Packed Writes | Unpacked Writes | Cost Multiplier |
|---|---|---|---|
| Early turn | 15 | ~50 | 3.3x |
| Mid turn | 28 | ~100 | 3.6x |
| Late turn | 39 | ~145 | 3.7x |
| join_game | 654-1,294 | ~3,200 | 2.5-4.9x |

**StorePacking is not optional. Implement it in Feature 1 (Types & Constants).**

---

## 3. Per-Action Operation Costs

### Player Actions

| Action | Reads | Writes | Steps | Notes |
|---|---|---|---|---|
| MoveUnit | 3 | 1 | ~300 | unit + dest tile + stacking check |
| AttackUnit | 5 | 3 | ~800 | both units + tile + seed + diplo |
| RangedAttack | 7 | 2 | ~1,000 | + LOS checks (2-3 intermediate tiles) |
| FoundCity | 13 | 26 | ~2,000 | settler + distance checks + 7× tile_owner + 7× tile_owner_player |
| SetProduction | 3 | 2 | ~200 | city(2 slots) + techs |
| SetResearch | 1 | 1 | ~200 | |
| BuildImprovement | 4 | 2 | ~400 | unit + tile + improvement + techs |
| RemoveImprovement | 2 | 2 | ~200 | unit + improvement |
| FortifyUnit | 1 | 1 | ~100 | |
| DeclareWar | 1 | 1 | ~100 | |
| PurchaseWithGold | 4 | 4 | ~400 | gold + city/unit + techs |
| UpgradeUnit | 3 | 2 | ~300 | unit + gold + techs |

### End-of-Turn Processing

| Component | Reads | Writes | Steps | Notes |
|---|---|---|---|---|
| Per city (pop N) | 2 + (N+1)×2 | 2 | ~200×N | city(2) + (N+1) tiles + (N+1) improvements → city(2) |
| Unit produced | 0 | 2 | ~100 | new unit(1) + unit_count(1) |
| Building produced | 0 | 0 | ~50 | already in city write |
| Science | 3 | 1-2 | ~200 | current_tech + progress + completed |
| Gold | 1 | 1 | ~200 | treasury |
| Heal + reset (per unit) | 3 | 1 | ~100 | unit + tile_owner + tile_owner_player |
| Turn management | 6 | 4 | ~300 | status + turn + player + timestamp + timeout |
| Victory check | 2 | 0 | ~100 | |
| Per event emitted | 0 | 0 | ~300 | |

### One-Time Costs

| Transaction | Reads | Writes | Steps | Notes |
|---|---|---|---|---|
| create_game | 1 | 3 | ~200 | game_count + metadata |
| join_game (map gen) | ~3,945 | ~1,294 | ~827,000 | 640 tiles + smoothing + starting positions + units + metadata |

---

## 4. Turn Scenarios

### A: Typical Early Turn (turns 5-20)

*Move 2 units, Set Production, End Turn. 1 city (pop 2), 3 units.*

| Component | Reads | Writes | Steps |
|---|---|---|---|
| Access control | 6 | 0 | 300 |
| MoveUnit ×2 | 6 | 2 | 600 |
| SetProduction ×1 | 3 | 2 | 200 |
| EOT: 1 city (pop 2) | 8 | 2 | 600 |
| EOT: Science | 3 | 1 | 200 |
| EOT: Gold | 1 | 1 | 200 |
| EOT: Heal/reset ×3 | 9 | 3 | 300 |
| Turn flip | 0 | 4 | 300 |
| Events (1) | 0 | 0 | 300 |
| **Total** | **36** | **15** | **3,000** |

### B: Mid Game Turn (turns 40-80)

*Move 4 units, Attack 1, Set Production ×2, Build Improvement. 2 cities (pop 3, pop 2), 5 units.*

| Component | Reads | Writes | Steps |
|---|---|---|---|
| Access control | 6 | 0 | 300 |
| MoveUnit ×4 | 12 | 4 | 1,200 |
| AttackUnit ×1 | 5 | 3 | 800 |
| SetProduction ×2 | 6 | 4 | 400 |
| BuildImprovement ×1 | 4 | 2 | 400 |
| EOT: City 1 (pop 3) | 10 | 2 | 800 |
| EOT: City 2 (pop 2) | 8 | 2 | 600 |
| EOT: Science | 3 | 1 | 200 |
| EOT: Gold | 1 | 1 | 200 |
| EOT: Heal/reset ×5 | 15 | 5 | 500 |
| Turn flip | 0 | 4 | 300 |
| Events (2) | 0 | 0 | 600 |
| **Total** | **70** | **28** | **6,300** |

### C: Late Game Turn (turns 100-150)

*Move 6 units, Attack 2, Set Production ×3. 3 cities (pop 5, 4, 3), 8 units.*

| Component | Reads | Writes | Steps |
|---|---|---|---|
| Access control | 6 | 0 | 300 |
| MoveUnit ×6 | 18 | 6 | 1,800 |
| AttackUnit ×2 | 10 | 6 | 1,600 |
| SetProduction ×3 | 9 | 6 | 600 |
| EOT: City 1 (pop 5) | 14 | 2 | 1,200 |
| EOT: City 2 (pop 4) | 12 | 2 | 1,000 |
| EOT: City 3 (pop 3) | 10 | 2 | 800 |
| EOT: Science | 3 | 2 | 200 |
| EOT: Gold | 1 | 1 | 200 |
| EOT: Heal/reset ×8 | 24 | 8 | 800 |
| Turn flip | 0 | 4 | 300 |
| Events (3) | 0 | 0 | 900 |
| **Total** | **107** | **39** | **9,700** |

### D: City Founding Turn (1-2 times per game)

*Same as A + FoundCity.*

| Component | Reads | Writes | Steps |
|---|---|---|---|
| Scenario A base | 36 | 15 | 3,000 |
| FoundCity | 13 | 26 | 2,000 |
| **Total** | **49** | **41** | **5,000** |

### E: join_game — Map Generation (one-time)

| Component | Reads | Writes | Steps |
|---|---|---|---|
| 640 tiles × 3 Poseidon hashes | 0 | 640 | 576,000 |
| Smoothing pass (neighbor reads) | ~3,840 | 640 | 200,000 |
| Starting position search | ~100 | 0 | 50,000 |
| 4 starting units (2 per player) | 0 | 6 | 200 |
| Game metadata + events | 5 | 8 | 1,000 |
| **Total** | **~3,945** | **~1,294** | **~827,000** |

Notes:
- Smoothing writes to same tiles as generation (same slots), so effective unique writes = ~654 (640 tiles + 6 units + 8 metadata)
- 827K steps is well within StarkNet's ~3M step transaction limit
- 654 unique storage writes is high but feasible (StarkNet handles batch operations with hundreds of writes)

---

## 5. Cost Estimates (USD)

### Calibration

Based on observed StarkNet transaction costs (early 2026, EIP-4844 blobs):

| Reference Transaction | Writes | Typical Cost |
|---|---|---|
| ERC-20 transfer | ~3 | $0.001-0.005 |
| AMM swap | ~8 | $0.005-0.02 |
| Complex DeFi (lending) | ~15 | $0.01-0.05 |
| Batch operation (~50 writes) | ~50 | $0.05-0.15 |

Costs scale roughly linearly with writes. L1 gas price is the biggest variable.

### Per-Turn Estimates

| Scenario | Writes | Low L1 Gas | Typical L1 Gas | High L1 Gas |
|---|---|---|---|---|
| **A: Early turn** | 15 | $0.005 | **$0.02** | $0.06 |
| **B: Mid turn** | 28 | $0.01 | **$0.05** | $0.12 |
| **C: Late turn** | 39 | $0.02 | **$0.08** | $0.20 |
| **D: Founding turn** | 41 | $0.02 | **$0.08** | $0.20 |
| **E: join_game** | 654 | $0.20 | **$1.00** | $3.00 |
| create_game | 3 | $0.001 | **$0.005** | $0.01 |

### Per-Game Estimate (150 turns, 75 per player)

| Phase | Turns/Player | Cost/Turn (typical) | Subtotal |
|---|---|---|---|
| Setup (create + join, split) | 1 | $0.50 | $0.50 |
| Founding turns (×2) | 2 | $0.08 | $0.16 |
| Early (turns 5-20) | 13 | $0.02 | $0.26 |
| Mid (turns 20-80) | 30 | $0.05 | $1.50 |
| Late (turns 80-150) | 30 | $0.08 | $2.40 |
| **Per player** | **75** | | **$4.82** |
| **Per game (both)** | **150** | | **~$10** |

### Cost Range by L1 Gas Conditions

| L1 Gas | Per Turn (avg) | Per Player | Per Game |
|---|---|---|---|
| Low (blobs cheap) | $0.02 | $2.50 | **$5** |
| Typical | $0.05 | $5.00 | **$10** |
| High (L1 congestion) | $0.12 | $12.00 | **$25** |

### Comparison with Other On-Chain Games

| Game | Chain | Cost/Action | Notes |
|---|---|---|---|
| Dark Forest | Ethereum L1 | $5-50 | Extremely expensive |
| Loot Survivor | StarkNet | $0.01-0.05 | Similar complexity |
| Cairo Civ (ours) | StarkNet | $0.02-0.08 | Reasonable for 5-min turns |

---

## 6. Optimization Opportunities

Three optimizations that can be applied independently. Each is designed to be a drop-in change to the storage layer without affecting game logic.

### OPT-1: Pack tile_owner + tile_owner_player into single map

**Current**: Two separate maps per tile.
```cairo
tile_owner: LegacyMap<(u64, u8, u8), u32>,        // city_id
tile_owner_player: LegacyMap<(u64, u8, u8), u8>,   // player_idx
```

**Optimized**: Single map with packed value.
```cairo
tile_owner: LegacyMap<(u64, u8, u8), u64>,
// Encoding: (player_idx as u64) * 0x100000000 + (city_id as u64)
// 0 = unclaimed
// Decode: player = value / 0x100000000, city_id = value % 0x100000000
```

**Impact**:

| Operation | Current Writes | Optimized Writes | Saved |
|---|---|---|---|
| FoundCity territory (7 tiles) | 14 | 7 | **7 writes** |
| Territory expansion (12 tiles at pop 3) | 24 | 12 | **12 writes** |
| join_game (640 tiles init) | 0 (no territory at start) | 0 | 0 |
| Heal/reset per unit (reads) | 3 reads | 2 reads | **1 read/unit** |
| City capture (territory transfer) | 2 writes/tile | 1 write/tile | **50%** |

Per-game savings: ~60-100 writes across all founding + expansion events.

**How to add later**: Replace two `LegacyMap` entries with one. Add `pack_tile_owner` / `unpack_tile_owner` helpers. Change `get_tile_owner` view function return type (already returns tuple — change internal implementation only). All game logic modules use `is_friendly_territory()` which just needs player_idx — the packing is invisible to them.

### OPT-2: Chunked or Lazy Map Generation

**Current**: `join_game` generates all 640 tiles in one transaction (~654 writes, ~827K steps).

**Option A — Chunked generation** (split across transactions):
```cairo
fn join_game(game_id: u64);           // sets up game, stores seed, status = GENERATING
fn generate_chunk(game_id: u64, chunk: u8);  // generates rows chunk*5..chunk*5+4 (4 chunks of 5 rows)
fn finalize_game(game_id: u64);       // validates map, places units, status = ACTIVE
```

- 4 chunks × ~160 tile writes = ~160 writes per tx (vs 654 in one)
- Each chunk: ~160 writes, ~210K steps
- Adds 5 transactions instead of 1, but each is much cheaper
- Total writes unchanged, but each tx fits comfortably in gas limits

**Option B — Lazy generation with cache**:
```cairo
fn get_or_generate_tile(game_id: u64, q: u8, r: u8) -> TileData {
    let cached = map_tiles.read(game_id, q, r);
    if cached.terrain != TERRAIN_UNINITIALIZED {
        return cached;
    }
    let tile = generate_tile(seed, q, r);  // hash-based, deterministic
    map_tiles.write(game_id, q, r, tile);
    return tile;
}
```

- Tiles generated on first access (movement, city founding, yield computation)
- Spreads cost across many turns instead of one big transaction
- Problem: starting position search needs to read ~100 tiles to find valid positions
- Problem: in Phase 1 with public state, the UI wants to render the full map immediately

**Recommendation**: Option A (chunked) is simpler and works for both Phase 1 and Phase 2. Option B is more complex but cheaper if most tiles are never accessed (unlikely in a 150-turn duel on a 32×20 map).

**How to add later**: The map generation logic is in `map_gen.cairo` (pure function). The contract just calls it. Chunking only changes the contract's `join_game` flow — split into multiple entry points. The `generate_map` function can be changed to `generate_map_chunk(seed, row_start, row_end)` without affecting any other module.

### OPT-3: Batch Unit Updates

**Current**: Each unit is a separate storage slot. Healing/resetting N units = N writes.

**Optimized**: Pack multiple units into a single storage slot.

```cairo
// Pack up to 3 units per felt252 (each unit = 56 bits, felt252 = 252 bits)
// Key: (game_id, player_idx, unit_group_idx)
// unit_group_idx = unit_id / 3
// Position within group = unit_id % 3
unit_groups: LegacyMap<(u64, u8, u32), felt252>,
```

**Impact**:
- Healing 8 units: 8 writes → 3 writes (ceil(8/3))
- Movement reset: same savings
- Read a single unit: unpack from group (slightly more computation, fewer reads)

**Tradeoff**: More complex packing/unpacking, harder to reason about. Saves ~30% on unit-heavy turns.

**How to add later**: This only changes the storage layer in `contract.cairo`. The `Unit` struct and all pure-function modules (movement, combat, turn) are unchanged — they work with unpacked `Unit` values. The contract packs/unpacks at the storage boundary.

**Recommendation**: Defer unless late-game turns with 10+ units become a cost concern. The complexity isn't worth it for the MVP.

---

## 7. Optimization Impact Summary

| Optimization | Complexity | Per-Turn Savings | Per-Game Savings | Recommendation |
|---|---|---|---|---|
| **OPT-1**: Pack tile_owner | Low | 1-14 writes on territory turns | ~80 writes (~$0.20) | **Do in MVP** |
| **OPT-2**: Chunked map gen | Low | N/A (one-time) | Reduces peak tx cost from $1-3 to $0.25-0.75 per chunk | **Do if join_game hits gas limits** |
| **OPT-3**: Batch unit packing | Medium | 3-5 writes on late turns | ~150 writes (~$0.40) | **Defer to post-MVP** |

### Optimized Per-Game Estimate (with OPT-1)

| Phase | Cost (baseline) | Cost (OPT-1) | Savings |
|---|---|---|---|
| Setup | $1.00 | $1.00 | — |
| Founding (×2) | $0.16 | $0.10 | $0.06 |
| Early (13 turns) | $0.26 | $0.22 | $0.04 |
| Mid (30 turns) | $1.50 | $1.35 | $0.15 |
| Late (30 turns) | $2.40 | $2.10 | $0.30 |
| **Per player** | **$4.82** | **$4.27** | **$0.55** |
| **Per game** | **~$10** | **~$9** | **~$1** |

---

## 8. Design Constraints for Optimization Compatibility

To ensure optimizations can be added later without refactoring game logic:

### Rule 1: Pure modules never touch storage directly
All game logic modules (hex, map_gen, movement, combat, city, tech, economy, turn, victory) are pure functions. They take unpacked structs as input and return unpacked structs as output. Packing/unpacking happens only in `contract.cairo`.

### Rule 2: Territory ownership accessed via helper function
No module directly reads `tile_owner` or `tile_owner_player`. Instead, the contract calls `is_friendly_territory(player, tile_owner_player, tile_owner_city_id)`. If we pack the two maps later (OPT-1), only the contract's read logic changes.

### Rule 3: Map generation is a pure function
`generate_map(seed, width, height)` returns an array of tiles. The contract decides how to store them (all at once, or in chunks). Chunking (OPT-2) only changes the contract entry point, not the generation logic.

### Rule 4: Unit access is by ID, not by group
All modules reference units by `(player_idx, unit_id)`. If we batch-pack units later (OPT-3), the contract translates `unit_id → group_idx + offset` at the storage layer. Pure modules never see the grouping.

### Rule 5: StorePacking traits are in types.cairo
All `StorePacking` implementations live next to the struct definitions. If packing schemes change, only `types.cairo` is affected. Tests for packing correctness are added to `test_types.cairo` (a new, small test file).
