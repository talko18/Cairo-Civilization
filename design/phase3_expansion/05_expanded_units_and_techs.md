# Expanding Units and Tech Tree

## Prerequisite

Phase 1 game logic working.

## What Changes

MVP has 5 unit types and ~20 techs. This expansion adds the full Ancient–Renaissance era units and tech tree (~60 techs, ~25 unit types).

### New Unit Types

| Era | Units Added |
|---|---|
| Ancient | Spearman, Heavy Chariot, Galley |
| Classical | Swordsman, Horseman, Catapult, Quadrireme |
| Medieval | Man-at-Arms, Knight, Crossbowman, Trebuchet |
| Renaissance | Musketman, Pike & Shot, Bombard, Caravel, Frigate |

Each unit is still just a `u8` type ID on-chain. The off-chain prover has the full stat tables:

```cairo
fn get_unit_stats(unit_type: u8) -> UnitStats {
    match unit_type {
        0 => UnitStats { cs: 20, rs: 0, range: 0, move: 2, ... },  // Warrior
        1 => UnitStats { cs: 15, rs: 25, range: 1, move: 2, ... }, // Slinger
        // ... etc
    }
}
```

### Expanded Tech Tree

Add techs era by era. Each tech has:
- Prerequisites (other techs)
- Science cost
- Unlocks (units, buildings, abilities)

The tech tree is encoded in the off-chain prover as lookup tables. The proof verifies prerequisites are met before allowing research completion.

### Contract Changes

None. The contract stores `u8` type IDs and doesn't interpret them. All game semantics live in the off-chain prover circuit. Adding new unit types or techs only requires updating the prover code and recompiling.

### Upgrade Safety

Since game rules live in the proof circuit (not the contract), you can expand units and techs without any contract upgrade. New games use the new prover version. Ongoing games continue with their original prover version (the commitment scheme is the same).
