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
    fn get_accumulated_science(self: @TContractState, game_id: u64, player_idx: u8, tech_id: u8) -> u32;
    fn get_winner(self: @TContractState, game_id: u64) -> u8;
    fn get_score(self: @TContractState, game_id: u64, player_idx: u8) -> u32;
    fn get_diplomacy_status(self: @TContractState, game_id: u64, p1: u8, p2: u8) -> u8;
    fn get_city_locked_count(self: @TContractState, game_id: u64, player_idx: u8, city_id: u32) -> u8;
    fn get_city_locked_tile(self: @TContractState, game_id: u64, player_idx: u8, city_id: u32, slot: u8) -> (u8, u8);
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
        game_seed: Map<u64, felt252>,
        player_address: Map<(u64, u8), ContractAddress>,
        player_treasury: Map<(u64, u8), u32>,
        player_completed_techs: Map<(u64, u8), u64>,
        player_current_research: Map<(u64, u8), u8>,
        // Per-tech accumulated half-science: (game_id, player, tech_id) → accumulated
        tech_accumulated_half_science: Map<(u64, u8, u8), u32>,
        player_unit_count: Map<(u64, u8), u32>,
        player_city_count: Map<(u64, u8), u32>,
        player_kills: Map<(u64, u8), u32>,
        player_captured_cities: Map<(u64, u8), u32>,
        diplomacy: Map<(u64, u8, u8), u8>,
        units: Map<(u64, u8, u32), Unit>,
        cities: Map<(u64, u8, u32), City>,
        tiles: Map<(u64, u8, u8), TileData>,
        // Packed tile ownership: upper 8 bits = player, lower 32 bits = city_id+1 (0=unowned)
        tile_ownership: Map<(u64, u8, u8), u64>,
        tile_improvement: Map<(u64, u8, u8), u8>,
        // Citizen tile assignments: locked tiles per city
        // slot index → (q, r); count tracks how many are locked
        city_locked_count: Map<(u64, u8, u32), u8>,
        // Packed (q, r) per locked slot: low 8 bits = q, high 8 bits = r
        city_locked_tile: Map<(u64, u8, u32, u8), u16>,
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
            // Process actions
            let span = actions.span();
            let mut i: u32 = 0;
            let len = span.len();
            let mut turn_ended = false;
            while i < len && !turn_ended {
                let action = *span.at(i);
                match action {
                    Action::EndTurn => {
                        InternalImpl::process_end_of_turn(ref self, game_id, cur_p);
                        let np = self.game_num_players.read(game_id);
                        let next_p = turn::next_player(cur_p, np);
                        self.game_current_player.write(game_id, next_p);
                        let new_t = self.game_current_turn.read(game_id) + 1;
                        self.game_current_turn.write(game_id, new_t);
                        InternalImpl::reset_movement_for(ref self, game_id, next_p);
                        self.emit(TurnSubmitted { game_id, player_idx: cur_p, turn_number: new_t });
                        turn_ended = true;
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
            // Process actions (no end-of-turn, no player switch)
            let span = actions.span();
            let mut i: u32 = 0;
            let len = span.len();
            let mut turn_ended = false;
            while i < len && !turn_ended {
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
                        InternalImpl::reset_movement_for(ref self, game_id, next_p);
                        self.emit(TurnSubmitted { game_id, player_idx: cur_p, turn_number: new_t });
                        turn_ended = true;
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
            let packed = self.tile_ownership.read((game_id, q, r));
            let city_id = (packed & 0xFFFFFFFF).try_into().unwrap();
            let player_idx: u8 = ((packed / 0x100000000) & 0xFF).try_into().unwrap();
            (player_idx, city_id)
        }
        fn get_tile_improvement(self: @ContractState, game_id: u64, q: u8, r: u8) -> u8 { self.tile_improvement.read((game_id, q, r)) }
        fn get_treasury(self: @ContractState, game_id: u64, player_idx: u8) -> u32 { self.player_treasury.read((game_id, player_idx)) }
        fn get_completed_techs(self: @ContractState, game_id: u64, player_idx: u8) -> u64 { self.player_completed_techs.read((game_id, player_idx)) }
        fn get_current_research(self: @ContractState, game_id: u64, player_idx: u8) -> u8 { self.player_current_research.read((game_id, player_idx)) }
        fn get_accumulated_science(self: @ContractState, game_id: u64, player_idx: u8, tech_id: u8) -> u32 { self.tech_accumulated_half_science.read((game_id, player_idx, tech_id)) }
        fn get_winner(self: @ContractState, game_id: u64) -> u8 { self.game_winner.read(game_id) }
        fn get_score(self: @ContractState, game_id: u64, player_idx: u8) -> u32 { 0 }
        fn get_diplomacy_status(self: @ContractState, game_id: u64, p1: u8, p2: u8) -> u8 { self.diplomacy.read((game_id, p1, p2)) }
        fn get_city_locked_count(self: @ContractState, game_id: u64, player_idx: u8, city_id: u32) -> u8 {
            self.city_locked_count.read((game_id, player_idx, city_id))
        }
        fn get_city_locked_tile(self: @ContractState, game_id: u64, player_idx: u8, city_id: u32, slot: u8) -> (u8, u8) {
            let packed = self.city_locked_tile.read((game_id, player_idx, city_id, slot));
            ((packed & 0xFF).try_into().unwrap(), ((packed / 0x100) & 0xFF).try_into().unwrap())
        }
    }

    // ----- Internal --------------------------------------------------------
    #[generate_trait]
    impl InternalImpl of InternalTrait {

        fn auto_start(ref self: ContractState, game_id: u64) {
            self.game_status.write(game_id, STATUS_ACTIVE);
            self.game_current_turn.write(game_id, 0);
            self.game_current_player.write(game_id, 0);

            // Seed from game_id + block timestamp + caller for randomness
            let seed = PoseidonTrait::new()
                .update(game_id.into())
                .update(get_block_timestamp().into())
                .update(get_caller_address().into())
                .finalize();
            self.game_seed.write(game_id, seed);

            // Generate and store map
            let map_tiles = map_gen::generate_map(seed, 32, 20);
            let tile_span = map_tiles.span();
            let mut ti: u32 = 0;
            let tlen = tile_span.len();
            while ti < tlen {
                let (q, r, td) = *tile_span.at(ti);
                self.tiles.write((game_id, q, r), td);
                ti += 1;
            };

            // Store rivers
            let rivers = map_gen::generate_rivers(seed, tile_span);
            let rspan = rivers.span();
            let mut ri: u32 = 0;
            let rlen = rspan.len();
            while ri < rlen {
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
                Action::AssignCitizen((cid, tq, tr)) => Self::act_assign_citizen(ref self, game_id, player, cid, tq, tr),
                Action::UnassignCitizen((cid, tq, tr)) => Self::act_unassign_citizen(ref self, game_id, player, cid, tq, tr),
                Action::EndTurn => { }, // handled in submit_turn
            }
        }

        // ---- MoveUnit ----
        fn act_move(ref self: ContractState, game_id: u64, player: u8, uid: u32, dq: u8, dr: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            assert(uid < uc, 'Invalid unit id');
            let mut unit = self.units.read((game_id, player, uid));
            assert(unit.hp > 0, 'Unit is dead');
            assert(unit.movement_remaining > 0, 'No movement');
            assert(hex::in_bounds(dq, dr), 'Out of bounds');

            let dist = hex::hex_distance(unit.q, unit.r, dq, dr);
            assert(dist > 0, 'Already there');

            if dist == 1 {
                // Adjacent: simple single-step move
                let dest_tile = self.tiles.read((game_id, dq, dr));
                let cost = movement::tile_movement_cost(@dest_tile);
                assert(cost > 0, 'Impassable');
                assert(unit.movement_remaining >= cost, 'Insufficient MP');
                // Step through this tile (hook point for ZOC / fog of war)
                unit.q = dq;
                unit.r = dr;
                unit.movement_remaining -= cost;
                unit.fortify_turns = 0;
                self.units.write((game_id, player, uid), unit);
            } else {
                // Multi-tile: Dijkstra pathfinding with parent tracking.
                // Finds shortest path, then walks it tile-by-tile so future
                // features (zone of control, fog of war discovery) work.
                //
                // Visited entries: (q, r, best_mp_remaining, parent_q, parent_r)
                // Max reachable tiles with MP<=3 is ~37, so linear scans are fine.
                let start_q = unit.q;
                let start_r = unit.r;
                let mp = unit.movement_remaining;

                // visited[0] = start node (parent points to itself)
                let mut visited: Array<(u8, u8, u8, u8, u8)> = array![
                    (start_q, start_r, mp, start_q, start_r)
                ];
                let mut open: Array<(u8, u8, u8)> = array![(start_q, start_r, mp)];
                let mut found = false;

                while !found {
                    // Pick the open entry with highest remaining MP (Dijkstra)
                    let ospan = open.span();
                    let olen = ospan.len();
                    if olen == 0 { break; }
                    let mut best_idx: u32 = 0;
                    let mut best_mp: u8 = 0;
                    let mut bi: u32 = 0;
                    while bi < olen {
                        let (_, _, omp) = *ospan.at(bi);
                        if omp > best_mp {
                            best_mp = omp;
                            best_idx = bi;
                        }
                        bi += 1;
                    };
                    if best_mp == 0 { break; }
                    let (cq, cr, cmp) = *ospan.at(best_idx);

                    // Remove from open by zeroing MP
                    let mut new_open: Array<(u8, u8, u8)> = array![];
                    let mut ri: u32 = 0;
                    while ri < olen {
                        if ri == best_idx {
                            new_open.append((cq, cr, 0));
                        } else {
                            new_open.append(*ospan.at(ri));
                        }
                        ri += 1;
                    };

                    // Expand neighbors
                    let neighbors = hex::hex_neighbors(cq, cr);
                    let nspan = neighbors.span();
                    let mut ni: u32 = 0;
                    let nlen = nspan.len();
                    while ni < nlen {
                        let (nq, nr) = *nspan.at(ni);
                        let td = self.tiles.read((game_id, nq, nr));
                        let cost = movement::tile_movement_cost(@td);
                        if cost > 0 && cmp >= cost {
                            let new_mp = cmp - cost;
                            // Check if already visited with equal or better MP
                            let mut already_better = false;
                            let vspan = visited.span();
                            let mut vi: u32 = 0;
                            while vi < vspan.len() {
                                let (vq, vr, vmp, _, _) = *vspan.at(vi);
                                if vq == nq && vr == nr && vmp >= new_mp {
                                    already_better = true;
                                    break;
                                }
                                vi += 1;
                            };
                            if !already_better {
                                // Record with parent = (cq, cr)
                                visited.append((nq, nr, new_mp, cq, cr));
                                if nq == dq && nr == dr {
                                    found = true;
                                } else {
                                    new_open.append((nq, nr, new_mp));
                                }
                            }
                        }
                        ni += 1;
                    };
                    open = new_open;
                };

                assert(found, 'Cannot reach destination');

                // Reconstruct path from destination back to start using parents
                let vspan = visited.span();
                let vlen = vspan.len();
                let mut path: Array<(u8, u8)> = array![(dq, dr)];
                let mut cur_q = dq;
                let mut cur_r = dr;
                let mut safety: u32 = 0;
                while (cur_q != start_q || cur_r != start_r) && safety < 10 {
                    // Find this tile's parent in visited (scan from end for latest/best entry)
                    let mut pi: u32 = vlen;
                    while pi > 0 {
                        pi -= 1;
                        let (vq, vr, _, pq, pr) = *vspan.at(pi);
                        if vq == cur_q && vr == cur_r {
                            cur_q = pq;
                            cur_r = pr;
                            break;
                        }
                    };
                    if cur_q != start_q || cur_r != start_r {
                        path.append((cur_q, cur_r));
                    }
                    safety += 1;
                };

                // Path is in reverse order (dest first). Walk it backwards.
                let pspan = path.span();
                let plen = pspan.len();
                let mut step: u32 = plen;
                while step > 0 {
                    step -= 1;
                    let (sq, sr) = *pspan.at(step);
                    let td = self.tiles.read((game_id, sq, sr));
                    let cost = movement::tile_movement_cost(@td);

                    // Step through this tile — unit physically enters it.
                    // Future hook: check ZOC, discover fog-of-war tiles in LOS, etc.
                    unit.q = sq;
                    unit.r = sr;
                    unit.movement_remaining -= cost;
                };

                unit.fortify_turns = 0;
                self.units.write((game_id, player, uid), unit);
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
            while ep < np && !found {
                if ep != player {
                    let euc = self.player_unit_count.read((game_id, ep));
                    let mut eu: u32 = 0;
                    while eu < euc && !found {
                        let eunit = self.units.read((game_id, ep, eu));
                        if eunit.hp > 0 && eunit.q == tq && eunit.r == tr {
                            enemy_player = ep;
                            enemy_uid = eu;
                            found = true;
                        }
                        eu += 1;
                    };
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
            while ep < np && !found {
                if ep != player {
                    let euc = self.player_unit_count.read((game_id, ep));
                    let mut eu: u32 = 0;
                    while eu < euc && !found {
                        let eunit = self.units.read((game_id, ep, eu));
                        if eunit.hp > 0 && eunit.q == tq && eunit.r == tr {
                            eplayer = ep;
                            euid = eu;
                            found = true;
                        }
                        eu += 1;
                    };
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
            while pi < np {
                let cc = self.player_city_count.read((game_id, pi));
                let mut ci: u32 = 0;
                while ci < cc {
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
            while ti < tlen {
                let (tq, tr) = *tspan.at(ti);
                // Only claim unowned tiles
                if self.tile_ownership.read((game_id, tq, tr)) == 0 {
                    let packed: u64 = (cid + 1).into() | (Into::<u8, u64>::into(player) * 0x100000000);
                    self.tile_ownership.write((game_id, tq, tr), packed);
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
            // Reset stockpile when switching production target
            if c.current_production != item {
                c.production_stockpile = 0;
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

        // ---- AssignCitizen: lock a citizen to work a specific tile ----
        fn act_assign_citizen(ref self: ContractState, game_id: u64, player: u8, cid: u32, tq: u8, tr: u8) {
            let cc = self.player_city_count.read((game_id, player));
            assert(cid < cc, 'Invalid city id');
            let c = self.cities.read((game_id, player, cid));
            // Tile must be in city territory
            let packed_own = self.tile_ownership.read((game_id, tq, tr));
            let owner_city: u32 = (packed_own & 0xFFFFFFFF).try_into().unwrap();
            let owner_player: u8 = ((packed_own / 0x100000000) & 0xFF).try_into().unwrap();
            assert(owner_city == cid + 1 && owner_player == player, 'Tile not in city territory');
            // Can't lock city center (it's always worked for free)
            assert(tq != c.q || tr != c.r, 'Cannot lock city center');
            // Tile must be workable (not mountain/ocean)
            let td = self.tiles.read((game_id, tq, tr));
            assert(td.terrain != 0 && td.terrain != 12, 'Tile not workable');
            // Can't exceed population count (center doesn't use a slot)
            let mut count = self.city_locked_count.read((game_id, player, cid));
            assert(count < c.population, 'All citizens assigned');
            // Check not already locked
            let packed_new: u16 = tq.into() | (Into::<u8, u16>::into(tr) * 0x100);
            let mut si: u8 = 0;
            while si < count {
                let locked = self.city_locked_tile.read((game_id, player, cid, si));
                assert(locked != packed_new, 'Tile already assigned');
                si += 1;
            };
            // Add to locked list
            self.city_locked_tile.write((game_id, player, cid, count), packed_new);
            self.city_locked_count.write((game_id, player, cid), count + 1);
        }

        // ---- UnassignCitizen: remove lock from a tile ----
        fn act_unassign_citizen(ref self: ContractState, game_id: u64, player: u8, cid: u32, tq: u8, tr: u8) {
            let cc = self.player_city_count.read((game_id, player));
            assert(cid < cc, 'Invalid city id');
            let count = self.city_locked_count.read((game_id, player, cid));
            let target: u16 = tq.into() | (Into::<u8, u16>::into(tr) * 0x100);
            // Find the tile in the locked list
            let mut found_slot: u8 = 255;
            let mut si: u8 = 0;
            while si < count {
                let locked = self.city_locked_tile.read((game_id, player, cid, si));
                if locked == target {
                    found_slot = si;
                    break;
                }
                si += 1;
            };
            assert(found_slot != 255, 'Tile not assigned');
            // Swap with last and decrement count
            let last = count - 1;
            if found_slot != last {
                let last_tile = self.city_locked_tile.read((game_id, player, cid, last));
                self.city_locked_tile.write((game_id, player, cid, found_slot), last_tile);
            }
            // Clear last slot and update count
            self.city_locked_tile.write((game_id, player, cid, last), 0);
            self.city_locked_count.write((game_id, player, cid), last);
        }

        // ---- Compute worked tiles for a city ----
        // The city center is ALWAYS worked (free, doesn't use a population slot).
        // Each citizen (population) works one additional tile: locked first, then auto best-yield.
        fn compute_worked_tiles(
            self: @ContractState, game_id: u64, player: u8, cid: u32,
            city_q: u8, city_r: u8, population: u8, radius: u8,
        ) -> Array<(u8, u8)> {
            let mut result: Array<(u8, u8)> = array![];

            // 0. City center is always worked (free)
            result.append((city_q, city_r));

            // Additional tiles = population count
            let max_additional: u32 = population.into();
            let mut additional: u32 = 0;

            // 1. Collect locked tiles (filter out any no longer in territory)
            let locked_count = self.city_locked_count.read((game_id, player, cid));
            let mut li: u8 = 0;
            while li < locked_count && additional < max_additional {
                let packed_lock = self.city_locked_tile.read((game_id, player, cid, li));
                let lq: u8 = (packed_lock & 0xFF).try_into().unwrap();
                let lr: u8 = ((packed_lock / 0x100) & 0xFF).try_into().unwrap();
                // Skip city center (already in result)
                if lq != city_q || lr != city_r {
                    // Verify still in territory
                    let po = self.tile_ownership.read((game_id, lq, lr));
                    let ow: u32 = (po & 0xFFFFFFFF).try_into().unwrap();
                    let op: u8 = ((po / 0x100000000) & 0xFF).try_into().unwrap();
                    if ow == cid + 1 && op == player {
                        result.append((lq, lr));
                        additional += 1;
                    }
                }
                li += 1;
            };

            if additional >= max_additional {
                return result;
            }

            // 2. Gather all territory tiles with yields, excluding center and locked
            let all_tiles = hex::hexes_in_range(city_q, city_r, radius);
            let at_span = all_tiles.span();
            let at_len = at_span.len();

            // Build scored list: (score, q, r) for auto-assignment
            // Score = food*3 + production*2 + gold*1 (prioritize food, then prod)
            let mut scored: Array<(u16, u8, u8)> = array![];
            let mut ai: u32 = 0;
            while ai < at_len {
                let (aq, ar) = *at_span.at(ai);
                // Skip city center (already worked for free)
                if aq == city_q && ar == city_r {
                    ai += 1;
                    continue;
                }
                // Skip if already in locked set
                let mut is_locked = false;
                let rspan = result.span();
                let mut ri: u32 = 0;
                while ri < rspan.len() {
                    let (rq, rr) = *rspan.at(ri);
                    if rq == aq && rr == ar {
                        is_locked = true;
                        break;
                    }
                    ri += 1;
                };
                if !is_locked {
                    let td = self.tiles.read((game_id, aq, ar));
                    // Skip unworkable tiles
                    if td.terrain != 0 && td.terrain != 12 {
                        let imp = self.tile_improvement.read((game_id, aq, ar));
                        let y = city::compute_tile_yield(@td, imp);
                        let score: u16 = y.food.into() * 3 + y.production.into() * 2 + y.gold.into();
                        scored.append((score, aq, ar));
                    }
                }
                ai += 1;
            };

            // 3. Sort by score descending (simple selection sort — small arrays)
            let scored_span = scored.span();
            let slen = scored_span.len();
            let mut sorted_indices: Array<u32> = array![];
            let mut used: Array<bool> = array![];
            let mut ui: u32 = 0;
            while ui < slen {
                sorted_indices.append(ui);
                used.append(false);
                ui += 1;
            };

            let remaining = max_additional - additional;
            let mut picked: u32 = 0;
            while picked < remaining && picked < slen {
                // Find best unused
                let mut best_idx: u32 = 0;
                let mut best_score: u16 = 0;
                let mut found_any = false;
                let mut si2: u32 = 0;
                while si2 < slen {
                    if !*used.at(si2) {
                        let (sc, _, _) = *scored_span.at(si2);
                        if !found_any || sc > best_score {
                            best_score = sc;
                            best_idx = si2;
                            found_any = true;
                        }
                    }
                    si2 += 1;
                };
                if !found_any { break; }
                // Mark used
                used = Self::array_set_bool(used, best_idx, true);
                let (_, bq, br) = *scored_span.at(best_idx);
                result.append((bq, br));
                picked += 1;
            };

            result
        }

        /// Helper: set a bool in an array at index (rebuild)
        fn array_set_bool(arr: Array<bool>, idx: u32, val: bool) -> Array<bool> {
            let span = arr.span();
            let len = span.len();
            let mut r: Array<bool> = array![];
            let mut i: u32 = 0;
            while i < len {
                if i == idx { r.append(val); } else { r.append(*span.at(i)); }
                i += 1;
            };
            r
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
                    while tid <= 18 && !has_available {
                        if !tech::is_researched(tid, techs) && tech::can_research(tid, techs) {
                            has_available = true;
                        }
                        tid += 1;
                    };
                    assert(!has_available, 'Must set research target');
                }
            }

            // Every city must have a production target
            let mut pi: u32 = 0;
            while pi < cc {
                let c = self.cities.read((game_id, player, pi));
                assert(c.current_production != 0, 'City has no production');
                pi += 1;
            };

            let mut total_gold_income: u32 = 0;
            let mut total_half_science: u32 = 0;
            let mut military_count: u32 = 0;

            // Process each city
            let mut ci: u32 = 0;
            while ci < cc {
                let mut c = self.cities.read((game_id, player, ci));

                // Compute worked tiles using smart assignment (locked + auto best-yield)
                let radius = constants::territory_radius(c.population);
                let worked = Self::compute_worked_tiles(@self, game_id, player, ci, c.q, c.r, c.population, radius);
                let wspan = worked.span();
                let wlen = wspan.len();
                let mut food: u16 = 0;
                let mut prod: u16 = 0;
                let mut gold: u16 = 0;
                let mut ti: u32 = 0;
                while ti < wlen {
                    let (tq, tr) = *wspan.at(ti);
                    let td = self.tiles.read((game_id, tq, tr));
                    let imp = self.tile_improvement.read((game_id, tq, tr));
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
                        while ni < nlen {
                            let (nq, nr) = *nts.at(ni);
                            if self.tile_ownership.read((game_id, nq, nr)) == 0 {
                                let packed: u64 = (ci + 1).into() | (Into::<u8, u64>::into(player) * 0x100000000);
                                self.tile_ownership.write((game_id, nq, nr), packed);
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

            // Single pass over units: count advanced military for maintenance + heal
            let uc = self.player_unit_count.read((game_id, player));
            let mut ui: u32 = 0;
            while ui < uc {
                let mut u = self.units.read((game_id, player, ui));
                if u.hp > 0 {
                    // Maintenance: only advanced units cost gold
                    if constants::costs_maintenance(u.unit_type) {
                        military_count += 1;
                    }
                    // Healing
                    if u.hp < 100 {
                        let new_hp = turn::heal_unit(@u, true, false, u.fortify_turns > 0);
                        u.hp = new_hp;
                        self.units.write((game_id, player, ui), u);
                    }
                }
                ui += 1;
            };

            // Gold accounting
            let net_gold = economy::compute_net_gold(total_gold_income, military_count);
            let treasury = self.player_treasury.read((game_id, player));
            let (new_treasury, _disband) = economy::update_treasury(treasury, net_gold);
            self.player_treasury.write((game_id, player), new_treasury);

            // Tech research — per-tech accumulated science
            let cur_tech = self.player_current_research.read((game_id, player));
            if cur_tech > 0 {
                let acc = self.tech_accumulated_half_science.read((game_id, player, cur_tech));
                let half_sci: u16 = total_half_science.try_into().unwrap();
                let (new_acc, completed_tech) = tech::process_research(cur_tech, acc, half_sci);
                self.tech_accumulated_half_science.write((game_id, player, cur_tech), new_acc);
                if completed_tech > 0 {
                    let techs = self.player_completed_techs.read((game_id, player));
                    let new_techs = tech::mark_researched(completed_tech, techs);
                    self.player_completed_techs.write((game_id, player), new_techs);
                    self.player_current_research.write((game_id, player), 0);
                    // Clear accumulated science for completed tech
                    self.tech_accumulated_half_science.write((game_id, player, completed_tech), 0);
                    self.emit(TechCompleted { game_id, player_idx: player, tech_id: completed_tech });
                }
            }
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

        fn reset_movement_for(ref self: ContractState, game_id: u64, player: u8) {
            let uc = self.player_unit_count.read((game_id, player));
            let mut ui: u32 = 0;
            while ui < uc {
                let mut u = self.units.read((game_id, player, ui));
                if u.hp > 0 {
                    u.movement_remaining = turn::reset_movement(@u);
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
            let mut found_idx: u8 = 255;
            while i < np {
                if self.player_address.read((game_id, i)) == addr {
                    found_idx = i;
                    break;
                }
                i += 1;
            };
            assert(found_idx != 255, 'Not a player');
            found_idx
        }

        fn pow2_u32(n: u32) -> u32 {
            if n == 0 { return 1; }
            let mut r: u32 = 1;
            let mut i: u32 = 0;
            while i < n { r *= 2; i += 1; };
            r
        }

        /// Ensure the 6 hex neighbors of a starting position are passable land.
        /// If any neighbor is water or mountain, override it to TERRAIN_GRASSLAND.
        fn ensure_passable_neighbors(ref self: ContractState, game_id: u64, q: u8, r: u8) {
            use cairo_civ::types::{
                TERRAIN_OCEAN, TERRAIN_COAST, TERRAIN_MOUNTAIN, TERRAIN_GRASSLAND,
                FEATURE_NONE, RESOURCE_NONE,
            };
            let neighbors = hex::hex_neighbors(q, r);
            let nspan = neighbors.span();
            let mut d: u32 = 0;
            while d < nspan.len() {
                let (nq_u8, nr_u8) = *nspan.at(d);
                {
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

