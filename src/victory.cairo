// ============================================================================
// Victory — Victory condition checks. Pure functions.
// See design/implementation/01_interfaces.md §Module 10.
// ============================================================================

use cairo_civ::constants;

/// Check domination victory: player controls all original capitals.
pub fn check_domination(
    player_controls_all_capitals: bool,
) -> bool {
    player_controls_all_capitals
}

/// Check score victory at turn limit.
pub fn check_score_victory(
    current_turn: u32,
    turn_limit: u32,
) -> bool {
    current_turn >= turn_limit
}

/// Calculate player score from components.
pub fn calculate_score(
    total_population: u32,
    city_count: u32,
    tech_count: u32,
    tiles_explored: u32,
    kills: u32,
    captured_cities: u32,
    building_count: u32,
) -> u32 {
    total_population * constants::SCORE_PER_POP
    + city_count * constants::SCORE_PER_CITY
    + tech_count * constants::SCORE_PER_TECH
    + tiles_explored * constants::SCORE_PER_TILE_EXPLORED
    + kills * constants::SCORE_PER_KILL
    + captured_cities * constants::SCORE_PER_CAPTURED_CITY
    + building_count * constants::SCORE_PER_BUILDING
}

/// Determine winner by score (returns player index with highest score).
/// Tiebreaker: player with more cities. If still tied: player 0 wins.
pub fn determine_winner(scores: Span<u32>, city_counts: Span<u32>) -> u8 {
    let len = scores.len();
    if len == 0 {
        return 0;
    }
    let mut best_idx: u32 = 0;
    let mut best_score: u32 = *scores.at(0);
    let mut best_cities: u32 = *city_counts.at(0);

    let mut i: u32 = 1;
    loop {
        if i >= len {
            break;
        }
        let s = *scores.at(i);
        let c = *city_counts.at(i);
        if s > best_score {
            best_idx = i;
            best_score = s;
            best_cities = c;
        } else if s == best_score && c > best_cities {
            best_idx = i;
            best_cities = c;
        }
        // If tied on both score and cities, lower index wins (no update)
        i += 1;
    };
    best_idx.try_into().unwrap()
}

/// Count set bits in a u64 bitmask (for counting techs, buildings, etc).
pub fn count_bits(mask: u64) -> u32 {
    let mut count: u32 = 0;
    let mut m = mask;
    loop {
        if m == 0 {
            break;
        }
        if m & 1 != 0 {
            count += 1;
        }
        m = m / 2;
    };
    count
}

/// Count set bits in a u32 bitmask.
pub fn count_bits_u32(mask: u32) -> u32 {
    let mut count: u32 = 0;
    let mut m = mask;
    loop {
        if m == 0 {
            break;
        }
        if m & 1 != 0 {
            count += 1;
        }
        m = m / 2;
    };
    count
}
