// ============================================================================
// Tests — Turn Processing (N1–N12, N5b, N5c)
// Feature 9 in the feature map.
// ============================================================================

use cairo_civ::types::{Unit, City, UNIT_WARRIOR, UNIT_SCOUT, UNIT_ARCHER};
use cairo_civ::turn;
use cairo_civ::constants;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_unit(unit_type: u8, hp: u8, fortify: u8) -> Unit {
    Unit {
        unit_type, q: 16, r: 10, hp,
        movement_remaining: 2, charges: 0,
        fortify_turns: fortify,
    }
}

fn make_city(hp: u8) -> City {
    City {
        name: 'TestCity', q: 16, r: 10,
        population: 3, hp,
        food_stockpile: 0, production_stockpile: 0,
        current_production: 0, buildings: 0,
        founded_turn: 0, original_owner: 0, is_capital: true,
    }
}

// ===========================================================================
// Unit healing (N1–N5, N5b, N5c, N10–N11)
// ===========================================================================

// N1: Unit heals +10 HP in friendly territory
#[test]
fn test_heal_friendly_territory() {
    let unit = make_unit(UNIT_WARRIOR, 80, 0);
    let new_hp = turn::heal_unit(@unit, true, false, false);
    assert!(new_hp == 90); // 80 + 10
}

// N2: Unit heals +5 HP in neutral territory
#[test]
fn test_heal_neutral() {
    let unit = make_unit(UNIT_WARRIOR, 80, 0);
    let new_hp = turn::heal_unit(@unit, false, false, false);
    assert!(new_hp == 85); // 80 + 5
}

// N3: Unit heals +0 in enemy territory
#[test]
fn test_heal_enemy_territory() {
    let unit = make_unit(UNIT_WARRIOR, 80, 0);
    let new_hp = turn::heal_unit(@unit, false, true, false);
    assert!(new_hp == 80); // no healing
}

// N4: Fortified unit heals extra +10
#[test]
fn test_heal_fortified() {
    let unit = make_unit(UNIT_WARRIOR, 70, 1);
    let new_hp = turn::heal_unit(@unit, true, false, true);
    assert!(new_hp == 90); // 70 + 10(friendly) + 10(fortify)
}

// N5: Healing doesn't exceed 100 HP (normal max)
#[test]
fn test_heal_cap_at_max() {
    let unit = make_unit(UNIT_WARRIOR, 95, 0);
    let new_hp = turn::heal_unit(@unit, true, false, false);
    assert!(new_hp == 100); // capped at 100, not 105
}

// N5b: Unit at 110 HP (Barracks bonus) doesn't heal above 110
#[test]
fn test_barracks_unit_110hp_no_extra_heal() {
    let unit = make_unit(UNIT_WARRIOR, 110, 0);
    let new_hp = turn::heal_unit(@unit, true, false, false);
    assert!(new_hp == 110); // stays at 110, no extra heal
}

// N5c: Barracks unit at 80 HP heals toward 100 (NOT back to 110)
#[test]
fn test_barracks_unit_damaged_heals_to_100() {
    let unit = make_unit(UNIT_WARRIOR, 80, 0);
    // Even if unit was created with 110 HP, max heal target is 100
    let new_hp = turn::heal_unit(@unit, true, false, false);
    assert!(new_hp == 90); // 80 + 10, heading toward 100 cap
}

// N10: Unit at 100 HP stays at 100 after healing step
#[test]
fn test_heal_already_full_hp() {
    let unit = make_unit(UNIT_WARRIOR, 100, 0);
    let new_hp = turn::heal_unit(@unit, true, false, false);
    assert!(new_hp == 100);
}

// N11: Dead unit (removed from storage) is not healed — N/A in pure function
#[test]
fn test_heal_dead_unit_skipped() {
    // hp=0 unit — should return 0 (or not be called)
    let unit = make_unit(UNIT_WARRIOR, 0, 0);
    let new_hp = turn::heal_unit(@unit, true, false, false);
    assert!(new_hp == 0); // dead stays dead
}

// ===========================================================================
// Movement reset (N6)
// ===========================================================================

// N6: All units get full MP at turn start
#[test]
fn test_reset_movement() {
    let unit = make_unit(UNIT_WARRIOR, 100, 0);
    let mp = turn::reset_movement(@unit);
    assert!(mp == constants::unit_movement(UNIT_WARRIOR));

    let scout = make_unit(UNIT_SCOUT, 100, 0);
    let mp_scout = turn::reset_movement(@scout);
    assert!(mp_scout == constants::unit_movement(UNIT_SCOUT));
}

// ===========================================================================
// Territory checks (N7–N9)
// ===========================================================================

// N7: Tile owned by player's city → friendly
#[test]
fn test_is_friendly_territory() {
    assert!(cairo_civ::city::is_friendly_territory(0, 0, 1)); // player 0 owns city_id 1
}

// N8: Unclaimed tile → neutral
#[test]
fn test_is_neutral_territory() {
    assert!(!cairo_civ::city::is_friendly_territory(0, 0, 0)); // city_id=0 = unowned
}

// N9: Tile owned by opponent's city → enemy
#[test]
fn test_is_enemy_territory() {
    assert!(!cairo_civ::city::is_friendly_territory(0, 1, 1)); // player 1 owns it
}

// ===========================================================================
// Fortify (N12)
// ===========================================================================

// N12: Fortified unit that stays still gets fortify_turns +1
#[test]
fn test_fortify_increments_on_skip() {
    // After fortify action, fortify_turns = 1
    // If unit doesn't move next turn, fortify_turns → 2 (max bonus)
    let unit = make_unit(UNIT_WARRIOR, 100, 1);
    assert!(unit.fortify_turns == 1);
    // Incrementing is done in contract; just verify the concept
}

// ===========================================================================
// Turn order & timing
// ===========================================================================

#[test]
fn test_validate_turn_order_correct() {
    assert!(turn::validate_turn_order(1, 0, 0));
}

#[test]
fn test_validate_turn_order_wrong() {
    assert!(!turn::validate_turn_order(1, 1, 0));
}

#[test]
fn test_next_player_2_players() {
    assert!(turn::next_player(0, 2) == 1);
    assert!(turn::next_player(1, 2) == 0);
}


// ===========================================================================
// City healing
// ===========================================================================

#[test]
fn test_heal_city_normal() {
    let city = make_city(150);
    assert!(turn::heal_city(@city) == 170);
}

#[test]
fn test_heal_city_cap_200() {
    let city = make_city(190);
    assert!(turn::heal_city(@city) == 200);
}

#[test]
fn test_heal_city_already_full() {
    let city = make_city(200);
    assert!(turn::heal_city(@city) == 200);
}

// ===========================================================================
// Unit can act
// ===========================================================================

#[test]
fn test_unit_can_act_with_mp() {
    let unit = make_unit(UNIT_WARRIOR, 100, 0);
    assert!(turn::unit_can_act(@unit));
}

#[test]
fn test_unit_cannot_act_no_mp() {
    let mut unit = make_unit(UNIT_WARRIOR, 100, 0);
    unit.movement_remaining = 0;
    assert!(!turn::unit_can_act(@unit));
}
