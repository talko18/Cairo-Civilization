// ============================================================================
// Economy — Gold accounting. Pure functions.
// See design/implementation/01_interfaces.md §Module 8.
// ============================================================================

use cairo_civ::constants;

/// Compute gold balance delta for a turn.
/// Returns net_gold (signed, can be negative).
pub fn compute_net_gold(
    total_gold_income: u32,
    military_unit_count: u32,
) -> i32 {
    let income: i32 = total_gold_income.try_into().unwrap();
    let expenses: i32 = (military_unit_count * constants::UNIT_MAINTENANCE_COST).try_into().unwrap();
    income - expenses
}

/// Update treasury. If treasury goes negative after applying net_gold,
/// clamp to 0 and return number of units to disband.
/// Returns (new_treasury, units_to_disband).
pub fn update_treasury(
    current_treasury: u32,
    net_gold: i32,
) -> (u32, u32) {
    let treasury_i: i32 = current_treasury.try_into().unwrap();
    let new_val: i32 = treasury_i + net_gold;

    if new_val >= 0 {
        let new_treasury: u32 = new_val.try_into().unwrap();
        (new_treasury, 0)
    } else {
        // Deficit: each unit costs 1 gold maintenance, so disband enough
        // to cover the deficit (at least 1)
        let deficit: u32 = (-new_val).try_into().unwrap();
        // Each disbanded unit saves 1 gold/turn in maintenance
        let disband = deficit; // 1 unit per gold of deficit
        (0, disband)
    }
}

/// Validate a gold purchase: treasury >= cost.
pub fn can_purchase(treasury: u32, cost: u32) -> bool {
    treasury >= cost
}

/// Process unit disbandment due to negative treasury.
/// Returns gold refund per disbanded unit.
pub fn disband_refund(_unit_type: u8) -> u32 {
    0 // no refund in MVP
}
