# Test Plan

Three layers: **unit tests** (pure functions), **integration tests** (contract calls), **system tests** (full game scenarios). Plus a **manual testing guide** for UI interaction.

All Cairo tests use `#[test]` attribute and run via `scarb test`.

---

## 1. Unit Tests

Each module has its own test file. Tests are pure — no contract deployment, no storage.

### 1.1 `test_hex` — Hex Math

| # | Test | What It Verifies |
|---|---|---|
| H1 | `test_distance_same_tile` | distance(a, a) == 0 |
| H2 | `test_distance_adjacent` | distance between neighbors == 1 |
| H3 | `test_distance_two_apart` | distance across 2 hexes == 2 |
| H4 | `test_distance_diagonal` | distance along diagonal direction |
| H5 | `test_distance_symmetric` | distance(a,b) == distance(b,a) |
| H6 | `test_neighbors_center` | 6 neighbors returned for center tile |
| H7 | `test_neighbors_corner` | fewer neighbors at map corner (out-of-bounds filtered) |
| H8 | `test_neighbors_edge` | edge tile has fewer valid neighbors |
| H9 | `test_in_bounds_valid` | (16, 10) is in bounds for 32x20 |
| H10 | `test_in_bounds_invalid` | (33, 0) is out of bounds |
| H11 | `test_in_bounds_zero` | (0, 0) is in bounds |
| H12 | `test_los_clear` | LOS between two flat tiles, no obstacles |
| H13 | `test_los_blocked_mountain` | LOS blocked by mountain between source and target |
| H14 | `test_los_blocked_woods` | LOS blocked by woods between (not at endpoints) |
| H15 | `test_los_woods_at_endpoint` | Woods at source or target do NOT block LOS |
| H16 | `test_los_adjacent` | Adjacent tiles always have LOS |
| H17 | `test_hexes_in_range_radius1` | Returns 7 tiles (center + 6 neighbors) |
| H18 | `test_hexes_in_range_radius2` | Returns 19 tiles for radius 2 |
| H19 | `test_hexes_in_range_at_edge` | Clips to map bounds at edges |
| H20 | `test_river_crossing` | Correctly detects river edge from bitmask |
| H21 | `test_no_river_crossing` | No river between two tiles |
| H22 | `test_axial_to_storage` | axial(-16, 0) → storage(0, 0) |
| H23 | `test_storage_to_axial` | storage(16, 10) → axial(0, 10) |
| H24 | `test_direction_between_adjacent` | Returns correct direction index 0-5 |
| H25 | `test_direction_between_non_adjacent` | Returns None |
| H26 | `test_hexes_in_range_radius0` | Radius 0 returns only the center tile |
| H27 | `test_los_to_self` | LOS from a tile to itself is always true |

### 1.2 `test_map_gen` — Map Generation

| # | Test | What It Verifies |
|---|---|---|
| M1 | `test_generate_map_deterministic` | Same seed → same map |
| M2 | `test_generate_map_different_seeds` | Different seeds → different maps |
| M3 | `test_generate_map_size` | Generates exactly MAP_WIDTH × MAP_HEIGHT tiles |
| M4 | `test_assign_terrain_ocean` | Low height → Ocean |
| M5 | `test_assign_terrain_mountain` | Very high height → Mountain |
| M6 | `test_assign_terrain_grassland` | Mid height, high moisture → Grassland |
| M7 | `test_assign_terrain_desert` | Mid height, low moisture → Desert |
| M8 | `test_assign_terrain_tundra` | Mid height, low temp → Tundra |
| M9 | `test_feature_woods` | Woods placed on eligible terrain |
| M10 | `test_feature_not_on_ocean` | Features never placed on water tiles |
| M11 | `test_resource_placement` | Resources placed on valid terrain types |
| M12 | `test_resource_not_on_mountain` | No resources on mountains |
| M13 | `test_starting_positions_distance` | Starting positions are at least 10 hexes apart |
| M14 | `test_starting_positions_food` | Each start has >= 4 food within 2 tiles |
| M15 | `test_starting_positions_production` | Each start has >= 2 production within 2 tiles |
| M16 | `test_starting_positions_on_land` | Starting positions are on land tiles |
| M17 | `test_validate_map_good` | Valid map passes validation |
| M18 | `test_latitude_bias_equator` | Center row → 0 bias |
| M19 | `test_latitude_bias_pole` | Edge row → high bias (cold) |
| M20 | `test_rivers_generated` | At least 1 river generated |
| M21 | `test_rivers_start_at_mountains` | Rivers originate from mountain tiles |
| M22 | `test_validate_map_bad_all_ocean` | Map that is all ocean fails validation (no valid starts) |
| M23 | `test_starting_positions_impossible` | Tiny map with no valid starting pairs returns error |

### 1.3 `test_movement` — Movement Validation

| # | Test | What It Verifies |
|---|---|---|
| V1 | `test_move_flat_terrain` | Move to flat grassland costs 1 |
| V2 | `test_move_hills` | Move to hills costs 2 |
| V3 | `test_move_woods` | Move to woods costs 2 |
| V4 | `test_move_mountain_blocked` | Cannot move to mountain |
| V5 | `test_move_ocean_blocked` | Cannot move to ocean |
| V6 | `test_move_coast_blocked` | Cannot move to coast |
| V7 | `test_move_insufficient_movement` | Unit with 1 MP can't enter hills (cost 2) |
| V8 | `test_move_exact_movement` | Unit with 2 MP can enter hills (cost 2) |
| V9 | `test_move_river_crossing` | River crossing costs all remaining movement |
| V10 | `test_move_river_crossing_zero_mp` | Cannot cross river with 0 MP remaining |
| V11 | `test_move_friendly_unit_blocking` | Can't move to tile with own military unit |
| V12 | `test_move_friendly_civilian_ok` | Military unit can move to tile with own civilian unit (1 military + 1 civilian allowed) |
| V13 | `test_move_non_adjacent` | Can't move to non-adjacent tile |
| V14 | `test_move_out_of_bounds` | Can't move off map |
| V15 | `test_move_deducts_movement` | After move, unit's movement_remaining is reduced |
| V16 | `test_move_updates_position` | After move, unit's (q, r) is updated |
| V17 | `test_scout_3_movement` | Scout has 3 movement points |
| V18 | `test_warrior_2_movement` | Warrior has 2 movement points |
| V19 | `test_reset_movement_values` | Each unit type gets correct MP at turn start |
| V20 | `test_move_enemy_tile_is_attack` | Moving to enemy-occupied tile is flagged as attack |
| V21 | `test_move_zero_movement_remaining` | Unit with 0 MP remaining can't move anywhere |
| V22 | `test_move_second_move_insufficient` | Unit uses 2 MP moving to hills, can't then enter another hills tile |
| V23 | `test_move_to_marsh` | Marsh tile costs 2 movement |
| V24 | `test_fortify_clears_on_move` | Moving a fortified unit resets fortify_turns to 0 |
| V25 | `test_move_civilian_to_civilian_blocked` | Can't move settler to tile with own builder (no civilian stacking) |
| V26 | `test_melee_attack_requires_movement` | Warrior with 0 MP remaining can't melee attack (melee = move into tile) |
| V27 | `test_ranged_attack_no_movement_needed` | Archer with 0 MP remaining CAN still ranged attack (no movement consumed) |
| V28 | `test_build_improvement_consumes_all_movement` | After BuildImprovement, builder has 0 MP remaining |
| V29 | `test_remove_improvement_consumes_all_movement` | After RemoveImprovement, builder has 0 MP remaining |

### 1.4 `test_combat` — Combat Resolution

| # | Test | What It Verifies |
|---|---|---|
| C1 | `test_equal_strength_base_damage` | CS 20 vs CS 20 → base 30 damage each |
| C2 | `test_stronger_attacker` | CS 20 vs CS 10 → attacker deals more damage |
| C3 | `test_stronger_defender` | CS 10 vs CS 20 → defender deals more damage |
| C4 | `test_max_delta` | CS diff of +40 → lookup table max damage (149) |
| C5 | `test_min_delta` | CS diff of -40 → lookup table min damage (6) |
| C6 | `test_hills_defense_bonus` | Defender on hills gets +3 CS |
| C7 | `test_woods_defense_bonus` | Defender in woods gets +3 CS |
| C8 | `test_fortify_1_turn` | Fortify 1 turn gives +3 CS |
| C9 | `test_fortify_2_turns` | Fortify 2+ turns gives +6 CS |
| C10 | `test_river_crossing_bonus` | River crossing gives defender +5 CS |
| C11 | `test_multiple_defense_modifiers` | Hills + fortified + river = +3+6+5 = +14 CS |
| C12 | `test_ranged_no_counter_damage` | Ranged attacker takes 0 damage |
| C13 | `test_ranged_uses_rs` | Ranged attack uses ranged_strength not combat_strength |
| C14 | `test_melee_vs_ranged_unit` | Melee attacker vs ranged unit: defender uses low CS |
| C15 | `test_ranged_attack_in_range` | Archer (range 2) can hit target 2 hexes away |
| C16 | `test_ranged_attack_out_of_range` | Archer (range 2) can't hit target 3 hexes away |
| C17 | `test_ranged_attack_needs_los` | Ranged attack blocked if no LOS |
| C18 | `test_combat_random_75` | random_factor=75 → 75% damage |
| C19 | `test_combat_random_125` | random_factor=125 → 125% damage |
| C20 | `test_combat_random_deterministic` | Same inputs → same random factor |
| C21 | `test_defender_killed` | Damage exceeds defender HP → killed |
| C22 | `test_attacker_killed` | Counter-damage exceeds attacker HP → killed |
| C23 | `test_both_survive` | Low damage → both survive |
| C24 | `test_city_combat_strength` | city_cs = 15 + pop×2 + wall_bonus |
| C25 | `test_city_cs_no_walls` | City with no walls: just 15 + pop×2 |
| C26 | `test_city_ranged_needs_walls` | City without walls can't make ranged attack |
| C27 | `test_city_ranged_with_walls` | City with walls fires at range 2 |
| C28 | `test_lookup_damage_all_deltas` | Verify all 81 entries in lookup table match `round(30 × e^(Δ/25))` |
| C29 | `test_civilian_cant_attack` | Settler/Builder combat_strength == 0 |
| C30 | `test_combat_random_range` | Random factor always in [75, 125] for many inputs |
| C31 | `test_attack_own_unit_fails` | Can't attack a unit belonging to the same player |
| C32 | `test_attack_not_at_war_fails` | Combat function rejects attack when players are at peace |
| C33 | `test_melee_unit_cant_ranged_attack` | Warrior (ranged_strength=0) can't use ranged attack action |
| C34 | `test_attack_civilian_captures` | Attacking an enemy Settler/Builder captures (ownership transfer) instead of dealing damage |
| C35 | `test_attack_dead_unit_fails` | Can't target a unit that was already killed this turn (hp=0, removed from storage) |
| C36 | `test_fortify_resets_on_attack` | Attacking with a fortified unit resets fortify_turns to 0 |
| C37 | `test_city_ranged_cs_equals_city_cs` | City ranged attack uses city_CS (15 + pop×2 + wall_bonus), not a fixed value |

### 1.5 `test_city` — City Management

| # | Test | What It Verifies |
|---|---|---|
| Y1 | `test_found_city_valid` | City founding on flat grassland succeeds |
| Y2 | `test_found_city_on_mountain` | City founding on mountain fails |
| Y3 | `test_found_city_on_water` | City founding on ocean/coast fails |
| Y4 | `test_found_city_too_close` | City within 3 hexes of existing city fails |
| Y5 | `test_found_city_exactly_3` | City at exactly 3 hexes succeeds |
| Y6 | `test_create_city_defaults` | New city has pop=1, hp=200, no buildings |
| Y7 | `test_first_city_is_capital` | First city founded sets is_capital=true |
| Y8 | `test_second_city_not_capital` | Second city has is_capital=false |
| Y9 | `test_tile_yield_grassland` | Grassland yields 2 food, 0 prod, 0 gold |
| Y10 | `test_tile_yield_plains_hills` | Plains Hills yields 1 food, 2 prod |
| Y11 | `test_tile_yield_woods` | Grassland + Woods yields 2 food, 1 prod |
| Y12 | `test_tile_yield_with_farm` | Grassland + Farm yields 3 food |
| Y13 | `test_tile_yield_with_mine` | Hills + Mine yields +1 prod |
| Y14 | `test_tile_yield_resource_wheat` | Grassland + Wheat yields 3 food |
| Y15 | `test_tile_yield_luxury_gold` | Silver resource yields +3 gold |
| Y16 | `test_tile_yield_coast_with_sailing` | Coast + Sailing tech yields 2 food |
| Y17 | `test_building_yields_monument` | Monument adds +1 science, +1 prod |
| Y18 | `test_building_yields_granary` | Granary adds +1 food |
| Y19 | `test_building_yields_market` | Market adds +3 gold |
| Y20 | `test_building_yields_palace` | Capital gets +2 prod, +2 science, +5 gold |
| Y21 | `test_housing_no_water` | No river, no coast → housing = 2 |
| Y22 | `test_housing_river` | River → housing = 5 |
| Y23 | `test_housing_with_granary` | River + Granary → housing = 7 |
| Y24 | `test_growth_normal` | Surplus food → population grows |
| Y25 | `test_growth_threshold` | Need exactly food_for_growth to grow |
| Y26 | `test_growth_blocked_by_housing` | Population at housing cap → no growth |
| Y27 | `test_starvation` | Negative food → population decreases |
| Y28 | `test_food_for_growth_formula` | food_for_growth = 15 + 6×pop |
| Y29 | `test_territory_radius_pop1` | Pop 1 → radius 1 (7 tiles) |
| Y30 | `test_territory_radius_pop3` | Pop 3 → radius 2 (19 tiles) |
| Y31 | `test_territory_radius_pop6` | Pop 6 → radius 3 (37 tiles) |
| Y32 | `test_auto_assign_food_priority` | Citizens assigned to highest-food tiles first |
| Y33 | `test_has_building` | Bitmask check for specific building |
| Y34 | `test_add_building` | Sets correct bit in bitmask |
| Y35 | `test_production_cost_warrior` | Warrior costs 40 production |
| Y36 | `test_production_cost_monument` | Monument costs 60 production |
| Y37 | `test_can_produce_no_tech` | Monument (no tech required) is always available |
| Y38 | `test_can_produce_needs_tech` | Granary requires Pottery tech |
| Y39 | `test_can_produce_already_built` | Can't build a building the city already has |
| Y40 | `test_water_mill_needs_river` | Water Mill can only be built in river cities |
| Y41 | `test_process_production_complete` | Item completes when stockpile >= cost |
| Y42 | `test_process_production_partial` | Stockpile accumulates across turns |
| Y43 | `test_build_improvement_wrong_terrain` | Farm on desert-hills fails (not valid terrain for farm) |
| Y44 | `test_build_improvement_already_exists_reverts` | Building improvement on tile that already has one **reverts** (must RemoveImprovement first) |
| Y44b | `test_remove_improvement_success` | RemoveImprovement clears tile_improvements, costs 0 charges |
| Y44c | `test_remove_improvement_empty_tile_reverts` | RemoveImprovement on tile with no improvement reverts |
| Y44d | `test_remove_then_build_next_turn` | Turn 1: RemoveImprovement. Turn 2: BuildImprovement on same tile succeeds |
| Y44e | `test_remove_and_build_same_turn_fails` | RemoveImprovement + BuildImprovement in same turn fails (both consume all movement) |
| Y44f | `test_mine_on_flat_fails` | Mine improvement on flat grassland (no hills) reverts |
| Y45 | `test_can_produce_invalid_id` | Production ID outside valid ranges (e.g., 200) reverts |
| Y46 | `test_starvation_min_pop_1` | Population can't drop below 1 from starvation |
| Y47 | `test_tile_yield_desert` | Desert yields 0 food, 0 prod, 0 gold |
| Y48 | `test_tile_yield_ocean` | Ocean yields 1 food, 0 prod, 0 gold |
| Y49 | `test_housing_coast` | Coast (no river) → housing = 3 |
| Y50 | `test_production_carryover` | Warrior costs 40 prod, city produces 6/turn → completes turn 7 (stockpile=42), carryover=2 applies to next item |
| Y51 | `test_unit_spawn_on_city_tile` | Completed unit appears on city tile |
| Y52 | `test_unit_spawn_city_tile_occupied` | If city tile has friendly military unit, produced unit spawns on nearest empty adjacent tile |
| Y53 | `test_city_center_always_worked` | Pop 1 city works center tile (free) + 1 assigned tile = 2 tiles total |

### 1.6 `test_tech` — Tech Tree

| # | Test | What It Verifies |
|---|---|---|
| T1 | `test_mining_no_prereq` | Mining has no prerequisites → always researchable |
| T2 | `test_irrigation_needs_pottery` | Irrigation requires Pottery |
| T3 | `test_construction_needs_two` | Construction requires Masonry + The Wheel |
| T4 | `test_machinery_needs_chain` | Machinery requires Archery + Engineering |
| T5 | `test_complete_tech_sets_bit` | Completing tech 4 sets bit 4 in bitmask |
| T6 | `test_is_completed_true` | Bit set → tech is completed |
| T7 | `test_is_completed_false` | Bit not set → tech not completed |
| T8 | `test_tech_cost_mining` | Mining costs 25 (50 half-points) |
| T9 | `test_tech_cost_machinery` | Machinery costs 100 (200 half-points) |
| T10 | `test_process_science_completes` | Progress reaches cost → tech completes |
| T11 | `test_process_science_partial` | Progress below cost → no completion |
| T12 | `test_process_science_overflow` | Excess progress carries over to next tech |
| T13 | `test_tech_unlocks_mining` | Mining unlocks Mine improvement |
| T14 | `test_tech_unlocks_archery` | Archery unlocks Archer unit |
| T15 | `test_tech_unlocks_pottery` | Pottery unlocks Granary building |
| T16 | `test_building_required_tech` | Walls requires Masonry (tech 8) |
| T17 | `test_improvement_required_tech` | Farm requires Irrigation (tech 6) |
| T18 | `test_count_completed_techs` | Popcount of bitmask with 5 bits set = 5 |
| T19 | `test_has_prerequisites_missing_one_of_two` | Construction needs Masonry + The Wheel; having only Masonry → not researchable |
| T20 | `test_complete_already_completed_tech` | Completing a tech that is already in the bitmask is no-op or error |
| T21 | `test_process_science_no_tech_selected` | current_tech = 0 (no research) → science is wasted, no progress |
| T22 | `test_tech_cost_invalid_id` | Tech ID > 18 returns error / panics |

### 1.7 `test_economy` — Gold

| # | Test | What It Verifies |
|---|---|---|
| E1 | `test_income_single_city` | Income from one city's gold yield |
| E2 | `test_income_palace_bonus` | Capital adds +5 gold |
| E3 | `test_expenses_per_unit` | 1 gold per military unit |
| E4 | `test_expenses_civilians_free` | Settlers/Builders don't cost maintenance |
| E5 | `test_positive_treasury` | Income > expenses → treasury grows |
| E6 | `test_negative_treasury_disband` | Treasury < 0 → disband 1 unit (lowest HP first) |
| E6b | `test_disband_lowest_hp_first` | Multiple military units, treasury < 0 → unit with lowest HP is disbanded |
| E7 | `test_purchase_cost` | Purchase cost = production_cost × 4 |
| E8 | `test_upgrade_cost_slinger` | Slinger→Archer = 30 gold |
| E9 | `test_can_upgrade_with_tech` | Slinger upgradable when Archery researched |
| E10 | `test_cant_upgrade_without_tech` | Slinger not upgradable without Archery |
| E11 | `test_purchase_insufficient_gold` | Buying a unit with less gold than purchase_cost reverts |
| E12 | `test_upgrade_no_upgrade_path` | Warrior has no upgrade path → upgrade reverts |
| E13 | `test_upgrade_already_max` | Archer (already max tier for MVP) → upgrade reverts |
| E14 | `test_treasury_exactly_zero` | Treasury = 0, income = expenses → no disband (not negative) |

### 1.8 `test_turn` — End of Turn

| # | Test | What It Verifies |
|---|---|---|
| N1 | `test_heal_friendly_territory` | Unit heals +10 HP in friendly territory |
| N2 | `test_heal_neutral` | Unit heals +5 HP in neutral territory |
| N3 | `test_heal_enemy_territory` | Unit heals +0 in enemy territory |
| N4 | `test_heal_fortified` | Fortified unit heals extra +10 |
| N5 | `test_heal_cap_at_max` | Healing doesn't exceed 100 HP (normal max) |
| N5b | `test_barracks_unit_110hp_no_extra_heal` | Unit at 110 HP (Barracks bonus) doesn't heal above 110 — healing caps at max(100, current_hp) |
| N5c | `test_barracks_unit_damaged_heals_to_100` | Barracks unit at 80 HP heals toward 100 (normal max), NOT back to 110 |
| N6 | `test_reset_movement` | All units get full MP at turn start |
| N7 | `test_is_friendly_territory` | Tile owned by player's city → friendly |
| N8 | `test_is_neutral_territory` | Unclaimed tile → neutral |
| N9 | `test_is_enemy_territory` | Tile owned by opponent's city → enemy |
| N10 | `test_heal_already_full_hp` | Unit at 100 HP stays at 100 after healing step |
| N11 | `test_heal_dead_unit_skipped` | Dead unit (removed from storage) is not healed |
| N12 | `test_fortify_increments_on_skip` | Unit that stays still and is fortified gets fortify_turns +1 |

### 1.9 `test_victory` — Victory Conditions

| # | Test | What It Verifies |
|---|---|---|
| W1 | `test_domination_capital_captured` | Capturing is_capital city → domination win |
| W2 | `test_domination_non_capital` | Capturing non-capital → no domination |
| W3 | `test_score_calculation` | Score formula matches spec |
| W4 | `test_score_population_weight` | +5 per population |
| W5 | `test_score_city_weight` | +10 per city |
| W6 | `test_score_tech_weight` | +3 per tech |
| W7 | `test_score_kills_weight` | +4 per kill |
| W8 | `test_turn_limit_150` | Turn 150 → turn limit reached |
| W9 | `test_turn_limit_149` | Turn 149 → not yet |
| W10 | `test_score_all_zeros` | Player with no cities, no techs, no kills → score = 0 |
| W11 | `test_turn_limit_0` | Turn 0 → not at limit |
| W12 | `test_score_captured_city_weight` | +15 per enemy city currently held |
| W13 | `test_score_building_weight` | +10 per building completed (across all cities) |
| W14 | `test_score_tiles_explored_phase1` | In Phase 1 (all public), tiles_explored = all tiles for both players — component is equal, doesn't differentiate. Test it's calculated correctly. |

---

## 2. Integration Tests (`test_contract`)

Deploy the contract and test via external function calls. These test the contract's state management, access control, and action validation.

### 2.1 Game Lifecycle

| # | Test | What It Verifies |
|---|---|---|
| I1 | `test_create_game` | create_game returns incrementing game_id, status = LOBBY |
| I2 | `test_join_game` | Player B joins, status → ACTIVE, map generated, units placed |
| I3 | `test_join_game_emits_events` | GameCreated, PlayerJoined, GameStarted events emitted |
| I4 | `test_join_game_creates_units` | Each player gets 1 Settler + 1 Warrior |
| I5 | `test_join_game_map_generated` | All 640 tiles have valid terrain values |
| I6 | `test_join_twice_fails` | Third player joining fails |
| I7 | `test_join_nonexistent_game` | Joining invalid game_id reverts |
| I8 | `test_creator_cant_join_own_game` | Same player can't join their own game |

### 2.2 Turn Submission — Access Control

| # | Test | What It Verifies |
|---|---|---|
| I9 | `test_wrong_player_reverts` | Player B submitting on Player A's turn reverts |
| I10 | `test_inactive_game_reverts` | Submitting turn on LOBBY/FINISHED game reverts |
| I11 | `test_empty_actions_ok` | Submitting EndTurn with no other actions works (skip turn) |
| I12 | `test_turn_increments` | After submit_turn, game_turn increments by 1 |
| I13 | `test_player_alternates` | current_player flips after each turn |

### 2.3 Turn Submission — Each Action

| # | Test | What It Verifies |
|---|---|---|
| I14 | `test_action_move_unit` | MoveUnit updates unit position in storage |
| I15 | `test_action_move_invalid_unit` | MoveUnit with non-existent unit_id reverts |
| I16 | `test_action_move_enemy_unit` | Moving opponent's unit reverts |
| I17 | `test_action_found_city` | FoundCity consumes settler, creates city in storage |
| I18 | `test_action_found_city_territory` | New city owns 7 tiles (center + 6 neighbors) |
| I19 | `test_action_found_city_non_settler` | FoundCity with warrior reverts |
| I20 | `test_action_attack_melee` | AttackUnit resolves combat, applies damage |
| I21 | `test_action_attack_kills` | Lethal attack removes defender from storage |
| I22 | `test_action_attack_empty_tile` | Attacking tile with no enemy reverts |
| I23 | `test_action_ranged_attack` | RangedAttack deals damage, no counter-damage |
| I24 | `test_action_ranged_out_of_range` | RangedAttack beyond range reverts |
| I25 | `test_action_set_production` | SetProduction updates city.current_production |
| I26 | `test_action_set_production_locked` | Setting production to locked building reverts |
| I27 | `test_action_set_research` | SetResearch updates player_current_tech |
| I28 | `test_action_set_research_no_prereq` | Setting research without prereqs reverts |
| I29 | `test_action_set_research_already_done` | Researching completed tech reverts |
| I30 | `test_action_build_improvement` | BuildImprovement(builder_id, q, r, improvement_type) stores improvement, deducts 1 charge, consumes all movement |
| I30b | `test_action_build_on_existing_reverts` | BuildImprovement on tile with existing improvement reverts |
| I30c | `test_action_remove_improvement` | RemoveImprovement clears tile improvement, costs 0 charges, consumes all movement |
| I30d | `test_action_remove_empty_tile_reverts` | RemoveImprovement on tile with no improvement reverts |
| I30e | `test_action_remove_not_builder_reverts` | Warrior trying RemoveImprovement reverts |
| I31 | `test_action_build_no_tech` | Building Farm without Irrigation reverts |
| I32 | `test_action_build_no_charges` | Builder with 0 charges reverts |
| I33 | `test_action_fortify` | FortifyUnit sets fortify_turns = 1 |
| I34 | `test_action_purchase` | PurchaseWithGold deducts gold, creates unit/building |
| I35 | `test_action_purchase_no_gold` | Purchase without enough gold reverts |
| I36 | `test_action_upgrade_unit` | UpgradeUnit changes unit type, deducts gold |
| I37 | `test_action_declare_war` | DeclareWar sets diplo_status to WAR |
| I37b | `test_action_attack_own_unit_reverts` | Attacking own unit reverts |
| I37c | `test_action_attack_not_at_war_reverts` | Attacking enemy without prior DeclareWar reverts |
| I37d | `test_action_attack_with_civilian_reverts` | Settler/Builder attacking reverts (combat_strength=0) |
| I37e | `test_action_ranged_with_melee_reverts` | Warrior using RangedAttack action reverts (ranged_strength=0) |
| I37f | `test_action_ranged_no_los_reverts` | Ranged attack with mountain blocking LOS reverts |
| I37g | `test_action_found_city_on_water_reverts` | FoundCity on ocean tile reverts |
| I37h | `test_action_found_city_too_close_reverts` | FoundCity within 3 hexes of existing city reverts |
| I37i | `test_action_set_production_enemy_city_reverts` | Setting production on opponent's city reverts |
| I37j | `test_action_set_production_invalid_id_reverts` | Production ID 255 (nonexistent) reverts |
| I37k | `test_action_set_research_invalid_tech_reverts` | Tech ID > 18 reverts |
| I37l | `test_action_build_wrong_terrain_reverts` | Farm on non-eligible terrain (desert hills) reverts |
| I37m | `test_action_build_not_builder_reverts` | Warrior trying BuildImprovement reverts |
| I37n | `test_action_upgrade_no_gold_reverts` | Upgrade with insufficient gold reverts |
| I37o | `test_action_upgrade_no_path_reverts` | Upgrade for unit type with no upgrade path reverts |
| I37p | `test_action_on_dead_unit_reverts` | Moving/attacking with a unit killed earlier in same turn reverts |
| I37q | `test_action_double_move_no_mp_reverts` | Moving a unit twice when second move costs more than remaining MP reverts |
| I37r | `test_action_declare_war_on_self_reverts` | Declaring war on yourself reverts |
| I37s | `test_action_declare_war_already_at_war` | Declaring war when already at war is a no-op (doesn't revert) |
| I37t | `test_action_fortify_civilian_reverts` | Fortifying a Settler/Builder reverts (or is a no-op) |
| I37u | `test_action_capture_city_hp_resets_100` | After capturing city, city HP = 100 (not 200) |
| I37v | `test_action_capture_city_pop_minus_1` | After capturing city with pop 3, pop becomes 2 |
| I37w | `test_action_capture_city_pop_min_1` | Capturing pop 1 city → pop stays at 1 (can't drop below) |
| I37x | `test_action_capture_destroys_improvements` | Improvements on tiles owned by captured city are destroyed |
| I37y | `test_action_purchase_instant` | PurchaseWithGold creates unit/building immediately (same turn, not next turn) |
| I37z | `test_action_capture_civilian` | Moving military unit onto enemy civilian → civilian changes ownership (captured, not killed) |

### 2.4 End-of-Turn Processing

| # | Test | What It Verifies |
|---|---|---|
| I38 | `test_eot_city_yields` | City food/production stockpiles increase |
| I39 | `test_eot_population_growth` | Population increases when food threshold met |
| I40 | `test_eot_production_completes` | Building completes when production threshold met |
| I41 | `test_eot_unit_produced` | Completed unit appears in storage |
| I42 | `test_eot_tech_completes` | Tech completes when science threshold met |
| I43 | `test_eot_gold_income` | Treasury increases by gold_per_turn |
| I44 | `test_eot_unit_healing` | Damaged unit heals at turn end |
| I45 | `test_eot_movement_reset` | Units get full movement at next turn start |
| I46 | `test_eot_fortify_increments` | Fortified unit's fortify_turns increases |
| I47 | `test_eot_territory_expands` | City gaining population gets new territory tiles |

### 2.5 Timeout

| # | Test | What It Verifies |
|---|---|---|
| I48 | `test_claim_timeout_valid` | Opponent claims timeout after 5 min, turn skipped |
| I49 | `test_claim_timeout_too_early` | Claiming before 5 min reverts |
| I50 | `test_claim_timeout_wrong_player` | Current player can't claim timeout on themselves |
| I51 | `test_timeout_forfeit` | 3 consecutive timeouts → game ends, opponent wins |
| I51b | `test_claim_timeout_non_player_reverts` | Address not in the game can't claim timeout |
| I51c | `test_submit_turn_after_game_over_reverts` | Submitting turn to a FINISHED game reverts |
| I51d | `test_submit_turn_after_timer_expired` | Submitting after 5-min timer elapsed reverts (opponent must claim timeout) |

### 2.6 View Functions

| # | Test | What It Verifies |
|---|---|---|
| I52 | `test_get_tile_returns_terrain` | get_tile returns correct terrain for generated map |
| I53 | `test_get_unit_returns_data` | get_unit returns correct unit data after creation |
| I54 | `test_get_city_returns_data` | get_city returns correct city data after founding |
| I55 | `test_get_gold_tracks_changes` | get_gold reflects income/expenses each turn |
| I56 | `test_get_completed_techs_bitmask` | Bitmask updates correctly on tech completion |
| I57 | `test_get_score_computed` | get_score returns correct calculated score |
| I58 | `test_get_city_yields_computed` | get_city_yields returns correct per-city yields |
| I59 | `test_get_gold_per_turn_computed` | get_gold_per_turn returns income - expenses |
| I60 | `test_get_science_per_turn_computed` | get_science_per_turn returns correct half-science |

---

## 3. System Tests (`test_system`)

Full game scenarios that play through multiple turns to test feature interactions.

### 3.1 Game Scenarios

| # | Test | Description |
|---|---|---|
| S1 | `test_full_game_domination` | Play ~30 turns: found cities, build warriors, attack, capture capital. Verify GameEnded event with VICTORY_DOMINATION. |
| S2 | `test_full_game_score_victory` | Play to turn 150 with no combat. Found cities, build economy. Verify score calculation and winner. |
| S3 | `test_full_game_forfeit` | Player B times out 3 times. Verify GameEnded with VICTORY_FORFEIT. |
| S4 | `test_settle_and_grow` | Found city turn 1. Verify pop grows over 10 turns. Check territory expands at pop 3. |
| S5 | `test_tech_chain` | Research Mining → Masonry → Construction. Verify each unlock is available at the right time. Build Mine, then Walls, then Lumber Mill. |
| S6 | `test_combat_sequence` | Build warriors, move into range. Attack. Verify damage applied. Attack again until one dies. Verify UnitKilled event. |
| S7 | `test_city_siege` | Build army. Attack enemy city. Reduce HP to 0. Capture with melee unit. Verify ownership transfer, population -1, HP reset. |
| S8 | `test_economy_bankruptcy` | Build many units, run out of gold. Verify unit disbanded. |
| S9 | `test_ranged_combat_flow` | Build slinger, research Archery, upgrade to Archer. Attack from 2 tiles away. Verify no counter-damage. |
| S10 | `test_builder_improvements` | Research Pottery→Irrigation. Build Farm. Verify tile yield increases by +1 food. Attempt to build Mine on same tile → reverts. |
| S10b | `test_replace_improvement_flow` | Build Farm on tile. Next turn: RemoveImprovement. Next turn: Build Mine. Verify tile yield changes from +1 food to +1 production. |
| S11 | `test_city_production_chain` | Build Monument, then Granary, then Warrior. Verify each completes at the right turn based on production rate. |
| S12 | `test_housing_limits_growth` | City without river (housing=2). Verify pop can't exceed 2 without Granary. Build Granary (housing→4). Verify pop grows to 4. |
| S13 | `test_two_cities_territory_conflict` | Found two cities 3 tiles apart. Both expand territory. Verify tiles closest to each city are claimed correctly — no double-claiming. |
| S14 | `test_barracks_hp_bonus` | Build Barracks. Produce Warrior. Verify it starts at 110 HP instead of 100. |
| S15 | `test_walls_city_attack` | Build Walls. Enemy attacks. Verify city can fire ranged attack on defender's turn with CS = city_cs. |
| S16 | `test_civilian_capture` | Move warrior onto enemy builder. Verify builder is captured (ownership changes), not killed. |
| S17 | `test_multiple_combats_per_turn` | Attack with 3 different units in one turn. Verify each combat resolves independently with different random factors. |
| S18 | `test_war_declaration_required` | Attack enemy without declaring war first → reverts. Declare war, then attack → succeeds. |
| S19 | `test_all_units_lost_still_plays` | Player loses all military units but has cities. Can still submit turns (produce, research). |
| S20 | `test_invalid_action_mid_sequence_reverts_all` | Turn with [valid_move, invalid_move, valid_found]. Entire transaction reverts — no partial application. |

---

## 4. Manual Testing Guide — UI ↔ Contract Interaction

This section defines what the UI needs to read from the contract and how to exercise it for manual testing.

### 4.1 Full State Read Pattern

The UI must be able to reconstruct the entire game state for rendering. Here's the read sequence:

```
1. GAME METADATA
   get_game_status(game_id)          → u8 (0=lobby, 1=active, 2=finished)
   get_turn(game_id)                 → u32
   get_current_player(game_id)       → ContractAddress
   get_player_address(game_id, 0)    → ContractAddress (player A)
   get_player_address(game_id, 1)    → ContractAddress (player B)
   get_turn_timestamp(game_id)       → u64 (for timer display)
   get_winner(game_id)               → ContractAddress (zero if no winner)

2. MAP (once per game — immutable after generation)
   for q in 0..32:
     for r in 0..20:
       get_tile(game_id, q, r)       → TileData {terrain, feature, resource, river_edges}

3. IMPROVEMENTS & TERRITORY (changes each turn)
   for q in 0..32:
     for r in 0..20:
       get_tile_improvement(game_id, q, r)  → u8 (0=none)
       get_tile_owner(game_id, q, r)        → (u8, u32) (player_idx, city_id; city_id=0 means unclaimed)

4. UNITS (for each player)
   for player_idx in 0..2:
     count = get_unit_count(game_id, player_idx)
     for unit_id in 0..count:
       get_unit(game_id, player_idx, unit_id)  → Unit struct

5. CITIES (for each player)
   for player_idx in 0..2:
     count = get_city_count(game_id, player_idx)
     for city_id in 0..count:
       get_city(game_id, player_idx, city_id)  → City struct

6. ECONOMY & RESEARCH (for each player)
   for player_idx in 0..2:
     get_gold(game_id, player_idx)              → u32
     get_current_tech(game_id, player_idx)      → u8
     get_tech_progress(game_id, player_idx)     → u32
     get_completed_techs(game_id, player_idx)   → u64 bitmask
     get_kills(game_id, player_idx)             → u32

7. COMPUTED VALUES (convenience — avoid client-side recalculation)
   for player_idx in 0..2:
     get_score(game_id, player_idx)             → u32
     get_gold_per_turn(game_id, player_idx)     → i32
     get_science_per_turn(game_id, player_idx)  → u16 (half-points)
     for each city:
       get_city_yields(game_id, player_idx, city_id)  → CityYields

8. DIPLOMACY
   get_diplo_status(game_id, 0, 1)              → u8 (peace/war)
```

### 4.2 Manual Test Scenarios

These are played through the UI by a human tester, verifying visual correctness:

| # | Scenario | Steps | What to Verify |
|---|---|---|---|
| MT1 | **Create & Join** | Player A: create_game. Player B: join_game. | Map renders. Both players' units visible. Turn indicator shows Player A. Timer starts. |
| MT2 | **Move Unit** | Select Warrior. Click adjacent tile. Submit turn. | Warrior moves to new tile. Movement counter decreases. Turn passes to opponent. |
| MT3 | **Found City** | Select Settler. Click "Found City". Submit turn. | City appears on map. Territory borders shown. Settler disappears. City panel shows pop=1. |
| MT4 | **Set Production** | Open city. Select Warrior from production list. Submit turn (or let it produce over turns). | Production bar progresses. When done, Warrior appears on city tile. |
| MT5 | **Research Tech** | Open tech tree. Click Mining. Submit turns until researched. | Tech tree shows Mining as completed. Mine improvement becomes available to Builders. |
| MT6 | **Build Improvement** | Select Builder. Move to Hills. Click "Build Mine". Submit turn. | Mine icon appears on tile. Builder charges decrease. Tile yield tooltip shows +1 production. |
| MT7 | **Combat** | Move Warrior adjacent to enemy Warrior. Declare war. Attack. | Combat animation/feedback. Damage numbers shown. If killed, unit removed from map. |
| MT8 | **Ranged Attack** | Build Archer. Move within range. Ranged attack enemy. | Damage dealt. No counter-damage to Archer. |
| MT9 | **City Siege** | Attack enemy city repeatedly until HP=0. Melee attack to capture. | City HP bar depletes. On capture: ownership changes, borders update, population decreases. |
| MT10 | **Economy** | Check gold display. Build many units. Observe maintenance. Let gold go negative. | Gold per turn updates. Unit disbanded when bankrupt. Warning shown. |
| MT11 | **Population Growth** | Found city near food. Wait for growth. | Population counter increases. Territory expands at pop 3. New tiles colored. |
| MT12 | **Housing Cap** | City reaches housing limit. Observe growth stops. Build Granary. Growth resumes. | Growth indicator shows "housing needed". After Granary, growth continues. |
| MT13 | **Timeout** | Let timer expire on your turn. Opponent claims timeout. | Turn skipped. Timeout counter increases. After 3: game ends. |
| MT14 | **Score Check** | Play to turn 150. Compare scores. | Score breakdown shown. Correct winner declared. GameEnded event fired. |
| MT15 | **Full Game** | Play a complete game to domination victory. | All mechanics work together. Victory screen shows. No stuck states. |

### 4.3 Event Verification

The UI should listen to these events and display appropriate feedback:

| Event | UI Response |
|---|---|
| `GameCreated` | Show game in lobby list |
| `PlayerJoined` | Update lobby to show both players |
| `GameStarted` | Transition to game view, render map |
| `TurnSubmitted` | Update game state, show opponent's actions |
| `CombatResolved` | Show combat results (damage numbers, kill indicators) |
| `CityFounded` | Show new city on map with borders |
| `UnitKilled` | Remove unit from map, show death animation |
| `TechCompleted` | Show tech notification, update available production/improvements |
| `BuildingCompleted` | Show building icon in city, update city stats |
| `GameEnded` | Show victory/defeat screen with score breakdown |

### 4.4 State Consistency Checks (Manual)

After every action, verify in the UI:

1. **Unit count** matches what get_unit_count returns
2. **Gold** matches get_gold after income/expenses
3. **Tech progress** advances by the expected half-science per turn
4. **City yields** in the city panel match get_city_yields
5. **Territory** borders match get_tile_owner results
6. **Score** matches get_score computation
7. **Timer** countdown matches `turn_timestamp + 300 - now`

---

## 5. Test Execution Order

For CI / development:

```
Phase 1: Unit tests (fast, no deployment)
    scarb test --filter test_hex
    scarb test --filter test_map_gen
    scarb test --filter test_movement
    scarb test --filter test_combat
    scarb test --filter test_city
    scarb test --filter test_tech
    scarb test --filter test_economy
    scarb test --filter test_turn
    scarb test --filter test_victory

Phase 2: Integration tests (deploy contract, slower)
    scarb test --filter test_contract

Phase 3: System tests (multi-turn scenarios, slowest)
    scarb test --filter test_system

Phase 4: Manual testing
    Deploy to devnet → open UI → run MT1-MT15
```

Total: **352 automated tests** across 3 layers (239 unit + 92 integration + 21 system) + **15 manual test scenarios**.
