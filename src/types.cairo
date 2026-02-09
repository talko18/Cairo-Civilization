// ============================================================================
// Types — All shared data types and StorePacking implementations.
// No game logic. See design/03_starknet_contracts.md §4 and
// design/implementation/01_interfaces.md §Module 1.
// ============================================================================

use starknet::storage_access::StorePacking;

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

pub const Q_OFFSET: u8 = 16;
pub const R_OFFSET: u8 = 0;
pub const MAP_WIDTH: u8 = 32;
pub const MAP_HEIGHT: u8 = 20;

// ---------------------------------------------------------------------------
// Terrain types (u8)
// ---------------------------------------------------------------------------

pub const TERRAIN_OCEAN: u8 = 0;
pub const TERRAIN_COAST: u8 = 1;
pub const TERRAIN_GRASSLAND: u8 = 2;
pub const TERRAIN_GRASSLAND_HILLS: u8 = 3;
pub const TERRAIN_PLAINS: u8 = 4;
pub const TERRAIN_PLAINS_HILLS: u8 = 5;
pub const TERRAIN_DESERT: u8 = 6;
pub const TERRAIN_DESERT_HILLS: u8 = 7;
pub const TERRAIN_TUNDRA: u8 = 8;
pub const TERRAIN_TUNDRA_HILLS: u8 = 9;
pub const TERRAIN_SNOW: u8 = 10;
pub const TERRAIN_SNOW_HILLS: u8 = 11;
pub const TERRAIN_MOUNTAIN: u8 = 12;

// ---------------------------------------------------------------------------
// Feature types (u8)
// ---------------------------------------------------------------------------

pub const FEATURE_NONE: u8 = 0;
pub const FEATURE_WOODS: u8 = 1;
pub const FEATURE_RAINFOREST: u8 = 2;
pub const FEATURE_MARSH: u8 = 3;
pub const FEATURE_OASIS: u8 = 4;

// ---------------------------------------------------------------------------
// Resource types (u8)
// ---------------------------------------------------------------------------

pub const RESOURCE_NONE: u8 = 0;
pub const RESOURCE_WHEAT: u8 = 1;
pub const RESOURCE_RICE: u8 = 2;
pub const RESOURCE_CATTLE: u8 = 3;
pub const RESOURCE_STONE: u8 = 4;
pub const RESOURCE_FISH: u8 = 5;
pub const RESOURCE_HORSES: u8 = 6;
pub const RESOURCE_IRON: u8 = 7;
pub const RESOURCE_SILVER: u8 = 8;
pub const RESOURCE_SILK: u8 = 9;
pub const RESOURCE_DYES: u8 = 10;

// ---------------------------------------------------------------------------
// Unit types (u8)
// ---------------------------------------------------------------------------

pub const UNIT_SETTLER: u8 = 0;
pub const UNIT_BUILDER: u8 = 1;
pub const UNIT_SCOUT: u8 = 2;
pub const UNIT_WARRIOR: u8 = 3;
pub const UNIT_SLINGER: u8 = 4;
pub const UNIT_ARCHER: u8 = 5;
// 6+ reserved for civ-unique units (Phase 3)

// ---------------------------------------------------------------------------
// Improvement types (u8)
// ---------------------------------------------------------------------------

pub const IMPROVEMENT_NONE: u8 = 0;
pub const IMPROVEMENT_FARM: u8 = 1;
pub const IMPROVEMENT_MINE: u8 = 2;
pub const IMPROVEMENT_QUARRY: u8 = 3;
pub const IMPROVEMENT_PASTURE: u8 = 4;
pub const IMPROVEMENT_LUMBER_MILL: u8 = 5;

// ---------------------------------------------------------------------------
// Building bit indices (for City.buildings: u32 bitmask)
// ---------------------------------------------------------------------------

pub const BUILDING_MONUMENT: u8 = 0;
pub const BUILDING_GRANARY: u8 = 1;
pub const BUILDING_WALLS: u8 = 2;
pub const BUILDING_LIBRARY: u8 = 3;
pub const BUILDING_MARKET: u8 = 4;
pub const BUILDING_BARRACKS: u8 = 5;
pub const BUILDING_WATER_MILL: u8 = 6;
// 7+ reserved for civ-unique buildings (Phase 3) and future expansion

// ---------------------------------------------------------------------------
// Production item IDs (u8, range-separated)
// ---------------------------------------------------------------------------
// 0       = none/idle
// 1-63    = units  (production_item_id = unit_type + 1)
// 64-127  = buildings (production_item_id = building_bit + 64)
// 128-191 = wonders (future)
// 192-255 = projects (future)

pub const PRODUCTION_NONE: u8 = 0;

// Unit production IDs
pub const PROD_SETTLER: u8 = 1;
pub const PROD_BUILDER: u8 = 2;
pub const PROD_SCOUT: u8 = 3;
pub const PROD_WARRIOR: u8 = 4;
pub const PROD_SLINGER: u8 = 5;
pub const PROD_ARCHER: u8 = 6;

// Building production IDs
pub const PROD_MONUMENT: u8 = 64;
pub const PROD_GRANARY: u8 = 65;
pub const PROD_WALLS: u8 = 66;
pub const PROD_LIBRARY: u8 = 67;
pub const PROD_MARKET: u8 = 68;
pub const PROD_BARRACKS: u8 = 69;
pub const PROD_WATER_MILL: u8 = 70;

// ---------------------------------------------------------------------------
// Game status
// ---------------------------------------------------------------------------

pub const STATUS_LOBBY: u8 = 0;
pub const STATUS_ACTIVE: u8 = 1;
pub const STATUS_FINISHED: u8 = 2;

// ---------------------------------------------------------------------------
// Victory types
// ---------------------------------------------------------------------------

pub const VICTORY_DOMINATION: u8 = 0;
pub const VICTORY_SCORE: u8 = 1;
pub const VICTORY_FORFEIT: u8 = 2;

// ---------------------------------------------------------------------------
// Diplomacy status
// ---------------------------------------------------------------------------

pub const DIPLO_PEACE: u8 = 0;
pub const DIPLO_WAR: u8 = 1;

// ===========================================================================
// Structs
// ===========================================================================

/// On-chain unit representation.
/// In Phase 1: dead units are removed from storage.
/// In Phase 2: dead units set hp=0 (stable indexing for ZK circuit).
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Unit {
    pub unit_type: u8,
    pub q: u8,
    pub r: u8,
    pub hp: u8,               // 0-200
    pub movement_remaining: u8,
    pub charges: u8,           // builders only (starts at 3)
    pub fortify_turns: u8,     // 0=not fortified, 1=one turn, 2+=max bonus
}

/// On-chain city representation.
#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub struct City {
    pub name: felt252,
    pub q: u8,
    pub r: u8,
    pub population: u8,
    pub hp: u8,                // 0-200 (city hitpoints)
    pub food_stockpile: u16,
    pub production_stockpile: u16,
    pub current_production: u8, // production item ID, 0 = none
    pub buildings: u32,         // bitmask: 32 building slots
    pub founded_turn: u16,
    pub original_owner: u8,     // player index who founded it
    pub is_capital: bool,
}

/// Immutable map tile terrain data. Generated once per game.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct TileData {
    pub terrain: u8,
    pub feature: u8,
    pub resource: u8,
    pub river_edges: u8,       // bitmask, 6 bits for 6 hex edges
}

/// Yield for a single tile. Shared between map_gen and city modules.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct TileYield {
    pub food: u8,
    pub production: u8,
    pub gold: u8,
}

/// Aggregate yields for a city (tiles + buildings + palace).
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct CityYields {
    pub food: u16,
    pub production: u16,
    pub gold: u16,
    pub half_science: u16,     // tracked in half-points for precision
}

/// Result of a combat engagement.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct CombatResult {
    pub damage_to_defender: u8,
    pub damage_to_attacker: u8, // 0 for ranged attacks
    pub defender_killed: bool,
    pub attacker_killed: bool,
}

/// Player actions submitted per turn.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum Action {
    MoveUnit: (u32, u8, u8),              // unit_id, dest_q, dest_r
    AttackUnit: (u32, u8, u8),            // unit_id, target_q, target_r
    RangedAttack: (u32, u8, u8),          // unit_id, target_q, target_r
    FoundCity: (u32, felt252),            // settler_id, city_name
    SetProduction: (u32, u8),             // city_id, item_id
    SetResearch: u8,                      // tech_id
    BuildImprovement: (u32, u8, u8, u8),  // builder_id, q, r, improvement_type
    RemoveImprovement: (u32, u8, u8),     // builder_id, q, r
    FortifyUnit: u32,                     // unit_id
    SkipUnit: u32,                        // unit_id
    PurchaseWithGold: (u32, u8),          // city_id, item_id
    UpgradeUnit: u32,                     // unit_id
    DeclareWar: u8,                       // target player index
    AssignCitizen: (u32, u8, u8),         // city_id, tile_q, tile_r (lock citizen to tile)
    UnassignCitizen: (u32, u8, u8),       // city_id, tile_q, tile_r (remove lock)
    EndTurn,
}

/// Movement validation errors.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum MoveError {
    NotAdjacent,
    Impassable,
    InsufficientMovement,
    FriendlyUnitBlocking,
    OutOfBounds,
}

/// City founding validation errors.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum CityFoundError {
    OnMountain,
    OnWater,
    TooCloseToCity,
    OutOfBounds,
}

/// What a tech unlocks on completion.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct TechUnlock {
    pub reveals_resource: u8,      // 0 = none
    pub unlocks_building: u8,      // 0 = none, else building bit
    pub unlocks_unit: u8,          // 0 = none, else unit type
    pub unlocks_improvement: u8,   // 0 = none, else improvement type
    pub passive_effect: u8,        // 0 = none
}

// ===========================================================================
// StorePacking — pack structs into minimal felt252 slots for gas efficiency.
//
// All game logic modules work with unpacked structs. Packing/unpacking
// happens only at the storage boundary (contract.cairo).
//
// See design/implementation/04_gas_estimation.md §2 for bit layout.
// ===========================================================================

// --- Unit packing: 7 × u8 = 56 bits → 1 felt252 ---
//   bits  0-7:  unit_type
//   bits  8-15: q
//   bits 16-23: r
//   bits 24-31: hp
//   bits 32-39: movement_remaining
//   bits 40-47: charges
//   bits 48-55: fortify_turns

impl UnitStorePacking of StorePacking<Unit, felt252> {
    fn pack(value: Unit) -> felt252 {
        let mut packed: u256 = value.unit_type.into();
        packed = packed | (Into::<u8, u256>::into(value.q) * 0x100);
        packed = packed | (Into::<u8, u256>::into(value.r) * 0x10000);
        packed = packed | (Into::<u8, u256>::into(value.hp) * 0x1000000);
        packed = packed | (Into::<u8, u256>::into(value.movement_remaining) * 0x100000000);
        packed = packed | (Into::<u8, u256>::into(value.charges) * 0x10000000000);
        packed = packed | (Into::<u8, u256>::into(value.fortify_turns) * 0x1000000000000);
        packed.try_into().unwrap()
    }

    fn unpack(value: felt252) -> Unit {
        let packed: u256 = value.into();
        Unit {
            unit_type: (packed & 0xFF).try_into().unwrap(),
            q: ((packed / 0x100) & 0xFF).try_into().unwrap(),
            r: ((packed / 0x10000) & 0xFF).try_into().unwrap(),
            hp: ((packed / 0x1000000) & 0xFF).try_into().unwrap(),
            movement_remaining: ((packed / 0x100000000) & 0xFF).try_into().unwrap(),
            charges: ((packed / 0x10000000000) & 0xFF).try_into().unwrap(),
            fortify_turns: ((packed / 0x1000000000000) & 0xFF).try_into().unwrap(),
        }
    }
}

// --- TileData packing: 4 × u8 = 32 bits → 1 felt252 ---
//   bits  0-7:  terrain
//   bits  8-15: feature
//   bits 16-23: resource
//   bits 24-31: river_edges

impl TileDataStorePacking of StorePacking<TileData, felt252> {
    fn pack(value: TileData) -> felt252 {
        let mut packed: u256 = value.terrain.into();
        packed = packed | (Into::<u8, u256>::into(value.feature) * 0x100);
        packed = packed | (Into::<u8, u256>::into(value.resource) * 0x10000);
        packed = packed | (Into::<u8, u256>::into(value.river_edges) * 0x1000000);
        packed.try_into().unwrap()
    }

    fn unpack(value: felt252) -> TileData {
        let packed: u256 = value.into();
        TileData {
            terrain: (packed & 0xFF).try_into().unwrap(),
            feature: ((packed / 0x100) & 0xFF).try_into().unwrap(),
            resource: ((packed / 0x10000) & 0xFF).try_into().unwrap(),
            river_edges: ((packed / 0x1000000) & 0xFF).try_into().unwrap(),
        }
    }
}

// --- City packing: name (felt252) + fields → 2 felt252 slots ---
// Cairo's Store derive handles multi-slot structs automatically when
// individual fields implement Store. City uses the default Store derive
// which stores name in slot 0 and the remaining fields across slots 1+.
//
// For further optimization, a custom StorePacking<City, (felt252, felt252)>
// could pack all non-name fields into a single felt252 (136 bits).
// This is deferred — the default multi-slot Store is correct and sufficient
// for MVP. When gas profiling shows City writes are a bottleneck, implement
// the custom packing.
