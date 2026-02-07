// ============================================================================
// Combat — Damage calculation and combat resolution. Pure functions.
// See design/implementation/01_interfaces.md §Module 5.
// ============================================================================

use cairo_civ::types::{Unit, TileData, CombatResult, City};
use cairo_civ::constants;

// ---------------------------------------------------------------------------
// Defense CS calculation
// ---------------------------------------------------------------------------

/// Compute defender's effective combat strength including terrain/fortify/river modifiers.
fn defense_cs(unit_type: u8, tile: @TileData, fortify_turns: u8, is_river_crossing: bool) -> u8 {
    let mut cs: u8 = constants::unit_combat_strength(unit_type);

    // Hills defense bonus: terrains 3,5,7,9,11 are hill variants
    let terrain = *tile.terrain;
    if terrain == 3 || terrain == 5 || terrain == 7 || terrain == 9 || terrain == 11 {
        cs += constants::HILLS_DEFENSE_BONUS;
    }

    // Woods defense bonus
    if *tile.feature == 1 { // FEATURE_WOODS
        cs += constants::WOODS_DEFENSE_BONUS;
    }

    // Fortify bonus
    if fortify_turns >= 2 {
        cs += constants::FORTIFY_2_TURN_BONUS;
    } else if fortify_turns == 1 {
        cs += constants::FORTIFY_1_TURN_BONUS;
    }

    // River crossing gives defender a bonus
    if is_river_crossing {
        cs += constants::RIVER_CROSSING_DEFENSE_BONUS;
    }

    cs
}

/// Compute base damage from the lookup table.
/// delta = attacker_cs - defender_cs, clamped to [-40, +40].
fn compute_base_damage(attacker_cs: u8, defender_cs: u8) -> u8 {
    let delta: i16 = attacker_cs.into() - defender_cs.into();
    let clamped: i16 = if delta < -40 {
        0
    } else if delta > 40 {
        80
    } else {
        delta + 40
    };
    let idx: u8 = clamped.try_into().unwrap();
    constants::damage_lookup(idx)
}

/// Scale base damage by attacker's current HP percentage.
/// damage = base * hp / 100
fn scale_damage(base: u8, hp: u8) -> u8 {
    let dmg: u16 = (Into::<u8, u16>::into(base) * Into::<u8, u16>::into(hp)) / 100;
    if dmg > 255 {
        255
    } else {
        dmg.try_into().unwrap()
    }
}

// ---------------------------------------------------------------------------
// Melee combat
// ---------------------------------------------------------------------------

/// Resolve melee combat between attacker and defender.
/// Both units deal and take damage simultaneously.
pub fn resolve_melee(
    attacker: @Unit,
    defender: @Unit,
    defender_tile: @TileData,
    defender_fortify_turns: u8,
    is_river_crossing: bool,
) -> CombatResult {
    let atk_cs = constants::unit_combat_strength(*attacker.unit_type);
    let def_cs = defense_cs(*defender.unit_type, defender_tile, defender_fortify_turns, is_river_crossing);

    // Attacker → defender damage
    let base_to_def = compute_base_damage(atk_cs, def_cs);
    let dmg_to_def = scale_damage(base_to_def, *attacker.hp);

    // Defender → attacker counter-damage (attacker gets no terrain bonus)
    let base_to_atk = compute_base_damage(def_cs, atk_cs);
    let dmg_to_atk = scale_damage(base_to_atk, *defender.hp);

    CombatResult {
        damage_to_defender: dmg_to_def,
        damage_to_attacker: dmg_to_atk,
        defender_killed: dmg_to_def >= *defender.hp,
        attacker_killed: dmg_to_atk >= *attacker.hp,
    }
}

// ---------------------------------------------------------------------------
// Ranged combat
// ---------------------------------------------------------------------------

/// Resolve ranged combat: attacker uses ranged_strength, takes no counter-damage.
pub fn resolve_ranged(
    attacker: @Unit,
    defender: @Unit,
    defender_tile: @TileData,
    defender_fortify_turns: u8,
) -> CombatResult {
    let atk_rs = constants::unit_ranged_strength(*attacker.unit_type);
    let def_cs = defense_cs(*defender.unit_type, defender_tile, defender_fortify_turns, false);

    let base = compute_base_damage(atk_rs, def_cs);
    let dmg = scale_damage(base, *attacker.hp);

    CombatResult {
        damage_to_defender: dmg,
        damage_to_attacker: 0,
        defender_killed: dmg >= *defender.hp,
        attacker_killed: false,
    }
}

// ---------------------------------------------------------------------------
// City combat
// ---------------------------------------------------------------------------

/// Resolve melee attack against a city.
pub fn resolve_city_melee(
    attacker: @Unit,
    city: @City,
    has_walls: bool,
) -> CombatResult {
    let atk_cs = constants::unit_combat_strength(*attacker.unit_type);
    let def_cs = city_combat_strength(*city.population, has_walls);

    let base_to_def = compute_base_damage(atk_cs, def_cs);
    let dmg_to_city = scale_damage(base_to_def, *attacker.hp);

    let base_to_atk = compute_base_damage(def_cs, atk_cs);
    let dmg_to_atk = scale_damage(base_to_atk, *city.hp);

    CombatResult {
        damage_to_defender: dmg_to_city,
        damage_to_attacker: dmg_to_atk,
        defender_killed: dmg_to_city >= *city.hp,
        attacker_killed: dmg_to_atk >= *attacker.hp,
    }
}

/// Resolve ranged attack against a city.
pub fn resolve_city_ranged(
    attacker: @Unit,
    city: @City,
    has_walls: bool,
) -> CombatResult {
    let atk_rs = constants::unit_ranged_strength(*attacker.unit_type);
    let def_cs = city_combat_strength(*city.population, has_walls);

    let base = compute_base_damage(atk_rs, def_cs);
    let dmg = scale_damage(base, *attacker.hp);

    CombatResult {
        damage_to_defender: dmg,
        damage_to_attacker: 0,
        defender_killed: dmg >= *city.hp,
        attacker_killed: false,
    }
}

/// City ranged attack against a unit (requires walls).
pub fn resolve_city_defense_ranged(
    city: @City,
    target: @Unit,
    target_tile: @TileData,
    target_fortify_turns: u8,
    has_walls: bool,
) -> CombatResult {
    if !has_walls {
        return CombatResult {
            damage_to_defender: 0, damage_to_attacker: 0,
            defender_killed: false, attacker_killed: false,
        };
    }

    let city_rs = city_ranged_strength(*city.population, has_walls);
    let def_cs = defense_cs(*target.unit_type, target_tile, target_fortify_turns, false);

    let base = compute_base_damage(city_rs, def_cs);
    let dmg = scale_damage(base, *city.hp);

    CombatResult {
        damage_to_defender: dmg, // damage to the target unit
        damage_to_attacker: 0,  // city takes no counter-damage from ranged
        defender_killed: dmg >= *target.hp,
        attacker_killed: false,
    }
}

// ---------------------------------------------------------------------------
// Combat strength queries
// ---------------------------------------------------------------------------

/// Calculate effective CS with all modifiers (public interface for contract).
pub fn effective_combat_strength(
    unit: @Unit,
    tile: @TileData,
    fortify_turns: u8,
    _terrain_bonus: bool,
    river_bonus: bool,
) -> u8 {
    defense_cs(*unit.unit_type, tile, fortify_turns, river_bonus)
}

/// City combat strength: 15 + pop*2 + wall_bonus.
pub fn city_combat_strength(population: u8, has_walls: bool) -> u8 {
    let mut cs = constants::CITY_BASE_CS + population * constants::CITY_CS_PER_POP;
    if has_walls {
        cs += constants::WALL_DEFENSE_BONUS;
    }
    cs
}

/// City ranged strength. Requires walls; equals city_combat_strength.
pub fn city_ranged_strength(population: u8, has_walls: bool) -> u8 {
    if !has_walls {
        return 0;
    }
    city_combat_strength(population, has_walls)
}
