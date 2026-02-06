# Units, Combat & Movement

## 1. Unit Roster (MVP)

### Options

**A: 5 units (original MVP scope)** — Settler, Builder, Warrior, Slinger, Scout

- Pros: Minimal, fast to implement
- Cons: Tech tree has nothing meaningful to unlock (all units available from turn 1)

**B: 6 units (add Archer)** — Settler, Builder, Warrior, Slinger, Scout, Archer

- Pros: Archery tech unlocks Archer (Slinger upgrade), demonstrates tech→unit pipeline, matches Civ VI early game
- Cons: One more unit type, upgrade mechanic needed

**C: 8 units (add Archer, Spearman, Horseman)** — full Ancient + early Classical roster

- Pros: Rock-paper-scissors combat (melee/ranged/cavalry/anti-cav), richer gameplay
- Cons: More balancing, more tech tree entries, scope creep

### Decision: **B — 6 units**

Adding Archer gives the tech tree a meaningful unlock without scope creep. Spearman and Horseman are deferred — they need anti-cavalry mechanics and strategic resources (Horses) which add complexity.

### Unit Stats (Civ VI Values)

| Unit | Type | CS | RS | Range | Move | Vision | HP | Cost | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Settler | Civilian | 0 | 0 | 0 | 2 | 3 | 100 | 80 | Consumed on city founding. Cannot attack. |
| Builder | Civilian | 0 | 0 | 0 | 2 | 2 | 100 | 50 | 3 charges (builds improvements). Cannot attack. |
| Scout | Recon | 10 | 0 | 0 | 3 | 3 | 100 | 30 | Fast movement, extra vision. |
| Warrior | Melee | 20 | 0 | 0 | 2 | 2 | 100 | 40 | Basic melee unit. |
| Slinger | Ranged | 5 | 15 | 1 | 2 | 2 | 100 | 35 | Fragile in melee, ranged attack. |
| Archer | Ranged | 10 | 25 | 2 | 2 | 2 | 100 | 60 | Upgraded Slinger. Requires Archery tech. |

These are exact Civ VI base game values.

### Unit Rules

- Each tile can hold 1 military unit + 1 civilian unit (stacking)
- Civilian units are captured (not killed) when an enemy enters their tile
- Units heal +10 HP per turn in friendly territory, +5 in neutral, +0 in enemy
- Units heal +10 HP per turn extra when fortified (Fortify action)
- Units cannot move and attack in the same turn (unless they have remaining movement after moving)

---

## 2. Movement

### Options

**A: Civ VI movement (complex)** — variable costs per terrain, river penalty, zone of control

- Pros: Faithful to Civ VI, strategic depth
- Cons: Zone of control is complex (enemy units block adjacent tiles), pathfinding is more involved

**B: Simplified Civ VI** — variable costs, river penalty, NO zone of control

- Pros: Keeps terrain-based movement interesting, simpler pathfinding
- Cons: Missing zone of control changes tactics (can walk past enemy army)

**C: Flat movement** — every tile costs 1 movement, mountains impassable

- Pros: Simplest possible, trivial pathfinding
- Cons: Hills, woods, rivers have no movement effect — less interesting

### Decision: **B — Simplified Civ VI (no zone of control)**

Zone of control is important tactically but adds significant complexity (checking adjacency to all enemy units on every move step). Defer to post-MVP. Terrain-based costs keep movement interesting.

### Movement Costs (Civ VI Values)

| Terrain | Cost | Notes |
|---|---|---|
| Flat land (grassland, plains, desert, tundra, snow) | 1 | Base cost |
| Hills (any type) | 2 | Slow but provides defense |
| Woods | 2 | Slow, provides defense |
| Rainforest | 2 | Slow |
| Marsh | 2 | Slow |
| Mountains | ∞ | Impassable |
| Ocean | ∞ | Impassable for land units (MVP: no embarking) |
| Coast | ∞ | Impassable for land units (MVP: no embarking) |
| River crossing (edge) | Ends movement | Moving across a river edge costs ALL remaining movement |

### Movement Algorithm

```
fn can_move(unit, from, to, map) -> bool:
    1. `to` must be a neighbor of `from` (hex distance 1)
    2. `to` terrain must not be impassable for this unit
    3. Movement cost = terrain_cost(to)
    4. If crossing a river edge: cost = unit.movement_remaining (all of it)
    5. unit.movement_remaining >= cost
    6. `to` tile does not contain a friendly military unit (no same-type stacking)
    7. If `to` contains an enemy unit: this is an attack, not a move
```

### Embarking (Deferred)

In Civ VI, land units can embark onto water tiles after researching Sailing. For MVP, all water tiles are impassable. This simplifies movement and means maps must have connected landmasses.

---

## 3. Combat

### Formula Options

**A: Civ VI exponential formula** — `damage = 30 × e^(Δ/25)`

- Pros: Exact Civ VI behavior, strength differences matter a lot
- Cons: `e^x` is hard in integer math / ZK circuits, needs lookup table or approximation

**B: Linear approximation** — `damage = 30 + 1.5 × Δ` (clamped to 10–60)

- Pros: Trivial to compute, no lookup tables, ZK-friendly
- Cons: Doesn't match Civ VI feel — extreme strength differences don't matter enough

**C: Lookup table for the exponential** — pre-compute damage for each Δ from -40 to +40

- Pros: Exact Civ VI behavior, O(1) lookup in circuit (just a match statement), no floating point
- Cons: 81 entries to hardcode, but it's static data

### Decision: **C — Lookup table**

Exact Civ VI combat feel with zero floating point math. 81 integer entries is trivial to hardcode. The ZK circuit just indexes into the table — one constraint.

### Combat Damage Table (Pre-Computed)

`base_damage[Δ]` for Δ from -40 to +40, where `base_damage = round(30 × e^(Δ/25))`:

```
Δ:  -40  -35  -30  -25  -20  -15  -10   -5    0    5   10   15   20   25   30   35   40
Dmg:  6    7    9   11   13   16   20   24   30   37   45   55   66   81  100  122  149
```

Full table stored as a Cairo constant array with 81 entries (integer Δ from -40 to +40).

### Combat Resolution

```
fn resolve_combat(attacker, defender, terrain, random_factor) -> (u16, u16):
    // Compute strength difference
    delta = attacker.combat_strength - defender.effective_cs(terrain)
    delta = clamp(delta, -40, +40)
    
    // Look up base damage
    raw_damage_to_defender = DAMAGE_TABLE[delta + 40]
    raw_damage_to_attacker = DAMAGE_TABLE[-delta + 40]  // = DAMAGE_TABLE[40 - delta]
    
    // Apply random factor (75-125, i.e., 0.75x to 1.25x)
    damage_to_defender = raw_damage_to_defender * random_factor / 100
    damage_to_attacker = raw_damage_to_attacker * random_factor / 100
    
    return (damage_to_defender, damage_to_attacker)
```

### Defense Modifiers (Civ VI Values)

| Modifier | CS Bonus | Condition |
|---|---|---|
| Hills terrain | +3 | Defender is on hills |
| Woods / Rainforest | +3 | Defender is in woods/rainforest |
| River crossing | +5 to defender | Attacker crosses a river to attack |
| Fortified (1 turn) | +3 | Unit used Fortify action |
| Fortified (2+ turns) | +6 | Unit fortified for 2+ consecutive turns |
| City walls | +city_wall_CS | Defender is in a city with walls |

Defender effective CS = base CS + sum of applicable modifiers.

### Ranged Combat Differences

- Ranged attacker does NOT take counter-damage (attacker_damage = 0)
- Ranged attack requires `hex_distance(attacker, target) <= unit.range`
- Ranged attack requires line of sight (no mountains or woods blocking)
- Ranged units use `ranged_strength` for damage calculation (not `combat_strength`)
- If a melee unit attacks a ranged unit, the ranged unit defends with `combat_strength` (which is low)

### City Combat

Cities defend themselves:

```
City CS = 15 + (population × 2) + wall_bonus
Wall bonus: None=0, Ancient Walls=+10, Medieval Walls=+20 (post-MVP)

City ranged attack:
    - Requires Walls building. Cities WITHOUT Walls cannot make ranged attacks.
    - Ranged CS = city_CS (same as defense CS)
    - Range = 2 hexes
    - Fires once per turn (during the defending player's turn)
    - Does NOT take counter-damage (like a ranged unit)

City HP: 200 (separate from garrison unit HP)

To capture a city:
    1. Reduce city HP to 0 (via ranged + melee attacks)
    2. A melee unit must then move onto the city tile (melee attack action)
    3. City is captured (ownership transfers)
    4. City cannot be captured by ranged units alone
    5. On capture: city HP resets to 100, population -1
```
