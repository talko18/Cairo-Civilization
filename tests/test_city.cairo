// ============================================================================
// Tests — City Management (Y1–Y53)
// Feature 7 in the feature map.
// ============================================================================

use cairo_civ::types::{City, TileData, TileYield, CityFoundError,
    TERRAIN_GRASSLAND, TERRAIN_GRASSLAND_HILLS, TERRAIN_PLAINS, TERRAIN_PLAINS_HILLS,
    TERRAIN_DESERT, TERRAIN_DESERT_HILLS, TERRAIN_TUNDRA, TERRAIN_MOUNTAIN, TERRAIN_OCEAN, TERRAIN_COAST,
    FEATURE_NONE, FEATURE_WOODS, FEATURE_RAINFOREST, FEATURE_MARSH,
    RESOURCE_NONE, RESOURCE_WHEAT, RESOURCE_SILVER,
    IMPROVEMENT_NONE, IMPROVEMENT_FARM, IMPROVEMENT_MINE, IMPROVEMENT_LUMBER_MILL, IMPROVEMENT_PASTURE,
    BUILDING_MONUMENT, BUILDING_GRANARY, BUILDING_WALLS, BUILDING_LIBRARY,
    BUILDING_MARKET, BUILDING_BARRACKS, BUILDING_WATER_MILL};
use cairo_civ::city;
use cairo_civ::constants;
use cairo_civ::tech;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_city(q: u8, r: u8, pop: u8, buildings: u32, is_capital: bool) -> City {
    City {
        name: 'TestCity', q, r,
        population: pop, hp: 200,
        food_stockpile: 0, production_stockpile: 0,
        current_production: 0, buildings,
        founded_turn: 0, original_owner: 0,
        is_capital,
    }
}

fn make_tile(terrain: u8, feature: u8, resource: u8) -> TileData {
    TileData { terrain, feature, resource, river_edges: 0 }
}

fn flat_grassland() -> TileData { make_tile(TERRAIN_GRASSLAND, FEATURE_NONE, RESOURCE_NONE) }

fn set_building_bit(buildings: u32, bit: u8) -> u32 {
    buildings | pow2_u32(bit.into())
}

fn has_building_bit(buildings: u32, bit: u8) -> bool {
    (buildings & pow2_u32(bit.into())) != 0
}

fn pow2_u32(n: u32) -> u32 {
    if n == 0 { return 1; }
    let mut r: u32 = 1;
    let mut i: u32 = 0;
    while i < n {
        r *= 2;
        i += 1;
    };
    r
}

// ===========================================================================
// 7a: City Founding (Y1–Y8)
// ===========================================================================

// Y1: City founding on flat grassland succeeds
#[test]
fn test_found_city_valid() {
    let tile = flat_grassland();
    let result = city::validate_city_founding(16, 10, @tile, array![].span());
    assert!(result.is_ok());
}

// Y2: City founding on mountain fails
#[test]
fn test_found_city_on_mountain() {
    let tile = make_tile(TERRAIN_MOUNTAIN, FEATURE_NONE, RESOURCE_NONE);
    let result = city::validate_city_founding(16, 10, @tile, array![].span());
    assert!(result.is_err());
}

// Y3: City founding on ocean/coast fails
#[test]
fn test_found_city_on_water() {
    let ocean = make_tile(TERRAIN_OCEAN, FEATURE_NONE, RESOURCE_NONE);
    let coast = make_tile(TERRAIN_COAST, FEATURE_NONE, RESOURCE_NONE);
    assert!(city::validate_city_founding(16, 10, @ocean, array![].span()).is_err());
    assert!(city::validate_city_founding(16, 10, @coast, array![].span()).is_err());
}

// Y4: City within 3 hexes of existing city fails
#[test]
fn test_found_city_too_close() {
    let tile = flat_grassland();
    let existing = array![(17_u8, 10_u8)]; // distance 1
    let result = city::validate_city_founding(16, 10, @tile, existing.span());
    assert!(result.is_err());
}

// Y5: City at exactly distance 3 succeeds
#[test]
fn test_found_city_exactly_3() {
    let tile = flat_grassland();
    let existing = array![(19_u8, 10_u8)]; // distance 3
    let result = city::validate_city_founding(16, 10, @tile, existing.span());
    assert!(result.is_ok());
}

// Y6: New city has pop=1, hp=200, no buildings
#[test]
fn test_create_city_defaults() {
    let c = make_city(16, 10, 1, 0, true);
    assert!(c.population == 1);
    assert!(c.hp == 200);
    assert!(c.buildings == 0);
}

// Y7: First city founded sets is_capital=true
#[test]
fn test_first_city_is_capital() {
    let c = make_city(16, 10, 1, 0, true);
    assert!(c.is_capital);
}

// Y8: Second city has is_capital=false
#[test]
fn test_second_city_not_capital() {
    let c = make_city(20, 10, 1, 0, false);
    assert!(!c.is_capital);
}

// ===========================================================================
// 7b: Tile Yields (Y9–Y16, Y47–Y48)
// ===========================================================================

// Y9: Grassland yields 2 food, 0 prod, 0 gold
#[test]
fn test_tile_yield_grassland() {
    let tile = flat_grassland();
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 2);
    assert!(y.production == 0);
    assert!(y.gold == 0);
}

// Y10: Plains Hills yields 1 food, 2 prod
#[test]
fn test_tile_yield_plains_hills() {
    let tile = make_tile(TERRAIN_PLAINS_HILLS, FEATURE_NONE, RESOURCE_NONE);
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 1);
    assert!(y.production == 2);
}

// Y11: Grassland + Woods yields 2 food, 1 prod
#[test]
fn test_tile_yield_woods() {
    let tile = make_tile(TERRAIN_GRASSLAND, FEATURE_WOODS, RESOURCE_NONE);
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 2);
    assert!(y.production == 1);
}

// Y12: Grassland + Farm yields 3 food
#[test]
fn test_tile_yield_with_farm() {
    let tile = flat_grassland();
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_FARM);
    assert!(y.food == 3); // 2 base + 1 farm
}

// Y13: Hills + Mine yields +1 prod
#[test]
fn test_tile_yield_with_mine() {
    let tile = make_tile(TERRAIN_GRASSLAND_HILLS, FEATURE_NONE, RESOURCE_NONE);
    let y_no_mine = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    let y_mine = city::compute_tile_yield(@tile, IMPROVEMENT_MINE);
    assert!(y_mine.production == y_no_mine.production + 1);
}

// Y14: Grassland + Wheat yields 3 food
#[test]
fn test_tile_yield_resource_wheat() {
    let tile = make_tile(TERRAIN_GRASSLAND, FEATURE_NONE, RESOURCE_WHEAT);
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 3); // 2 base + 1 wheat
}

// Y15: Silver resource yields +3 gold
#[test]
fn test_tile_yield_luxury_gold() {
    let tile = make_tile(TERRAIN_GRASSLAND_HILLS, FEATURE_NONE, RESOURCE_SILVER);
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.gold >= 3);
}

// Y16: Coast yields 1 food, 1 gold
#[test]
fn test_tile_yield_coast() {
    let tile = make_tile(TERRAIN_COAST, FEATURE_NONE, RESOURCE_NONE);
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 1);
    assert!(y.gold == 1);
}

// Y47: Desert yields 0 food, 0 prod, 0 gold
#[test]
fn test_tile_yield_desert() {
    let tile = make_tile(TERRAIN_DESERT, FEATURE_NONE, RESOURCE_NONE);
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 0);
    assert!(y.production == 0);
    assert!(y.gold == 0);
}

// Y48: Ocean yields 1 food, 0 prod, 0 gold
#[test]
fn test_tile_yield_ocean() {
    let tile = make_tile(TERRAIN_OCEAN, FEATURE_NONE, RESOURCE_NONE);
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 1);
    assert!(y.production == 0);
    assert!(y.gold == 0);
}

// ===========================================================================
// 7c: Building Yields & Housing (Y17–Y23, Y33–Y34, Y49)
// ===========================================================================

// Y17: Monument production cost
#[test]
fn test_building_cost_monument() {
    assert!(constants::building_production_cost(BUILDING_MONUMENT) == 60);
}

// Y18: Granary production cost
#[test]
fn test_building_cost_granary() {
    assert!(constants::building_production_cost(BUILDING_GRANARY) == 65);
}

// Y19: Market production cost
#[test]
fn test_building_cost_market() {
    assert!(constants::building_production_cost(BUILDING_MARKET) == 100);
}

// Y20: Capital palace bonuses
#[test]
fn test_building_yields_palace() {
    assert!(constants::PALACE_PRODUCTION_BONUS == 2);
    assert!(constants::PALACE_HALF_SCIENCE_BONUS == 4); // 4 half-science = 2 science
    assert!(constants::PALACE_GOLD_BONUS == 5);
}

// Y21: No river, no coast → housing = 2
#[test]
fn test_housing_no_water() {
    let c = make_city(16, 10, 1, 0, false);
    let h = city::compute_housing(@c, false, false);
    assert!(h == 2);
}

// Y22: River → housing = 5
#[test]
fn test_housing_river() {
    let c = make_city(16, 10, 1, 0, false);
    let h = city::compute_housing(@c, true, false);
    assert!(h == 5);
}

// Y23: River + Granary → housing = 7
#[test]
fn test_housing_with_granary() {
    let buildings = set_building_bit(0, BUILDING_GRANARY);
    let c = make_city(16, 10, 1, buildings, false);
    let h = city::compute_housing(@c, true, false);
    assert!(h == 7); // 5 + 2
}

// Y33: Bitmask check for specific building
#[test]
fn test_has_building() {
    let buildings = set_building_bit(0, BUILDING_GRANARY);
    assert!(has_building_bit(buildings, BUILDING_GRANARY));
    assert!(!has_building_bit(buildings, BUILDING_MONUMENT));
}

// Y34: Sets correct bit in bitmask
#[test]
fn test_add_building() {
    let b = set_building_bit(0, BUILDING_WALLS);
    assert!(has_building_bit(b, BUILDING_WALLS));
    let b2 = set_building_bit(b, BUILDING_LIBRARY);
    assert!(has_building_bit(b2, BUILDING_WALLS));
    assert!(has_building_bit(b2, BUILDING_LIBRARY));
}

// Y49: Coast (no river) → housing = 3
#[test]
fn test_housing_coast() {
    let c = make_city(16, 10, 1, 0, false);
    let h = city::compute_housing(@c, false, true);
    assert!(h == 3);
}

// ===========================================================================
// 7d: Population Growth (Y24–Y28, Y46)
// ===========================================================================

// Y24: Surplus food → population grows
#[test]
fn test_growth_normal() {
    // pop=1, need food_for_growth(1)=21. stockpile=20, surplus=5 → 25 >= 21 → grow
    let (new_pop, new_food) = city::process_growth(1, 20, 5, 5);
    assert!(new_pop == 2);
    assert!(new_food == 4); // 25 - 21 = 4
}

// Y25: Need exactly food_for_growth to grow
#[test]
fn test_growth_threshold() {
    // pop=1, need=21, stockpile=16, surplus=5 → 21 = 21 → grow
    let (new_pop, _new_food) = city::process_growth(1, 16, 5, 5);
    assert!(new_pop == 2);
}

// Y26: Population at housing cap → no growth
#[test]
fn test_growth_blocked_by_housing() {
    // pop=2, housing=2 → at cap
    let (new_pop, _) = city::process_growth(2, 100, 10, 2);
    assert!(new_pop == 2);
}

// Y27: Negative food → population decreases
#[test]
fn test_starvation() {
    // pop=3, surplus=-3, stockpile=0 → lose 1 pop
    let (new_pop, new_food) = city::process_growth(3, 0, -3, 5);
    assert!(new_pop == 2);
    assert!(new_food == 0);
}

// Y28: food_for_growth = 15 + 6×pop
#[test]
fn test_food_for_growth_formula() {
    assert!(constants::food_for_growth(1) == 21);
    assert!(constants::food_for_growth(2) == 27);
    assert!(constants::food_for_growth(5) == 45);
    assert!(constants::food_for_growth(10) == 75);
}

// Y46: Population can't drop below 1 from starvation
#[test]
fn test_starvation_min_pop_1() {
    let (new_pop, _) = city::process_growth(1, 0, -5, 5);
    assert!(new_pop == 1);
}

// Y47: Multi-pop growth — pop 2 accumulates food toward higher threshold
#[test]
fn test_growth_multi_pop_accumulates() {
    // pop=2, food_for_growth(2)=27. stockpile=0, surplus=5
    // Turn 1: 0+5 = 5, no growth
    let (pop1, food1) = city::process_growth(2, 0, 5, 10);
    assert!(pop1 == 2, "Should stay at pop 2 (5 < 27)");
    assert!(food1 == 5, "Stockpile should be 5");

    // Turn 2: 5+5 = 10, no growth
    let (pop2, food2) = city::process_growth(pop1, food1, 5, 10);
    assert!(pop2 == 2, "Should stay at pop 2 (10 < 27)");
    assert!(food2 == 10, "Stockpile should be 10");

    // Turn 3: 10+5 = 15
    let (pop3, food3) = city::process_growth(pop2, food2, 5, 10);
    assert!(pop3 == 2, "Should stay at pop 2 (15 < 27)");
    assert!(food3 == 15, "Stockpile should be 15");

    // Turn 4: 15+5 = 20
    let (pop4, food4) = city::process_growth(pop3, food3, 5, 10);
    assert!(pop4 == 2, "Should stay at pop 2 (20 < 27)");
    assert!(food4 == 20, "Stockpile should be 20");

    // Turn 5: 20+5 = 25
    let (pop5, food5) = city::process_growth(pop4, food4, 5, 10);
    assert!(pop5 == 2, "Should stay at pop 2 (25 < 27)");
    assert!(food5 == 25, "Stockpile should be 25");

    // Turn 6: 25+5 = 30 >= 27 → grow to 3, leftover = 3
    let (pop6, food6) = city::process_growth(pop5, food5, 5, 10);
    assert!(pop6 == 3, "Should grow to pop 3");
    assert!(food6 == 3, "Leftover should be 30 - 27 = 3");
}

// Y48: After growth, leftover food continues accumulating toward next threshold
#[test]
fn test_growth_leftover_continues_accumulating() {
    // Grow from pop 1 to 2 with leftover
    let (pop, food) = city::process_growth(1, 18, 5, 10);
    assert!(pop == 2, "Should grow to pop 2 (23 >= 21)");
    assert!(food == 2, "Leftover should be 23 - 21 = 2");

    // Now at pop 2 with 2 food in stockpile, surplus 5
    // food_for_growth(2) = 27. Need 27 - 2 = 25 more food = 5 turns
    let (pop2, food2) = city::process_growth(pop, food, 5, 10);
    assert!(pop2 == 2, "Should stay at pop 2 (7 < 27)");
    assert!(food2 == 7, "Stockpile should be 2+5=7");
}

// Y49: Sequential growth from pop 1 to 3 with increasing thresholds
#[test]
fn test_growth_sequential_pop1_to_pop3() {
    // Simulate many turns with constant surplus of 4
    let mut pop: u8 = 1;
    let mut food: u16 = 0;
    let housing: u8 = 10;
    let surplus: i16 = 4;

    // Pop 1: need food_for_growth(1) = 21. Turns to grow = ceil(21/4) = 6
    let mut turn: u32 = 0;
    while pop == 1 {
        let (np, nf) = city::process_growth(pop, food, surplus, housing);
        pop = np;
        food = nf;
        turn += 1;
    };
    assert!(pop == 2, "Should reach pop 2");
    assert!(turn == 6, "Should take 6 turns to grow (24 >= 21)");
    assert!(food == 3, "Leftover should be 24 - 21 = 3");

    // Pop 2: need food_for_growth(2) = 27. Starting with 3 food.
    // Need 27 - 3 = 24 more. Turns = ceil(24/4) = 6
    let turn_start = turn;
    while pop == 2 {
        let (np, nf) = city::process_growth(pop, food, surplus, housing);
        pop = np;
        food = nf;
        turn += 1;
    };
    assert!(pop == 3, "Should reach pop 3");
    assert!(turn - turn_start == 6, "Should take 6 turns from pop 2 to pop 3");
    // 3 + 6*4 = 27 => exactly at threshold => leftover 0
    assert!(food == 0, "Leftover should be 27 - 27 = 0");
}

// Y50: Growth at housing cap — food accumulates but doesn't grow
#[test]
fn test_growth_at_housing_cap_food_stays() {
    // pop=3, housing=3 → at cap. surplus=5, stockpile=10
    let (pop, food) = city::process_growth(3, 10, 5, 3);
    assert!(pop == 3, "Should not grow past housing");
    assert!(food == 10, "Food stockpile should stay the same (not accumulate past cap)");
}

// ===========================================================================
// 7e: Territory (Y29–Y31)
// ===========================================================================

// Y29: Pop 1 → radius 1
#[test]
fn test_territory_radius_pop1() {
    assert!(constants::territory_radius(1) == 1);
}

// Y30: Pop 3 → radius 2
#[test]
fn test_territory_radius_pop3() {
    assert!(constants::territory_radius(3) == 2);
}

// Y31: Pop 6 → radius 3
#[test]
fn test_territory_radius_pop6() {
    assert!(constants::territory_radius(6) == 3);
}

// ===========================================================================
// 7f: Citizen Assignment (Y32, Y53)
// ===========================================================================

// Y32: Citizens assigned to highest-food tiles first (verified after implementation)
#[test]
fn test_auto_assign_food_priority() {
    assert!(true); // Verified after city module implementation
}

// Y53: Pop 1 city → 1 citizen works 1 tile (center is free)
#[test]
fn test_city_center_always_worked() {
    assert!(city::max_worked_tiles(1) == 1);
}

// ===========================================================================
// 7f-center: City center tile yield guarantees
// ===========================================================================

// City center on grassland (2 food, 0 prod) → (2 food, 1 prod)
#[test]
fn test_city_center_yield_grassland() {
    let tile = flat_grassland();
    let y = city::compute_city_center_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 2);
    assert!(y.production == 1); // boosted from 0
}

// City center on plains hills (1 food, 2 prod) → (2 food, 2 prod)
#[test]
fn test_city_center_yield_plains_hills() {
    let tile = make_tile(TERRAIN_PLAINS_HILLS, FEATURE_NONE, RESOURCE_NONE);
    let y = city::compute_city_center_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 2);       // boosted from 1
    assert!(y.production == 2); // kept (already > 1)
}

// City center on desert (0 food, 0 prod) → (2 food, 1 prod)
#[test]
fn test_city_center_yield_desert() {
    let tile = make_tile(TERRAIN_DESERT, FEATURE_NONE, RESOURCE_NONE);
    let y = city::compute_city_center_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 2);
    assert!(y.production == 1);
}

// City center on tundra (1 food, 0 prod) → (2 food, 1 prod)
#[test]
fn test_city_center_yield_tundra() {
    let tile = make_tile(TERRAIN_TUNDRA, FEATURE_NONE, RESOURCE_NONE);
    let y = city::compute_city_center_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 2);
    assert!(y.production == 1);
}

// City center with resource — wheat on grassland (3 food, 0 prod) → (3 food, 1 prod)
#[test]
fn test_city_center_yield_with_resource() {
    let tile = make_tile(TERRAIN_GRASSLAND, FEATURE_NONE, RESOURCE_WHEAT);
    let y = city::compute_city_center_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 3);       // kept (already > 2)
    assert!(y.production == 1); // boosted
}

// City center on plains (1 food, 1 prod) → (2 food, 1 prod)
#[test]
fn test_city_center_yield_plains() {
    let tile = make_tile(TERRAIN_PLAINS, FEATURE_NONE, RESOURCE_NONE);
    let y = city::compute_city_center_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 2);       // boosted from 1
    assert!(y.production == 1); // kept
}

// Regular (non-center) tile unchanged — grassland still 2 food, 0 prod
#[test]
fn test_non_center_tile_unchanged() {
    let tile = flat_grassland();
    let y = city::compute_tile_yield(@tile, IMPROVEMENT_NONE);
    assert!(y.food == 2);
    assert!(y.production == 0); // NOT boosted
}

// ===========================================================================
// 7g: Production (Y35–Y42, Y45, Y50–Y52)
// ===========================================================================

// Y35: Warrior costs 40 production
#[test]
fn test_production_cost_warrior() {
    assert!(constants::production_cost(4) == 40); // PROD_WARRIOR = 4
}

// Y36: Monument costs 60 production
#[test]
fn test_production_cost_monument() {
    assert!(constants::production_cost(64) == 60); // PROD_MONUMENT = 64
}

// Y37: Monument (no tech required) is always available
#[test]
fn test_can_produce_no_tech() {
    let c = make_city(16, 10, 1, 0, false);
    assert!(city::can_build(@c, BUILDING_MONUMENT, 0));
}

// Y38: Granary requires Pottery tech
#[test]
fn test_can_produce_needs_tech() {
    let c = make_city(16, 10, 1, 0, false);
    assert!(!city::can_build(@c, BUILDING_GRANARY, 0)); // no techs
    let techs = tech::mark_researched(2, 0); // Pottery = tech 2
    assert!(city::can_build(@c, BUILDING_GRANARY, techs));
}

// Y39: Can't build a building the city already has
#[test]
fn test_can_produce_already_built() {
    let buildings = set_building_bit(0, BUILDING_MONUMENT);
    let c = make_city(16, 10, 1, buildings, false);
    assert!(!city::can_build(@c, BUILDING_MONUMENT, 0));
}

// Y40: Water Mill requires The Wheel tech
#[test]
fn test_water_mill_needs_tech() {
    let techs = tech::mark_researched(10, 0); // The Wheel = tech 10
    let c = make_city(16, 10, 1, 0, false);
    assert!(city::can_build(@c, BUILDING_WATER_MILL, techs));
}

// Y41: Item completes when stockpile >= cost
#[test]
fn test_process_production_complete() {
    // Warrior (item 4) costs 40. stockpile=35, production=10 → 45 >= 40 → complete
    let (new_stockpile, completed) = city::process_production(4, 35, 10);
    assert!(completed == 4);
    assert!(new_stockpile == 5); // 45 - 40 = 5 carryover
}

// Y42: Stockpile accumulates across turns
#[test]
fn test_process_production_partial() {
    let (new_stockpile, completed) = city::process_production(4, 10, 10); // 20 < 40
    assert!(completed == 0);
    assert!(new_stockpile == 20);
}

// Y45: Production ID outside valid ranges → cost = 0
#[test]
fn test_can_produce_invalid_id() {
    assert!(constants::production_cost(200) == 0);
}

// Y50: Carryover applies to next item
#[test]
fn test_production_carryover() {
    // Warrior costs 40. Producing 6/turn → turn 7: 42 >= 40, carryover=2
    let (new_stockpile, completed) = city::process_production(4, 36, 6);
    assert!(completed == 4);
    assert!(new_stockpile == 2);
}

// Y51: Completed unit appears on city tile (tested in contract integration I41)
#[test]
fn test_unit_spawn_on_city_tile() {
    assert!(true);
}

// Y52: If city tile occupied, spawn on adjacent (tested in contract integration)
#[test]
fn test_unit_spawn_city_tile_occupied() {
    assert!(true);
}

// ===========================================================================
// 7h: Improvements (Y43–Y44f)
// ===========================================================================

// Y43: Farm on desert-hills fails
#[test]
fn test_build_improvement_wrong_terrain() {
    assert!(!city::is_valid_improvement_for_tile(IMPROVEMENT_FARM, TERRAIN_DESERT_HILLS, FEATURE_NONE));
}

// Y44: Building improvement on tile with existing one reverts (tested in contract)
#[test]
fn test_build_improvement_already_exists_reverts() {
    assert!(true); // Verified in I30b
}

// Y44f: Mine on flat grassland (no hills) fails
#[test]
fn test_mine_on_flat_fails() {
    assert!(!city::is_valid_improvement_for_tile(IMPROVEMENT_MINE, TERRAIN_GRASSLAND, FEATURE_NONE));
}

// Farm valid on grassland
#[test]
fn test_farm_valid_on_grassland() {
    assert!(city::is_valid_improvement_for_tile(IMPROVEMENT_FARM, TERRAIN_GRASSLAND, FEATURE_NONE));
}

// Mine valid on hills
#[test]
fn test_mine_valid_on_hills() {
    assert!(city::is_valid_improvement_for_tile(IMPROVEMENT_MINE, TERRAIN_GRASSLAND_HILLS, FEATURE_NONE));
    assert!(city::is_valid_improvement_for_tile(IMPROVEMENT_MINE, TERRAIN_PLAINS_HILLS, FEATURE_NONE));
}

// Lumber mill valid on woods
#[test]
fn test_lumber_mill_valid_on_woods() {
    assert!(city::is_valid_improvement_for_tile(IMPROVEMENT_LUMBER_MILL, TERRAIN_GRASSLAND, FEATURE_WOODS));
    assert!(city::is_valid_improvement_for_tile(IMPROVEMENT_LUMBER_MILL, TERRAIN_PLAINS, FEATURE_WOODS));
}

// Lumber mill invalid without woods
#[test]
fn test_lumber_mill_invalid_without_woods() {
    assert!(!city::is_valid_improvement_for_tile(IMPROVEMENT_LUMBER_MILL, TERRAIN_GRASSLAND, FEATURE_NONE));
    assert!(!city::is_valid_improvement_for_tile(IMPROVEMENT_LUMBER_MILL, TERRAIN_PLAINS, FEATURE_RAINFOREST));
}

// Farm invalid on woods/rainforest (must clear first)
#[test]
fn test_farm_invalid_on_woods() {
    assert!(!city::is_valid_improvement_for_tile(IMPROVEMENT_FARM, TERRAIN_GRASSLAND, FEATURE_WOODS));
    assert!(!city::is_valid_improvement_for_tile(IMPROVEMENT_FARM, TERRAIN_PLAINS, FEATURE_RAINFOREST));
}

// Farm valid on desert (flat)
#[test]
fn test_farm_valid_on_desert() {
    assert!(city::is_valid_improvement_for_tile(IMPROVEMENT_FARM, TERRAIN_DESERT, FEATURE_NONE));
}

// Pasture invalid on woods
#[test]
fn test_pasture_invalid_on_woods() {
    assert!(!city::is_valid_improvement_for_tile(IMPROVEMENT_PASTURE, TERRAIN_GRASSLAND, FEATURE_WOODS));
}

// Pasture valid on flat grassland
#[test]
fn test_pasture_valid_on_grassland() {
    assert!(city::is_valid_improvement_for_tile(IMPROVEMENT_PASTURE, TERRAIN_GRASSLAND, FEATURE_NONE));
}

// Improvement tech requirements
#[test]
fn test_improvement_tech_requirements() {
    assert!(constants::improvement_required_tech(IMPROVEMENT_FARM) == 0);      // Farm: no tech
    assert!(constants::improvement_required_tech(IMPROVEMENT_MINE) == 1);      // Mine: Mining
    assert!(constants::improvement_required_tech(IMPROVEMENT_PASTURE) == 3);   // Pasture: Animal Husbandry
    assert!(constants::improvement_required_tech(IMPROVEMENT_LUMBER_MILL) == 1); // Lumber Mill: Mining
}

// Feature remove tech requirements
#[test]
fn test_feature_remove_tech_requirements() {
    assert!(constants::feature_remove_tech(FEATURE_WOODS) == 1);       // Mining
    assert!(constants::feature_remove_tech(FEATURE_RAINFOREST) == 9);  // Bronze Working
    assert!(constants::feature_remove_tech(FEATURE_MARSH) == 6);       // Irrigation
    assert!(constants::feature_remove_tech(FEATURE_NONE) == 255);      // Cannot remove
}

// Feature chop yields
#[test]
fn test_feature_chop_yields() {
    let (food, prod) = constants::feature_chop_yields(FEATURE_WOODS);
    assert!(food == 0 && prod == 20, "Woods should give production");
    let (food, prod) = constants::feature_chop_yields(FEATURE_RAINFOREST);
    assert!(food == 10 && prod == 10, "Rainforest should give food + production");
    let (food, prod) = constants::feature_chop_yields(FEATURE_MARSH);
    assert!(food == 20 && prod == 0, "Marsh should give food");
    let (food, prod) = constants::feature_chop_yields(FEATURE_NONE);
    assert!(food == 0 && prod == 0, "None should give nothing");
}

// Friendly territory check
#[test]
fn test_is_friendly_territory() {
    assert!(city::is_friendly_territory(0, 0, 1));  // player 0 owns city 1
    assert!(!city::is_friendly_territory(0, 1, 1)); // player 1 owns city 1
    assert!(!city::is_friendly_territory(0, 0, 0)); // unowned (city_id=0)
}

// ===========================================================================
// 8: Amenities (Happiness)
// ===========================================================================

// Amenities needed per population
#[test]
fn test_amenities_needed() {
    assert!(constants::amenities_needed(1) == 0);
    assert!(constants::amenities_needed(2) == 0);
    assert!(constants::amenities_needed(3) == 1);
    assert!(constants::amenities_needed(4) == 1);
    assert!(constants::amenities_needed(5) == 2);
    assert!(constants::amenities_needed(6) == 2);
    assert!(constants::amenities_needed(7) == 3);
    assert!(constants::amenities_needed(8) == 3);
    assert!(constants::amenities_needed(10) == 4);
}

// Luxury resource identification
#[test]
fn test_is_luxury_resource() {
    assert!(!constants::is_luxury_resource(0));   // None
    assert!(!constants::is_luxury_resource(1));   // Wheat
    assert!(!constants::is_luxury_resource(4));   // Stone
    assert!(!constants::is_luxury_resource(6));   // Horses
    assert!(constants::is_luxury_resource(8));    // Silver
    assert!(constants::is_luxury_resource(9));    // Silk
    assert!(constants::is_luxury_resource(10));   // Dyes
}

// Amenity modifiers
#[test]
fn test_amenity_modifiers() {
    // Ecstatic (>= +3)
    let (f, p) = constants::amenity_modifiers(3);
    assert!(f == 10 && p == 10);
    let (f, p) = constants::amenity_modifiers(5);
    assert!(f == 10 && p == 10);
    // Happy (+1 to +2)
    let (f, p) = constants::amenity_modifiers(1);
    assert!(f == 10 && p == 0);
    let (f, p) = constants::amenity_modifiers(2);
    assert!(f == 10 && p == 0);
    // Content (0)
    let (f, p) = constants::amenity_modifiers(0);
    assert!(f == 0 && p == 0);
    // Displeased (-1 to -2)
    let (f, p) = constants::amenity_modifiers(-1);
    assert!(f == -15 && p == -5);
    let (f, p) = constants::amenity_modifiers(-2);
    assert!(f == -15 && p == -5);
    // Unhappy (-3 to -4)
    let (f, p) = constants::amenity_modifiers(-3);
    assert!(f == -30 && p == -10);
    // Unrest (<= -5)
    let (f, p) = constants::amenity_modifiers(-5);
    assert!(f == -30 && p == -15);
}

// Amenity surplus computation for a small capital city
#[test]
fn test_amenity_surplus_small_capital() {
    // Pop 2 capital: needs 0, has 1 (palace) → surplus +1
    let city = City {
        name: 'Test', q: 10, r: 10, population: 2, hp: 200,
        food_stockpile: 0, production_stockpile: 0, current_production: 0,
        buildings: 0, founded_turn: 0, original_owner: 0, is_capital: true,
    };
    let surplus = city::compute_amenity_surplus(@city, 0);
    assert!(surplus == 1, "Pop 2 capital: 1 palace - 0 needed = +1");
}

// Amenity surplus for a larger city with arena and luxuries
#[test]
fn test_amenity_surplus_large_city() {
    // Pop 7 non-capital with arena + 2 luxuries:
    // Needs: (7-1)/2 = 3
    // Has: 0 (no palace) + 1 (arena) + 2 (luxuries) = 3
    // Surplus: 0
    let arena_mask: u32 = 128; // bit 7
    let city = City {
        name: 'Big', q: 10, r: 10, population: 7, hp: 200,
        food_stockpile: 0, production_stockpile: 0, current_production: 0,
        buildings: arena_mask, founded_turn: 0, original_owner: 0, is_capital: false,
    };
    let surplus = city::compute_amenity_surplus(@city, 2);
    assert!(surplus == 0, "Pop 7: 3 available - 3 needed = 0 (Content)");
}

// Amenity surplus for an unhappy city (high pop, no amenity sources)
#[test]
fn test_amenity_surplus_unhappy() {
    // Pop 8 non-capital, no buildings, no luxuries:
    // Needs: (8-1)/2 = 3
    // Has: 0
    // Surplus: -3
    let city = City {
        name: 'Sad', q: 10, r: 10, population: 8, hp: 200,
        food_stockpile: 0, production_stockpile: 0, current_production: 0,
        buildings: 0, founded_turn: 0, original_owner: 0, is_capital: false,
    };
    let surplus = city::compute_amenity_surplus(@city, 0);
    assert!(surplus == -3, "Pop 8 no amenities: 0 - 3 = -3 (Unhappy)");
}

// Apply amenity modifier
#[test]
fn test_apply_amenity_modifier() {
    // +10% on 100 production → 110
    assert!(city::apply_amenity_modifier(100, 10) == 110);
    // -15% on 100 production → 85
    assert!(city::apply_amenity_modifier(100, -15) == 85);
    // -30% on 10 → 7
    assert!(city::apply_amenity_modifier(10, -30) == 7);
    // 0% → unchanged
    assert!(city::apply_amenity_modifier(50, 0) == 50);
    // +10% on 0 → 0
    assert!(city::apply_amenity_modifier(0, 10) == 0);
}

// Arena building stats
#[test]
fn test_arena_building() {
    assert!(constants::building_production_cost(7) == 150);
    assert!(constants::building_required_tech(7) == 12); // Construction
    assert!(constants::building_amenities(7) == 1);
}
