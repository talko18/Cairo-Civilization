// ============================================================================
// Tests — Economy (E1–E14, E6b)
// Feature 8 in the feature map.
// ============================================================================

use cairo_civ::economy;
use cairo_civ::constants;
use cairo_civ::tech;

// ===========================================================================
// Income (E1–E2)
// ===========================================================================

// E1: Income from one city's gold yield
#[test]
fn test_income_single_city() {
    // City produces 5 gold, 0 military units → net = 5
    let net = economy::compute_net_gold(5, 0);
    assert!(net == 5);
}

// E2: Capital adds +5 gold (verified via constants)
#[test]
fn test_income_palace_bonus() {
    assert!(constants::PALACE_GOLD_BONUS == 5);
}

// ===========================================================================
// Expenses (E3–E4)
// ===========================================================================

// E3: 1 gold per advanced military unit (warriors/scouts are free)
#[test]
fn test_expenses_per_unit() {
    assert!(constants::UNIT_MAINTENANCE_COST == 1);
    let net = economy::compute_net_gold(10, 3); // 3 advanced units
    assert!(net == 7); // 10 - 3*1
}

// E4: Settlers/Builders don't cost maintenance
#[test]
fn test_expenses_civilians_free() {
    assert!(constants::is_civilian(0)); // Settler
    assert!(constants::is_civilian(1)); // Builder
    assert!(!constants::is_civilian(3)); // Warrior - not civilian
}

// E4b: Warriors and scouts don't cost maintenance, advanced units do
#[test]
fn test_maintenance_basic_units_free() {
    assert!(!constants::costs_maintenance(0)); // Settler: no
    assert!(!constants::costs_maintenance(1)); // Builder: no
    assert!(!constants::costs_maintenance(2)); // Scout: no
    assert!(!constants::costs_maintenance(3)); // Warrior: no (basic)
    assert!(constants::costs_maintenance(4));  // Slinger: yes (advanced)
    assert!(constants::costs_maintenance(5));  // Archer: yes (advanced)
}

// ===========================================================================
// Treasury (E5–E6, E6b, E14)
// ===========================================================================

// E5: Income > expenses → treasury grows
#[test]
fn test_positive_treasury() {
    let (new_treasury, disband) = economy::update_treasury(100, 10);
    assert!(new_treasury == 110);
    assert!(disband == 0);
}

// E6: Treasury < 0 → disband 1 unit
#[test]
fn test_negative_treasury_disband() {
    let (new_treasury, disband) = economy::update_treasury(5, -10);
    assert!(new_treasury == 0);
    assert!(disband > 0);
}

// E6b: Multiple military units, treasury < 0 → lowest HP disbanded
#[test]
fn test_disband_lowest_hp_first() {
    // Disband logic is in contract layer; here we verify disband count
    let (_, disband) = economy::update_treasury(0, -3);
    assert!(disband > 0);
}

// E14: Treasury = 0, income = expenses → no disband (not negative)
#[test]
fn test_treasury_exactly_zero() {
    let (new_treasury, disband) = economy::update_treasury(0, 0);
    assert!(new_treasury == 0);
    assert!(disband == 0);
}

// ===========================================================================
// Purchases (E7, E11)
// ===========================================================================

// E7: Purchase cost = production_cost × 4
#[test]
fn test_purchase_cost() {
    assert!(constants::purchase_cost(4) == 160); // Warrior: 40 * 4
    assert!(constants::purchase_cost(1) == 320); // Settler: 80 * 4
}

// E11: Buying a unit with less gold than purchase_cost fails
#[test]
fn test_purchase_insufficient_gold() {
    assert!(!economy::can_purchase(100, 160));
}

#[test]
fn test_can_purchase_sufficient() {
    assert!(economy::can_purchase(200, 160));
}

#[test]
fn test_can_purchase_exact() {
    assert!(economy::can_purchase(160, 160));
}

// ===========================================================================
// Upgrades (E8–E10, E12–E13)
// ===========================================================================

// E8: Slinger→Archer = 30 gold (60 / 2)
#[test]
fn test_upgrade_cost_slinger() {
    assert!(constants::unit_upgrade_cost(4) == 30);
}

// E9: Slinger upgradable when Archery researched
#[test]
fn test_can_upgrade_with_tech() {
    let (to_type, req_tech) = constants::unit_upgrade_path(4);
    assert!(to_type == 5);   // Archer
    assert!(req_tech == 4);  // Archery
    let techs = tech::mark_researched(4, 0);
    assert!(tech::is_researched(req_tech, techs));
}

// E10: Slinger not upgradable without Archery
#[test]
fn test_cant_upgrade_without_tech() {
    let (_to_type, req_tech) = constants::unit_upgrade_path(4);
    assert!(!tech::is_researched(req_tech, 0));
}

// E12: Warrior has no upgrade path → upgrade reverts
#[test]
fn test_upgrade_no_upgrade_path() {
    let (to_type, _) = constants::unit_upgrade_path(3); // Warrior
    assert!(to_type == 0); // no upgrade
}

// E13: Archer (already max tier for MVP) → upgrade reverts
#[test]
fn test_upgrade_already_max() {
    let (to_type, _) = constants::unit_upgrade_path(5); // Archer
    assert!(to_type == 0); // no further upgrade
}

// ===========================================================================
// Disband refund (MVP: no refund)
// ===========================================================================

#[test]
fn test_disband_refund_zero() {
    assert!(economy::disband_refund(3) == 0); // Warrior
    assert!(economy::disband_refund(5) == 0); // Archer
}
