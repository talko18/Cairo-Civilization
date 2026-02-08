// ============================================================================
// Tech — Technology research logic. Pure functions.
// See design/implementation/01_interfaces.md §Module 7.
// ============================================================================

use cairo_civ::constants;

/// Check if prerequisites for a tech are met.
pub fn can_research(tech_id: u8, completed_techs: u64) -> bool {
    if tech_id == 0 || tech_id > 18 {
        return false;
    }
    let prereqs = tech_prerequisites(tech_id);
    let len = prereqs.len();
    if len == 0 {
        return true;
    }
    let mut i: u32 = 0;
    loop {
        if i >= len {
            break true;
        }
        let prereq = *prereqs.at(i);
        if !is_researched(prereq, completed_techs) {
            break false;
        }
        i += 1;
    }
}

/// Process science per turn: accumulate half-science toward current research.
/// Returns (new_accumulated_half_science, completed_tech_id).
/// completed_tech_id = 0 means research still in progress.
pub fn process_research(
    current_tech: u8,
    accumulated_half_science: u32,
    half_science_per_turn: u16,
) -> (u32, u8) {
    if current_tech == 0 {
        return (0, 0); // No tech selected, science is wasted
    }
    let new_accumulated = accumulated_half_science + half_science_per_turn.into();
    let cost = constants::tech_cost_half(current_tech);

    if cost > 0 && new_accumulated >= cost {
        (new_accumulated - cost, current_tech)
    } else {
        (new_accumulated, 0)
    }
}

/// Check if a tech is already completed.
pub fn is_researched(tech_id: u8, completed_techs: u64) -> bool {
    if tech_id == 0 || tech_id > 64 {
        return false;
    }
    let mask: u64 = 1_u64 * pow2((tech_id - 1).into());
    (completed_techs & mask) != 0
}

/// Mark a tech as completed. Returns updated bitmask.
pub fn mark_researched(tech_id: u8, completed_techs: u64) -> u64 {
    if tech_id == 0 || tech_id > 64 {
        return completed_techs;
    }
    let mask: u64 = 1_u64 * pow2((tech_id - 1).into());
    completed_techs | mask
}

/// Get tech prerequisites. Returns array of tech IDs.
pub fn tech_prerequisites(tech_id: u8) -> Array<u8> {
    match tech_id {
        1 => array![],          // Mining: none
        2 => array![],          // Pottery: none
        3 => array![],          // Animal Husbandry: none
        4 => array![3],         // Archery: Animal Husbandry
        5 => array![],          // Sailing: none
        6 => array![2],         // Irrigation: Pottery
        7 => array![2],         // Writing: Pottery
        8 => array![1],         // Masonry: Mining
        9 => array![1],         // Bronze Working: Mining
        10 => array![1],        // The Wheel: Mining
        11 => array![7],        // Currency: Writing
        12 => array![8, 10],    // Construction: Masonry + The Wheel
        13 => array![3],        // Horseback Riding: Animal Husbandry
        14 => array![9],        // Iron Working: Bronze Working
        15 => array![5],        // Celestial Navigation: Sailing
        16 => array![11, 12],   // Mathematics: Currency + Construction
        17 => array![12],       // Engineering: Construction
        18 => array![4, 17],    // Machinery: Archery + Engineering
        _ => array![],
    }
}

// Utility: 2^n for bitmask operations (up to n=63).
fn pow2(n: u32) -> u64 {
    if n == 0 {
        return 1;
    }
    let mut result: u64 = 1;
    let mut i: u32 = 0;
    loop {
        if i >= n {
            break;
        }
        result *= 2;
        i += 1;
    };
    result
}
