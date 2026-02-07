// ============================================================================
// City — City management, yields, and growth. Pure functions.
// See design/implementation/01_interfaces.md §Module 6.
// ============================================================================

use cairo_civ::types::{
    City, TileData, TileYield, CityYields, CityFoundError,
    TERRAIN_MOUNTAIN, TERRAIN_OCEAN, TERRAIN_COAST,
    FEATURE_WOODS, FEATURE_RAINFOREST,
    RESOURCE_WHEAT, RESOURCE_RICE, RESOURCE_CATTLE, RESOURCE_FISH,
    RESOURCE_STONE, RESOURCE_HORSES, RESOURCE_IRON,
    RESOURCE_SILVER, RESOURCE_SILK, RESOURCE_DYES,
    IMPROVEMENT_NONE, IMPROVEMENT_FARM, IMPROVEMENT_MINE, IMPROVEMENT_QUARRY,
    IMPROVEMENT_PASTURE, IMPROVEMENT_LUMBER_MILL,
    TERRAIN_GRASSLAND, TERRAIN_PLAINS,
    TERRAIN_GRASSLAND_HILLS, TERRAIN_PLAINS_HILLS, TERRAIN_DESERT_HILLS,
    TERRAIN_TUNDRA_HILLS, TERRAIN_SNOW_HILLS,
    BUILDING_GRANARY,
};
use cairo_civ::constants;
use cairo_civ::tech;
use cairo_civ::hex;

// ---------------------------------------------------------------------------
// City founding
// ---------------------------------------------------------------------------

/// Validate that a city can be founded at the given position.
pub fn validate_city_founding(
    q: u8,
    r: u8,
    tile: @TileData,
    existing_city_positions: Span<(u8, u8)>,
) -> Result<(), CityFoundError> {
    // Check bounds
    if !hex::in_bounds(q, r) {
        return Result::Err(CityFoundError::OutOfBounds);
    }

    // Check terrain
    let terrain = *tile.terrain;
    if terrain == TERRAIN_MOUNTAIN {
        return Result::Err(CityFoundError::OnMountain);
    }
    if terrain == TERRAIN_OCEAN || terrain == TERRAIN_COAST {
        return Result::Err(CityFoundError::OnWater);
    }

    // Check distance from existing cities
    let mut i: u32 = 0;
    let len = existing_city_positions.len();
    loop {
        if i >= len {
            break Result::Ok(());
        }
        let (eq, er) = *existing_city_positions.at(i);
        if hex::hex_distance(q, r, eq, er) < constants::MIN_CITY_DISTANCE {
            break Result::Err(CityFoundError::TooCloseToCity);
        }
        i += 1;
    }
}

// ---------------------------------------------------------------------------
// Tile yields
// ---------------------------------------------------------------------------

/// Compute yields for a single tile, considering terrain + feature + resource + improvement.
pub fn compute_tile_yield(
    tile: @TileData,
    improvement: u8,
) -> TileYield {
    let mut food = constants::base_terrain_yield_food(*tile.terrain);
    let mut production = constants::base_terrain_yield_production(*tile.terrain);
    let mut gold = constants::base_terrain_yield_gold(*tile.terrain);

    // Feature bonus
    let feature = *tile.feature;
    if feature == FEATURE_WOODS {
        production += 1;
    }

    // Resource bonus
    let resource = *tile.resource;
    if resource == RESOURCE_WHEAT || resource == RESOURCE_RICE || resource == RESOURCE_CATTLE {
        food += 1;
    } else if resource == RESOURCE_FISH {
        food += 1;
    } else if resource == RESOURCE_STONE || resource == RESOURCE_IRON {
        production += 1;
    } else if resource == RESOURCE_HORSES {
        production += 1;
    } else if resource == RESOURCE_SILVER {
        gold += 3;
    } else if resource == RESOURCE_SILK || resource == RESOURCE_DYES {
        gold += 2;
    }

    // Improvement bonus
    if improvement == IMPROVEMENT_FARM {
        food += 1;
    } else if improvement == IMPROVEMENT_MINE {
        production += 1;
    } else if improvement == IMPROVEMENT_QUARRY {
        production += 1;
    } else if improvement == IMPROVEMENT_PASTURE {
        production += 1;
    } else if improvement == IMPROVEMENT_LUMBER_MILL {
        production += 1;
    }

    TileYield { food, production, gold }
}

/// Compute aggregate yields for a city: sum of tile yields + building bonuses + palace.
pub fn compute_city_yields(
    city: @City,
    worked_tiles: Span<(TileData, u8)>,
) -> CityYields {
    let mut total_food: u16 = 0;
    let mut total_prod: u16 = 0;
    let mut total_gold: u16 = 0;
    let mut total_sci: u16 = 0;

    // Sum worked tile yields
    let mut i: u32 = 0;
    let len = worked_tiles.len();
    loop {
        if i >= len {
            break;
        }
        let (tile, imp) = *worked_tiles.at(i);
        let y = compute_tile_yield(@tile, imp);
        total_food += y.food.into();
        total_prod += y.production.into();
        total_gold += y.gold.into();
        i += 1;
    };

    // Palace bonus (capital)
    if *city.is_capital {
        total_prod += constants::PALACE_PRODUCTION_BONUS;
        total_gold += constants::PALACE_GOLD_BONUS;
        total_sci += constants::PALACE_HALF_SCIENCE_BONUS;
    }

    // Building bonuses
    let buildings = *city.buildings;
    if has_building(buildings, 3) {
        // Library: +2 half-science
        total_sci += 2;
    }
    if has_building(buildings, 4) {
        // Market: +3 gold
        total_gold += 3;
    }

    // Subtract food consumption
    let consumption: u16 = constants::FOOD_PER_CITIZEN * (*city.population).into();
    let food_surplus: u16 = if total_food > consumption {
        total_food - consumption
    } else {
        0
    };

    CityYields {
        food: food_surplus,
        production: total_prod,
        gold: total_gold,
        half_science: total_sci,
    }
}

// ---------------------------------------------------------------------------
// Population growth
// ---------------------------------------------------------------------------

/// Process population growth or starvation for a city.
/// Returns (new_population, new_food_stockpile).
pub fn process_growth(
    population: u8,
    food_stockpile: u16,
    food_surplus: i16,
    housing: u8,
) -> (u8, u16) {
    // Housing cap: can't grow past housing
    if population >= housing {
        // Still check for starvation at housing cap
        if food_surplus < 0 {
            let abs_surplus: u16 = (-food_surplus).try_into().unwrap();
            if abs_surplus > food_stockpile {
                if population > 1 {
                    return (population - 1, 0);
                }
                return (population, 0);
            }
            return (population, food_stockpile - abs_surplus);
        }
        return (population, food_stockpile);
    }

    if food_surplus >= 0 {
        let surplus_u16: u16 = food_surplus.try_into().unwrap();
        let new_stockpile: u16 = food_stockpile + surplus_u16;
        let threshold = constants::food_for_growth(population);
        if new_stockpile >= threshold {
            return (population + 1, new_stockpile - threshold);
        }
        return (population, new_stockpile);
    } else {
        // Negative surplus: starvation
        let abs_surplus: u16 = (-food_surplus).try_into().unwrap();
        if abs_surplus > food_stockpile {
            if population > 1 {
                return (population - 1, 0);
            }
            return (1, 0);
        }
        return (population, food_stockpile - abs_surplus);
    }
}

// ---------------------------------------------------------------------------
// Housing
// ---------------------------------------------------------------------------

/// Calculate housing capacity from water access and buildings.
pub fn compute_housing(
    city: @City,
    has_adjacent_river: bool,
    has_adjacent_coast: bool,
) -> u8 {
    let base = if has_adjacent_river {
        constants::HOUSING_BASE_RIVER
    } else if has_adjacent_coast {
        constants::HOUSING_BASE_COAST
    } else {
        constants::HOUSING_BASE_NO_WATER
    };

    let mut bonus: u8 = 0;
    if has_building(*city.buildings, BUILDING_GRANARY) {
        bonus += constants::HOUSING_GRANARY_BONUS;
    }

    base + bonus
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

/// Process production for a city.
/// Returns (new_production_stockpile, completed_item_id).
/// completed_item_id = 0 means production still in progress.
pub fn process_production(
    current_production: u8,
    production_stockpile: u16,
    production_per_turn: u16,
) -> (u16, u8) {
    if current_production == 0 {
        return (0, 0); // idle
    }
    let new_stockpile = production_stockpile + production_per_turn;
    let cost = constants::production_cost(current_production);
    if cost > 0 && new_stockpile >= cost {
        (new_stockpile - cost, current_production)
    } else {
        (new_stockpile, 0)
    }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/// Check if a building can be built in a city.
pub fn can_build(city: @City, building_bit: u8, completed_techs: u64) -> bool {
    // Already built?
    if has_building(*city.buildings, building_bit) {
        return false;
    }
    // Tech requirement?
    let req_tech = constants::building_required_tech(building_bit);
    if req_tech != 0 && !tech::is_researched(req_tech, completed_techs) {
        return false;
    }
    true
}

/// Calculate the number of workable tiles for a city's population.
pub fn max_worked_tiles(population: u8) -> u8 {
    population // each citizen works 1 tile
}

// ---------------------------------------------------------------------------
// Improvements
// ---------------------------------------------------------------------------

/// Check if an improvement is valid for the given tile terrain.
pub fn is_valid_improvement_for_tile(improvement_type: u8, terrain: u8, _feature: u8) -> bool {
    if improvement_type == IMPROVEMENT_FARM {
        // Farm on flat grassland or plains
        terrain == TERRAIN_GRASSLAND || terrain == TERRAIN_PLAINS
    } else if improvement_type == IMPROVEMENT_MINE {
        // Mine on hills
        terrain == TERRAIN_GRASSLAND_HILLS
            || terrain == TERRAIN_PLAINS_HILLS
            || terrain == TERRAIN_DESERT_HILLS
            || terrain == TERRAIN_TUNDRA_HILLS
            || terrain == TERRAIN_SNOW_HILLS
    } else if improvement_type == IMPROVEMENT_QUARRY {
        // Quarry on hills (same as mine for now)
        terrain == TERRAIN_GRASSLAND_HILLS
            || terrain == TERRAIN_PLAINS_HILLS
            || terrain == TERRAIN_DESERT_HILLS
    } else if improvement_type == IMPROVEMENT_PASTURE {
        // Pasture on flat grassland or plains
        terrain == TERRAIN_GRASSLAND || terrain == TERRAIN_PLAINS
    } else if improvement_type == IMPROVEMENT_LUMBER_MILL {
        // Lumber mill in woods (feature check would be more appropriate)
        terrain == TERRAIN_GRASSLAND || terrain == TERRAIN_PLAINS
    } else {
        false
    }
}

// ---------------------------------------------------------------------------
// Territory
// ---------------------------------------------------------------------------

/// Territory tiles within radius based on population.
pub fn territory_tiles(q: u8, r: u8, population: u8) -> Array<(u8, u8)> {
    hex::hexes_in_range(q, r, constants::territory_radius(population))
}

/// Calculate city HP regeneration per turn.
pub fn city_heal_per_turn(_city: @City) -> u8 {
    20 // Cities heal 20 HP per turn
}

/// Check if territory (player_idx) is friendly, neutral, or enemy.
pub fn is_friendly_territory(player: u8, tile_owner_player: u8, tile_owner_city_id: u32) -> bool {
    if tile_owner_city_id == 0 {
        return false; // unowned
    }
    player == tile_owner_player
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn has_building(buildings: u32, bit: u8) -> bool {
    let mask = pow2_u32(bit.into());
    (buildings & mask) != 0
}

fn pow2_u32(n: u32) -> u32 {
    if n == 0 {
        return 1;
    }
    let mut r: u32 = 1;
    let mut i: u32 = 0;
    loop {
        if i >= n {
            break;
        }
        r *= 2;
        i += 1;
    };
    r
}
