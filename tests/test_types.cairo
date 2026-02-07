// ============================================================================
// Tests — Types and StorePacking
// Feature 1 in the feature map.
// ============================================================================

use cairo_civ::types::{Unit, TileData, TERRAIN_PLAINS, FEATURE_WOODS, RESOURCE_NONE, UNIT_WARRIOR};
use starknet::storage_access::StorePacking;

// ---------------------------------------------------------------------------
// P1: Unit StorePacking round-trip
// ---------------------------------------------------------------------------

#[test]
fn test_unit_store_packing_round_trip() {
    let unit = Unit {
        unit_type: UNIT_WARRIOR,
        q: 10,
        r: 15,
        hp: 100,
        movement_remaining: 2,
        charges: 0,
        fortify_turns: 1,
    };
    let packed = StorePacking::pack(unit);
    let unpacked: Unit = StorePacking::unpack(packed);
    assert!(unpacked == unit);
}

// ---------------------------------------------------------------------------
// P2: TileData StorePacking round-trip
// ---------------------------------------------------------------------------

#[test]
fn test_tile_data_store_packing_round_trip() {
    let tile = TileData {
        terrain: TERRAIN_PLAINS,
        feature: FEATURE_WOODS,
        resource: RESOURCE_NONE,
        river_edges: 0b101010, // edges 1, 3, 5
    };
    let packed = StorePacking::pack(tile);
    let unpacked: TileData = StorePacking::unpack(packed);
    assert!(unpacked == tile);
}

// ---------------------------------------------------------------------------
// P3: Unit StorePacking boundary values
// ---------------------------------------------------------------------------

#[test]
fn test_unit_store_packing_max_values() {
    let unit = Unit {
        unit_type: 255,
        q: 255,
        r: 255,
        hp: 255,
        movement_remaining: 255,
        charges: 255,
        fortify_turns: 255,
    };
    let packed = StorePacking::pack(unit);
    let unpacked: Unit = StorePacking::unpack(packed);
    assert!(unpacked == unit);
}

#[test]
fn test_unit_store_packing_zero_values() {
    let unit = Unit {
        unit_type: 0,
        q: 0,
        r: 0,
        hp: 0,
        movement_remaining: 0,
        charges: 0,
        fortify_turns: 0,
    };
    let packed = StorePacking::pack(unit);
    let unpacked: Unit = StorePacking::unpack(packed);
    assert!(unpacked == unit);
}
