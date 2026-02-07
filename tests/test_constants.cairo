// ============================================================================
// Tests — Constants and lookup tables
// Feature 1 in the feature map.
// ============================================================================

use cairo_civ::constants;

// ---------------------------------------------------------------------------
// Unit stats
// ---------------------------------------------------------------------------

#[test]
fn test_unit_combat_strength() {
    assert!(constants::unit_combat_strength(0) == 0);   // Settler
    assert!(constants::unit_combat_strength(1) == 0);   // Builder
    assert!(constants::unit_combat_strength(2) == 10);  // Scout
    assert!(constants::unit_combat_strength(3) == 20);  // Warrior
    assert!(constants::unit_combat_strength(4) == 5);   // Slinger
    assert!(constants::unit_combat_strength(5) == 10);  // Archer
    assert!(constants::unit_combat_strength(255) == 0); // Invalid
}

#[test]
fn test_unit_ranged_strength() {
    assert!(constants::unit_ranged_strength(3) == 0);   // Warrior (melee)
    assert!(constants::unit_ranged_strength(4) == 15);  // Slinger
    assert!(constants::unit_ranged_strength(5) == 25);  // Archer
}

#[test]
fn test_unit_range() {
    assert!(constants::unit_range(3) == 0); // Warrior (no range)
    assert!(constants::unit_range(4) == 1); // Slinger
    assert!(constants::unit_range(5) == 2); // Archer
}

#[test]
fn test_unit_movement() {
    assert!(constants::unit_movement(0) == 2); // Settler
    assert!(constants::unit_movement(2) == 3); // Scout
    assert!(constants::unit_movement(3) == 2); // Warrior
}

#[test]
fn test_is_civilian() {
    assert!(constants::is_civilian(0));  // Settler
    assert!(constants::is_civilian(1));  // Builder
    assert!(!constants::is_civilian(2)); // Scout
    assert!(!constants::is_civilian(3)); // Warrior
}

#[test]
fn test_is_ranged_unit() {
    assert!(!constants::is_ranged_unit(3)); // Warrior
    assert!(constants::is_ranged_unit(4));  // Slinger
    assert!(constants::is_ranged_unit(5));  // Archer
}

// ---------------------------------------------------------------------------
// Building stats
// ---------------------------------------------------------------------------

#[test]
fn test_building_production_cost() {
    assert!(constants::building_production_cost(0) == 60);  // Monument
    assert!(constants::building_production_cost(1) == 65);  // Granary
    assert!(constants::building_production_cost(2) == 80);  // Walls
}

#[test]
fn test_building_required_tech() {
    assert!(constants::building_required_tech(0) == 0); // Monument: none
    assert!(constants::building_required_tech(1) == 2); // Granary: Pottery
    assert!(constants::building_required_tech(2) == 8); // Walls: Masonry
}

// ---------------------------------------------------------------------------
// Production cost (range-separated IDs)
// ---------------------------------------------------------------------------

#[test]
fn test_production_cost_units() {
    assert!(constants::production_cost(1) == 80);  // Settler
    assert!(constants::production_cost(4) == 40);  // Warrior
}

#[test]
fn test_production_cost_buildings() {
    assert!(constants::production_cost(64) == 60);  // Monument
    assert!(constants::production_cost(65) == 65);  // Granary
}

#[test]
fn test_production_cost_idle() {
    assert!(constants::production_cost(0) == 0);
}

#[test]
fn test_purchase_cost() {
    assert!(constants::purchase_cost(4) == 160); // Warrior: 40 * 4
}

// ---------------------------------------------------------------------------
// Movement costs
// ---------------------------------------------------------------------------

#[test]
fn test_terrain_movement_cost_impassable() {
    assert!(constants::terrain_movement_cost(0, 0) == 0);  // Ocean
    assert!(constants::terrain_movement_cost(1, 0) == 0);  // Coast
    assert!(constants::terrain_movement_cost(12, 0) == 0); // Mountain
}

#[test]
fn test_terrain_movement_cost_flat() {
    assert!(constants::terrain_movement_cost(2, 0) == 1); // Grassland
    assert!(constants::terrain_movement_cost(4, 0) == 1); // Plains
}

#[test]
fn test_terrain_movement_cost_hills() {
    assert!(constants::terrain_movement_cost(3, 0) == 2); // Grassland Hills
    assert!(constants::terrain_movement_cost(5, 0) == 2); // Plains Hills
}

#[test]
fn test_terrain_movement_cost_feature() {
    assert!(constants::terrain_movement_cost(2, 1) == 2); // Grassland + Woods
}

// ---------------------------------------------------------------------------
// Damage lookup table
// ---------------------------------------------------------------------------

#[test]
fn test_damage_lookup_extremes() {
    assert!(constants::damage_lookup(0) == 6);     // delta -40
    assert!(constants::damage_lookup(80) == 149);  // delta +40
}

#[test]
fn test_damage_lookup_mid() {
    assert!(constants::damage_lookup(40) == 50); // delta 0
}

#[test]
fn test_damage_lookup_clamp() {
    assert!(constants::damage_lookup(81) == 149);  // beyond table
    assert!(constants::damage_lookup(255) == 149); // way beyond
}

// ---------------------------------------------------------------------------
// Terrain yields
// ---------------------------------------------------------------------------

#[test]
fn test_base_terrain_yield_food() {
    assert!(constants::base_terrain_yield_food(2) == 2); // Grassland
    assert!(constants::base_terrain_yield_food(4) == 1); // Plains
    assert!(constants::base_terrain_yield_food(6) == 0); // Desert
}

#[test]
fn test_base_terrain_yield_production() {
    assert!(constants::base_terrain_yield_production(5) == 2); // Plains Hills
    assert!(constants::base_terrain_yield_production(2) == 0); // Grassland
}

// ---------------------------------------------------------------------------
// Food and growth
// ---------------------------------------------------------------------------

#[test]
fn test_food_for_growth() {
    assert!(constants::food_for_growth(1) == 21);  // 15 + 6*1
    assert!(constants::food_for_growth(5) == 45);  // 15 + 6*5
}

// ---------------------------------------------------------------------------
// Territory radius
// ---------------------------------------------------------------------------

#[test]
fn test_territory_radius() {
    assert!(constants::territory_radius(1) == 1);
    assert!(constants::territory_radius(2) == 1);
    assert!(constants::territory_radius(3) == 2);
    assert!(constants::territory_radius(5) == 2);
    assert!(constants::territory_radius(6) == 3);
}

// ---------------------------------------------------------------------------
// Tech costs
// ---------------------------------------------------------------------------

#[test]
fn test_tech_cost() {
    assert!(constants::tech_cost(1) == 25);   // Mining
    assert!(constants::tech_cost(18) == 100); // Machinery
    assert!(constants::tech_cost(0) == 0);    // Invalid
}

#[test]
fn test_tech_cost_half() {
    assert!(constants::tech_cost_half(1) == 50); // Mining: 25 * 2
}

// ---------------------------------------------------------------------------
// Upgrade paths
// ---------------------------------------------------------------------------

#[test]
fn test_unit_upgrade_path_slinger() {
    let (to_type, tech) = constants::unit_upgrade_path(4);
    assert!(to_type == 5);  // Archer
    assert!(tech == 4);     // Archery
}

#[test]
fn test_unit_upgrade_path_no_upgrade() {
    let (to_type, _tech) = constants::unit_upgrade_path(3); // Warrior
    assert!(to_type == 0);
}

#[test]
fn test_unit_upgrade_cost() {
    assert!(constants::unit_upgrade_cost(4) == 30); // Archer cost 60 / 2
}
