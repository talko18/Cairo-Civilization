// ============================================================================
// Map Generation — Generate map from seed. Called once per game.
//
// Produces a realistic 32x20 hex map with:
//   - Smooth, continent-style terrain (multi-sample noise averaging)
//   - Ocean only at edges / large water bodies; coast buffers land from ocean
//   - Coherent mountain ranges (seeded ridgelines, not scattered peaks)
//   - Multi-tile rivers flowing from mountains downhill to coast/ocean
//   - Latitude-driven temperature (poles → cold, equator → warm)
// ============================================================================

use core::poseidon::PoseidonTrait;
use core::hash::HashStateTrait;

use cairo_civ::types::{
    TileData,
    TERRAIN_OCEAN, TERRAIN_COAST, TERRAIN_MOUNTAIN,
    TERRAIN_GRASSLAND, TERRAIN_GRASSLAND_HILLS,
    TERRAIN_PLAINS, TERRAIN_PLAINS_HILLS,
    TERRAIN_DESERT, TERRAIN_DESERT_HILLS,
    TERRAIN_TUNDRA, TERRAIN_TUNDRA_HILLS,
    TERRAIN_SNOW, TERRAIN_SNOW_HILLS,
    FEATURE_NONE, FEATURE_WOODS, FEATURE_MARSH,
    RESOURCE_NONE, RESOURCE_WHEAT, RESOURCE_CATTLE,
    RESOURCE_STONE, RESOURCE_IRON, RESOURCE_SILVER,
    RESOURCE_HORSES, RESOURCE_DYES,
    MAP_WIDTH, MAP_HEIGHT,
};
use cairo_civ::hex;

// ---------------------------------------------------------------------------
// Main generation
// ---------------------------------------------------------------------------

/// Generate the full map from a seed. Returns array of (q, r, TileData).
pub fn generate_map(seed: felt252, width: u8, height: u8) -> Array<(u8, u8, TileData)> {
    // ── Phase 1: Generate raw height / moisture / temperature grids ──
    // Use multi-octave noise for smooth, continent-like terrain.
    let mut heights: Array<u16> = array![];
    let mut moistures: Array<u16> = array![];
    let mut temps: Array<u16> = array![];

    let w: u16 = width.into();
    let h: u16 = height.into();
    let total: u32 = w.into() * h.into();

    let mut idx: u32 = 0;
    while idx < total {
        let q: u8 = (idx % w.into()).try_into().unwrap();
        let r: u8 = (idx / w.into()).try_into().unwrap();

        // Multi-octave height: average of several offset samples for smoothness
        let hv = smooth_noise(seed, q, r, 0, width, height);
        // Apply continent mask: push edges toward ocean
        let edge_factor = continent_mask(q, r, width, height);
        let h_val: u16 = if hv > edge_factor { hv - edge_factor } else { 0 };

        let mv = smooth_noise(seed, q, r, 10, width, height);

        let t_raw = smooth_noise(seed, q, r, 20, width, height);
        let bias = latitude_bias(r, height);
        let t_val: u16 = if t_raw > bias { t_raw - bias } else { 0 };

        heights.append(h_val);
        moistures.append(mv);
        temps.append(t_val);

        idx += 1;
    };

    // ── Phase 2: Mountain ranges ──
    // Seed a few ridgelines that walk across the map, raising height along them.
    let mut mtn_bonus: Array<u16> = array![];
    // Initialize to zero
    let mut mi: u32 = 0;
    while mi < total {
        mtn_bonus.append(0);
        mi += 1;
    };
    // Generate ridgelines
    let mtn_bonus = generate_ridgelines(seed, width, height, mtn_bonus);

    // ── Phase 3: Assign terrain ──
    let mut tiles: Array<(u8, u8, TileData)> = array![];
    let h_span = heights.span();
    let m_span = moistures.span();
    let t_span = temps.span();
    let mtn_span = mtn_bonus.span();

    let mut idx2: u32 = 0;
    while idx2 < total {
        let q: u8 = (idx2 % w.into()).try_into().unwrap();
        let r: u8 = (idx2 / w.into()).try_into().unwrap();

        let raw_h = *h_span.at(idx2);
        let bonus = *mtn_span.at(idx2);
        let final_h: u16 = if raw_h + bonus > 999 { 999 } else { raw_h + bonus };
        let mv = *m_span.at(idx2);
        let tv = *t_span.at(idx2);

        let terrain = assign_terrain(final_h, mv, tv);
        let feature = assign_feature(terrain, mv, tv, seed, q, r);
        let resource = assign_resource(terrain, feature, seed, q, r);

        tiles.append((q, r, TileData { terrain, feature, resource, river_edges: 0 }));
        idx2 += 1;
    };

    // ── Phase 4: Coast/ocean cleanup ──
    // Any ocean tile adjacent to land becomes coast.
    // Any remaining ocean not adjacent to coast stays ocean.
    let tiles = fix_coastlines(tiles, width, height);

    tiles
}

// ---------------------------------------------------------------------------
// Smooth noise (multi-octave via neighbor averaging)
// ---------------------------------------------------------------------------

/// Multi-sample noise: averages the tile's own hash with its 4 cardinal
/// neighbors' hashes, producing smoother gradients than raw per-tile noise.
fn smooth_noise(seed: felt252, q: u8, r: u8, channel: u8, width: u8, height: u8) -> u16 {
    let center = hash_noise(seed, q, r, channel);

    // Sample 4 offset points (not all 6 neighbors — saves gas, still smooth)
    let mut sum: u32 = center.into() * 3; // weight center 3×
    let mut count: u32 = 3;

    // East
    if q + 1 < width {
        sum += hash_noise(seed, q + 1, r, channel).into();
        count += 1;
    }
    // West
    if q > 0 {
        sum += hash_noise(seed, q - 1, r, channel).into();
        count += 1;
    }
    // South
    if r + 1 < height {
        sum += hash_noise(seed, q, r + 1, channel).into();
        count += 1;
    }
    // North
    if r > 0 {
        sum += hash_noise(seed, q, r - 1, channel).into();
        count += 1;
    }

    (sum / count).try_into().unwrap()
}

// ---------------------------------------------------------------------------
// Continent mask — pushes map edges toward ocean
// ---------------------------------------------------------------------------

/// Returns a value to subtract from height based on distance from edge.
/// Edge tiles get high subtraction (→ ocean), center tiles get 0.
fn continent_mask(q: u8, r: u8, width: u8, height: u8) -> u16 {
    let q16: u16 = q.into();
    let r16: u16 = r.into();
    let w16: u16 = width.into();
    let h16: u16 = height.into();

    // Distance from each edge
    let dl = q16;           // left
    let dr = w16 - 1 - q16; // right
    let dt = r16;           // top
    let db = h16 - 1 - r16; // bottom

    // Minimum distance to any edge
    let min_lr = if dl < dr { dl } else { dr };
    let min_tb = if dt < db { dt } else { db };
    let min_edge = if min_lr < min_tb { min_lr } else { min_tb };

    // Tiles at edge 0 → subtract 500 (guaranteed ocean)
    // Tiles at edge 1 → subtract 350
    // Tiles at edge 2 → subtract 200
    // Tiles at edge 3 → subtract 80
    // Tiles at edge 4+ → subtract 0
    if min_edge == 0 { 500 }
    else if min_edge == 1 { 350 }
    else if min_edge == 2 { 200 }
    else if min_edge == 3 { 80 }
    else { 0 }
}

// ---------------------------------------------------------------------------
// Mountain ridgeline generation
// ---------------------------------------------------------------------------

/// Create 2-4 mountain ridgelines that walk across the map.
/// Each ridge starts at a pseudo-random point and extends in a direction,
/// raising height bonus along its path and 1-tile wide shoulders.
fn generate_ridgelines(
    seed: felt252, width: u8, height: u8, mut bonus: Array<u16>
) -> Array<u16> {
    let w: u32 = width.into();
    let h: u32 = height.into();
    let total: u32 = w * h;

    // Number of ridges: 2-4
    let num_ridges: u32 = (hash_noise(seed, 0, 0, 50) % 3).into() + 2;

    let mut ridge_i: u32 = 0;
    while ridge_i < num_ridges {
        // Starting position for this ridge
        let start_q_noise = hash_noise(seed, ridge_i.try_into().unwrap(), 0, 51);
        let start_r_noise = hash_noise(seed, ridge_i.try_into().unwrap(), 0, 52);
        let mut cur_q: u32 = ((start_q_noise % (width - 4).into()) + 2).into();
        let mut cur_r: u32 = ((start_r_noise % (height - 4).into()) + 2).into();

        // Ridge length: 8-16 tiles
        let ridge_len: u32 = (hash_noise(seed, ridge_i.try_into().unwrap(), 0, 53) % 9).into() + 8;

        let mut step: u32 = 0;
        while step < ridge_len && cur_q < w && cur_r < h {
            // Set height bonus on the ridge tile (index = q * height + r)
            let center_idx = cur_q * h + cur_r;
            if center_idx < total {
                let old = *bonus.at(center_idx);
                bonus = array_set(bonus, center_idx, if old > 350 { old } else { 350 });
            }

            // Set shoulder tiles (adjacent) to a lesser bonus
            let shoulder_offsets: Array<(i32, i32)> = array![(1, 0), (-1, 0), (0, 1), (0, -1)];
            let s_span = shoulder_offsets.span();
            let mut si: u32 = 0;
            while si < 4 {
                let (dq, dr) = *s_span.at(si);
                let sq: i32 = cur_q.try_into().unwrap() + dq;
                let sr: i32 = cur_r.try_into().unwrap() + dr;
                if sq >= 0 && sq < w.try_into().unwrap() && sr >= 0 && sr < h.try_into().unwrap() {
                    let s_idx: u32 = sq.try_into().unwrap() * h + sr.try_into().unwrap();
                    if s_idx < total {
                        let old_s = *bonus.at(s_idx);
                        if old_s < 180 {
                            bonus = array_set(bonus, s_idx, 180);
                        }
                    }
                }
                si += 1;
            };

            // Walk direction: biased by seed, with some wobble
            let dir_noise = hash_noise(seed, cur_q.try_into().unwrap(), cur_r.try_into().unwrap(), 54 + ridge_i.try_into().unwrap());
            let dir = dir_noise % 6;
            if dir < 2 {
                cur_q += 1;
            } else if dir < 3 {
                if cur_r > 0 { cur_r -= 1; }
                cur_q += 1;
            } else if dir < 4 {
                cur_r += 1;
                cur_q += 1;
            } else if dir < 5 {
                cur_r += 1;
            } else {
                if cur_r > 0 { cur_r -= 1; }
            }

            step += 1;
        };

        ridge_i += 1;
    };

    bonus
}

/// Set a value in an array at a given index (Cairo arrays are immutable,
/// so we rebuild). For small total sizes (640) this is acceptable.
fn array_set(arr: Array<u16>, idx: u32, val: u16) -> Array<u16> {
    let span = arr.span();
    let len = span.len();
    let mut result: Array<u16> = array![];
    let mut i: u32 = 0;
    while i < len {
        if i == idx {
            result.append(val);
        } else {
            result.append(*span.at(i));
        }
        i += 1;
    };
    result
}

// ---------------------------------------------------------------------------
// Coastline cleanup
// ---------------------------------------------------------------------------

/// Post-process: any ocean tile with a land neighbor becomes coast.
/// This ensures no ocean directly touches interior land.
fn fix_coastlines(
    tiles: Array<(u8, u8, TileData)>, width: u8, height: u8
) -> Array<(u8, u8, TileData)> {
    let span = tiles.span();
    let total = span.len();
    let w: u32 = width.into();

    // Build a flat terrain array for neighbor lookups
    let mut terrains: Array<u8> = array![];
    let mut i: u32 = 0;
    while i < total {
        let (_, _, td) = *span.at(i);
        terrains.append(td.terrain);
        i += 1;
    };
    let t_span = terrains.span();

    // Fix: ocean adjacent to land → coast
    let mut result: Array<(u8, u8, TileData)> = array![];
    let mut j: u32 = 0;
    while j < total {
        let (q, r, mut td) = *span.at(j);

        if td.terrain == TERRAIN_OCEAN {
            let has_land_neighbor = check_land_neighbor(
                q, r, width, height, t_span, w
            );
            if has_land_neighbor {
                td = TileData {
                    terrain: TERRAIN_COAST,
                    feature: td.feature,
                    resource: td.resource,
                    river_edges: td.river_edges,
                };
            }
        }

        result.append((q, r, td));
        j += 1;
    };

    result
}

/// Check if any of the 6 hex neighbors is walkable land.
/// Tile index: tiles are ordered q outer, r inner → index = q * height + r.
fn check_land_neighbor(
    q: u8, r: u8, width: u8, height: u8, terrains: Span<u8>, _w: u32
) -> bool {
    let h: u32 = height.into();
    let neighbors = hex::hex_neighbors(q, r);
    let nspan = neighbors.span();
    let nlen = nspan.len();
    let mut ni: u32 = 0;
    let mut found_land = false;
    while ni < nlen {
        let (nq, nr) = *nspan.at(ni);
        if nq < width && nr < height {
            let n_idx: u32 = nq.into() * h + nr.into();
            let n_terrain = *terrains.at(n_idx);
            if is_land_terrain(n_terrain) {
                found_land = true;
                break;
            }
        }
        ni += 1;
    };
    found_land
}

// ---------------------------------------------------------------------------
// Terrain assignment
// ---------------------------------------------------------------------------

/// Assign terrain type from noise values.
///
/// Height thresholds:
///   h < 250  → Ocean
///   h < 300  → Coast
///   h >= 820 → Mountain
///   h >= 600 → Hills variant
///   else     → Flat variant
///
/// Temperature / moisture determine biome:
///   t < 50              → Snow
///   t < 250             → Tundra
///   m < 300             → Desert
///   m >= 500            → Grassland
///   300 <= m < 500      → Plains
pub fn assign_terrain(h: u16, m: u16, t: u16) -> u8 {
    if h < 250 {
        return TERRAIN_OCEAN;
    }
    if h < 300 {
        return TERRAIN_COAST;
    }
    if h >= 820 {
        return TERRAIN_MOUNTAIN;
    }

    let is_hills = h >= 600;

    // Temperature determines cold biomes
    if t < 50 {
        return if is_hills { TERRAIN_SNOW_HILLS } else { TERRAIN_SNOW };
    }
    if t < 250 {
        return if is_hills { TERRAIN_TUNDRA_HILLS } else { TERRAIN_TUNDRA };
    }

    // Moisture determines warm biomes
    if m < 300 {
        return if is_hills { TERRAIN_DESERT_HILLS } else { TERRAIN_DESERT };
    }
    if m >= 500 {
        return if is_hills { TERRAIN_GRASSLAND_HILLS } else { TERRAIN_GRASSLAND };
    }

    // Medium moisture → Plains
    if is_hills { TERRAIN_PLAINS_HILLS } else { TERRAIN_PLAINS }
}

// ---------------------------------------------------------------------------
// Feature assignment
// ---------------------------------------------------------------------------

/// Assign feature for a given terrain and noise values.
/// Features are never placed on water or mountain tiles.
pub fn assign_feature(terrain: u8, m: u16, _t: u16, seed: felt252, q: u8, r: u8) -> u8 {
    // No features on water or mountain
    if terrain == TERRAIN_OCEAN || terrain == TERRAIN_COAST || terrain == TERRAIN_MOUNTAIN {
        return FEATURE_NONE;
    }

    let noise = hash_noise(seed, q, r, 3);

    // Woods on grassland/plains with decent moisture
    if (terrain == TERRAIN_GRASSLAND || terrain == TERRAIN_PLAINS
        || terrain == TERRAIN_GRASSLAND_HILLS || terrain == TERRAIN_PLAINS_HILLS)
        && m > 400
        && noise > 650
    {
        return FEATURE_WOODS;
    }

    // Marsh on flat grassland with high moisture
    if terrain == TERRAIN_GRASSLAND && m > 700 && noise > 850 {
        return FEATURE_MARSH;
    }

    FEATURE_NONE
}

// ---------------------------------------------------------------------------
// Resource assignment
// ---------------------------------------------------------------------------

/// Assign resource for a given terrain + feature.
/// No resources on mountains or deep ocean.
pub fn assign_resource(terrain: u8, _feature: u8, seed: felt252, q: u8, r: u8) -> u8 {
    if terrain == TERRAIN_MOUNTAIN || terrain == TERRAIN_OCEAN {
        return RESOURCE_NONE;
    }

    let noise = hash_noise(seed, q, r, 4);
    if noise <= 850 {
        return RESOURCE_NONE; // ~85% chance of no resource
    }

    let type_noise = hash_noise(seed, q, r, 5) % 10;

    // Flat land resources
    if terrain == TERRAIN_GRASSLAND || terrain == TERRAIN_PLAINS {
        if type_noise < 3 {
            return RESOURCE_WHEAT;
        }
        if type_noise < 5 {
            return RESOURCE_CATTLE;
        }
        if type_noise < 7 {
            return RESOURCE_HORSES;
        }
        if type_noise < 9 {
            return RESOURCE_SILVER;
        }
        return RESOURCE_DYES;
    }

    // Hills resources
    if terrain == TERRAIN_GRASSLAND_HILLS
        || terrain == TERRAIN_PLAINS_HILLS
        || terrain == TERRAIN_DESERT_HILLS
    {
        if type_noise < 4 {
            return RESOURCE_STONE;
        }
        if type_noise < 7 {
            return RESOURCE_IRON;
        }
        return RESOURCE_SILVER;
    }

    RESOURCE_NONE
}

// ---------------------------------------------------------------------------
// Rivers — multi-tile, flowing from mountains downhill
// ---------------------------------------------------------------------------

/// Generate rivers. Each river starts near a mountain and walks downhill
/// (toward lower height / water) for multiple tiles, recording river edges
/// on each tile it crosses.
pub fn generate_rivers(
    seed: felt252, tiles: Span<(u8, u8, TileData)>,
) -> Array<(u8, u8, u8)> {
    let mut rivers: Array<(u8, u8, u8)> = array![];
    let len = tiles.len();

    // Collect mountain positions as river sources
    let mut sources: Array<(u8, u8)> = array![];
    let mut i: u32 = 0;
    while i < len {
        let (q, r, td) = *tiles.at(i);
        if td.terrain == TERRAIN_MOUNTAIN {
            let noise = hash_noise(seed, q, r, 6);
            if noise > 700 {
                sources.append((q, r));
            }
        }
        i += 1;
    };

    // For each source, trace a river path
    let src_span = sources.span();
    let src_len = src_span.len();
    let mut si: u32 = 0;
    while si < src_len {
        let (sq, sr) = *src_span.at(si);

        // Walk up to 12 tiles from the source
        let mut cur_q: u8 = sq;
        let mut cur_r: u8 = sr;
        let mut step: u32 = 0;
        let max_steps: u32 = 12;
        let mut river_done = false;

        while step < max_steps && !river_done {
            // Pick flow direction based on position + step
            let dir_noise = hash_noise(seed, cur_q, cur_r, 60 + step.try_into().unwrap());
            let dir: u8 = (dir_noise % 6).try_into().unwrap();

            // Get neighbor in that direction
            let next_opt = neighbor_in_dir(cur_q, cur_r, dir);
            match next_opt {
                Option::Some((nq, nr)) => {
                    let edge_mask = bit_mask(dir);
                    rivers.append((cur_q, cur_r, edge_mask));

                    let opp_dir = (dir + 3) % 6;
                    let opp_mask = bit_mask(opp_dir);
                    rivers.append((nq, nr, opp_mask));

                    // Check if we reached water — stop the river
                    let next_terrain = find_terrain(tiles, nq, nr);
                    if next_terrain == TERRAIN_OCEAN || next_terrain == TERRAIN_COAST {
                        river_done = true;
                    } else {
                        cur_q = nq;
                        cur_r = nr;
                    }
                },
                Option::None => { river_done = true; },
            }

            step += 1;
        };

        si += 1;
    };

    // Ensure at least 1 river exists
    if rivers.len() == 0 && len > 0 {
        let mut j: u32 = 0;
        let mut placed = false;
        while j < len && !placed {
            let (q, r, td) = *tiles.at(j);
            if td.terrain == TERRAIN_MOUNTAIN || is_land_terrain(td.terrain) {
                rivers.append((q, r, 0b000001));
                placed = true;
            }
            j += 1;
        };
    }

    rivers
}

/// Find terrain type for tile at (q, r). Tiles are ordered q*height + r.
fn find_terrain(tiles: Span<(u8, u8, TileData)>, q: u8, r: u8) -> u8 {
    let idx: u32 = q.into() * MAP_HEIGHT.into() + r.into();
    if idx < tiles.len() {
        let (_, _, td) = *tiles.at(idx);
        td.terrain
    } else {
        TERRAIN_OCEAN
    }
}

/// Get the neighbor hex in a given direction (0-5) using offset coordinates.
/// Directions: 0=upper-right, 1=top, 2=upper-left, 3=lower-left, 4=bottom, 5=lower-right.
/// Neighbor offsets depend on column parity (flat-top, odd-q-down).
fn neighbor_in_dir(q: u8, r: u8, dir: u8) -> Option<(u8, u8)> {
    let qi: i16 = q.into();
    let ri: i16 = r.into();
    let w: i16 = MAP_WIDTH.into();
    let h: i16 = MAP_HEIGHT.into();
    let even = (qi % 2) == 0;

    let (nq, nr) = if even {
        if dir == 0 { (qi + 1, ri - 1) }      // upper-right
        else if dir == 1 { (qi, ri - 1) }      // top
        else if dir == 2 { (qi - 1, ri - 1) }  // upper-left
        else if dir == 3 { (qi - 1, ri) }      // lower-left
        else if dir == 4 { (qi, ri + 1) }      // bottom
        else { (qi + 1, ri) }                   // lower-right
    } else {
        if dir == 0 { (qi + 1, ri) }           // upper-right
        else if dir == 1 { (qi, ri - 1) }      // top
        else if dir == 2 { (qi - 1, ri) }      // upper-left
        else if dir == 3 { (qi - 1, ri + 1) }  // lower-left
        else if dir == 4 { (qi, ri + 1) }      // bottom
        else { (qi + 1, ri + 1) }              // lower-right
    };

    if nq >= 0 && nq < w && nr >= 0 && nr < h {
        Option::Some((nq.try_into().unwrap(), nr.try_into().unwrap()))
    } else {
        Option::None
    }
}

// ---------------------------------------------------------------------------
// Starting positions
// ---------------------------------------------------------------------------

/// Minimum distance from map edge for starting positions.
const MIN_EDGE_DIST: u8 = 4;

/// Check if a tile is far enough from the map edge (>= MIN_EDGE_DIST).
fn is_far_from_edge(q: u8, r: u8, width: u8, height: u8) -> bool {
    q >= MIN_EDGE_DIST && q + MIN_EDGE_DIST < width
        && r >= MIN_EDGE_DIST && r + MIN_EDGE_DIST < height
}

/// Minimum average yield (food + production + gold) across the 2-ring
/// for a starting position to be considered balanced.
const MIN_AVG_YIELD: u32 = 2;

/// Compute total yield (food + production + gold) for a single tile from its TileData.
/// Does not include improvements (none exist at game start).
fn tile_total_yield(td: @TileData) -> u8 {
    use cairo_civ::constants;

    let mut total: u8 = constants::base_terrain_yield_food(*td.terrain)
        + constants::base_terrain_yield_production(*td.terrain)
        + constants::base_terrain_yield_gold(*td.terrain);

    // Feature bonus
    if *td.feature == FEATURE_WOODS {
        total += 1; // +1 production
    }

    // Resource bonus
    let res = *td.resource;
    if res == RESOURCE_WHEAT || res == RESOURCE_CATTLE {
        total += 1; // +1 food
    } else if res == RESOURCE_STONE || res == RESOURCE_IRON || res == RESOURCE_HORSES {
        total += 1; // +1 production
    } else if res == RESOURCE_SILVER {
        total += 3; // +3 gold
    } else if res == RESOURCE_DYES {
        total += 2; // +2 gold
    }

    total
}

/// Check if a position has good enough yields in its 2-ring neighborhood.
/// Returns true if the average total yield across all tiles in radius 2 is >= MIN_AVG_YIELD.
fn has_balanced_yields(q: u8, r: u8, tiles: Span<(u8, u8, TileData)>) -> bool {
    let ring = hex::hexes_in_range(q, r, 2);
    let rspan = ring.span();
    let rlen = rspan.len();
    let h: u32 = MAP_HEIGHT.into();

    let mut yield_sum: u32 = 0;
    let mut count: u32 = 0;
    let mut i: u32 = 0;
    while i < rlen {
        let (tq, tr) = *rspan.at(i);
        let idx: u32 = tq.into() * h + tr.into();
        if idx < tiles.len() {
            let (_, _, td) = *tiles.at(idx);
            yield_sum += tile_total_yield(@td).into();
            count += 1;
        }
        i += 1;
    };

    if count == 0 {
        return false;
    }
    // Average >= MIN_AVG_YIELD ⟺ yield_sum >= MIN_AVG_YIELD * count
    yield_sum >= MIN_AVG_YIELD * count
}

/// Find valid starting positions for 2 players.
/// Constraints:
///   - Both on walkable land, >= 4 tiles from edge
///   - >= 8 hexes apart
///   - Both have balanced yields: average (food+prod+gold) >= 2 across 2-ring tiles
/// Falls back to unbalanced positions if no balanced pair is found.
/// Uses seed-based shuffling so positions vary across games.
pub fn find_starting_positions(
    tiles: Span<(u8, u8, TileData)>, seed: felt252,
) -> Option<((u8, u8), (u8, u8))> {
    let len = tiles.len();
    let width = MAP_WIDTH;
    let height = MAP_HEIGHT;

    // 1. Collect all base candidate tiles (land, far from edge)
    let mut candidates: Array<(u8, u8)> = array![];
    let mut i: u32 = 0;
    while i < len {
        let (q, r, td) = *tiles.at(i);
        if is_land_terrain(td.terrain) && is_far_from_edge(q, r, width, height) {
            candidates.append((q, r));
        }
        i += 1;
    };

    let clen = candidates.len();
    if clen < 2 {
        return Option::None;
    }

    // 2. Try to find a balanced pair first (both positions have good yields)
    //    Yield quality is checked lazily — only for the positions we try,
    //    not for all candidates upfront.
    let cspan = candidates.span();
    let result = pick_balanced_pair(cspan, tiles, seed);

    match result {
        Option::Some(_) => result,
        Option::None => {
            // Fallback: pick any valid pair ignoring yield quality
            pick_any_pair(cspan, seed)
        },
    }
}

/// Try to find a pair of starting positions where both have balanced yields.
/// Tries multiple first-player candidates (up to 5) to maximize chances.
fn pick_balanced_pair(
    candidates: Span<(u8, u8)>, tiles: Span<(u8, u8, TileData)>, seed: felt252,
) -> Option<((u8, u8), (u8, u8))> {
    let clen = candidates.len();
    if clen < 2 {
        return Option::None;
    }

    // Try up to 20 different first-player picks
    let max_attempts: u32 = if clen < 20 { clen } else { 20 };
    let mut attempt: u32 = 0;
    let mut result: Option<((u8, u8), (u8, u8))> = Option::None;

    while attempt < max_attempts && result.is_none() {
        let hash1 = PoseidonTrait::new().update(seed).update(101 + attempt.into()).finalize();
        let h1_u256: u256 = hash1.into();
        let start1_idx: u32 = (h1_u256 % clen.into()).try_into().unwrap();
        let (q1, r1) = *candidates.at(start1_idx);

        // Check yield quality for first position
        if has_balanced_yields(q1, r1, tiles) {
            // Scan for second position with good yields and >= 8 hexes away
            let hash2 = PoseidonTrait::new().update(seed).update(201 + attempt.into()).finalize();
            let h2_u256: u256 = hash2.into();
            let offset2: u32 = (h2_u256 % clen.into()).try_into().unwrap();
            let mut k: u32 = 0;
            while k < clen && result.is_none() {
                let idx2 = (offset2 + k) % clen;
                let (q2, r2) = *candidates.at(idx2);
                let dist = hex::hex_distance(q1, r1, q2, r2);
                if dist >= 8 && has_balanced_yields(q2, r2, tiles) {
                    result = Option::Some(((q1, r1), (q2, r2)));
                }
                k += 1;
            };
        }

        attempt += 1;
    };
    result
}

/// Pick any pair of starting positions that are >= 8 hexes apart (no yield check).
fn pick_any_pair(
    candidates: Span<(u8, u8)>, seed: felt252,
) -> Option<((u8, u8), (u8, u8))> {
    let clen = candidates.len();
    if clen < 2 {
        return Option::None;
    }

    let hash1 = PoseidonTrait::new().update(seed).update(101).finalize();
    let h1_u256: u256 = hash1.into();
    let start1_idx: u32 = (h1_u256 % clen.into()).try_into().unwrap();
    let (q1, r1) = *candidates.at(start1_idx);

    let hash2 = PoseidonTrait::new().update(seed).update(102).finalize();
    let h2_u256: u256 = hash2.into();
    let offset2: u32 = (h2_u256 % clen.into()).try_into().unwrap();
    let mut k: u32 = 0;
    let mut result: Option<((u8, u8), (u8, u8))> = Option::None;
    while k < clen && result.is_none() {
        let idx2 = (offset2 + k) % clen;
        let (q2, r2) = *candidates.at(idx2);
        let dist = hex::hex_distance(q1, r1, q2, r2);
        if dist >= 8 {
            result = Option::Some(((q1, r1), (q2, r2)));
        }
        k += 1;
    };
    result
}

// ---------------------------------------------------------------------------
// Map validation
// ---------------------------------------------------------------------------

/// Validate that a map is playable: enough land and valid starting positions.
pub fn validate_map(tiles: Span<(u8, u8, TileData)>, seed: felt252) -> bool {
    let len = tiles.len();
    if len == 0 {
        return false;
    }

    // Count land tiles
    let mut land_count: u32 = 0;
    let mut i: u32 = 0;
    while i < len {
        let (_, _, td) = *tiles.at(i);
        if is_land_terrain(td.terrain) {
            land_count += 1;
        }
        i += 1;
    };

    // Need at least 25% land
    if land_count < len / 4 {
        return false;
    }

    // Need valid starting positions
    find_starting_positions(tiles, seed).is_some()
}

// ---------------------------------------------------------------------------
// Latitude bias
// ---------------------------------------------------------------------------

/// Compute latitude bias for temperature calculation.
/// Center rows have 0 bias; poles have high bias (colder).
/// Symmetric: top and bottom poles have equal bias.
pub fn latitude_bias(r: u8, height: u8) -> u16 {
    if height <= 1 {
        return 0;
    }
    let h_minus_1: u16 = (height - 1).into();
    let half: u16 = h_minus_1 / 2;
    let r16: u16 = r.into();
    let mirror: u16 = h_minus_1 - r16;
    let dist_from_edge = if r16 < mirror { r16 } else { mirror };

    if dist_from_edge >= half {
        0
    } else {
        (half - dist_from_edge) * 100
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Hash-based noise: Poseidon(seed, q, r, channel) → u16 in [0, 999].
fn hash_noise(seed: felt252, q: u8, r: u8, channel: u8) -> u16 {
    let hash = PoseidonTrait::new()
        .update(seed)
        .update(q.into())
        .update(r.into())
        .update(channel.into())
        .finalize();

    // Convert felt252 → u256, take mod 1000, convert back to u16
    let hash_u256: u256 = hash.into();
    let modulus: u256 = 1000;
    let remainder: u256 = hash_u256 % modulus;
    // remainder is 0-999 which fits in u16
    let rem_felt: felt252 = remainder.try_into().unwrap();
    rem_felt.try_into().unwrap()
}

fn is_land_terrain(terrain: u8) -> bool {
    terrain != TERRAIN_OCEAN && terrain != TERRAIN_COAST && terrain != TERRAIN_MOUNTAIN
}

fn bit_mask(bit: u8) -> u8 {
    if bit == 0 { 1 }
    else if bit == 1 { 2 }
    else if bit == 2 { 4 }
    else if bit == 3 { 8 }
    else if bit == 4 { 16 }
    else { 32 }
}
