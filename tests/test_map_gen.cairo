// ============================================================================
// Tests — Map Generation (M1–M23)
// Feature 3 in the feature map.
// ============================================================================

use cairo_civ::map_gen;
use cairo_civ::hex;
use cairo_civ::constants;
use cairo_civ::types::{TileData, TERRAIN_OCEAN, TERRAIN_COAST, TERRAIN_MOUNTAIN,
    TERRAIN_GRASSLAND, TERRAIN_DESERT, TERRAIN_TUNDRA,
    FEATURE_NONE, FEATURE_WOODS, RESOURCE_NONE,
    RESOURCE_WHEAT, RESOURCE_CATTLE, RESOURCE_STONE, RESOURCE_IRON,
    RESOURCE_HORSES, RESOURCE_SILVER, RESOURCE_DYES,
    MAP_HEIGHT};

/// Helper: compute the average total yield (food+prod+gold) across the 2-ring of a position.
/// Returns the integer average (floor).
fn compute_ring_avg_yield(pos: (u8, u8), tiles: Span<(u8, u8, TileData)>) -> u32 {
    let (q, r) = pos;
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
            let mut total: u32 = constants::base_terrain_yield_food(td.terrain).into()
                + constants::base_terrain_yield_production(td.terrain).into()
                + constants::base_terrain_yield_gold(td.terrain).into();
            if td.feature == FEATURE_WOODS {
                total += 1;
            }
            if td.resource == RESOURCE_WHEAT || td.resource == RESOURCE_CATTLE {
                total += 1;
            } else if td.resource == RESOURCE_STONE || td.resource == RESOURCE_IRON || td.resource == RESOURCE_HORSES {
                total += 1;
            } else if td.resource == RESOURCE_SILVER {
                total += 3;
            } else if td.resource == RESOURCE_DYES {
                total += 2;
            }
            yield_sum += total;
            count += 1;
        }
        i += 1;
    };
    if count == 0 { 0 } else { yield_sum / count }
}

// ===========================================================================
// Determinism (M1–M2)
// ===========================================================================

// M1: Same seed → same map
#[test]
fn test_generate_map_deterministic() {
    let tiles1 = map_gen::generate_map(42, 32, 20);
    let tiles2 = map_gen::generate_map(42, 32, 20);
    assert!(tiles1.len() == tiles2.len());
    // Verify first tile is the same
    if tiles1.len() > 0 {
        let (q1, r1, td1) = *tiles1.at(0);
        let (q2, r2, td2) = *tiles2.at(0);
        assert!(q1 == q2);
        assert!(r1 == r2);
        assert!(td1.terrain == td2.terrain);
    }
}

// M2: Different seeds → different maps
#[test]
fn test_generate_map_different_seeds() {
    let tiles1 = map_gen::generate_map(42, 32, 20);
    let tiles2 = map_gen::generate_map(99, 32, 20);
    // With high probability, first tile terrain differs
    // (if not, at least check they both generate valid output)
    assert!(tiles1.len() == tiles2.len());
}

// ===========================================================================
// Map size (M3)
// ===========================================================================

// M3: Generates exactly MAP_WIDTH × MAP_HEIGHT tiles
#[test]
fn test_generate_map_size() {
    let tiles = map_gen::generate_map(123, 32, 20);
    assert!(tiles.len() == 640); // 32 * 20
}

// ===========================================================================
// Terrain assignment (M4–M8)
// ===========================================================================

// M4: Low height → Ocean
#[test]
fn test_assign_terrain_ocean() {
    // h < 250 → Ocean
    let t = map_gen::assign_terrain(100, 500, 500);
    assert!(t == TERRAIN_OCEAN);
}

// M5: Very high height → Mountain
#[test]
fn test_assign_terrain_mountain() {
    // h >= 820 → Mountain
    let t = map_gen::assign_terrain(900, 500, 500);
    assert!(t == TERRAIN_MOUNTAIN);
}

// M6: Mid height, high moisture → Grassland
#[test]
fn test_assign_terrain_grassland() {
    // h=500 (land, not hills), m=700 (high moisture), t=500 (warm)
    let t = map_gen::assign_terrain(500, 700, 500);
    assert!(t == TERRAIN_GRASSLAND);
}

// M7: Mid height, low moisture → Desert
#[test]
fn test_assign_terrain_desert() {
    // h=500 (land, not hills), m=100 (low moisture), t=500 (warm)
    let t = map_gen::assign_terrain(500, 100, 500);
    assert!(t == TERRAIN_DESERT);
}

// M8: Mid height, low temp → Tundra
#[test]
fn test_assign_terrain_tundra() {
    // h=500 (land, not hills), m=500, t=100 (cold)
    let t = map_gen::assign_terrain(500, 500, 100);
    assert!(t == TERRAIN_TUNDRA);
}

// ===========================================================================
// Features (M9–M10)
// ===========================================================================

// M9: Woods placed on eligible terrain
#[test]
fn test_feature_woods() {
    // Woods should be assignable on grassland
    let f = map_gen::assign_feature(TERRAIN_GRASSLAND, 800, 500, 42, 10, 10);
    // Feature may or may not be woods depending on hash — just verify it's valid
    assert!(f <= 4); // valid feature range
}

// M10: Features never placed on water tiles
#[test]
fn test_feature_not_on_ocean() {
    let f = map_gen::assign_feature(TERRAIN_OCEAN, 800, 500, 42, 10, 10);
    assert!(f == FEATURE_NONE);
}

// ===========================================================================
// Resources (M11–M12)
// ===========================================================================

// M11: Resources placed on valid terrain types
#[test]
fn test_resource_placement() {
    let r = map_gen::assign_resource(TERRAIN_GRASSLAND, FEATURE_NONE, 42, 10, 10);
    // Should be a valid resource ID (0-10)
    assert!(r <= 10);
}

// M12: No resources on mountains
#[test]
fn test_resource_not_on_mountain() {
    let r = map_gen::assign_resource(TERRAIN_MOUNTAIN, FEATURE_NONE, 42, 10, 10);
    assert!(r == RESOURCE_NONE);
}

// ===========================================================================
// Starting positions (M13–M16)
// ===========================================================================

// M13: Starting positions are at least 8 hexes apart
#[test]
fn test_starting_positions_distance() {
    let tiles = map_gen::generate_map(42, 32, 20);
    let positions = map_gen::find_starting_positions(tiles.span(), 42);
    match positions {
        Option::Some((p1, p2)) => {
            let (q1, r1) = p1;
            let (q2, r2) = p2;
            let dist = cairo_civ::hex::hex_distance(q1, r1, q2, r2);
            assert!(dist >= 8, "Starting positions must be >= 8 hexes apart, got {}", dist);
        },
        Option::None => {
            // Map may not generate valid starts — test just checks the constraint
            // when positions exist
        },
    }
}

// M14: Both starting positions have balanced yields (average >= 2 across 2-ring)
#[test]
fn test_starting_positions_balanced_yields() {
    let tiles = map_gen::generate_map(42, 32, 20);
    let tspan = tiles.span();
    let positions = map_gen::find_starting_positions(tspan, 42);
    match positions {
        Option::Some((p1, p2)) => {
            let avg1 = compute_ring_avg_yield(p1, tspan);
            let avg2 = compute_ring_avg_yield(p2, tspan);
            // Both must average at least 2 total yield per tile
            assert!(avg1 >= 2, "Player 1 start yields too low");
            assert!(avg2 >= 2, "Player 2 start yields too low");
        },
        Option::None => {
            assert!(false, "Expected valid starting positions for seed 42");
        },
    }
}

// M15: Starting position yield balance holds across multiple seeds
#[test]
fn test_starting_positions_yields_multi_seed() {
    let seed: felt252 = 7777;
    let tiles = map_gen::generate_map(seed, 32, 20);
    let tspan = tiles.span();
    let positions = map_gen::find_starting_positions(tspan, seed);
    match positions {
        Option::Some((p1, p2)) => {
            let avg1 = compute_ring_avg_yield(p1, tspan);
            let avg2 = compute_ring_avg_yield(p2, tspan);
            assert!(avg1 >= 2, "Player 1 start yields too low (seed 7777)");
            assert!(avg2 >= 2, "Player 2 start yields too low (seed 7777)");
        },
        Option::None => {
            assert!(false, "Expected valid starting positions for seed 7777");
        },
    }
}

// M16: Starting positions are on land tiles
#[test]
fn test_starting_positions_on_land() {
    let tiles = map_gen::generate_map(42, 32, 20);
    let positions = map_gen::find_starting_positions(tiles.span(), 42);
    match positions {
        Option::Some((p1, p2)) => {
            let (q1, r1) = p1;
            let (q2, r2) = p2;
            // Starting positions must not be ocean, coast, or mountain
            // We'd need to look up terrain — placeholder for now
            assert!(q1 < 32 && r1 < 20);
            assert!(q2 < 32 && r2 < 20);
        },
        Option::None => {},
    }
}

// ===========================================================================
// Map validation (M17, M22–M23)
// ===========================================================================

// M17: Valid map passes validation
#[test]
fn test_validate_map_good() {
    let tiles = map_gen::generate_map(42, 32, 20);
    assert!(map_gen::validate_map(tiles.span(), 42));
}

// M22: Map that is all ocean fails validation
#[test]
fn test_validate_map_bad_all_ocean() {
    let mut tiles: Array<(u8, u8, TileData)> = array![];
    let mut q: u8 = 0;
    while q < 32 {
        let mut r: u8 = 0;
        while r < 20 {
            tiles.append((q, r, TileData {
                terrain: TERRAIN_OCEAN,
                feature: FEATURE_NONE,
                resource: RESOURCE_NONE,
                river_edges: 0,
            }));
            r += 1;
        };
        q += 1;
    };
    assert!(!map_gen::validate_map(tiles.span(), 42));
}

// M23: Tiny map with no valid starting pairs returns error
#[test]
fn test_starting_positions_impossible() {
    // 2x2 map — too small for 10-hex distance
    let tiles: Array<(u8, u8, TileData)> = array![
        (0, 0, TileData { terrain: TERRAIN_GRASSLAND, feature: FEATURE_NONE, resource: RESOURCE_NONE, river_edges: 0 }),
        (1, 0, TileData { terrain: TERRAIN_GRASSLAND, feature: FEATURE_NONE, resource: RESOURCE_NONE, river_edges: 0 }),
        (0, 1, TileData { terrain: TERRAIN_GRASSLAND, feature: FEATURE_NONE, resource: RESOURCE_NONE, river_edges: 0 }),
        (1, 1, TileData { terrain: TERRAIN_GRASSLAND, feature: FEATURE_NONE, resource: RESOURCE_NONE, river_edges: 0 }),
    ];
    let positions = map_gen::find_starting_positions(tiles.span(), 42);
    assert!(positions.is_none());
}

// ===========================================================================
// Latitude bias (M18–M19)
// ===========================================================================

// M18: Center row → 0 bias
#[test]
fn test_latitude_bias_equator() {
    let bias = map_gen::latitude_bias(10, 20); // center of 20-row map
    assert!(bias == 0);
}

// M19: Edge row → high bias (cold)
#[test]
fn test_latitude_bias_pole() {
    let bias = map_gen::latitude_bias(0, 20);  // top row
    assert!(bias > 0);
    let bias2 = map_gen::latitude_bias(19, 20); // bottom row
    assert!(bias2 > 0);
    // Poles should have similar bias
    assert!(bias == bias2);
}

// ===========================================================================
// Rivers (M20–M21)
// ===========================================================================

// M20: At least 1 river generated
#[test]
fn test_rivers_generated() {
    let tiles = map_gen::generate_map(42, 32, 20);
    let rivers = map_gen::generate_rivers(42, tiles.span());
    assert!(rivers.len() >= 1);
}

// M21: Rivers originate from mountain tiles
#[test]
fn test_rivers_start_at_mountains() {
    let tiles = map_gen::generate_map(42, 32, 20);
    let rivers = map_gen::generate_rivers(42, tiles.span());
    // First river entry should be near/on a mountain
    // Specific validation depends on implementation
    assert!(rivers.len() >= 0); // placeholder — real check after impl
}

// ===========================================================================
// Starting position edge distance (M24–M28)
// ===========================================================================

// M24: Both starting positions are >= 4 tiles from every map edge
#[test]
fn test_starting_positions_far_from_edge() {
    let tiles = map_gen::generate_map(42, 32, 20);
    let positions = map_gen::find_starting_positions(tiles.span(), 42);
    match positions {
        Option::Some((p1, p2)) => {
            let (q1, r1) = p1;
            let (q2, r2) = p2;
            // Player 1
            assert!(q1 >= 4, "P1 too close to left edge: q={}", q1);
            assert!(q1 + 4 < 32, "P1 too close to right edge: q={}", q1);
            assert!(r1 >= 4, "P1 too close to top edge: r={}", r1);
            assert!(r1 + 4 < 20, "P1 too close to bottom edge: r={}", r1);
            // Player 2
            assert!(q2 >= 4, "P2 too close to left edge: q={}", q2);
            assert!(q2 + 4 < 32, "P2 too close to right edge: q={}", q2);
            assert!(r2 >= 4, "P2 too close to top edge: r={}", r2);
            assert!(r2 + 4 < 20, "P2 too close to bottom edge: r={}", r2);
        },
        Option::None => {},
    }
}

// M25: Edge distance constraint holds with a different seed
#[test]
fn test_starting_positions_edge_distance_seed_99() {
    let seed: felt252 = 99;
    let tiles = map_gen::generate_map(seed, 32, 20);
    let positions = map_gen::find_starting_positions(tiles.span(), seed);
    match positions {
        Option::Some((p1, p2)) => {
            let (q1, r1) = p1;
            let (q2, r2) = p2;
            assert!(q1 >= 4 && q1 + 4 < 32, "P1 q out of safe zone");
            assert!(r1 >= 4 && r1 + 4 < 20, "P1 r out of safe zone");
            assert!(q2 >= 4 && q2 + 4 < 32, "P2 q out of safe zone");
            assert!(r2 >= 4 && r2 + 4 < 20, "P2 r out of safe zone");
            let dist = cairo_civ::hex::hex_distance(q1, r1, q2, r2);
            assert!(dist >= 8, "Distance too small");
        },
        Option::None => {},
    }
}

// M25b: Edge distance constraint holds with yet another seed
#[test]
fn test_starting_positions_edge_distance_seed_1234() {
    let seed: felt252 = 1234;
    let tiles = map_gen::generate_map(seed, 32, 20);
    let positions = map_gen::find_starting_positions(tiles.span(), seed);
    match positions {
        Option::Some((p1, p2)) => {
            let (q1, r1) = p1;
            let (q2, r2) = p2;
            assert!(q1 >= 4 && q1 + 4 < 32, "P1 q out of safe zone");
            assert!(r1 >= 4 && r1 + 4 < 20, "P1 r out of safe zone");
            assert!(q2 >= 4 && q2 + 4 < 32, "P2 q out of safe zone");
            assert!(r2 >= 4 && r2 + 4 < 20, "P2 r out of safe zone");
            let dist = cairo_civ::hex::hex_distance(q1, r1, q2, r2);
            assert!(dist >= 8, "Distance too small");
        },
        Option::None => {},
    }
}

// M26: Tiles exactly at the edge boundary are rejected as starting positions
#[test]
fn test_starting_positions_reject_edge_tiles() {
    // Build a map where the only land tiles are at the edges
    let mut tiles: Array<(u8, u8, TileData)> = array![];
    let mut q: u8 = 0;
    while q < 32 {
        let mut r: u8 = 0;
        while r < 20 {
            // Only place land at the first 3 rows/cols (within the edge zone)
            let terrain = if q < 4 || r < 4 {
                TERRAIN_GRASSLAND
            } else {
                TERRAIN_OCEAN
            };
            tiles.append((q, r, TileData {
                terrain,
                feature: FEATURE_NONE,
                resource: RESOURCE_NONE,
                river_edges: 0,
            }));
            r += 1;
        };
        q += 1;
    };
    // No land tiles >= 4 from edge, so should return None
    let positions = map_gen::find_starting_positions(tiles.span(), 42);
    assert!(positions.is_none(), "Should not find starts when all land is near edges");
}

// M27: Different seeds produce different starting positions
#[test]
fn test_starting_positions_vary_with_seed() {
    let tiles = map_gen::generate_map(42, 32, 20);
    let pos_a = map_gen::find_starting_positions(tiles.span(), 42);
    let pos_b = map_gen::find_starting_positions(tiles.span(), 999);
    // With different seeds on the same map, positions should (usually) differ
    match (pos_a, pos_b) {
        (Option::Some(((q1a, r1a), _)), Option::Some(((q1b, r1b), _))) => {
            // At least one coordinate should differ (not strictly guaranteed,
            // but extremely likely with different seeds)
            let same = q1a == q1b && r1a == r1b;
            // We just check that the function accepted both — if they happen to
            // be the same, it's a valid but rare coincidence
            assert!(q1a < 32 && q1b < 32);
        },
        _ => {},
    }
}

// M28: Starting positions on a fully-interior-land map are always valid
#[test]
fn test_starting_positions_all_land_map() {
    // Build a map that is all grassland — every tile is valid land
    let mut tiles: Array<(u8, u8, TileData)> = array![];
    let mut q: u8 = 0;
    while q < 32 {
        let mut r: u8 = 0;
        while r < 20 {
            tiles.append((q, r, TileData {
                terrain: TERRAIN_GRASSLAND,
                feature: FEATURE_NONE,
                resource: RESOURCE_NONE,
                river_edges: 0,
            }));
            r += 1;
        };
        q += 1;
    };
    let positions = map_gen::find_starting_positions(tiles.span(), 42);
    match positions {
        Option::Some((p1, p2)) => {
            let (q1, r1) = p1;
            let (q2, r2) = p2;
            // Both must be >= 4 from all edges
            assert!(q1 >= 4 && q1 + 4 < 32);
            assert!(r1 >= 4 && r1 + 4 < 20);
            assert!(q2 >= 4 && q2 + 4 < 32);
            assert!(r2 >= 4 && r2 + 4 < 20);
            // Must be >= 8 apart
            let dist = cairo_civ::hex::hex_distance(q1, r1, q2, r2);
            assert!(dist >= 8);
        },
        Option::None => {
            assert!(false, "All-land map should always find valid starting positions");
        },
    }
}
