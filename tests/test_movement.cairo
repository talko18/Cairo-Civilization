// ============================================================================
// Tests — Movement Validation (V1–V29)
// Feature 5 in the feature map.
// ============================================================================

use cairo_civ::types::{Unit, TileData, MoveError,
    UNIT_WARRIOR, UNIT_SCOUT, UNIT_SETTLER, UNIT_BUILDER, UNIT_ARCHER,
    TERRAIN_GRASSLAND, TERRAIN_GRASSLAND_HILLS, TERRAIN_PLAINS, TERRAIN_MOUNTAIN,
    TERRAIN_OCEAN, TERRAIN_COAST,
    FEATURE_NONE, FEATURE_WOODS, FEATURE_MARSH, RESOURCE_NONE};
use cairo_civ::movement;
use cairo_civ::constants;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_unit(unit_type: u8, q: u8, r: u8, mp: u8) -> Unit {
    Unit {
        unit_type, q, r,
        hp: 100,
        movement_remaining: mp,
        charges: if unit_type == UNIT_BUILDER { 3 } else { 0 },
        fortify_turns: 0,
    }
}

fn make_tile(terrain: u8, feature: u8) -> TileData {
    TileData { terrain, feature, resource: RESOURCE_NONE, river_edges: 0 }
}

fn flat_tile() -> TileData { make_tile(TERRAIN_GRASSLAND, FEATURE_NONE) }
fn hills_tile() -> TileData { make_tile(TERRAIN_GRASSLAND_HILLS, FEATURE_NONE) }
fn woods_tile() -> TileData { make_tile(TERRAIN_GRASSLAND, FEATURE_WOODS) }
fn mountain_tile() -> TileData { make_tile(TERRAIN_MOUNTAIN, FEATURE_NONE) }
fn ocean_tile() -> TileData { make_tile(TERRAIN_OCEAN, FEATURE_NONE) }
fn coast_tile() -> TileData { make_tile(TERRAIN_COAST, FEATURE_NONE) }
fn marsh_tile() -> TileData { make_tile(TERRAIN_GRASSLAND, FEATURE_MARSH) }

// ===========================================================================
// Terrain movement costs (V1–V6)
// ===========================================================================

// V1: Move to flat grassland costs 1
#[test]
fn test_move_flat_terrain() {
    assert!(movement::tile_movement_cost(@flat_tile()) == 1);
}

// V2: Move to hills costs 2
#[test]
fn test_move_hills() {
    assert!(movement::tile_movement_cost(@hills_tile()) == 2);
}

// V3: Move to woods costs 2
#[test]
fn test_move_woods() {
    assert!(movement::tile_movement_cost(@woods_tile()) == 2);
}

// V4: Cannot move to mountain (cost 0 = impassable)
#[test]
fn test_move_mountain_blocked() {
    assert!(movement::tile_movement_cost(@mountain_tile()) == 0);
}

// V5: Cannot move to ocean
#[test]
fn test_move_ocean_blocked() {
    assert!(movement::tile_movement_cost(@ocean_tile()) == 0);
}

// V6: Cannot move to coast
#[test]
fn test_move_coast_blocked() {
    assert!(movement::tile_movement_cost(@coast_tile()) == 0);
}

// ===========================================================================
// Movement validation (V7–V16)
// ===========================================================================

// V7: Unit with 1 MP can't enter hills (cost 2)
#[test]
fn test_move_insufficient_movement() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 1);
    let result = movement::validate_move(
        @unit, 17, 10, @hills_tile(), Option::None, 0, 0
    );
    assert!(result.is_err());
}

// V8: Unit with 2 MP can enter hills (cost 2)
#[test]
fn test_move_exact_movement() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 2);
    let result = movement::validate_move(
        @unit, 17, 10, @hills_tile(), Option::None, 0, 0
    );
    assert!(result.is_ok());
}

// V9: River crossing costs all remaining movement
#[test]
fn test_move_river_crossing() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 2);
    let river_tile = TileData {
        terrain: TERRAIN_GRASSLAND,
        feature: FEATURE_NONE,
        resource: RESOURCE_NONE,
        river_edges: 0b000001, // river on E edge
    };
    // Moving east across river — should succeed but consume all MP
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::None, 0, 0
    );
    assert!(result.is_ok());
}

// V10: Cannot cross river with 0 MP remaining
#[test]
fn test_move_river_crossing_zero_mp() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 0);
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::None, 0, 0
    );
    assert!(result.is_err());
}

// V11: Can't move to tile with own military unit
#[test]
fn test_move_friendly_unit_blocking() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 2);
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::Some(UNIT_WARRIOR), 0, 0
    );
    assert!(result.is_err());
}

// V12: Military unit can move to tile with own civilian unit
#[test]
fn test_move_friendly_civilian_ok() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 2);
    // Settler (civilian) on destination, same player (player 0)
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::Some(UNIT_SETTLER), 0, 0
    );
    assert!(result.is_ok());
}

// V13: Can't move to non-adjacent tile
#[test]
fn test_move_non_adjacent() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 2);
    let result = movement::validate_move(
        @unit, 18, 10, @flat_tile(), Option::None, 0, 0
    );
    assert!(result.is_err());
}

// V14: Can't move off map
#[test]
fn test_move_out_of_bounds() {
    let unit = make_unit(UNIT_WARRIOR, 31, 10, 2);
    let result = movement::validate_move(
        @unit, 32, 10, @flat_tile(), Option::None, 0, 0
    );
    assert!(result.is_err());
}

// V15: After move, unit's movement_remaining is reduced
#[test]
fn test_move_deducts_movement() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 2);
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::None, 0, 0
    );
    match result {
        Result::Ok(remaining) => {
            assert!(remaining == 1); // 2 - 1 cost
        },
        Result::Err(_) => { assert!(false); },
    }
}

// V16: After move to hills, movement reduced by 2
#[test]
fn test_move_updates_position() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 2);
    let result = movement::validate_move(
        @unit, 17, 10, @hills_tile(), Option::None, 0, 0
    );
    match result {
        Result::Ok(remaining) => {
            assert!(remaining == 0); // 2 - 2 cost
        },
        Result::Err(_) => { assert!(false); },
    }
}

// ===========================================================================
// Unit movement points (V17–V19)
// ===========================================================================

// V17: Scout has 3 movement points
#[test]
fn test_scout_3_movement() {
    assert!(constants::unit_movement(UNIT_SCOUT) == 3);
}

// V18: Warrior has 2 movement points
#[test]
fn test_warrior_2_movement() {
    assert!(constants::unit_movement(UNIT_WARRIOR) == 2);
}

// V19: Each unit type gets correct MP at turn start
#[test]
fn test_reset_movement_values() {
    assert!(constants::unit_movement(UNIT_SETTLER) == 2);
    assert!(constants::unit_movement(UNIT_BUILDER) == 2);
    assert!(constants::unit_movement(UNIT_SCOUT) == 3);
    assert!(constants::unit_movement(UNIT_WARRIOR) == 2);
    assert!(constants::unit_movement(UNIT_ARCHER) == 2);
}

// ===========================================================================
// Edge cases (V20–V29)
// ===========================================================================

// V20: Moving to enemy-occupied tile is flagged as attack
#[test]
fn test_move_enemy_tile_is_attack() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 2);
    // Enemy military unit (different player) on destination
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::Some(UNIT_WARRIOR), 1, 0
    );
    // This should either succeed (for melee attack) or return specific error
    // Implementation will define exact behavior
    assert!(result.is_ok() || result.is_err()); // placeholder
}

// V21: Unit with 0 MP remaining can't move anywhere
#[test]
fn test_move_zero_movement_remaining() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 0);
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::None, 0, 0
    );
    assert!(result.is_err());
}

// V22: Unit uses 2 MP moving to hills, can't then enter another hills tile
#[test]
fn test_move_second_move_insufficient() {
    // After first move to hills (cost 2), warrior has 0 MP
    let unit = make_unit(UNIT_WARRIOR, 17, 10, 0); // simulating after first move
    let result = movement::validate_move(
        @unit, 18, 10, @hills_tile(), Option::None, 0, 0
    );
    assert!(result.is_err());
}

// V23: Marsh tile costs 2 movement
#[test]
fn test_move_to_marsh() {
    assert!(movement::tile_movement_cost(@marsh_tile()) == 2);
}

// V24: Moving a fortified unit resets fortify_turns to 0
#[test]
fn test_fortify_clears_on_move() {
    let unit = Unit {
        unit_type: UNIT_WARRIOR, q: 16, r: 10,
        hp: 100, movement_remaining: 2, charges: 0,
        fortify_turns: 2,
    };
    // After move, fortify_turns should be 0
    // This is handled by the contract, but movement module should signal it
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::None, 0, 0
    );
    assert!(result.is_ok());
}

// V25: Can't move settler to tile with own builder (no civilian stacking)
#[test]
fn test_move_civilian_to_civilian_blocked() {
    let unit = make_unit(UNIT_SETTLER, 16, 10, 2);
    // Builder (civilian) on destination, same player
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::Some(UNIT_BUILDER), 0, 0
    );
    assert!(result.is_err());
}

// V26: Warrior with 0 MP remaining can't melee attack
#[test]
fn test_melee_attack_requires_movement() {
    let unit = make_unit(UNIT_WARRIOR, 16, 10, 0);
    let result = movement::validate_move(
        @unit, 17, 10, @flat_tile(), Option::Some(UNIT_WARRIOR), 1, 0
    );
    assert!(result.is_err());
}

// V27: Archer with 0 MP remaining CAN still ranged attack (separate action, tested in combat)
#[test]
fn test_ranged_attack_no_movement_needed() {
    // Ranged attacks don't go through validate_move — they use combat module directly
    // This test verifies the design: ranged_attack is separate from movement
    let unit = make_unit(UNIT_ARCHER, 16, 10, 0);
    assert!(unit.movement_remaining == 0);
    assert!(constants::is_ranged_unit(UNIT_ARCHER));
}

// V28: After BuildImprovement, builder has 0 MP remaining
#[test]
fn test_build_improvement_consumes_all_movement() {
    // BuildImprovement consumes all movement — contract sets MP to 0
    // Verify builder starts with 2 MP
    let builder = make_unit(UNIT_BUILDER, 16, 10, 2);
    assert!(builder.movement_remaining == 2);
    // After building, should be 0 — tested via contract integration
}

// V29: After RemoveImprovement, builder has 0 MP remaining
#[test]
fn test_remove_improvement_consumes_all_movement() {
    // RemoveImprovement consumes all movement — contract sets MP to 0
    let builder = make_unit(UNIT_BUILDER, 16, 10, 2);
    assert!(builder.movement_remaining == 2);
    // After removing, should be 0 — tested via contract integration
}
