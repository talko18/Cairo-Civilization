// ============================================================================
// Tests — Hex math functions (H1–H27)
// Feature 2 in the feature map.
// ============================================================================

use cairo_civ::hex;

// ===========================================================================
// Distance (H1–H5)
// ===========================================================================

// H1: distance(a, a) == 0
#[test]
fn test_distance_same_tile() {
    assert!(hex::hex_distance(16, 10, 16, 10) == 0);
}

// H2: distance between neighbors == 1
// Axial neighbors from (16,10): E=(17,10), W=(15,10), SE=(16,11), NW=(16,9), NE=(17,9), SW=(15,11)
#[test]
fn test_distance_adjacent() {
    // E neighbor
    assert!(hex::hex_distance(16, 10, 17, 10) == 1);
    // W neighbor
    assert!(hex::hex_distance(16, 10, 15, 10) == 1);
    // SE neighbor
    assert!(hex::hex_distance(16, 10, 16, 11) == 1);
    // NW neighbor
    assert!(hex::hex_distance(16, 10, 16, 9) == 1);
    // NE neighbor
    assert!(hex::hex_distance(16, 10, 17, 9) == 1);
    // SW neighbor
    assert!(hex::hex_distance(16, 10, 15, 11) == 1);
}

// H3: distance across 2 hexes == 2
#[test]
fn test_distance_two_apart() {
    // Two steps east: (16,10) -> (17,10) -> (18,10)
    assert!(hex::hex_distance(16, 10, 18, 10) == 2);
    // Two steps SE: (16,10) -> (16,11) -> (16,12)
    assert!(hex::hex_distance(16, 10, 16, 12) == 2);
}

// H4: distance along diagonal direction
// (0,0) to (1,1) in axial: dq=1, dr=1, |1|+|1|+|2| = 4/2 = 2
// In storage: (16,0) to (17,1) → axial (0,0) to (1,1)
#[test]
fn test_distance_diagonal() {
    assert!(hex::hex_distance(16, 0, 17, 1) == 2);
    // (16,10) to (18,8): axial (0,10) to (2,8), dq=2, dr=-2, |2|+|2|+|0|=4/2=2
    assert!(hex::hex_distance(16, 10, 18, 8) == 2);
    // Longer diagonal: (16,10) to (19,7): dq=3, dr=-3, |3|+|3|+|0|=6/2=3
    assert!(hex::hex_distance(16, 10, 19, 7) == 3);
}

// H5: distance(a,b) == distance(b,a)
#[test]
fn test_distance_symmetric() {
    assert!(hex::hex_distance(10, 5, 15, 8) == hex::hex_distance(15, 8, 10, 5));
    assert!(hex::hex_distance(0, 0, 31, 19) == hex::hex_distance(31, 19, 0, 0));
    assert!(hex::hex_distance(16, 10, 20, 3) == hex::hex_distance(20, 3, 16, 10));
}

// ===========================================================================
// Neighbors (H6–H8)
// ===========================================================================

// H6: 6 neighbors returned for center tile
#[test]
fn test_neighbors_center() {
    let neighbors = hex::hex_neighbors(16, 10);
    assert!(neighbors.len() == 6);
    // Verify all 6 expected neighbors are present
    // E=(17,10), W=(15,10), SE=(16,11), NW=(16,9), NE=(17,9), SW=(15,11)
    assert!(contains(@neighbors, 17, 10));
    assert!(contains(@neighbors, 15, 10));
    assert!(contains(@neighbors, 16, 11));
    assert!(contains(@neighbors, 16, 9));
    assert!(contains(@neighbors, 17, 9));
    assert!(contains(@neighbors, 15, 11));
}

// H7: fewer neighbors at map corner (out-of-bounds filtered)
#[test]
fn test_neighbors_corner() {
    // (0, 0) corner: neighbors would be (1,0), (-1,0), (0,1), (0,-1), (1,-1), (-1,1)
    // Only (1,0) and (0,1) are in bounds (q<32, r<20, unsigned so no negatives)
    let neighbors = hex::hex_neighbors(0, 0);
    assert!(neighbors.len() == 2);
    assert!(contains(@neighbors, 1, 0));
    assert!(contains(@neighbors, 0, 1));
}

// H8: edge tile has fewer valid neighbors
#[test]
fn test_neighbors_edge() {
    // (0, 10) — left edge, middle row
    // Neighbors: E=(1,10)✓, W=(-1,10)✗, SE=(0,11)✓, NW=(0,9)✓, NE=(1,9)✓, SW=(-1,11)✗
    let neighbors = hex::hex_neighbors(0, 10);
    assert!(neighbors.len() == 4);
    // Top-right corner (31, 0)
    // Neighbors: E=(32,0)✗, W=(30,0)✓, SE=(31,1)✓, NW=(31,-1)✗, NE=(32,-1)✗, SW=(30,1)✓
    let neighbors2 = hex::hex_neighbors(31, 0);
    assert!(neighbors2.len() == 3);
}

// ===========================================================================
// Bounds checking (H9–H11)
// ===========================================================================

// H9: (16, 10) is in bounds for 32x20
#[test]
fn test_in_bounds_valid() {
    assert!(hex::in_bounds(16, 10));
    assert!(hex::in_bounds(0, 0));
    assert!(hex::in_bounds(31, 19));
}

// H10: (33, 0) is out of bounds
#[test]
fn test_in_bounds_invalid() {
    assert!(!hex::in_bounds(32, 0));
    assert!(!hex::in_bounds(0, 20));
    assert!(!hex::in_bounds(32, 20));
    assert!(!hex::in_bounds(255, 255));
}

// H11: (0, 0) is in bounds
#[test]
fn test_in_bounds_zero() {
    assert!(hex::in_bounds(0, 0));
}

// ===========================================================================
// Line of Sight (H12–H16, H27)
// ===========================================================================

// H12: LOS between two flat tiles, no obstacles
#[test]
fn test_los_clear() {
    let blocking: Array<(u8, u8)> = array![];
    assert!(hex::has_line_of_sight(16, 10, 18, 10, blocking.span()));
}

// H13: LOS blocked by mountain between source and target
// Source=(16,10), blocker=(17,10), target=(18,10) — straight line east
#[test]
fn test_los_blocked_mountain() {
    let blocking: Array<(u8, u8)> = array![(17, 10)];
    assert!(!hex::has_line_of_sight(16, 10, 18, 10, blocking.span()));
}

// H14: LOS blocked by woods between (not at endpoints)
#[test]
fn test_los_blocked_woods() {
    // Source=(10,10), target=(12,10), blocker=(11,10)
    let blocking: Array<(u8, u8)> = array![(11, 10)];
    assert!(!hex::has_line_of_sight(10, 10, 12, 10, blocking.span()));
}

// H15: Woods at source or target do NOT block LOS
#[test]
fn test_los_woods_at_endpoint() {
    // Blocking tile is at source — should NOT block
    let blocking_source: Array<(u8, u8)> = array![(16, 10)];
    assert!(hex::has_line_of_sight(16, 10, 18, 10, blocking_source.span()));
    // Blocking tile is at target — should NOT block
    let blocking_target: Array<(u8, u8)> = array![(18, 10)];
    assert!(hex::has_line_of_sight(16, 10, 18, 10, blocking_target.span()));
}

// H16: Adjacent tiles always have LOS (nothing in between)
#[test]
fn test_los_adjacent() {
    // Even with a blocking tile listed, adjacent tiles have nothing in between
    let blocking: Array<(u8, u8)> = array![(20, 20)]; // irrelevant tile
    assert!(hex::has_line_of_sight(16, 10, 17, 10, blocking.span()));
}

// H27: LOS from a tile to itself is always true
#[test]
fn test_los_to_self() {
    let blocking: Array<(u8, u8)> = array![(16, 10)]; // even if tile itself is "blocking"
    assert!(hex::has_line_of_sight(16, 10, 16, 10, blocking.span()));
}

// ===========================================================================
// Hexes in range (H17–H19, H26)
// ===========================================================================

// H17: Returns 7 tiles (center + 6 neighbors) for radius 1
#[test]
fn test_hexes_in_range_radius1() {
    let tiles = hex::hexes_in_range(16, 10, 1);
    assert!(tiles.len() == 7);
    // Must include center
    assert!(contains(@tiles, 16, 10));
}

// H18: Returns 19 tiles for radius 2
#[test]
fn test_hexes_in_range_radius2() {
    let tiles = hex::hexes_in_range(16, 10, 2);
    assert!(tiles.len() == 19);
}

// H19: Clips to map bounds at edges
#[test]
fn test_hexes_in_range_at_edge() {
    // (0, 0) with radius 1: center + only 2 in-bounds neighbors = 3
    let tiles = hex::hexes_in_range(0, 0, 1);
    assert!(tiles.len() == 3);
    assert!(contains(@tiles, 0, 0));
    assert!(contains(@tiles, 1, 0));
    assert!(contains(@tiles, 0, 1));
}

// H26: Radius 0 returns only the center tile
#[test]
fn test_hexes_in_range_radius0() {
    let tiles = hex::hexes_in_range(16, 10, 0);
    assert!(tiles.len() == 1);
    assert!(contains(@tiles, 16, 10));
}

// ===========================================================================
// River crossing (H20–H21)
// ===========================================================================

// H20: Correctly detects river edge from bitmask
// Direction indices: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE
// river_edges = 0b000001 means river on E edge
#[test]
fn test_river_crossing() {
    // River on E edge of (16,10), moving E to (17,10) → crossing
    let river_edges: u8 = 0b000001; // bit 0 = E
    assert!(hex::is_river_crossing(16, 10, 17, 10, river_edges));
}

// H21: No river between two tiles
#[test]
fn test_no_river_crossing() {
    // No river edges at all
    assert!(!hex::is_river_crossing(16, 10, 17, 10, 0));
    // River on SE edge, but moving E — no crossing
    let river_edges: u8 = 0b100000; // bit 5 = SE
    assert!(!hex::is_river_crossing(16, 10, 17, 10, river_edges));
}

// ===========================================================================
// Coordinate conversion (H22–H23)
// ===========================================================================

// H22: axial(-16, 0) → storage(0, 0)
#[test]
fn test_axial_to_storage() {
    let (sq, sr) = hex::axial_to_storage(-16, 0);
    assert!(sq == 0);
    assert!(sr == 0);
    // Also test positive axial
    let (sq2, sr2) = hex::axial_to_storage(0, 10);
    assert!(sq2 == 16);
    assert!(sr2 == 10);
}

// H23: storage(16, 10) → axial(0, 10)
#[test]
fn test_storage_to_axial() {
    let (aq, ar) = hex::storage_to_axial(16, 10);
    assert!(aq == 0);
    assert!(ar == 10);
    // storage(0, 0) → axial(-16, 0)
    let (aq2, ar2) = hex::storage_to_axial(0, 0);
    assert!(aq2 == -16);
    assert!(ar2 == 0);
}

// ===========================================================================
// Direction between (H24–H25)
// ===========================================================================

// H24: Returns correct direction index 0-5 for adjacent tiles
#[test]
fn test_direction_between_adjacent() {
    // E: (16,10) → (17,10) = direction 0
    let d_e = hex::direction_between(16, 10, 17, 10);
    assert!(d_e == Option::Some(0));
    // NE: (16,10) → (17,9) = direction 1
    let d_ne = hex::direction_between(16, 10, 17, 9);
    assert!(d_ne == Option::Some(1));
    // NW: (16,10) → (16,9) = direction 2
    let d_nw = hex::direction_between(16, 10, 16, 9);
    assert!(d_nw == Option::Some(2));
    // W: (16,10) → (15,10) = direction 3
    let d_w = hex::direction_between(16, 10, 15, 10);
    assert!(d_w == Option::Some(3));
    // SW: (16,10) → (15,11) = direction 4
    let d_sw = hex::direction_between(16, 10, 15, 11);
    assert!(d_sw == Option::Some(4));
    // SE: (16,10) → (16,11) = direction 5
    let d_se = hex::direction_between(16, 10, 16, 11);
    assert!(d_se == Option::Some(5));
}

// H25: Returns None for non-adjacent tiles
#[test]
fn test_direction_between_non_adjacent() {
    // Distance 2 — not adjacent
    let d = hex::direction_between(16, 10, 18, 10);
    assert!(d == Option::None);
    // Same tile — not adjacent either
    let d2 = hex::direction_between(16, 10, 16, 10);
    assert!(d2 == Option::None);
}

// ===========================================================================
// Helper: check if (q, r) is in an Array<(u8, u8)>
// ===========================================================================

fn contains(arr: @Array<(u8, u8)>, q: u8, r: u8) -> bool {
    let mut i: u32 = 0;
    let len = arr.len();
    let mut found = false;
    while i < len {
        let (tq, tr) = *arr.at(i);
        if tq == q && tr == r {
            found = true;
            break;
        }
        i += 1;
    };
    found
}
