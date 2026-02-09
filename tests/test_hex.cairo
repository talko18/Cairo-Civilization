// ============================================================================
// Tests — Hex math functions (H1–H27)
// Feature 2 in the feature map.
//
// All coordinates are offset coordinates (flat-top, odd-q-down):
//   q = column (0..31), r = row (0..19)
//   Odd columns are shifted down by half a hex.
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
// q=16 (even): neighbors are (17,9), (16,9), (15,9), (15,10), (16,11), (17,10)
#[test]
fn test_distance_adjacent() {
    // upper-right
    assert!(hex::hex_distance(16, 10, 17, 9) == 1);
    // top
    assert!(hex::hex_distance(16, 10, 16, 9) == 1);
    // upper-left
    assert!(hex::hex_distance(16, 10, 15, 9) == 1);
    // lower-left
    assert!(hex::hex_distance(16, 10, 15, 10) == 1);
    // bottom
    assert!(hex::hex_distance(16, 10, 16, 11) == 1);
    // lower-right
    assert!(hex::hex_distance(16, 10, 17, 10) == 1);

    // Also test odd column: q=21, neighbors of (21,5):
    // upper-right (22,5), top (21,4), upper-left (20,5),
    // lower-left (20,6), bottom (21,6), lower-right (22,6)
    assert!(hex::hex_distance(21, 5, 22, 6) == 1);
    assert!(hex::hex_distance(21, 5, 20, 6) == 1);
}

// H3: distance across 2 hexes == 2
#[test]
fn test_distance_two_apart() {
    // Two steps: (16,10)→(17,10)→(18,10): even→odd→even lower-right path
    assert!(hex::hex_distance(16, 10, 18, 10) == 2);
    // Two steps down: (16,10)→(16,11)→(16,12)
    assert!(hex::hex_distance(16, 10, 16, 12) == 2);
}

// H4: distance along diagonal direction
#[test]
fn test_distance_diagonal() {
    // (16,10) → (17,11): upper-right then bottom = 2 steps
    assert!(hex::hex_distance(16, 10, 17, 11) == 2);
    // (10,5) → (12,4): 2 steps
    assert!(hex::hex_distance(10, 5, 12, 4) == 2);
    // (10,5) → (13,4): 3 steps
    assert!(hex::hex_distance(10, 5, 13, 4) == 3);
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
    // q=16 (even): upper-right(17,9), top(16,9), upper-left(15,9),
    //              lower-left(15,10), bottom(16,11), lower-right(17,10)
    assert!(contains(@neighbors, 17, 9));
    assert!(contains(@neighbors, 16, 9));
    assert!(contains(@neighbors, 15, 9));
    assert!(contains(@neighbors, 15, 10));
    assert!(contains(@neighbors, 16, 11));
    assert!(contains(@neighbors, 17, 10));
}

// H7: fewer neighbors at map corner (out-of-bounds filtered)
#[test]
fn test_neighbors_corner() {
    // (0, 0), even column: neighbors (1,-1), (0,-1), (-1,-1), (-1,0), (0,1), (1,0)
    // Only (0,1) and (1,0) are in bounds
    let neighbors = hex::hex_neighbors(0, 0);
    assert!(neighbors.len() == 2);
    assert!(contains(@neighbors, 1, 0));
    assert!(contains(@neighbors, 0, 1));
}

// H8: edge tile has fewer valid neighbors
#[test]
fn test_neighbors_edge() {
    // (0, 10) — left edge, even column
    // Neighbors: (1,9)✓, (0,9)✓, (-1,9)✗, (-1,10)✗, (0,11)✓, (1,10)✓
    let neighbors = hex::hex_neighbors(0, 10);
    assert!(neighbors.len() == 4);

    // (31, 0) — right edge, odd column
    // Neighbors: (32,0)✗, (31,-1)✗, (30,0)✓, (30,1)✓, (31,1)✓, (32,1)✗
    let neighbors2 = hex::hex_neighbors(31, 0);
    assert!(neighbors2.len() == 3);
}

// Additional: test odd column neighbors
#[test]
fn test_neighbors_odd_column() {
    // q=21 (odd), r=5
    // upper-right(22,5), top(21,4), upper-left(20,5),
    // lower-left(20,6), bottom(21,6), lower-right(22,6)
    let neighbors = hex::hex_neighbors(21, 5);
    assert!(neighbors.len() == 6);
    assert!(contains(@neighbors, 22, 5));
    assert!(contains(@neighbors, 21, 4));
    assert!(contains(@neighbors, 20, 5));
    assert!(contains(@neighbors, 20, 6));
    assert!(contains(@neighbors, 21, 6));
    assert!(contains(@neighbors, 22, 6));
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
// (16,10) → (17,10) → (18,10): blocker at (17,10)
#[test]
fn test_los_blocked_mountain() {
    let blocking: Array<(u8, u8)> = array![(17, 10)];
    assert!(!hex::has_line_of_sight(16, 10, 18, 10, blocking.span()));
}

// H14: LOS blocked by woods between (not at endpoints)
#[test]
fn test_los_blocked_woods() {
    let blocking: Array<(u8, u8)> = array![(11, 10)];
    assert!(!hex::has_line_of_sight(10, 10, 12, 10, blocking.span()));
}

// H15: Woods at source or target do NOT block LOS
#[test]
fn test_los_woods_at_endpoint() {
    let blocking_source: Array<(u8, u8)> = array![(16, 10)];
    assert!(hex::has_line_of_sight(16, 10, 18, 10, blocking_source.span()));
    let blocking_target: Array<(u8, u8)> = array![(18, 10)];
    assert!(hex::has_line_of_sight(16, 10, 18, 10, blocking_target.span()));
}

// H16: Adjacent tiles always have LOS (nothing in between)
#[test]
fn test_los_adjacent() {
    let blocking: Array<(u8, u8)> = array![(20, 20)];
    assert!(hex::has_line_of_sight(16, 10, 17, 10, blocking.span()));
}

// H27: LOS from a tile to itself is always true
#[test]
fn test_los_to_self() {
    let blocking: Array<(u8, u8)> = array![(16, 10)];
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
// Direction indices: 0=upper-right, 1=top, 2=upper-left, 3=lower-left, 4=bottom, 5=lower-right
// q=16 is even: lower-right neighbor is (17,10), which is direction 5.
#[test]
fn test_river_crossing() {
    // River on direction 5 (lower-right) edge of (16,10), moving to (17,10) → crossing
    let river_edges: u8 = 0b100000; // bit 5 = lower-right
    assert!(hex::is_river_crossing(16, 10, 17, 10, river_edges));
}

// H21: No river between two tiles
#[test]
fn test_no_river_crossing() {
    // No river edges at all
    assert!(!hex::is_river_crossing(16, 10, 17, 10, 0));
    // River on top edge (dir 1), but moving lower-right — no crossing
    let river_edges: u8 = 0b000010; // bit 1 = top
    assert!(!hex::is_river_crossing(16, 10, 17, 10, river_edges));
}

// ===========================================================================
// Coordinate conversion (H22–H23)
// ===========================================================================

// H22: axial_to_storage converts correctly
#[test]
fn test_axial_to_storage() {
    // axial (0, 0) → offset (0, 0)
    let (sq, sr) = hex::axial_to_storage(0, 0);
    assert!(sq == 0);
    assert!(sr == 0);
    // axial (16, 2) → offset (16, 2 + floor(16/2)) = (16, 10)
    let (sq2, sr2) = hex::axial_to_storage(16, 2);
    assert!(sq2 == 16);
    assert!(sr2 == 10);
    // axial (1, 0) → offset (1, 0 + floor(1/2)) = (1, 0)
    let (sq3, sr3) = hex::axial_to_storage(1, 0);
    assert!(sq3 == 1);
    assert!(sr3 == 0);
}

// H23: storage_to_axial converts correctly
#[test]
fn test_storage_to_axial() {
    // offset (0, 0) → axial (0, 0 - 0) = (0, 0)
    let (aq, ar) = hex::storage_to_axial(0, 0);
    assert!(aq == 0);
    assert!(ar == 0);
    // offset (16, 10) → axial (16, 10 - 8) = (16, 2)
    let (aq2, ar2) = hex::storage_to_axial(16, 10);
    assert!(aq2 == 16);
    assert!(ar2 == 2);
    // offset (1, 5) → axial (1, 5 - 0) = (1, 5)
    let (aq3, ar3) = hex::storage_to_axial(1, 5);
    assert!(aq3 == 1);
    assert!(ar3 == 5);
}

// ===========================================================================
// Direction between (H24–H25)
// ===========================================================================

// H24: Returns correct direction index 0-5 for adjacent tiles (even column)
#[test]
fn test_direction_between_adjacent() {
    // q=16 (even column):
    // upper-right: (16,10) → (17,9) = direction 0
    let d0 = hex::direction_between(16, 10, 17, 9);
    assert!(d0 == Option::Some(0));
    // top: (16,10) → (16,9) = direction 1
    let d1 = hex::direction_between(16, 10, 16, 9);
    assert!(d1 == Option::Some(1));
    // upper-left: (16,10) → (15,9) = direction 2
    let d2 = hex::direction_between(16, 10, 15, 9);
    assert!(d2 == Option::Some(2));
    // lower-left: (16,10) → (15,10) = direction 3
    let d3 = hex::direction_between(16, 10, 15, 10);
    assert!(d3 == Option::Some(3));
    // bottom: (16,10) → (16,11) = direction 4
    let d4 = hex::direction_between(16, 10, 16, 11);
    assert!(d4 == Option::Some(4));
    // lower-right: (16,10) → (17,10) = direction 5
    let d5 = hex::direction_between(16, 10, 17, 10);
    assert!(d5 == Option::Some(5));
}

// H24b: Returns correct direction for odd column
#[test]
fn test_direction_between_odd_column() {
    // q=21 (odd column):
    // upper-right: (21,5) → (22,5) = direction 0
    assert!(hex::direction_between(21, 5, 22, 5) == Option::Some(0));
    // top: (21,5) → (21,4) = direction 1
    assert!(hex::direction_between(21, 5, 21, 4) == Option::Some(1));
    // upper-left: (21,5) → (20,5) = direction 2
    assert!(hex::direction_between(21, 5, 20, 5) == Option::Some(2));
    // lower-left: (21,5) → (20,6) = direction 3
    assert!(hex::direction_between(21, 5, 20, 6) == Option::Some(3));
    // bottom: (21,5) → (21,6) = direction 4
    assert!(hex::direction_between(21, 5, 21, 6) == Option::Some(4));
    // lower-right: (21,5) → (22,6) = direction 5
    assert!(hex::direction_between(21, 5, 22, 6) == Option::Some(5));
}

// H25: Returns None for non-adjacent tiles
#[test]
fn test_direction_between_non_adjacent() {
    let d = hex::direction_between(16, 10, 18, 10);
    assert!(d == Option::None);
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
