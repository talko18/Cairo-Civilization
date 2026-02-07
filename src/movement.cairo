// ============================================================================
// Movement — Unit movement validation. Pure functions, no storage.
// See design/implementation/01_interfaces.md §Module 4.
// ============================================================================

use cairo_civ::types::{Unit, TileData, MoveError};
use cairo_civ::constants;
use cairo_civ::hex;

/// Return terrain movement cost. 0 = impassable.
pub fn tile_movement_cost(tile: @TileData) -> u8 {
    constants::terrain_movement_cost(*tile.terrain, *tile.feature)
}

/// Validate a single unit move. Returns remaining movement on success.
///
/// `dest_military_unit_type`: None = tile empty, Some(unit_type) = unit on tile
/// `dest_military_owner`: player index of the unit on the destination (if any)
/// `mover_player`: player index of the moving unit
pub fn validate_move(
    unit: @Unit,
    dest_q: u8,
    dest_r: u8,
    dest_tile: @TileData,
    dest_military_unit_type: Option<u8>,
    dest_military_owner: u8,
    mover_player: u8,
) -> Result<u8, MoveError> {
    // Check bounds
    if !hex::in_bounds(dest_q, dest_r) {
        return Result::Err(MoveError::OutOfBounds);
    }

    // Must be adjacent
    if hex::hex_distance(*unit.q, *unit.r, dest_q, dest_r) != 1 {
        return Result::Err(MoveError::NotAdjacent);
    }

    // Must have movement remaining
    let mp = *unit.movement_remaining;
    if mp == 0 {
        return Result::Err(MoveError::InsufficientMovement);
    }

    // Check terrain passability
    let cost = tile_movement_cost(dest_tile);
    if cost == 0 {
        return Result::Err(MoveError::Impassable);
    }

    // Check if enough MP
    if mp < cost {
        return Result::Err(MoveError::InsufficientMovement);
    }

    // Check destination occupancy
    match dest_military_unit_type {
        Option::Some(existing_type) => {
            if dest_military_owner == mover_player {
                // Same player — can only stack military on civilian (or vice versa)
                let mover_is_civilian = constants::is_civilian(*unit.unit_type);
                let dest_is_civilian = constants::is_civilian(existing_type);

                // Can't stack two military or two civilian units
                if mover_is_civilian == dest_is_civilian {
                    return Result::Err(MoveError::FriendlyUnitBlocking);
                }
                // Military onto civilian or civilian onto military — OK
            }
            // Enemy unit — this is an attack move, allow it through
            // (combat resolution handled separately)
        },
        Option::None => {
            // Empty tile — OK
        },
    }

    Result::Ok(mp - cost)
}

/// Check if movement crosses a river edge.
pub fn check_river_crossing(
    from_q: u8, from_r: u8,
    to_q: u8, to_r: u8,
    from_river_edges: u8,
) -> bool {
    hex::is_river_crossing(from_q, from_r, to_q, to_r, from_river_edges)
}

/// Check if unit can embark onto water (always false for MVP).
pub fn can_embark(_unit: @Unit) -> bool {
    false
}

/// Check zone of control: is the path through an enemy ZOC.
pub fn is_zone_of_control(
    _from_q: u8, _from_r: u8,
    _to_q: u8, _to_r: u8,
    _enemy_positions: Span<(u8, u8)>,
) -> bool {
    false // Not implemented in MVP
}
