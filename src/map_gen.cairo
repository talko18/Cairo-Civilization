// ============================================================================
// Map Generation — Generate map from seed. Called once per game.
// See design/implementation/01_interfaces.md §Module 3.
//
// Uses Poseidon hashing for deterministic procedural generation.
// Each tile's terrain/feature/resource is derived from hash(seed, q, r, channel).
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
};
use cairo_civ::hex;

// ---------------------------------------------------------------------------
// Main generation
// ---------------------------------------------------------------------------

/// Generate the full map from a seed. Returns array of (q, r, TileData).
pub fn generate_map(seed: felt252, width: u8, height: u8) -> Array<(u8, u8, TileData)> {
    let mut tiles: Array<(u8, u8, TileData)> = array![];
    let mut q: u8 = 0;
    loop {
        if q >= width {
            break;
        }
        let mut r: u8 = 0;
        loop {
            if r >= height {
                break;
            }

            // Generate noise channels via Poseidon hash
            let h = hash_noise(seed, q, r, 0); // height
            let m = hash_noise(seed, q, r, 1); // moisture
            let t_raw = hash_noise(seed, q, r, 2); // base temperature

            // Apply latitude bias (poles are colder)
            let bias = latitude_bias(r, height);
            let t: u16 = if t_raw > bias { t_raw - bias } else { 0 };

            let terrain = assign_terrain(h, m, t);
            let feature = assign_feature(terrain, m, t, seed, q, r);
            let resource = assign_resource(terrain, feature, seed, q, r);

            tiles.append((q, r, TileData { terrain, feature, resource, river_edges: 0 }));

            r += 1;
        };
        q += 1;
    };
    tiles
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
///   t < 150             → Snow
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
// Rivers
// ---------------------------------------------------------------------------

/// Generate rivers. Returns array of (q, r, river_edges_bitmask).
/// Rivers originate from mountains and flow downhill.
pub fn generate_rivers(
    seed: felt252, tiles: Span<(u8, u8, TileData)>,
) -> Array<(u8, u8, u8)> {
    let mut rivers: Array<(u8, u8, u8)> = array![];
    let len = tiles.len();

    let mut i: u32 = 0;
    loop {
        if i >= len {
            break;
        }
        let (q, r, td) = *tiles.at(i);
        if td.terrain == TERRAIN_MOUNTAIN {
            let noise = hash_noise(seed, q, r, 6);
            if noise > 800 {
                // Create a river edge on a pseudo-random direction
                let dir_noise: u8 = (hash_noise(seed, q, r, 7) % 6).try_into().unwrap();
                let edge_mask: u8 = bit_mask(dir_noise);
                rivers.append((q, r, edge_mask));
            }
        }
        i += 1;
    };

    // Ensure at least 1 river exists
    if rivers.len() == 0 && len > 0 {
        let mut j: u32 = 0;
        loop {
            if j >= len {
                break;
            }
            let (q, r, td) = *tiles.at(j);
            if td.terrain == TERRAIN_MOUNTAIN || is_land_terrain(td.terrain) {
                rivers.append((q, r, 0b000001)); // force E-edge river
                break;
            }
            j += 1;
        };
    }

    rivers
}

// ---------------------------------------------------------------------------
// Starting positions
// ---------------------------------------------------------------------------

/// Find valid starting positions for 2 players.
/// Constraints: >= 10 hexes apart, both on land.
pub fn find_starting_positions(
    tiles: Span<(u8, u8, TileData)>, _seed: felt252,
) -> Option<((u8, u8), (u8, u8))> {
    let len = tiles.len();
    let mut i: u32 = 0;
    loop {
        if i >= len {
            break Option::None;
        }
        let (q1, r1, td1) = *tiles.at(i);
        if is_land_terrain(td1.terrain) {
            // Search for a suitable second position
            let mut found_j: Option<u32> = Option::None;
            let mut j: u32 = i + 1;
            loop {
                if j >= len {
                    break;
                }
                let (q2, r2, td2) = *tiles.at(j);
                if is_land_terrain(td2.terrain) {
                    let dist = hex::hex_distance(q1, r1, q2, r2);
                    if dist >= 10 {
                        found_j = Option::Some(j);
                        break;
                    }
                }
                j += 1;
            };

            match found_j {
                Option::Some(jj) => {
                    let (q2, r2, _) = *tiles.at(jj);
                    break Option::Some(((q1, r1), (q2, r2)));
                },
                Option::None => {},
            }
        }
        i += 1;
    }
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
    loop {
        if i >= len {
            break;
        }
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
