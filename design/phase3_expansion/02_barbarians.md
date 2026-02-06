# Adding Barbarians

## Prerequisite

Phase 1 game logic working. Can be added before or after Phase 2 (ZK).

## Design: Barbarians as Public State

Barbarian positions and behavior are **fully public**. This is the simplest approach and matches the base game — barbarians are visible once you explore their area.

## What Gets Added

### State

```cairo
struct BarbarianOutpost {
    col: u16,
    row: u16,
    active: bool,
    spawn_cooldown: u8,
}

struct BarbarianUnit {
    unit_type: u8,  // Scout, Warrior, Spearman, Horse Archer
    col: u16,
    row: u16,
    hp: u16,
}
```

Stored on-chain (public). One `BarbarianState` per game.

### Deterministic AI

Barbarian behavior is deterministic given the game state + a seed:

```
Each turn, after all players submit:
    1. Outpost spawning:
       - If spawn_cooldown == 0 and outpost has < 3 units:
         spawn unit (type = f(turn_number, outpost_index, seed))
       - Reset cooldown
    
    2. Scout behavior:
       - Move toward nearest player city (public knowledge)
       - If scout reaches within 2 tiles of a city: trigger raid spawning
    
    3. Raider behavior:
       - Move toward the city the scout found
       - Attack if adjacent
    
    4. Combat:
       - Uses existing combat formula
       - Barbarians have fixed combat strength per type
```

The AI is computed by the contract (Phase 1) or by each player's proof (Phase 2). Since behavior is deterministic and state is public, all players compute the same result.

### Contract Changes

```cairo
// New storage
barb_outpost_count: LegacyMap<u64, u8>,
barb_outposts: LegacyMap<(u64, u8), BarbarianOutpost>,
barb_unit_count: LegacyMap<u64, u8>,
barb_units: LegacyMap<(u64, u8), BarbarianUnit>,

// New in submit_turn: after processing player turn
fn process_barbarians(game_id):
    // spawn, move, attack — all deterministic
```

### Phase 2 Integration

In Phase 2 (ZK), barbarian state is still public. The player's turn proof must incorporate barbarian actions as external events (same as opponent actions). The contract computes barbarian AI deterministically, and the proof verifies the player applied barbarian combat damage correctly.
