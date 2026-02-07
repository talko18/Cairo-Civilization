// ============================================================================
// Tests — Victory Conditions (W1–W14)
// Feature 10 in the feature map.
// ============================================================================

use cairo_civ::victory;
use cairo_civ::constants;

// ===========================================================================
// Domination (W1–W2)
// ===========================================================================

// W1: Capturing is_capital city → domination win
#[test]
fn test_domination_capital_captured() {
    assert!(victory::check_domination(true));
}

// W2: Capturing non-capital → no domination
#[test]
fn test_domination_non_capital() {
    assert!(!victory::check_domination(false));
}

// ===========================================================================
// Score (W3–W7, W10, W12–W14)
// ===========================================================================

// W3: Score formula matches spec
#[test]
fn test_score_calculation() {
    // Expected: pop*5 + cities*10 + techs*3 + tiles*2 + kills*4 + captured*15 + buildings*10
    let score = victory::calculate_score(10, 2, 5, 100, 3, 1, 4);
    let expected = 10 * constants::SCORE_PER_POP
                 + 2 * constants::SCORE_PER_CITY
                 + 5 * constants::SCORE_PER_TECH
                 + 100 * constants::SCORE_PER_TILE_EXPLORED
                 + 3 * constants::SCORE_PER_KILL
                 + 1 * constants::SCORE_PER_CAPTURED_CITY
                 + 4 * constants::SCORE_PER_BUILDING;
    assert!(score == expected);
}

// W4: +5 per population
#[test]
fn test_score_population_weight() {
    let s1 = victory::calculate_score(1, 0, 0, 0, 0, 0, 0);
    let s2 = victory::calculate_score(2, 0, 0, 0, 0, 0, 0);
    assert!(s2 - s1 == constants::SCORE_PER_POP);
}

// W5: +10 per city
#[test]
fn test_score_city_weight() {
    let s1 = victory::calculate_score(0, 1, 0, 0, 0, 0, 0);
    let s2 = victory::calculate_score(0, 2, 0, 0, 0, 0, 0);
    assert!(s2 - s1 == constants::SCORE_PER_CITY);
}

// W6: +3 per tech
#[test]
fn test_score_tech_weight() {
    let s1 = victory::calculate_score(0, 0, 1, 0, 0, 0, 0);
    let s2 = victory::calculate_score(0, 0, 2, 0, 0, 0, 0);
    assert!(s2 - s1 == constants::SCORE_PER_TECH);
}

// W7: +4 per kill
#[test]
fn test_score_kills_weight() {
    let s1 = victory::calculate_score(0, 0, 0, 0, 1, 0, 0);
    let s2 = victory::calculate_score(0, 0, 0, 0, 2, 0, 0);
    assert!(s2 - s1 == constants::SCORE_PER_KILL);
}

// W10: Player with no cities, no techs, no kills → score = 0
#[test]
fn test_score_all_zeros() {
    let score = victory::calculate_score(0, 0, 0, 0, 0, 0, 0);
    assert!(score == 0);
}

// W12: +15 per enemy city currently held
#[test]
fn test_score_captured_city_weight() {
    let s1 = victory::calculate_score(0, 0, 0, 0, 0, 1, 0);
    let s2 = victory::calculate_score(0, 0, 0, 0, 0, 2, 0);
    assert!(s2 - s1 == constants::SCORE_PER_CAPTURED_CITY);
}

// W13: +10 per building completed
#[test]
fn test_score_building_weight() {
    let s1 = victory::calculate_score(0, 0, 0, 0, 0, 0, 1);
    let s2 = victory::calculate_score(0, 0, 0, 0, 0, 0, 2);
    assert!(s2 - s1 == constants::SCORE_PER_BUILDING);
}

// W14: tiles_explored component calculated correctly
#[test]
fn test_score_tiles_explored_phase1() {
    let s = victory::calculate_score(0, 0, 0, 50, 0, 0, 0);
    assert!(s == 50 * constants::SCORE_PER_TILE_EXPLORED);
}

// ===========================================================================
// Turn limit (W8–W9, W11)
// ===========================================================================

// W8: Turn 150 → turn limit reached
#[test]
fn test_turn_limit_150() {
    assert!(victory::check_score_victory(150, constants::TURN_LIMIT));
}

// W9: Turn 149 → not yet
#[test]
fn test_turn_limit_149() {
    assert!(!victory::check_score_victory(149, constants::TURN_LIMIT));
}

// W11: Turn 0 → not at limit
#[test]
fn test_turn_limit_0() {
    assert!(!victory::check_score_victory(0, constants::TURN_LIMIT));
}

// ===========================================================================
// Winner determination
// ===========================================================================

#[test]
fn test_determine_winner_by_score() {
    let scores: Array<u32> = array![100, 250];
    let cities: Array<u32> = array![1, 2];
    let winner = victory::determine_winner(scores.span(), cities.span());
    assert!(winner == 1); // player 1 has higher score
}

#[test]
fn test_determine_winner_tie_by_cities() {
    let scores: Array<u32> = array![200, 200];
    let cities: Array<u32> = array![1, 3];
    let winner = victory::determine_winner(scores.span(), cities.span());
    assert!(winner == 1); // tie-break: more cities
}

#[test]
fn test_determine_winner_full_tie() {
    let scores: Array<u32> = array![200, 200];
    let cities: Array<u32> = array![2, 2];
    let winner = victory::determine_winner(scores.span(), cities.span());
    assert!(winner == 0); // full tie: player 0 wins
}

// ===========================================================================
// Bit counting
// ===========================================================================

#[test]
fn test_count_bits() {
    let mask: u64 = 0b10110; // 3 bits set
    assert!(victory::count_bits(mask) == 3);
}

#[test]
fn test_count_bits_zero() {
    assert!(victory::count_bits(0) == 0);
}

#[test]
fn test_count_bits_u32() {
    let mask: u32 = 0b111; // 3 bits set
    assert!(victory::count_bits_u32(mask) == 3);
}
