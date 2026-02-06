# Hex Coordinate System & Map Generation

## 1. Coordinate System

### Options

**A: Offset (odd-r)** — what Civ VI uses internally

```
Row 0:  [0,0] [1,0] [2,0] [3,0]
Row 1:    [0,1] [1,1] [2,1] [3,1]    ← shifted right
Row 2:  [0,2] [1,2] [2,2] [3,2]
```

- Pros: Natural fit for rectangular maps, simple storage (2D array), what Civ VI uses
- Cons: Neighbor math differs for odd/even rows, distance formula requires conversion, asymmetric — more edge cases in ZK circuits

**B: Axial (q, r)** — standard in hex grid libraries (Red Blob Games, libhex)

```
Axes: q (east), r (southeast)
Every hex has exactly 6 neighbors with symmetric offsets:
  (q+1,r), (q-1,r), (q,r+1), (q,r-1), (q+1,r-1), (q-1,r+1)
```

- Pros: Symmetric neighbor math (same formula everywhere), clean distance: `(|Δq| + |Δr| + |Δq+Δr|) / 2`, well-documented (redblobgames.com), simpler ZK circuits (no branching on odd/even)
- Cons: Rectangular map boundaries need clipping, slightly less intuitive than (col, row)

**C: Cube (x, y, z where x+y+z=0)**

- Pros: Cleanest math of all, distance = `max(|Δx|, |Δy|, |Δz|)`, trivial rotations and reflections
- Cons: Redundant coordinate (z = -x-y), wastes 50% more storage per position, every operation must maintain the x+y+z=0 invariant

### Decision: **B — Axial coordinates**

Closest to Civ VI's hex behavior with cleaner math. The symmetric neighbor formula eliminates branching in the ZK circuit (no odd/even row checks). Storage is the same as offset (2 values per position). Converting to/from offset for rendering is trivial.

### Concrete Specification

```
--- Logical coordinates (axial) ---
Coordinate: (q: i16, r: i16)   // can be negative

Distance(a, b):
    dq = |a.q - b.q|
    dr = |a.r - b.r|
    return (dq + dr + |dq - dr|) / 2

Neighbors(q, r):
    E:  (q+1, r)     W:  (q-1, r)
    SE: (q, r+1)     NW: (q, r-1)
    NE: (q+1, r-1)   SW: (q-1, r+1)

--- Storage coordinates (unsigned, on-chain) ---
To avoid signed integers in Cairo storage, apply a fixed offset:
    q_stored = q_axial + Q_OFFSET     (u8)
    r_stored = r_axial + R_OFFSET     (u8)

For a 32×20 map: Q_OFFSET = 16, R_OFFSET = 0
    q_stored range: 0..31    (q_axial: -16..+15)
    r_stored range: 0..19    (r_axial: 0..19)

All on-chain types use (q: u8, r: u8) in storage coordinates.
The client converts to/from axial for math (distance, neighbors).

Map Wrapping: NO wrapping for MVP (flat rectangular map)
```

### Line of Sight

For vision blocking (mountains, woods):

```
LOS(source, target):
    Draw a line from source center to target center
    For each hex the line passes through:
        if hex is Mountain: blocked
        if hex has Woods/Rainforest AND hex != source AND hex != target: blocked
    If not blocked: visible

Line drawing: use axial lerp (interpolate q and r, round to nearest hex)
```

This matches Civ VI's LOS rules.

---

## 2. Map Generation

### Options

**A: Perlin noise heightmap** — standard for terrain generation

```
1. Generate 2D Perlin noise → heightmap
2. Threshold to assign terrain:
   height < 0.3 → Ocean/Coast
   height < 0.5 → Flat (Grassland/Plains)
   height < 0.7 → Hills
   height >= 0.7 → Mountains
3. Second noise layer for moisture → biome:
   high moisture + low elevation → Grassland
   low moisture + low elevation → Desert/Plains
4. Place features (woods, marsh) based on noise + biome
5. Place resources semi-randomly with placement rules
```

- Pros: Produces natural-looking terrain, well-understood, tunable, deterministic from seed
- Cons: Can produce unplayable maps (all ocean, disconnected land), needs validation pass

**B: Template-based with noise** — Civ VI's actual approach (simplified)

```
1. Start with a continent template (blob shape)
2. Distort edges with Perlin noise
3. Assign terrain within the continent based on latitude + noise
4. Place mountains as ridgelines (line noise)
5. Place rivers flowing from mountains to coast
6. Place resources and features
```

- Pros: Guarantees playable maps, matches Civ VI feel, controllable continent shapes
- Cons: More complex to implement, template design is subjective

**C: Simple random with constraints** — fastest to implement

```
1. Fill map with land (single Pangaea continent)
2. Random terrain assignment with frequency targets
3. Place mountains as a random ridge
4. Place resources uniformly at random
5. Validate: starting positions have food, production, and aren't isolated
```

- Pros: Simplest to implement, fast, easy to debug
- Cons: Maps look artificial, less interesting gameplay

### Decision: **A — Perlin noise heightmap** with validation

Closest to Civ VI's natural terrain feel while being straightforward to implement. Add a validation pass that rejects maps where starting positions don't have minimum food/production within 2 tiles. The seed is deterministic, so regeneration is just trying seed+1.

### Map Parameters (MVP — Duel Size)

```
Map Width:  32 hexes
Map Height: 20 hexes
Total Tiles: 640

Terrain Distribution Targets:
    Ocean:    15-20%
    Coast:    5-10%
    Grassland: 20-25%
    Plains:   20-25%
    Desert:   5-10%
    Tundra:   5-10%
    Snow:     0-5%
    Mountains: 5-8%

Feature Distribution:
    Woods:      15-20% of eligible land tiles
    Rainforest: 5-10% of tropical land tiles
    Marsh:      2-5% of grassland near coast
    Oasis:      1-3 per desert region

Resource Distribution:
    Strategic: 2-3 of each type (Horses, Iron)
    Luxury:    3-4 different types, 1-2 copies each
    Bonus:     1 per ~8 land tiles (Wheat, Rice, Cattle, etc.)

Starting Positions:
    2 players, placed at opposite ends of the map
    Minimum 10 hex distance between capitals
    Each start must have within 2 tiles:
        - At least 4 food (from terrain + resources)
        - At least 2 production
        - At least 1 fresh water source (river or coast)
```

### Map Generation Algorithm

**Important: Phase 1 vs Phase 2 distinction**

Perlin noise requires floating-point math, which Cairo doesn't natively support. Two approaches:

**Phase 1 (on-chain generation)**: Use a hash-based terrain assignment that works in integer math:

```
fn generate_map(seed: felt252, width: u8, height: u8) -> Array<TileData> {
    for r in 0..height:
        for q in 0..width:
            // Hash each tile position to get pseudo-random values
            let h = Poseidon(seed, q, r, 'HEIGHT') % 1000    // 0-999
            let m = Poseidon(seed, q, r, 'MOISTURE') % 1000  // 0-999
            let t = Poseidon(seed, q, r, 'TEMP') % 1000 + latitude_bias(r, height)
            
            // Smooth: average with neighbors to avoid pure noise
            // h = (h + h_neighbor_avg) / 2  (optional smoothing pass)
            
            terrain = match (h, m, t):
                h < 250          → Ocean
                h < 320          → Coast
                h >= 820         → Mountain
                h >= 600 && t < 300 → Snow Hills / Tundra Hills
                h >= 600 && m < 300 → Desert Hills
                h >= 600         → Plains Hills / Grassland Hills
                t < 250          → Snow / Tundra
                m < 300          → Desert
                m < 550          → Plains
                _                → Grassland
            
            feature = assign_feature(terrain, m, t, seed, q, r)
            resource = assign_resource(terrain, feature, seed, q, r)
}

fn latitude_bias(r: u8, height: u8) -> u16:
    // Colder at top/bottom, warmer in middle
    let center = height / 2
    let dist = abs(r - center)
    return (dist * 500) / center  // 0 at equator, ~500 at poles
```

This produces less natural terrain than Perlin (more "speckled"), but a smoothing pass over the grid after initial assignment fixes this. Hash-based generation is fully deterministic from the seed and works in pure integer Cairo.

**Phase 2 (off-chain dealer)**: The dealer runs off-chain (Rust/Python), so it can use proper Perlin noise. The on-chain contract only stores the map commitment (Merkle root), not the generation algorithm. Better maps, same trust model.

### Rivers (Simplified for MVP)

Civ VI has complex river systems. For MVP, simplify:
- Generate 2-3 rivers per map, originating from mountains
- Rivers flow downhill (follow height gradient to coast)
- River stored as edge data: each hex has `river_edges: u8` bitmask (6 bits, one per edge)
- Crossing a river edge ends unit movement (Civ VI rule)
