// ============================================================================
// Contract — StarkNet contract glue layer. The ONLY stateful module.
// Calls pure-function modules for all game logic.
// See design/implementation/01_interfaces.md §Module 11.
// ============================================================================

use starknet::ContractAddress;
use cairo_civ::types::{Action, Unit, City, TileData};

#[starknet::interface]
pub trait ICairoCiv<TContractState> {
    fn create_game(ref self: TContractState, num_players: u8) -> u64;
    fn join_game(ref self: TContractState, game_id: u64) -> u8;
    fn start_game(ref self: TContractState, game_id: u64);
    fn submit_turn(ref self: TContractState, game_id: u64, actions: Array<Action>);
    fn submit_actions(ref self: TContractState, game_id: u64, actions: Array<Action>);
    fn forfeit(ref self: TContractState, game_id: u64);
    fn claim_timeout_victory(ref self: TContractState, game_id: u64);
    fn get_game_status(self: @TContractState, game_id: u64) -> u8;
    fn get_current_turn(self: @TContractState, game_id: u64) -> u32;
    fn get_current_player(self: @TContractState, game_id: u64) -> u8;
    fn get_player_address(self: @TContractState, game_id: u64, player_idx: u8) -> ContractAddress;
    fn get_unit(self: @TContractState, game_id: u64, player_idx: u8, unit_id: u32) -> Unit;
    fn get_unit_count(self: @TContractState, game_id: u64, player_idx: u8) -> u32;
    fn get_city(self: @TContractState, game_id: u64, player_idx: u8, city_id: u32) -> City;
    fn get_city_count(self: @TContractState, game_id: u64, player_idx: u8) -> u32;
    fn get_tile(self: @TContractState, game_id: u64, q: u8, r: u8) -> TileData;
    fn get_tile_owner(self: @TContractState, game_id: u64, q: u8, r: u8) -> (u8, u32);
    fn get_tile_improvement(self: @TContractState, game_id: u64, q: u8, r: u8) -> u8;
    fn get_treasury(self: @TContractState, game_id: u64, player_idx: u8) -> u32;
    fn get_completed_techs(self: @TContractState, game_id: u64, player_idx: u8) -> u64;
    fn get_current_research(self: @TContractState, game_id: u64, player_idx: u8) -> u8;
    fn get_winner(self: @TContractState, game_id: u64) -> u8;
    fn get_score(self: @TContractState, game_id: u64, player_idx: u8) -> u32;
    fn get_diplomacy_status(self: @TContractState, game_id: u64, p1: u8, p2: u8) -> u8;
}

// Events
#[derive(Copy, Drop, starknet::Event)]
pub struct GameCreated { pub game_id: u64, pub creator: ContractAddress, pub num_players: u8 }
#[derive(Copy, Drop, starknet::Event)]
pub struct PlayerJoined { pub game_id: u64, pub player: ContractAddress, pub player_idx: u8 }
#[derive(Copy, Drop, starknet::Event)]
pub struct GameStarted { pub game_id: u64 }
#[derive(Copy, Drop, starknet::Event)]
pub struct TurnSubmitted { pub game_id: u64, pub player_idx: u8, pub turn_number: u32 }
#[derive(Copy, Drop, starknet::Event)]
pub struct UnitKilled { pub game_id: u64, pub owner: u8, pub unit_id: u32, pub killer: u8 }
#[derive(Copy, Drop, starknet::Event)]
pub struct CityFounded { pub game_id: u64, pub player_idx: u8, pub city_id: u32, pub q: u8, pub r: u8 }
#[derive(Copy, Drop, starknet::Event)]
pub struct CityCaptured { pub game_id: u64, pub city_id: u32, pub from_player: u8, pub to_player: u8 }
#[derive(Copy, Drop, starknet::Event)]
pub struct TechCompleted { pub game_id: u64, pub player_idx: u8, pub tech_id: u8 }
#[derive(Copy, Drop, starknet::Event)]
pub struct BuildingCompleted { pub game_id: u64, pub player_idx: u8, pub city_id: u32, pub building_bit: u8 }
#[derive(Copy, Drop, starknet::Event)]
pub struct GameEnded { pub game_id: u64, pub winner: u8, pub victory_type: u8 }

// =========================================================================
#[starknet::contract]
mod CairoCiv {
    use super::{
        ICairoCiv, GameCreated, PlayerJoined, GameStarted, TurnSubmitted,
        UnitKilled, CityFounded, CityCaptured, TechCompleted, BuildingCompleted, GameEnded,
    };
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        StorageMapReadAccess, StorageMapWriteAccess,
        Map,
    };
    use core::poseidon::PoseidonTrait;
    use core::hash::HashStateTrait;
    use cairo_civ::types::{
        Action, Unit, City, TileData,
        STATUS_LOBBY, STATUS_ACTIVE, STATUS_FINISHED,
        VICTORY_FORFEIT,
        UNIT_SETTLER, UNIT_WARRIOR, UNIT_BUILDER,
        DIPLO_WAR,
        IMPROVEMENT_NONE,
    };
    use cairo_civ::{hex, map_gen, movement, combat, city, tech, economy, turn, constants};

    // ----- Storage ---------------------------------------------------------
    #[storage]
    struct Storage {
        next_game_id: u64,
        game_status: Map<u64, u8>,
        game_num_players: Map<u64, u8>,
        game_joined_count: Map<u64, u8>,
        game_current_turn: Map<u64, u32>,
        game_current_player: Map<u64, u8>,
        game_winner: Map<u64, u8>,
        game_victory_type: Map<u64, u8>,
        game_last_action_ts: Map<u64, u64>,
        game_seed: Map<u64, felt252>,
        player_address: Map<(u64, u8), ContractAddress>,
        player_treasury: Map<(u64, u8), u32>,
        player_completed_techs: Map<(u64, u8), u64>,
        player_current_research: Map<(u64, u8), u8>,
        player_accumulated_half_science: Map<(u64, u8), u32>,
        player_unit_count: Map<(u64, u8), u32>,
        player_city_count: Map<(u64, u8), u32>,
        player_kills: Map<(u64, u8), u32>,
        player_captured_cities: Map<(u64, u8), u32>,
        player_timeout_count: Map<(u64, u8), u8>,
        game_consecutive_timeouts: Map<u64, u8>,
        diplomacy: Map<(u64, u8, u8), u8>,
        units: Map<(u64, u8, u32), Unit>,
        cities: Map<(u64, u8, u32), City>,
        tiles: Map<(u64, u8, u8), TileData>,
        tile_owner: Map<(u64, u8, u8), u32>,
        tile_owner_player: Map<(u64, u8, u8), u8>,
        tile_improvement: Map<(u64, u8, u8), u8>,
    }

    // ----- Events ----------------------------------------------------------
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        GameCreated: GameCreated,
        PlayerJoined: PlayerJoined,
        GameStarted: GameStarted,
        TurnSubmitted: TurnSubmitted,
        UnitKilled: UnitKilled,
        CityFounded: CityFounded,
        CityCaptured: CityCaptured,
        TechCompleted: TechCompleted,
        BuildingCompleted: BuildingCompleted,
        GameEnded: GameEnded,
    }

    // ----- External --------------------------------------------------------
    #[abi(embed_v0)]
    impl CairoCivImpl of ICairoCiv<ContractState> {
        // ---- Lobby ----
        fn create_game(ref self: ContractState, num_players: u8) -> u64 {
            let game_id = self.next_game_id.read() + 1;
            self.next_game_id.write(game_id);
            self.game_status.write(game_id, STATUS_LOBBY);
            self.game_num_players.write(game_id, num_players);
            let caller = get_caller_address();
            self.player_address.write((game_id, 0), caller);
            self.game_joined_count.write(game_id, 1);
            self.emit(GameCreated { game_id, creator: caller, num_players });
            game_id
        }

        fn join_game(ref self: ContractState, game_id: u64) -> u8 {
            let status = self.game_status.read(game_id);
            assert(status == STATUS_LOBBY, 'Game not in lobby');
            let caller = get_caller_address();
            let creator = self.player_address.read((game_id, 0));
            assert(caller != creator, 'Cannot join own game');
            let joined = self.game_joined_count.read(game_id);
            let max_p = self.game_num_players.read(game_id);
            assert(joined < max_p, 'Game full');
            let idx = joined;
            self.player_address.write((game_id, idx), caller);
            self.game_joined_count.write(game_id, joined + 1);
            self.emit(PlayerJoined { game_id, player: caller, player_idx: idx });
            if joined + 1 == max_p {
                InternalImpl::auto_start(ref self, game_id);
            }
            idx
        }

        fn start_game(ref self: ContractState, game_id: u64) {
            assert(self.game_status.read(game_id) == STATUS_LOBBY, 'Not in lobby');
        }

        // ---- Gameplay ----
        fn submit_turn(ref self: ContractState, game_id: u64, actions: Array<Action>) {
            let status = self.game_status.read(game_id);
            assert(status == STATUS_ACTIVE, 'Game not active');
            let caller = get_caller_address();
            let cur_p = self.game_current_player.read(game_id);
            let p_addr = self.player_address.read((game_id, cur_p));
            assert(caller == p_addr, 'Not your turn');
            // Timer check
            let ts = get_block_timestamp();
            let last_ts = self.game_last_action_ts.read(game_id);
            assert(
                !turn::check_timeout(last_ts, ts, constants::TURN_TIMEOUT_SECONDS),
                'Turn timed out',
            );
            // Reset timeout counter (player submitted in time)
            self.game_consecutive_timeouts.write(game_id, 0);
            // Process actions
            let span = actions.span();
            let mut i: u32 = 0;
            let len = span.len();
            loop {
                if i >= len { break; }
                let action = *span.at(i);
                match action {
                    Action::EndTurn => {
                        InternalImpl::process_end_of_turn(ref self, game_id, cur_p);
                        let np = self.game_num_players.read(game_id);
                        let next_p = turn::next_player(cur_p, np);
                        self.game_current_player.write(game_id, next_p);
                        let new_t = self.game_current_turn.read(game_id) + 1;
                        self.game_current_turn.write(game_id, new_t);
                        self.game_last_action_ts.write(game_id, ts);
                        InternalImpl::reset_movement_for(ref self, game_id, next_p);
                        self.emit(TurnSubmitted { game_id, player_idx: cur_p, turn_number: new_t });
                        break;
                    },
                    _ => InternalImpl::handle_action(ref self, game_id, cur_p, action),
                }
                i += 1;
            };
        }

        /// Process actions mid-turn without ending the turn.
        /// Used for batching predicted actions with unpredicted ones.
        fn submit_actions(ref self: ContractState, game_id: u64, actions: Array<Action>) {
            let status = self.game_status.read(game_id);
            assert(status == STATUS_ACTIVE, 'Game not active');
            let caller = get_caller_address();
            let cur_p = self.game_current_player.read(game_id);
            let p_addr = self.player_address.read((game_id, cur_p));
            assert(caller == p_addr, 'Not your turn');
            // Timer check
            let ts = get_block_timestamp();
            let last_ts = self.game_last_action_ts.read(game_id);
            assert(
                !turn::check_timeout(last_ts, ts, constants::TURN_TIMEOUT_SECONDS),
                'Turn timed out',
            );
            // Process actions (no end-of-turn, no player switch)
            let span = actions.span();
            let mut i: u32 = 0;
            let len = span.len();
            loop {
                if i >= len { break; }
                let action = *span.at(i);
                match action {
                    Action::EndTurn => {
                        // EndTurn in submit_actions triggers full end-of-turn
                        InternalImpl::process_end_of_turn(ref self, game_id, cur_p);
                        let np = self.game_num_players.read(game_id);
                        let next_p = turn::next_player(cur_p, np);
                        self.game_current_player.write(game_id, next_p);
                        let new_t = self.game_current_turn.read(game_id) + 1;
                        self.game_current_turn.write(game_id, new_t);
                        self.game_last_action_ts.write(game_id, ts);
                        InternalImpl::reset_movement_for(ref self, game_id, next_p);
                        self.game_consecutive_timeouts.write(game_id, 0);
                        self.emit(TurnSubmitted { game_id, player_idx: cur_p, turn_number: new_t });
                        break;
                    },
                    _ => InternalImpl::handle_action(ref self, game_id, cur_p, action),
                }
                i += 1;
            };
        }

        fn forfeit(ref self: ContractState, game_id: u64) {
            assert(self.game_status.read(game_id) == STATUS_ACTIVE, 'Game not active');
            let caller = get_caller_address();
            let p = InternalImpl::find_player(@self, game_id, caller);
            let winner = if p == 0 { 1_u8 } else { 0_u8 };
            InternalImpl::end_game(ref self, game_id, winner, VICTORY_FORFEIT);
        }

        fn claim_timeout_victory(ref self: ContractState, game_id: u64) {
            assert(self.game_status.read(game_id) == STATUS_ACTIVE, 'Game not active');
            let caller = get_caller_address();
            let claimer = InternalImpl::find_player(@self, game_id, caller);
            let cur_p = self.game_current_player.read(game_id);
            assert(claimer != cur_p, 'Cannot timeout yourself');
            let ts = get_block_timestamp();
            let last_ts = self.game_last_action_ts.read(game_id);
            assert(
                turn::check_timeout(last_ts, ts, constants::TURN_TIMEOUT_SECONDS),
                'Timer not expired',
            );
            let tc = self.game_consecutive_timeouts.read(game_id) + 1;
            self.game_consecutive_timeouts.write(game_id, tc);
            if tc >= constants::MAX_CONSECUTIVE_TIMEOUTS {
                InternalImpl::end_game(ref self, game_id, claimer, VICTORY_FORFEIT);
            } else {
                let np = self.game_num_players.read(game_id);
                let next_p = turn::next_player(cur_p, np);
                self.game_current_player.write(game_id, next_p);
                let new_t = self.game_current_turn.read(game_id) + 1;
                self.game_current_turn.write(game_id, new_t);
                // Don't update last_action_ts — timer keeps counting from last real action
                InternalImpl::reset_movement_for(ref self, game_id, next_p);
            }
        }

        // ---- View functions ----
        fn get_game_status(self: @ContractState, game_id: u64) -> u8 { self.game_status.read(game_id) }
        fn get_current_turn(self: @ContractState, game_id: u64) -> u32 { self.game_current_turn.read(game_id) }
        fn get_current_player(self: @ContractState, game_id: u64) -> u8 { self.game_current_player.read(game_id) }
        fn get_player_address(self: @ContractState, game_id: u64, player_idx: u8) -> ContractAddress { self.player_address.read((game_id, player_idx)) }
        fn get_unit(self: @ContractState, game_id: u64, player_idx: u8, unit_id: u32) -> Unit { self.units.read((game_id, player_idx, unit_id)) }
        fn get_unit_count(self: @ContractState, game_id: u64, player_idx: u8) -> u32 { self.player_unit_count.read((game_id, player_idx)) }
        fn get_city(self: @ContractState, game_id: u64, player_idx: u8, city_id: u32) -> City { self.cities.read((game_id, player_idx, city_id)) }
        fn get_city_count(self: @ContractState, game_id: u64, player_idx: u8) -> u32 { self.player_city_count.read((game_id, player_idx)) }
        fn get_tile(self: @ContractState, game_id: u64, q: u8, r: u8) -> TileData { self.tiles.read((game_id, q, r)) }
        fn get_tile_owner(self: @ContractState, game_id: u64, q: u8, r: u8) -> (u8, u32) {
            (self.tile_owner_player.read((game_id, q, r)), self.tile_owner.read((game_id, q, r)))
        }
        fn get_tile_improvement(self: @ContractState, game_id: u64, q: u8, r: u8) -> u8 { self.tile_improvement.read((game_id, q, r)) }
        fn get_treasury(self: @ContractState, game_id: u64, player_idx: u8) -> u32 { self.player_treasury.read((game_id, player_idx)) }
        fn get_completed_techs(self: @ContractState, game_id: u64, player_idx: u8) -> u64 { self.player_completed_techs.read((game_id, player_idx)) }
        fn get_current_research(self: @ContractState, game_id: u64, player_idx: u8) -> u8 { self.player_current_research.read((game_id, player_idx)) }
        fn get_winner(self: @ContractState, game_id: u64) -> u8 { self.game_winner.read(game_id) }
        fn get_score(self: @ContractState, game_id: u64, player_idx: u8) -> u32 { 0 }
        fn get_diplomacy_status(self: @ContractState, game_id: u64, p1: u8, p2: u8) -> u8 { self.diplomacy.read((game_id, p1, p2)) }
    }

    // ----- Internal --------------------------------------------------------
    #[generate_trait]
    impl InternalImpl of InternalTrait {

        fn auto_start(ref self: ContractState, game_id: u64) {
            self.game_status.write(game_id, STATUS_ACTIVE);
            self.game_current_turn.write(game_id, 0);
            self.game_current_player.write(game_id, 0);
            self.game_last_action_ts.write(game_id, get_block_timestamp());

            // Seed from game_id
            let seed = PoseidonTrait::new().update(game_id.into()).finalize();
            self.game_seed.write(game_id, seed);

            // Generate and store map
            let map_tiles = map_gen::generate_map(seed, 32, 20);
            let tile_span = map_tiles.span();
            let mut ti: u32 = 0;
            let tlen = tile_span.len();
            loop {
                if ti >= tlen { break; }
                let (q, r, td) = *tile_span.at(ti);
                self.tiles.write((game_id, q, r), td);
                ti += 1;
            };

            // Store rivers
            let rivers = map_gen::generate_rivers(seed, tile_span);
            let rspan = rivers.span();
            let mut ri: u32 = 0;
            let rlen = rspan.len();
            loop {
                if ri >= rlen { break; }
                let (rq, rr, edges) = *rspan.at(ri);
                let mut t = self.tiles.read((game_id, rq, rr));
                t.river_edges = t.river_edges | edges;
                self.tiles.write((game_id, rq, rr), t);
                ri += 1;
            };

            // Starting positions
            let starts = map_gen::find_starting_positions(tile_span, seed);
            let ((q1, r1), (q2, r2)) = starts.expect('No valid start positions');

            // Ensure neighbors of starting positions have passable terrain
            // so units can move in all directions from spawn
            Self::ensure_passable_neighbors(ref self, game_id, q1, r1);
            Self::ensure_passable_neighbors(ref self, game_id, q2, r2);

            // Player 0: Settler + Warrior
            let mp0 = constants::unit_movement(UNIT_SETTLER);
            self.units.write((game_id, 0, 0), Unit {
                unit_type: UNIT_SETTLER, q: q1, r: r1, hp: 100,
                movement_remaining: mp0, charges: 0, fortify_turns: 0,
            });
            let mp1 = constants::unit_movement(UNIT_WARRIOR);
            self.units.write((game_id, 0, 1), Unit {
                unit_type: UNIT_WARRIOR, q: q1, r: r1, hp: 100,
                movement_remaining: mp1, charges: 0, fortify_turns: 0,
            });
            self.player_unit_count.write((game_id, 0), 2);

            // Player 1: Settler + Warrior
            self.units.write((game_id, 1, 0), Unit {
                unit_type: UNIT_SETTLER, q: q2, r: r2, hp: 100,
                movement_remaining: mp0, charges: 0, fortify_turns: 0,
            });
            self.units.write((game_id, 1, 1), Unit {
                unit_type: UNIT_WARRIOR, q: q2, r: r2, hp: 100,
                movement_remaining: mp1, charges: 0, fortify_turns: 0,
            });
            self.player_unit_count.write((game_id, 1), 2);

            self.emit(GameStarted { game_id });
        }

        // ---- Action dispatcher ----
        fn handle_action(ref self: ContractState, game_id: u64, player: u8, action: Action) {
            match action {
                Action::MoveUnit((uid, dq, dr)) => Self::act_move(ref self, game_id, player, uid, dq, dr),
                Action::AttackUnit((uid, tq, tr)) => Self::act_attack(ref self, game_id, player, uid, tq, tr),
                Action::RangedAttack((uid, tq, tr)) => Self::act_ranged(ref self, game_id, player, uid, tq, tr),
                Action::FoundCity((sid, name)) => Self::act_found_city(ref self, game_id, player, sid, name),
                Action::SetProduction((cid, item)) => Self::act_set_production(ref self, game_id, player, cid, item),
                Action::SetResearch(tid) => Self::act_set_research(ref self, game_id, player, tid),
                Action::BuildImprovement((bid, q, r, imp)) => Self::act_build_improvement(ref self, game_id, player, bid, q, r, imp),
                Action::RemoveImprovement((bid, q, r)) => Self::act_remove_improvement(ref self, game_id, player, bid, q, r),
                Action::FortifyUnit(uid) => Self::act_fortify(ref self, game_id, player, uid),
                Action::SkipUnit(_) => { },
                Action::PurchaseWithGold((cid, item)) => Self::act_purchase(ref self, game_id, player, cid, item),
                Action::UpgradeUnit(uid) => Self::act_upgrade(ref self, game_id, player, uid),
                Action::DeclareWar(target) => Self::act_declare_war(ref self, game_id, player, target),
                Action::EndTurn => { }, // handled in submit_turn
            }
        }

        // ---- MoveUnit ----
        fn act_move(ref self: ContractState, game_id: u64, player: u8, uid: u32, dq: u8, dr: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(uid < uc, 'Invalid unit id');
            let mut unit = self.units.read((game_id, player, uid));
            assert(unit.hp > 0, 'Unit is dead');
            let dest_tile = self.tiles.read((game_id, dq, dr));
            let result = movement::validate_move(
                @unit, dq, dr, @dest_tile, Option::None, 0, player,
            );
            match result {
                Result::Ok(remaining) => {
                    unit.q = dq;
                    unit.r = dr;
                    unit.movement_remaining = remaining;
                    unit.fortify_turns = 0; // moving breaks fortify
                    self.units.write((game_id, player, uid), unit);
                },
                Result::Err(_) => { panic!("Move validation failed"); },
            }
        }

        // ---- AttackUnit ----
        fn act_attack(ref self: ContractState, game_id: u64, player: u8, uid: u32, tq: u8, tr: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(uid < uc, 'Invalid unit id');
            let mut attacker = self.units.read((game_id, player, uid));
            assert(attacker.hp > 0, 'Unit is dead');
            assert(attacker.movement_remaining > 0, 'No movement');
            let atk_cs = constants::unit_combat_strength(attacker.unit_type);
            assert(atk_cs > 0, 'Civilians cannot attack');

            // Find enemy unit at target
            let np = self.game_num_players.read(game_id);
            let mut enemy_player: u8 = 255;
            let mut enemy_uid: u32 = 0;
            let mut found = false;
            let mut ep: u8 = 0;
            loop {
                if ep >= np { break; }
                if ep != player {
                    let euc = self.player_unit_count.read((game_id, ep));
                    let mut eu: u32 = 0;
                    loop {
                        if eu >= euc { break; }
                        let eunit = self.units.read((game_id, ep, eu));
                        if eunit.hp > 0 && eunit.q == tq && eunit.r == tr {
                            enemy_player = ep;
                            enemy_uid = eu;
                            found = true;
                            break;
                        }
                        eu += 1;
                    };
                    if found { break; }
                }
                ep += 1;
            };
            assert(found, 'No enemy at target');
            // Check at war
            let diplo = self.diplomacy.read((game_id, player, enemy_player));
            assert(diplo == DIPLO_WAR, 'Not at war');
            // Check adjacent
            let dist = hex::hex_distance(attacker.q, attacker.r, tq, tr);
            assert(dist == 1, 'Not adjacent');

            let mut defender = self.units.read((game_id, enemy_player, enemy_uid));
            let def_tile = self.tiles.read((game_id, tq, tr));
            let result = combat::resolve_melee(@attacker, @defender, @def_tile, defender.fortify_turns, false);
            // Apply damage
            if result.defender_killed {
                defender.hp = 0;
            } else {
                defender.hp = defender.hp - result.damage_to_defender;
            }
            self.units.write((game_id, enemy_player, enemy_uid), defender);
            if result.attacker_killed {
                attacker.hp = 0;
            } else {
                attacker.hp = attacker.hp - result.damage_to_attacker;
            }
            attacker.movement_remaining = 0;
            attacker.fortify_turns = 0;
            self.units.write((game_id, player, uid), attacker);
        }

        // ---- RangedAttack ----
        fn act_ranged(ref self: ContractState, game_id: u64, player: u8, uid: u32, tq: u8, tr: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(uid < uc, 'Invalid unit id');
            let unit = self.units.read((game_id, player, uid));
            assert(unit.hp > 0, 'Unit is dead');
            let rs = constants::unit_ranged_strength(unit.unit_type);
            assert(rs > 0, 'Not a ranged unit');
            let range = constants::unit_range(unit.unit_type);
            let dist = hex::hex_distance(unit.q, unit.r, tq, tr);
            assert(dist <= range, 'Out of range');

            // Find enemy
            let np = self.game_num_players.read(game_id);
            let mut found = false;
            let mut ep: u8 = 0;
            let mut euid: u32 = 0;
            let mut eplayer: u8 = 0;
            loop {
                if ep >= np { break; }
                if ep != player {
                    let euc = self.player_unit_count.read((game_id, ep));
                    let mut eu: u32 = 0;
                    loop {
                        if eu >= euc { break; }
                        let eunit = self.units.read((game_id, ep, eu));
                        if eunit.hp > 0 && eunit.q == tq && eunit.r == tr {
                            eplayer = ep;
                            euid = eu;
                            found = true;
                            break;
                        }
                        eu += 1;
                    };
                    if found { break; }
                }
                ep += 1;
            };
            assert(found, 'No enemy at target');
            assert(self.diplomacy.read((game_id, player, eplayer)) == DIPLO_WAR, 'Not at war');

            let mut defender = self.units.read((game_id, eplayer, euid));
            let def_tile = self.tiles.read((game_id, tq, tr));
            let result = combat::resolve_ranged(@unit, @defender, @def_tile, defender.fortify_turns);
            if result.defender_killed {
                defender.hp = 0;
            } else {
                defender.hp = defender.hp - result.damage_to_defender;
            }
            self.units.write((game_id, eplayer, euid), defender);
        }

        // ---- FoundCity ----
        fn act_found_city(ref self: ContractState, game_id: u64, player: u8, sid: u32, name: felt252) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(sid < uc, 'Invalid unit id');
            let mut settler = self.units.read((game_id, player, sid));
            assert(settler.hp > 0, 'Unit is dead');
            assert(settler.unit_type == UNIT_SETTLER, 'Not a settler');
            let tile = self.tiles.read((game_id, settler.q, settler.r));
            // Gather existing city positions for distance check
            let mut existing: Array<(u8, u8)> = array![];
            let np = self.game_num_players.read(game_id);
            let mut pi: u8 = 0;
            loop {
                if pi >= np { break; }
                let cc = self.player_city_count.read((game_id, pi));
                let mut ci: u32 = 0;
                loop {
                    if ci >= cc { break; }
                    let c = self.cities.read((game_id, pi, ci));
                    existing.append((c.q, c.r));
                    ci += 1;
                };
                pi += 1;
            };
            let validation = city::validate_city_founding(settler.q, settler.r, @tile, existing.span());
            match validation {
                Result::Ok(()) => {},
                Result::Err(_) => { panic!("City founding failed"); },
            }
            // Create city
            let cid = self.player_city_count.read((game_id, player));
            let is_capital = cid == 0;
            let new_city = City {
                name, q: settler.q, r: settler.r, population: 1, hp: 200,
                food_stockpile: 0, production_stockpile: 0, current_production: 0,
                buildings: 0, founded_turn: self.game_current_turn.read(game_id).try_into().unwrap(),
                original_owner: player, is_capital,
            };
            self.cities.write((game_id, player, cid), new_city);
            self.player_city_count.write((game_id, player), cid + 1);
            // Set territory
            let territory = city::territory_tiles(settler.q, settler.r, 1);
            let tspan = territory.span();
            let mut ti: u32 = 0;
            let tlen = tspan.len();
            loop {
                if ti >= tlen { break; }
                let (tq, tr) = *tspan.at(ti);
                // Only claim unowned tiles
                if self.tile_owner.read((game_id, tq, tr)) == 0 {
                    self.tile_owner.write((game_id, tq, tr), cid + 1); // 1-based
                    self.tile_owner_player.write((game_id, tq, tr), player);
                }
                ti += 1;
            };
            // Consume settler
            settler.hp = 0;
            self.units.write((game_id, player, sid), settler);
            self.emit(CityFounded { game_id, player_idx: player, city_id: cid, q: new_city.q, r: new_city.r });
        }

        // ---- SetProduction ----
        fn act_set_production(ref self: ContractState, game_id: u64, player: u8, cid: u32, item: u8) {
            let cc = self.player_city_count.read((game_id, player));
            assert(cid < cc, 'Invalid city id');
            let mut c = self.cities.read((game_id, player, cid));
            // Validate item
            let cost = constants::production_cost(item);
            assert(cost > 0, 'Invalid production item');
            let techs = self.player_completed_techs.read((game_id, player));
            // If unit, check required tech
            if item >= 1 && item <= 63 {
                let unit_type = item - 1;
                let req = constants::unit_required_tech(unit_type);
                if req != 0 {
                    assert(tech::is_researched(req, techs), 'Tech not researched');
                }
            }
            // If building, check can_build (includes tech + already-built checks)
            if item >= 64 && item <= 127 {
                let bbit = item - 64;
                assert(city::can_build(@c, bbit, techs), 'Cannot build this');
            }
            c.current_production = item;
            self.cities.write((game_id, player, cid), c);
        }

        // ---- SetResearch ----
        fn act_set_research(ref self: ContractState, game_id: u64, player: u8, tid: u8) {
            assert(tid >= 1 && tid <= 18, 'Invalid tech id');
            let techs = self.player_completed_techs.read((game_id, player));
            assert(!tech::is_researched(tid, techs), 'Already researched');
            assert(tech::can_research(tid, techs), 'Prerequisites not met');
            self.player_current_research.write((game_id, player), tid);
        }

        // ---- BuildImprovement ----
        fn act_build_improvement(ref self: ContractState, game_id: u64, player: u8, bid: u32, q: u8, r: u8, imp: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(bid < uc, 'Invalid unit id');
            let mut builder = self.units.read((game_id, player, bid));
            assert(builder.hp > 0, 'Unit is dead');
            assert(builder.unit_type == UNIT_BUILDER, 'Not a builder');
            assert(builder.charges > 0, 'No charges');
            assert(builder.movement_remaining > 0, 'No movement');
            assert(builder.q == q && builder.r == r, 'Not on tile');
            // Check no existing improvement
            let existing = self.tile_improvement.read((game_id, q, r));
            assert(existing == IMPROVEMENT_NONE, 'Already improved');
            // Validate improvement for terrain
            let tile = self.tiles.read((game_id, q, r));
            assert(city::is_valid_improvement_for_tile(imp, tile.terrain, tile.feature), 'Invalid for terrain');
            // Build
            self.tile_improvement.write((game_id, q, r), imp);
            builder.charges -= 1;
            builder.movement_remaining = 0;
            self.units.write((game_id, player, bid), builder);
        }

        // ---- RemoveImprovement ----
        fn act_remove_improvement(ref self: ContractState, game_id: u64, player: u8, bid: u32, q: u8, r: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(bid < uc, 'Invalid unit id');
            let builder = self.units.read((game_id, player, bid));
            assert(builder.hp > 0, 'Unit is dead');
            assert(builder.unit_type == UNIT_BUILDER, 'Not a builder');
            assert(builder.movement_remaining > 0, 'No movement');
            let existing = self.tile_improvement.read((game_id, q, r));
            assert(existing != IMPROVEMENT_NONE, 'No improvement');
            self.tile_improvement.write((game_id, q, r), IMPROVEMENT_NONE);
        }

        // ---- FortifyUnit ----
        fn act_fortify(ref self: ContractState, game_id: u64, player: u8, uid: u32) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(uid < uc, 'Invalid unit id');
            let mut unit = self.units.read((game_id, player, uid));
            assert(unit.hp > 0, 'Unit is dead');
            assert(!constants::is_civilian(unit.unit_type), 'Civilians cant fortify');
            unit.fortify_turns = 1;
            unit.movement_remaining = 0;
            self.units.write((game_id, player, uid), unit);
        }

        // ---- DeclareWar ----
        fn act_declare_war(ref self: ContractState, game_id: u64, player: u8, target: u8) {
            assert(target != player, 'Cannot war yourself');
            let np = self.game_num_players.read(game_id);
            assert(target < np, 'Invalid player');
            self.diplomacy.write((game_id, player, target), DIPLO_WAR);
            self.diplomacy.write((game_id, target, player), DIPLO_WAR);
        }

        // ---- PurchaseWithGold ----
        fn act_purchase(ref self: ContractState, game_id: u64, player: u8, cid: u32, item: u8) {
            let cc = self.player_city_count.read((game_id, player));
            assert(cid < cc, 'Invalid city id');
            let gold = self.player_treasury.read((game_id, player));
            let cost = constants::purchase_cost(item);
            assert(cost > 0, 'Invalid item');
            assert(gold >= cost, 'Not enough gold');
            let techs = self.player_completed_techs.read((game_id, player));
            // Tech checks
            if item >= 1 && item <= 63 {
                let ut = item - 1;
                let req = constants::unit_required_tech(ut);
                if req != 0 {
                    assert(tech::is_researched(req, techs), 'Tech not researched');
                }
            }
            if item >= 64 && item <= 127 {
                let bbit = item - 64;
                let c = self.cities.read((game_id, player, cid));
                assert(city::can_build(@c, bbit, techs), 'Cannot build this');
            }
            self.player_treasury.write((game_id, player), gold - cost);
            // Create unit or building
            if item >= 1 && item <= 63 {
                let ut = item - 1;
                let uid = self.player_unit_count.read((game_id, player));
                let c = self.cities.read((game_id, player, cid));
                self.units.write((game_id, player, uid), Unit {
                    unit_type: ut, q: c.q, r: c.r, hp: 100,
                    movement_remaining: 0, charges: if ut == UNIT_BUILDER { 3 } else { 0 },
                    fortify_turns: 0,
                });
                self.player_unit_count.write((game_id, player), uid + 1);
            } else if item >= 64 && item <= 127 {
                let bbit = item - 64;
                let mut c = self.cities.read((game_id, player, cid));
                c.buildings = c.buildings | Self::pow2_u32(bbit.into());
                self.cities.write((game_id, player, cid), c);
            }
        }

        // ---- UpgradeUnit ----
        fn act_upgrade(ref self: ContractState, game_id: u64, player: u8, uid: u32) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(uid < uc, 'Invalid unit id');
            let mut unit = self.units.read((game_id, player, uid));
            assert(unit.hp > 0, 'Unit is dead');
            let (to_type, req_tech) = constants::unit_upgrade_path(unit.unit_type);
            assert(to_type > 0, 'No upgrade path');
            let techs = self.player_completed_techs.read((game_id, player));
            assert(tech::is_researched(req_tech, techs), 'Tech not researched');
            let cost = constants::unit_upgrade_cost(unit.unit_type);
            let gold = self.player_treasury.read((game_id, player));
            assert(gold >= cost, 'Not enough gold');
            self.player_treasury.write((game_id, player), gold - cost);
            unit.unit_type = to_type;
            self.units.write((game_id, player, uid), unit);
        }

        // ---- End of turn processing ----
        fn process_end_of_turn(ref self: ContractState, game_id: u64, player: u8) {
            let cc = self.player_city_count.read((game_id, player));

            // If the player has at least one city, research must be set
            if cc > 0 {
                let cur_research = self.player_current_research.read((game_id, player));
                // research 0 = none; also allow if all techs already done
                if cur_research == 0 {
                    let techs = self.player_completed_techs.read((game_id, player));
                    // Check if there's any tech left to research (IDs 1..18)
                    let mut has_available: bool = false;
                    let mut tid: u8 = 1;
                    loop {
                        if tid > 18 { break; }
                        if !tech::is_researched(tid, techs) && tech::can_research(tid, techs) {
                            has_available = true;
                            break;
                        }
                        tid += 1;
                    };
                    assert(!has_available, 'Must set research target');
                }
            }

            // Every city must have a production target
            let mut pi: u32 = 0;
            loop {
                if pi >= cc { break; }
                let c = self.cities.read((game_id, player, pi));
                assert(c.current_production != 0, 'City has no production');
                pi += 1;
            };

            let mut total_gold_income: u32 = 0;
            let mut total_half_science: u32 = 0;
            let mut military_count: u32 = 0;

            // Process each city
            let mut ci: u32 = 0;
            loop {
                if ci >= cc { break; }
                let mut c = self.cities.read((game_id, player, ci));

                // Compute basic yields from territory tiles
                let radius = constants::territory_radius(c.population);
                let tiles_in_range = hex::hexes_in_range(c.q, c.r, radius);
                let tspan = tiles_in_range.span();
                let mut food: u16 = 0;
                let mut prod: u16 = 0;
                let mut gold: u16 = 0;
                let mut ti: u32 = 0;
                let tlen = tspan.len();
                // Only work population number of tiles
                let max_tiles: u32 = c.population.into();
                let work_count = if tlen < max_tiles { tlen } else { max_tiles };
                loop {
                    if ti >= work_count { break; }
                    let (tq, tr) = *tspan.at(ti);
                    let td = self.tiles.read((game_id, tq, tr));
                    let imp = self.tile_improvement.read((game_id, tq, tr));
                    // City center tile gets guaranteed minimum 2 food / 1 production
                    let y = if tq == c.q && tr == c.r {
                        city::compute_city_center_yield(@td, imp)
                    } else {
                        city::compute_tile_yield(@td, imp)
                    };
                    food += y.food.into();
                    prod += y.production.into();
                    gold += y.gold.into();
                    ti += 1;
                };
                // Palace bonus
                if c.is_capital {
                    prod += constants::PALACE_PRODUCTION_BONUS;
                    gold += constants::PALACE_GOLD_BONUS;
                    total_half_science += constants::PALACE_HALF_SCIENCE_BONUS.into();
                }
                // Food consumption
                let consumption: u16 = constants::FOOD_PER_CITIZEN * c.population.into();
                let food_surplus: i16 = if food >= consumption {
                    (food - consumption).try_into().unwrap()
                } else {
                    let deficit: u16 = consumption - food;
                    -(deficit.try_into().unwrap())
                };
                // Check for river adjacency (inline)
                let city_tile = self.tiles.read((game_id, c.q, c.r));
                let has_river = city_tile.river_edges > 0;
                let has_coast = false; // simplified
                let housing = city::compute_housing(@c, has_river, has_coast);
                // Growth
                let (new_pop, new_food) = city::process_growth(c.population, c.food_stockpile, food_surplus, housing);
                c.population = new_pop;
                c.food_stockpile = new_food;
                // Update territory if population changed
                if new_pop > c.population {
                    let new_rad = constants::territory_radius(new_pop);
                    if new_rad > radius {
                        let new_tiles = hex::hexes_in_range(c.q, c.r, new_rad);
                        let nts = new_tiles.span();
                        let mut ni: u32 = 0;
                        let nlen = nts.len();
                        loop {
                            if ni >= nlen { break; }
                            let (nq, nr) = *nts.at(ni);
                            if self.tile_owner.read((game_id, nq, nr)) == 0 {
                                self.tile_owner.write((game_id, nq, nr), ci + 1);
                                self.tile_owner_player.write((game_id, nq, nr), player);
                            }
                            ni += 1;
                        };
                    }
                }
                // Production
                if c.current_production > 0 {
                    let (new_stockpile, completed) = city::process_production(c.current_production, c.production_stockpile, prod);
                    c.production_stockpile = new_stockpile;
                    if completed > 0 {
                        Self::handle_production_complete(ref self, game_id, player, ci, completed, c.q, c.r);
                        // Re-read city to pick up building bit changes from handle_production_complete
                        c = self.cities.read((game_id, player, ci));
                        c.production_stockpile = new_stockpile;
                        c.current_production = 0; // reset after completion
                    }
                } else {
                    c.production_stockpile = 0;
                }
                total_gold_income += gold.into();
                self.cities.write((game_id, player, ci), c);
                ci += 1;
            };

            // Count military units for maintenance
            let uc = self.player_unit_count.read((game_id, player));
            let mut ui: u32 = 0;
            loop {
                if ui >= uc { break; }
                let u = self.units.read((game_id, player, ui));
                if u.hp > 0 && !constants::is_civilian(u.unit_type) {
                    military_count += 1;
                }
                ui += 1;
            };

            // Gold accounting
            let net_gold = economy::compute_net_gold(total_gold_income, military_count);
            let treasury = self.player_treasury.read((game_id, player));
            let (new_treasury, _disband) = economy::update_treasury(treasury, net_gold);
            self.player_treasury.write((game_id, player), new_treasury);

            // Tech research
            let cur_tech = self.player_current_research.read((game_id, player));
            if cur_tech > 0 {
                let acc = self.player_accumulated_half_science.read((game_id, player));
                let half_sci: u16 = total_half_science.try_into().unwrap();
                let (new_acc, completed_tech) = tech::process_research(cur_tech, acc, half_sci);
                self.player_accumulated_half_science.write((game_id, player), new_acc);
                if completed_tech > 0 {
                    let techs = self.player_completed_techs.read((game_id, player));
                    let new_techs = tech::mark_researched(completed_tech, techs);
                    self.player_completed_techs.write((game_id, player), new_techs);
                    self.player_current_research.write((game_id, player), 0);
                    self.emit(TechCompleted { game_id, player_idx: player, tech_id: completed_tech });
                }
            }

            // Heal units
            Self::heal_units(ref self, game_id, player);
        }

        fn handle_production_complete(ref self: ContractState, game_id: u64, player: u8, cid: u32, item: u8, city_q: u8, city_r: u8) {
            if item >= 1 && item <= 63 {
                // Unit produced
                let ut = item - 1;
                let uid = self.player_unit_count.read((game_id, player));
                self.units.write((game_id, player, uid), Unit {
                    unit_type: ut, q: city_q, r: city_r, hp: 100,
                    movement_remaining: 0,
                    charges: if ut == UNIT_BUILDER { constants::BUILDER_STARTING_CHARGES } else { 0 },
                    fortify_turns: 0,
                });
                self.player_unit_count.write((game_id, player), uid + 1);
            } else if item >= 64 && item <= 127 {
                // Building completed
                let bbit = item - 64;
                let mut c = self.cities.read((game_id, player, cid));
                c.buildings = c.buildings | Self::pow2_u32(bbit.into());
                self.cities.write((game_id, player, cid), c);
                self.emit(BuildingCompleted { game_id, player_idx: player, city_id: cid, building_bit: bbit });
            }
        }

        fn heal_units(ref self: ContractState, game_id: u64, player: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            let mut ui: u32 = 0;
            loop {
                if ui >= uc { break; }
                let mut u = self.units.read((game_id, player, ui));
                if u.hp > 0 && u.hp < 100 {
                    // Simplified: always heal as if in friendly territory
                    let new_hp = turn::heal_unit(@u, true, false, u.fortify_turns > 0);
                    u.hp = new_hp;
                    self.units.write((game_id, player, ui), u);
                }
                ui += 1;
            };
        }

        fn reset_movement_for(ref self: ContractState, game_id: u64, player: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            let mut ui: u32 = 0;
            loop {
                if ui >= uc { break; }
                let mut u = self.units.read((game_id, player, ui));
                if u.hp > 0 {
                    u.movement_remaining = turn::reset_movement(@u);
                    // Increment fortify turns for fortified units
                    if u.fortify_turns > 0 && u.fortify_turns < 2 {
                        u.fortify_turns = u.fortify_turns + 1;
                    }
                    self.units.write((game_id, player, ui), u);
                }
                ui += 1;
            };
        }

        fn end_game(ref self: ContractState, game_id: u64, winner: u8, vtype: u8) {
            self.game_status.write(game_id, STATUS_FINISHED);
            self.game_winner.write(game_id, winner);
            self.game_victory_type.write(game_id, vtype);
            self.emit(GameEnded { game_id, winner, victory_type: vtype });
        }

        fn find_player(self: @ContractState, game_id: u64, addr: ContractAddress) -> u8 {
            let np = self.game_num_players.read(game_id);
            let mut i: u8 = 0;
            loop {
                if i >= np { panic!("Not a player"); break 0; }
                if self.player_address.read((game_id, i)) == addr {
                    break i;
                }
                i += 1;
            }
        }

        fn pow2_u32(n: u32) -> u32 {
            if n == 0 { return 1; }
            let mut r: u32 = 1;
            let mut i: u32 = 0;
            loop { if i >= n { break; } r *= 2; i += 1; };
            r
        }

        /// Ensure the 6 hex neighbors of a starting position are passable land.
        /// If any neighbor is water or mountain, override it to TERRAIN_GRASSLAND.
        fn ensure_passable_neighbors(ref self: ContractState, game_id: u64, q: u8, r: u8) {
            use cairo_civ::types::{
                TERRAIN_OCEAN, TERRAIN_COAST, TERRAIN_MOUNTAIN, TERRAIN_GRASSLAND,
                FEATURE_NONE, RESOURCE_NONE, MAP_WIDTH, MAP_HEIGHT,
            };
            // 6 hex directions: E(+1,0), NE(+1,-1), NW(0,-1), W(-1,0), SW(-1,+1), SE(0,+1)
            let dirs: [(i16, i16); 6] = [
                (1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1),
            ];
            let mut d: u32 = 0;
            loop {
                if d >= 6 { break; }
                let (dq, dr) = *dirs.span().at(d);
                let nq: i16 = q.into() + dq;
                let nr: i16 = r.into() + dr;
                if nq >= 0 && nq < MAP_WIDTH.into() && nr >= 0 && nr < MAP_HEIGHT.into() {
                    let nq_u8: u8 = nq.try_into().unwrap();
                    let nr_u8: u8 = nr.try_into().unwrap();
                    let t = self.tiles.read((game_id, nq_u8, nr_u8));
                    if t.terrain == TERRAIN_OCEAN
                        || t.terrain == TERRAIN_COAST
                        || t.terrain == TERRAIN_MOUNTAIN
                    {
                        self.tiles.write(
                            (game_id, nq_u8, nr_u8),
                            TileData {
                                terrain: TERRAIN_GRASSLAND,
                                feature: FEATURE_NONE,
                                resource: RESOURCE_NONE,
                                river_edges: 0,
                            },
                        );
                    }
                }
                d += 1;
            };
        }
    }
}

