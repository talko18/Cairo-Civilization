# Combat & Interactions

## 1. Combat (MVP)

### Formula

```
Strength Difference (Δ) = Attacker CS - Defender CS + modifiers

Modifiers:
  + Terrain defense (hills: +3, woods: +3)
  + Fortification (+3 per turn, max +6)
  + Anti-cavalry (spearman vs cavalry: +10)

Damage to Defender = 30 × e^(Δ/25) × random_factor
Damage to Attacker = 30 × e^(-Δ/25) × random_factor

random_factor = Poseidon(attacker_salt, defender_salt, combat_id) % 51 + 75
              → range: 0.75x to 1.25x

Both salts already incorporate the opponent's last commitment (see doc 04),
so neither player could have predicted their salt before the opponent committed.
```

### Protocol (2 transactions, no extras)

```
Turn N: Attacker's turn
  - Attacker's turn proof has public output:
    AttackUnit(unit_reveal, target_col, target_row, turn_salt)
  - Contract creates PendingCombat record

Turn N+1: Defender's turn
  - Defender's turn proof has public output:
    DefendUnit(combat_id, unit_reveal, terrain, turn_salt)
  - Contract resolves combat deterministically:
    random = Poseidon(atk_salt, def_salt, combat_id) % 51 + 75
    result = compute_damage(atk_unit, def_unit, terrain, random)
  - Contract emits CombatResolved event
  - Defender incorporates result in this same turn proof
  - Attacker incorporates result on their next turn (via external events)
```

**Timeout**: If defender doesn't submit within their deadline, combat resolves with defender getting no defensive bonuses.

### Ranged Combat

Same protocol. Additional constraint in the proof: `hex_distance(attacker, target) <= unit.range`. Ranged attackers take no counter-damage.

### City Combat

Defender reveals city stats (population, walls, garrison) instead of a unit. City combat strength = base + walls + garrison + terrain.

## 2. Diplomacy (MVP)

Only two diplomatic actions for MVP:

### Declare War
Public action in turn proof. Contract updates `diplo_status` for both players. Both players must incorporate the status change.

### Make Peace
Public action. Both players must agree (proposer submits, other accepts on their turn).

**Deferred**: Alliances, trade deals, open borders, casus belli types. These add complexity but don't change the core architecture.

## 3. What's Deferred (Post-MVP)

| Feature | Why Deferred |
|---|---|
| Espionage | Requires spy placement proofs, counter-espionage interaction, detection randomness — all complex |
| Religion | Requires religious pressure computation across fog of war, theological combat, belief selection |
| Trade routes | Requires pathfinding over public routes, plunder mechanics |
| City-states | NPC AI + envoy system + suzerainty tracking |
| Barbarians | NPC AI + deterministic spawning + interaction with fog of war |
| Great People | Points tracking per category + unique abilities |
| Area of Effect combat | Splash damage across multiple tiles |
| Simultaneous turns | Conflict resolution, priority systems, edge cases |

Each of these can be added later as new `Action` variants and `PublicAction` variants. The core proof structure (one TurnProof per turn) doesn't change.
