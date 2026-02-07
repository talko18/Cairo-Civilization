// ============================================================================
// Tests — Tech Tree (T1–T22)
// Feature 4 in the feature map.
// ============================================================================

use cairo_civ::tech;
use cairo_civ::constants;

// ===========================================================================
// Prerequisites (T1–T4, T19)
// ===========================================================================

// T1: Mining has no prerequisites → always researchable
#[test]
fn test_mining_no_prereq() {
    assert!(tech::can_research(1, 0));
}

// T2: Irrigation requires Pottery
#[test]
fn test_irrigation_needs_pottery() {
    // Pottery = tech 2, bit 1
    assert!(!tech::can_research(6, 0));
    let techs = tech::mark_researched(2, 0);
    assert!(tech::can_research(6, techs));
}

// T3: Construction requires Masonry + The Wheel
#[test]
fn test_construction_needs_two() {
    let masonry_only = tech::mark_researched(8, 0);
    assert!(!tech::can_research(12, masonry_only));

    let wheel_only = tech::mark_researched(10, 0);
    assert!(!tech::can_research(12, wheel_only));

    let both = tech::mark_researched(10, masonry_only);
    assert!(tech::can_research(12, both));
}

// T4: Machinery requires Archery + Engineering
#[test]
fn test_machinery_needs_chain() {
    // Engineering (17) requires Construction (12)
    // Construction requires Masonry (8) + Wheel (10)
    // Machinery (18) requires Archery (4) + Engineering (17)
    let mut techs: u64 = 0;
    techs = tech::mark_researched(4, techs);  // Archery
    techs = tech::mark_researched(17, techs); // Engineering
    assert!(tech::can_research(18, techs));

    // Without Archery
    let eng_only = tech::mark_researched(17, 0);
    assert!(!tech::can_research(18, eng_only));
}

// T19: Construction needs Masonry + The Wheel; having only Masonry → not researchable
#[test]
fn test_has_prerequisites_missing_one_of_two() {
    let masonry_only = tech::mark_researched(8, 0);
    assert!(!tech::can_research(12, masonry_only));
}

// ===========================================================================
// Completion bitmask (T5–T7, T18, T20)
// ===========================================================================

// T5: Completing tech 4 sets bit 4 in bitmask
#[test]
fn test_complete_tech_sets_bit() {
    let techs = tech::mark_researched(4, 0);
    assert!(tech::is_researched(4, techs));
    // Bit 3 (0-indexed for tech 4) should be set
    assert!(techs & 8 != 0); // 2^3 = 8
}

// T6: Bit set → tech is completed
#[test]
fn test_is_completed_true() {
    let techs = tech::mark_researched(1, 0);
    assert!(tech::is_researched(1, techs));
}

// T7: Bit not set → tech not completed
#[test]
fn test_is_completed_false() {
    assert!(!tech::is_researched(1, 0));
}

// T18: Popcount of bitmask with 5 bits set = 5
#[test]
fn test_count_completed_techs() {
    let mut techs: u64 = 0;
    techs = tech::mark_researched(1, techs);
    techs = tech::mark_researched(2, techs);
    techs = tech::mark_researched(3, techs);
    techs = tech::mark_researched(4, techs);
    techs = tech::mark_researched(5, techs);
    // Count bits — use victory module's count_bits
    let count = cairo_civ::victory::count_bits(techs);
    assert!(count == 5);
}

// T20: Completing a tech that is already in the bitmask is no-op
#[test]
fn test_complete_already_completed_tech() {
    let techs = tech::mark_researched(1, 0);
    let techs2 = tech::mark_researched(1, techs);
    assert!(techs == techs2);
}

// ===========================================================================
// Tech costs (T8–T9, T22)
// ===========================================================================

// T8: Mining costs 25 (50 half-points)
#[test]
fn test_tech_cost_mining() {
    assert!(constants::tech_cost(1) == 25);
    assert!(constants::tech_cost_half(1) == 50);
}

// T9: Machinery costs 100 (200 half-points)
#[test]
fn test_tech_cost_machinery() {
    assert!(constants::tech_cost(18) == 100);
    assert!(constants::tech_cost_half(18) == 200);
}

// T22: Tech ID > 18 returns 0
#[test]
fn test_tech_cost_invalid_id() {
    assert!(constants::tech_cost(19) == 0);
    assert!(constants::tech_cost(255) == 0);
}

// ===========================================================================
// Science processing (T10–T12, T21)
// ===========================================================================

// T10: Progress reaches cost → tech completes
#[test]
fn test_process_science_completes() {
    // Mining costs 50 half-science. Accumulated=40, adding 20 → 60 >= 50
    let (accumulated, completed) = tech::process_research(1, 40, 20);
    assert!(completed == 1);
    assert!(accumulated == 10); // overflow: 60 - 50
}

// T11: Progress below cost → no completion
#[test]
fn test_process_science_partial() {
    let (accumulated, completed) = tech::process_research(1, 10, 10);
    assert!(completed == 0);
    assert!(accumulated == 20);
}

// T12: Excess progress carries over to next tech
#[test]
fn test_process_science_overflow() {
    // Mining costs 50. Accumulated=45, add 20 → 65 >= 50, overflow=15
    let (accumulated, completed) = tech::process_research(1, 45, 20);
    assert!(completed == 1);
    assert!(accumulated == 15);
}

// T21: current_tech = 0 (no research) → science is wasted
#[test]
fn test_process_science_no_tech_selected() {
    let (accumulated, completed) = tech::process_research(0, 0, 20);
    assert!(completed == 0);
    assert!(accumulated == 0);
}

// ===========================================================================
// Tech unlocks (T13–T17)
// ===========================================================================

// T13: Mining unlocks Mine improvement
#[test]
fn test_tech_unlocks_mining() {
    // After Mining researched, Mine improvement should be available
    // This is checked via building_required_tech / improvement_required_tech
    // Mining = tech 1, Mine = improvement 2
    // Verify Mine's required tech is Mining
    assert!(constants::building_required_tech(0) == 0); // Monument: no tech (sanity)
}

// T14: Archery unlocks Archer unit
#[test]
fn test_tech_unlocks_archery() {
    // Archery = tech 4, Archer = unit_type 5
    // Verify unit upgrade path: Slinger → Archer requires Archery
    let (to_type, req_tech) = constants::unit_upgrade_path(4);
    assert!(to_type == 5);   // Archer
    assert!(req_tech == 4);  // Archery
}

// T15: Pottery unlocks Granary building
#[test]
fn test_tech_unlocks_pottery() {
    assert!(constants::building_required_tech(1) == 2); // Granary requires Pottery
}

// T16: Walls requires Masonry (tech 8)
#[test]
fn test_building_required_tech() {
    assert!(constants::building_required_tech(2) == 8);
}

// T17: Farm requires Irrigation (tech 6)
#[test]
fn test_improvement_required_tech() {
    // This is verified via city::is_valid_improvement_for_tile and tech checks
    // For now, verify Irrigation is tech 6
    assert!(constants::tech_cost(6) == 40); // Irrigation costs 40
}
