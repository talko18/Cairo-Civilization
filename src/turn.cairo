// ============================================================================
// Turn — End-of-turn processing and turn validation. Pure functions.
// See design/implementation/01_interfaces.md §Module 9.
// ============================================================================

use cairo_civ::types::{Unit, City};
use cairo_civ::constants;

/// Validate turn sequence: player_index must match expected next player.
pub fn validate_turn_order(
    _current_turn: u32,
    turn_player: u8,
    expected_player: u8,
) -> bool {
    turn_player == expected_player
}

/// Process unit healing at end of turn. Returns new HP.
///
/// Healing rates:
///   Friendly territory: +10 HP
///   Neutral territory:  +5 HP
///   Enemy territory:    +0 HP
///   Fortified bonus:    +10 HP extra
///
/// HP capped at 100 (normal max).
pub fn heal_unit(
    unit: @Unit,
    in_friendly_territory: bool,
    in_enemy_territory: bool,
    is_fortified: bool,
) -> u8 {
    let hp = *unit.hp;
    if hp == 0 {
        return 0; // dead stays dead
    }

    let base_heal = if in_enemy_territory {
        constants::HEAL_ENEMY
    } else if in_friendly_territory {
        constants::HEAL_FRIENDLY
    } else {
        constants::HEAL_NEUTRAL
    };

    let fortify_bonus = if is_fortified {
        constants::HEAL_FORTIFY_BONUS
    } else {
        0_u8
    };

    let total_heal = base_heal + fortify_bonus;
    let new_hp = hp + total_heal;

    // Cap at 100 (normal max). Units created with 110 HP (barracks)
    // heal up to 100, not back to 110.
    let max_hp = constants::unit_max_hp(*unit.unit_type); // 100
    if new_hp > max_hp {
        // Don't reduce HP if already above max (e.g., barracks 110 HP unit undamaged)
        if hp >= max_hp {
            hp // stay at current HP
        } else {
            max_hp
        }
    } else {
        new_hp
    }
}

/// Process city HP regeneration at end of turn. Returns new HP.
pub fn heal_city(city: @City) -> u8 {
    let new_hp = *city.hp + 20_u8;
    if new_hp > 200 {
        200
    } else {
        new_hp
    }
}

/// Reset all unit movement points at start of turn.
/// Returns the unit's max movement for its type.
pub fn reset_movement(unit: @Unit) -> u8 {
    constants::unit_movement(*unit.unit_type)
}

/// Check if a player has timed out.
pub fn check_timeout(
    last_action_timestamp: u64,
    current_timestamp: u64,
    timeout_seconds: u64,
) -> bool {
    current_timestamp > last_action_timestamp + timeout_seconds
}

/// Determine next player index in turn order (2 players for MVP).
pub fn next_player(current_player: u8, player_count: u8) -> u8 {
    (current_player + 1) % player_count
}

/// Check if a unit can still act this turn (has movement or actions).
pub fn unit_can_act(unit: @Unit) -> bool {
    *unit.movement_remaining > 0
}
