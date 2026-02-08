// ============================================================================
// Constants — All game constants, lookup tables, and static data.
// This is the single source of truth for game balance values.
// See design/game_rules/ for the design rationale behind each value.
// ============================================================================

// ---------------------------------------------------------------------------
// Game parameters
// ---------------------------------------------------------------------------

pub const TURN_LIMIT: u32 = 150;
pub const TURN_TIMEOUT_SECONDS: u64 = 300; // 5 minutes
pub const MAX_CONSECUTIVE_TIMEOUTS: u8 = 3;
pub const MIN_CITY_DISTANCE: u8 = 3;
pub const STARTING_GOLD: u32 = 0;
pub const BUILDER_STARTING_CHARGES: u8 = 3;
pub const CITY_STARTING_HP: u8 = 200;
pub const CITY_STARTING_POP: u8 = 1;
pub const CITY_CAPTURE_HP: u8 = 100;

// ---------------------------------------------------------------------------
// Unit stats: (CS, RS, Range, Movement, Vision, HP, Production Cost)
// ---------------------------------------------------------------------------

pub fn unit_combat_strength(unit_type: u8) -> u8 {
    match unit_type {
        0 => 0,   // Settler
        1 => 0,   // Builder
        2 => 10,  // Scout
        3 => 20,  // Warrior
        4 => 5,   // Slinger
        5 => 10,  // Archer
        _ => 0,
    }
}

pub fn unit_ranged_strength(unit_type: u8) -> u8 {
    match unit_type {
        4 => 15,  // Slinger
        5 => 25,  // Archer
        _ => 0,
    }
}

pub fn unit_range(unit_type: u8) -> u8 {
    match unit_type {
        4 => 1,  // Slinger
        5 => 2,  // Archer
        _ => 0,
    }
}

pub fn unit_movement(unit_type: u8) -> u8 {
    match unit_type {
        0 => 2,  // Settler
        1 => 2,  // Builder
        2 => 3,  // Scout
        3 => 2,  // Warrior
        4 => 2,  // Slinger
        5 => 2,  // Archer
        _ => 0,
    }
}

pub fn unit_max_hp(_unit_type: u8) -> u8 {
    100 // all units have 100 HP (Barracks bonus is applied separately)
}

pub fn unit_production_cost(unit_type: u8) -> u16 {
    match unit_type {
        0 => 80,  // Settler
        1 => 50,  // Builder
        2 => 30,  // Scout
        3 => 40,  // Warrior
        4 => 35,  // Slinger
        5 => 60,  // Archer
        _ => 0,
    }
}

pub fn is_civilian(unit_type: u8) -> bool {
    unit_type == 0 || unit_type == 1 // Settler, Builder
}

/// Tech required to produce a unit. 0 = no tech needed.
pub fn unit_required_tech(unit_type: u8) -> u8 {
    match unit_type {
        0 => 0,   // Settler: no tech
        1 => 0,   // Builder: no tech
        2 => 0,   // Scout: no tech
        3 => 0,   // Warrior: no tech
        4 => 0,   // Slinger: no tech
        5 => 4,   // Archer: Archery
        _ => 0,
    }
}

pub fn is_ranged_unit(unit_type: u8) -> bool {
    unit_type == 4 || unit_type == 5 // Slinger, Archer
}

// ---------------------------------------------------------------------------
// Building stats: (cost, tech_requirement)
// ---------------------------------------------------------------------------

pub fn building_production_cost(building_bit: u8) -> u16 {
    match building_bit {
        0 => 60,   // Monument
        1 => 65,   // Granary
        2 => 80,   // Walls
        3 => 90,   // Library
        4 => 100,  // Market
        5 => 90,   // Barracks
        6 => 80,   // Water Mill
        _ => 0,
    }
}

/// Tech ID required to build a building. 0 = no requirement.
pub fn building_required_tech(building_bit: u8) -> u8 {
    match building_bit {
        0 => 0,   // Monument: no tech
        1 => 2,   // Granary: Pottery
        2 => 8,   // Walls: Masonry
        3 => 7,   // Library: Writing
        4 => 11,  // Market: Currency
        5 => 9,   // Barracks: Bronze Working
        6 => 10,  // Water Mill: The Wheel
        _ => 0,
    }
}

// ---------------------------------------------------------------------------
// Production item cost lookup (units + buildings via range-separated IDs)
// ---------------------------------------------------------------------------

pub fn production_cost(item_id: u8) -> u16 {
    if item_id == 0 {
        return 0; // idle
    }
    if item_id >= 1 && item_id <= 63 {
        // Unit: item_id = unit_type + 1
        return unit_production_cost(item_id - 1);
    }
    if item_id >= 64 && item_id <= 127 {
        // Building: item_id = building_bit + 64
        return building_production_cost(item_id - 64);
    }
    0 // invalid
}

/// Gold purchase cost = production_cost × 4
pub fn purchase_cost(item_id: u8) -> u32 {
    production_cost(item_id).into() * 4
}

// ---------------------------------------------------------------------------
// Movement costs per terrain
// ---------------------------------------------------------------------------

/// Returns movement cost for entering a tile, or 0 if impassable.
pub fn terrain_movement_cost(terrain: u8, feature: u8) -> u8 {
    // Impassable terrains
    if terrain == 0 || terrain == 1 || terrain == 12 {
        return 0; // Ocean, Coast, Mountain
    }
    // Features that add cost
    if feature == 1 || feature == 2 || feature == 3 {
        return 2; // Woods, Rainforest, Marsh
    }
    // Hills
    if terrain == 3 || terrain == 5 || terrain == 7 || terrain == 9 || terrain == 11 {
        return 2;
    }
    // Flat land
    1
}

// ---------------------------------------------------------------------------
// Defense modifiers
// ---------------------------------------------------------------------------

pub const HILLS_DEFENSE_BONUS: u8 = 3;
pub const WOODS_DEFENSE_BONUS: u8 = 3;
pub const RIVER_CROSSING_DEFENSE_BONUS: u8 = 5;
pub const FORTIFY_1_TURN_BONUS: u8 = 3;
pub const FORTIFY_2_TURN_BONUS: u8 = 6;
pub const WALL_DEFENSE_BONUS: u8 = 10;

// ---------------------------------------------------------------------------
// City combat
// ---------------------------------------------------------------------------

pub const CITY_BASE_CS: u8 = 15;
pub const CITY_CS_PER_POP: u8 = 2;
pub const CITY_RANGED_RANGE: u8 = 2;

// ---------------------------------------------------------------------------
// Healing
// ---------------------------------------------------------------------------

pub const HEAL_FRIENDLY: u8 = 10;
pub const HEAL_NEUTRAL: u8 = 5;
pub const HEAL_ENEMY: u8 = 0;
pub const HEAL_FORTIFY_BONUS: u8 = 10;

// ---------------------------------------------------------------------------
// Housing
// ---------------------------------------------------------------------------

pub const HOUSING_BASE_NO_WATER: u8 = 2;
pub const HOUSING_BASE_COAST: u8 = 3;
pub const HOUSING_BASE_RIVER: u8 = 5;
pub const HOUSING_GRANARY_BONUS: u8 = 2;

// ---------------------------------------------------------------------------
// Population growth
// ---------------------------------------------------------------------------

pub const FOOD_PER_CITIZEN: u16 = 2;

/// food_for_growth = 15 + 6 * pop
pub fn food_for_growth(population: u8) -> u16 {
    15 + 6 * population.into()
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

pub const UNIT_MAINTENANCE_COST: u32 = 1; // per military unit per turn
pub const PALACE_GOLD_BONUS: u16 = 5;
pub const PALACE_PRODUCTION_BONUS: u16 = 2;
pub const PALACE_HALF_SCIENCE_BONUS: u16 = 4; // +2 science = +4 half-science

// ---------------------------------------------------------------------------
// Score weights
// ---------------------------------------------------------------------------

pub const SCORE_PER_POP: u32 = 5;
pub const SCORE_PER_CITY: u32 = 10;
pub const SCORE_PER_TECH: u32 = 3;
pub const SCORE_PER_TILE_EXPLORED: u32 = 2;
pub const SCORE_PER_KILL: u32 = 4;
pub const SCORE_PER_CAPTURED_CITY: u32 = 15;
pub const SCORE_PER_BUILDING: u32 = 10;

// ---------------------------------------------------------------------------
// Tech tree costs (science points, NOT half-points — caller doubles)
// ---------------------------------------------------------------------------

pub fn tech_cost(tech_id: u8) -> u32 {
    match tech_id {
        1 => 25,   // Mining
        2 => 25,   // Pottery
        3 => 25,   // Animal Husbandry
        4 => 35,   // Archery
        5 => 40,   // Sailing
        6 => 40,   // Irrigation
        7 => 45,   // Writing
        8 => 50,   // Masonry
        9 => 50,   // Bronze Working
        10 => 50,  // The Wheel
        11 => 60,  // Currency
        12 => 80,  // Construction
        13 => 80,  // Horseback Riding
        14 => 80,  // Iron Working
        15 => 80,  // Celestial Navigation
        16 => 100, // Mathematics
        17 => 100, // Engineering
        18 => 100, // Machinery
        _ => 0,
    }
}

/// Tech cost in half-science points (internal tracking unit).
pub fn tech_cost_half(tech_id: u8) -> u32 {
    tech_cost(tech_id) * 2
}

// ---------------------------------------------------------------------------
// Upgrade paths
// ---------------------------------------------------------------------------

/// Returns (target_unit_type, required_tech_id) or (0, 0) if no upgrade.
pub fn unit_upgrade_path(unit_type: u8) -> (u8, u8) {
    match unit_type {
        4 => (5, 4), // Slinger → Archer, requires Archery (tech 4)
        _ => (0, 0), // No upgrade path
    }
}

/// Upgrade gold cost = 50% of new unit's production cost.
pub fn unit_upgrade_cost(from_type: u8) -> u32 {
    let (to_type, _tech) = unit_upgrade_path(from_type);
    if to_type == 0 {
        return 0;
    }
    unit_production_cost(to_type).into() / 2
}

// ---------------------------------------------------------------------------
// Combat damage lookup table — 81 entries for delta -40 to +40
// base_damage = round(30 × e^(delta/25))
// Indexed as DAMAGE_TABLE[delta + 40]
// ---------------------------------------------------------------------------

pub fn damage_lookup(delta_plus_40: u8) -> u8 {
    // Full 81-entry table. Index 0 = delta -40, index 40 = delta 0, index 80 = delta +40.
    // Values: round(30 * e^((i-40)/25)), capped at 149.
    if delta_plus_40 > 80 {
        return 149; // clamp
    }
    let table: Array<u8> = array![
        6, 6, 7, 7, 7, 8, 8, 9, 9, 10,         // delta -40 to -31
        10, 11, 11, 12, 13, 13, 14, 15, 16, 17,  // delta -30 to -21
        17, 18, 19, 20, 22, 23, 24, 25, 27, 28,  // delta -20 to -11
        30, 31, 33, 35, 37, 39, 41, 43, 45, 48,  // delta -10 to -1
        50, 53, 55, 58, 61, 64, 68, 71, 75, 79,  // delta 0 to 9  (NOTE: index 40 = delta 0 = ~30)
        83, 87, 92, 96, 101, 106, 112, 118, 124, 130, // delta 10 to 19
        137, 144, 149, 149, 149, 149, 149, 149, 149, 149, // delta 20 to 29 (capped at 149)
        149, 149, 149, 149, 149, 149, 149, 149, 149, 149, // delta 30 to 39
        149                                                // delta 40
    ];
    *table.at(delta_plus_40.into())
}

// ---------------------------------------------------------------------------
// Terrain yields (base yields before features/resources/improvements)
// ---------------------------------------------------------------------------

pub fn base_terrain_yield_food(terrain: u8) -> u8 {
    match terrain {
        0 => 1,  // Ocean
        1 => 1,  // Coast
        2 => 2,  // Grassland
        3 => 2,  // Grassland Hills
        4 => 1,  // Plains
        5 => 1,  // Plains Hills
        6 => 0,  // Desert
        7 => 0,  // Desert Hills
        8 => 1,  // Tundra
        9 => 1,  // Tundra Hills
        10 => 0, // Snow
        11 => 0, // Snow Hills
        _ => 0,  // Mountain / invalid
    }
}

pub fn base_terrain_yield_production(terrain: u8) -> u8 {
    match terrain {
        3 => 1,  // Grassland Hills
        4 => 1,  // Plains
        5 => 2,  // Plains Hills
        7 => 1,  // Desert Hills
        9 => 1,  // Tundra Hills
        11 => 1, // Snow Hills
        _ => 0,
    }
}

pub fn base_terrain_yield_gold(terrain: u8) -> u8 {
    match terrain {
        1 => 1,  // Coast
        _ => 0,
    }
}

// ---------------------------------------------------------------------------
// Territory radius from population
// ---------------------------------------------------------------------------

pub fn territory_radius(population: u8) -> u8 {
    // Pop 1-2: radius 1, Pop 3-5: radius 2, Pop 6+: radius 3
    if population >= 6 {
        3
    } else if population >= 3 {
        2
    } else {
        1
    }
}
