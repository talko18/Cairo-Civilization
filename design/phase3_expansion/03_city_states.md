# Adding City-States

## Prerequisite

Phase 1 game logic working. Can be added before or after Phase 2 (ZK).

## Design: City-States as Public NPCs

City-states are NPC civilizations with public state. They don't have hidden information — their cities, units, and diplomatic status are visible once discovered.

## What Gets Added

### State

```cairo
struct CityState {
    city_state_id: u8,
    name: felt252,
    cs_type: u8,         // 0=Militaristic, 1=Scientific, 2=Cultural, 3=Religious, 4=Trade, 5=Industrial
    col: u16,
    row: u16,
    is_alive: bool,
    suzerain: Option<ContractAddress>,  // player with most envoys (3+ minimum)
}
```

### Envoy System

```cairo
// Storage
envoy_counts: LegacyMap<(u64, u8, ContractAddress), u8>,  // (game, cs_id, player) → envoys

// Players earn envoys from:
//   - Civics completion (specific civics grant envoys)
//   - Government bonuses
//   - Meeting a city-state first (+1 envoy)
```

Suzerainty = player with most envoys (minimum 3). Ties broken by who reached the count first.

### Bonuses

| Envoys | Bonus |
|---|---|
| 1 | Small bonus based on type (e.g., Militaristic: +2 combat strength for units near CS) |
| 3 | Medium bonus + suzerainty if leading |
| 6 | Large bonus (unique to each CS) |

### City-State AI

Minimal AI — city-states are mostly passive:
- They defend if attacked (fixed garrison unit)
- They don't expand or build units
- Suzerain can levy their military (send CS units to war)

### Contract Changes

```cairo
// New public action
enum PublicAction {
    // ... existing ...
    AssignEnvoy: (u8),           // city_state_id
    LevyMilitary: (u8),         // city_state_id (suzerain only)
}

// New storage
cs_count: LegacyMap<u64, u8>,
city_states: LegacyMap<(u64, u8), CityState>,
envoy_counts: LegacyMap<(u64, u8, ContractAddress), u8>,
```

### Phase 2 Integration

Envoy assignment is a public action (in proof output). City-state state is public on-chain. The turn proof must verify the player earned the envoy legitimately (from civics, government, etc.) — this is checked against the player's private state inside the proof.
