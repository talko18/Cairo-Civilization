# Adding Unit Fog of War

## Prerequisite

Phase 2 must be complete (ZK commitments, off-chain prover working).

## What Changes

In Phase 2, unit positions are public (proof output each turn). This phase makes them private — units are only revealed when in an opponent's vision zone.

## Two Things to Add

### 1. Zone Bitmask in Turn Proof

The map is divided into fixed 8×8 hex zones. Each turn, the proof outputs a **zone bitmask** instead of full unit positions:

```
zone_bitmask: 1 felt252 (each bit = "I have vision in this zone")
```

The proof also checks all opponents' zone bitmasks from their last turn. For each of the player's units that falls within an opponent's vision zone, the proof MUST include a `ZoneReveal(opponent, zone_id, unit_type)` in public actions.

**Changes to the TurnProof circuit:**

```
REMOVE:
    unit_positions (public output)

ADD:
    zone_bitmask (public output)

ADD constraints:
    - zone_bitmask matches actual units/cities + vision ranges
    - For each unit in my state:
        For each opponent O:
            zone = compute_zone(unit.col, unit.row)
            if O.zone_bitmask[zone] == 1:
                assert ZoneReveal(O, zone, unit.type) in public_actions
```

**Changes to the contract:**
- Store `zone_bitmask` per player per game (1 felt252)
- Add `ZoneReveal` variant to `PublicAction` enum
- Remove `unit_positions` storage

### 2. Merkle Tree Commitment (Replaces Flat Hash)

Zone-level combat targeting means the attacker picks a tile that may be empty. The defender needs to prove non-presence efficiently. A flat hash can't do this — you'd need to reveal all units. A **Sparse Merkle Tree** keyed by tile position gives constant-size non-membership proofs.

**Changes to commitment scheme:**

```
BEFORE (flat hash):
    commitment = Poseidon(Poseidon(serialize(state)), salt)

AFTER (Merkle tree):
    units_tree = SMT keyed by (col, row), depth 16
    cities_tree = SMT keyed by city_id, depth 12
    meta_hash = Poseidon(gold, tech_progress, current_tech, ...)
    root = Poseidon(units_tree.root, cities_tree.root, meta_hash)
    commitment = Poseidon(root, salt)
```

**Changes to combat protocol:**

```
Attacker targets tile (5, 3) in a zone where a ZoneReveal indicated an enemy unit.

Defender responds with one of:
  A) Unit IS at (5, 3):
     - Reveal unit stats (existing combat flow)
     - Provide Merkle inclusion proof
     - Combat resolves normally

  B) No unit at (5, 3):
     - Provide Merkle NON-MEMBERSHIP proof (SMT leaf at (5,3) is default hash)
     - Combat fizzles
     - Attacker wasted their action (punishes blind aggression)
```

## Contract Interface Changes

```cairo
// New public action variants
enum PublicAction {
    // ... existing variants ...
    ZoneReveal: (ContractAddress, u8, u8),  // opponent, zone_id, unit_type
    CombatFizzled: u64,                      // combat_id (no unit at target)
}

// New storage
zone_bitmasks: LegacyMap<(u64, ContractAddress), felt252>,
```

## What the Opponent Learns

| With public positions (Phase 2) | With zone bitmask (Phase 3) |
|---|---|
| Exact (col, row) of every unit | "A warrior is somewhere in zone 7" (~64 tiles) |
| Exact unit type and count | Unit type per zone, but exact count unclear (overlapping reveals) |
| Full army composition visible | Only units near your vision zones are revealed |
