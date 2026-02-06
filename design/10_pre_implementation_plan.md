# Pre-Implementation Plan

Everything that needs to be decided before writing code for Phase 1. Organized by priority.

---

## Must Plan (Will Cause Rework If Not Decided Upfront)

### 1. Hex Coordinate System

Every movement, combat, vision, and distance calculation depends on this choice.

| Option | Pros | Cons |
|---|---|---|
| **Offset coordinates** (col, row with odd/even row shift) | Intuitive for rectangular maps, easy to store | Asymmetric neighbor math (different formulas for odd/even rows), distance calculation is ugly |
| **Axial coordinates** (q, r) | Symmetric neighbor math, clean distance formula `(|q| + |r| + |q+r|) / 2`, natural for hex grids | Rectangular maps waste storage (some coordinates unused) |
| **Cube coordinates** (x, y, z where x+y+z=0) | Cleanest math, trivial distance/rotation/line-of-sight | Redundant third coordinate, more storage per position |

**Needs to be defined:**
- Which coordinate system
- Distance function
- Neighbor function (6 neighbors per hex)
- Line-of-sight algorithm (for vision blocking by mountains/forests)
- Coordinate ↔ map index conversion (for Merkle tree keys, storage keys)
- Wrapping behavior (does the map wrap horizontally like Civ?)

### 2. Game Rules Spec

Without concrete numbers, you can't write game logic. Each section below needs a spec.

#### 2a. Unit Stats

| Unit | Combat Strength | Ranged Strength | Range | Movement | Vision | Production Cost | Abilities |
|---|---|---|---|---|---|---|---|
| Settler | 0 | 0 | 0 | 2 | 2 | 80 | Founds city (consumed) |
| Builder | 0 | 0 | 0 | 2 | 2 | 50 | Build improvement (3 charges) |
| Warrior | ? | 0 | 0 | 2 | 2 | 40 | Melee |
| Slinger | ? | ? | 1 | 2 | 2 | 35 | Ranged |
| Scout | ? | 0 | 0 | 3 | 3 | 30 | Fast, extra vision |

Needs: concrete values for `?`, HP (100 for all?), XP/promotion rules (or defer promotions).

#### 2b. Tech Tree

Needs: the ~20 techs, their prerequisites, science costs, and what they unlock.

Example skeleton:

```
Ancient Era:
  Mining         (cost: 25)  → unlocks: Builder improvements (quarry, mine)
  Pottery        (cost: 25)  → unlocks: Granary building
  Animal Husbandry (cost: 25) → unlocks: reveals Horses resource
  Archery        (cost: 25, prereq: none) → unlocks: Archer unit
  ...

Classical Era:
  Iron Working   (cost: 60, prereq: Mining) → unlocks: Swordsman
  Mathematics    (cost: 60, prereq: ...) → unlocks: Catapult (post-MVP)
  ...
```

#### 2c. Yield Calculation

Per city, per turn:

```
For each worked tile:
    food += tile.base_food + improvement_bonus + resource_bonus
    production += tile.base_production + ...
    gold += tile.base_gold + ...

science = per_citizen_science × population + building_bonuses
culture = per_citizen_culture × population + building_bonuses

Population growth:
    food_needed = f(population)  // e.g., 15 + 8 × (pop - 1)
    if food_stockpile >= food_needed: pop += 1, food_stockpile -= food_needed
```

Needs: base yields per terrain type, improvement yields, building yields, growth formula.

#### 2d. Terrain Yields

| Terrain | Food | Production | Gold |
|---|---|---|---|
| Grassland | ? | ? | ? |
| Plains | ? | ? | ? |
| Desert | ? | ? | ? |
| Tundra | ? | ? | ? |
| Coast | ? | ? | ? |
| Ocean | ? | ? | ? |
| Hills (+modifier) | ? | ? | ? |

Needs: concrete values, feature modifiers (woods, rainforest), resource bonuses.

#### 2e. Movement Costs

| Terrain | Movement Cost |
|---|---|
| Flat (grassland, plains, desert) | 1 |
| Hills | 2 |
| Woods / Rainforest | 2 |
| Mountains | Impassable |
| Rivers (crossing) | Ends movement |
| Roads (post-MVP) | 0.5 |

Needs: concrete values, embarking rules (can units cross water? MVP or deferred?).

#### 2f. Combat Formula Constants

```
Damage to Defender = BASE × e^(Δ/SCALE) × random_factor
Damage to Attacker = BASE × e^(-Δ/SCALE) × random_factor
```

Needs: values for BASE (30?), SCALE (25?), terrain defense bonuses, fortification values, max HP.

#### 2g. City Founding Rules

- Minimum distance between cities (3 tiles?)
- Initial territory radius (1 tile?)
- Starting population (1)
- Starting buildings (Palace in capital?)
- Can cities be founded on every terrain? (Not on mountains, not on water?)

#### 2h. Victory Condition

Domination = capture opponent's capital city.

Needs: what "capture" means exactly:
- Melee unit moves onto city tile with city HP at 0?
- City walls must be broken first?
- Is the city razed or transferred?
- Does the game end immediately on capture, or at end of turn?

### 3. Turn Timer / AFK Handling

| Decision | Options |
|---|---|
| Turn time limit | 3 min / 5 min / 10 min / no limit |
| What happens on timeout | Skip turn (no actions, salt updates) / Auto-forfeit / Pause game |
| Grace period | Allow N consecutive timeouts before forfeit? |
| Timer implementation | On-chain block timestamp check in `submit_turn` |

Needs: concrete values. Recommendation: 5-minute timer, 3 consecutive timeouts = forfeit.

### 4. Map Generation Spec

| Decision | Needs |
|---|---|
| Algorithm | Perlin noise? Diamond-square? Voronoi? |
| Terrain distribution | % ocean, % grassland, % desert, etc. |
| Resource placement | How many of each type, placement rules (iron on hills, fish on coast, etc.) |
| Starting positions | How to ensure fairness (equidistant, equal nearby resources) |
| Map sizes | Exact dimensions for Duel (40×26? smaller?) |
| Continent shape | One landmass? Two? Islands? (Simplest for MVP: one continent, Pangaea-style) |

Recommendation for MVP: simple Perlin noise heightmap → terrain assignment by elevation. Single continent. 2 starting positions at opposite ends.

---

## Should Plan (Saves Time But Can Iterate)

### 5. Client Architecture

| Question | Decision Needed |
|---|---|
| How does client know it's your turn? | Poll StarkNet events via Torii? Subscribe? |
| How is game state rendered? | Replay all events from game start? Snapshot + recent events? |
| How does client talk to dealer-prover? | REST API? WebSocket? |
| State persistence | localStorage keys, serialization format |
| UI framework | Vanilla JS (existing prototype)? React? Phaser.js for hex rendering? |

### 6. Development Environment

| Question | Decision Needed |
|---|---|
| Cairo version | Scarb version, Cairo compiler version to pin |
| Local testing | Katana for local StarkNet node |
| Test strategy | Unit tests in Cairo (`#[test]`), integration tests against Katana |
| CI/CD | GitHub Actions? Run tests on push? |
| Project structure | `src/` for contracts, `client/` for UI, `prover/` for off-chain (Phase 2) |

Recommended project structure:

```
cairo_civ/
  design/           ← already exists
  contracts/
    src/
      lib.cairo     ← single contract
      types.cairo   ← data types
      combat.cairo  ← combat math
      game.cairo    ← game lifecycle
      turn.cairo    ← turn processing
    Scarb.toml
    tests/
  client/
    index.html      ← existing prototype
    js/
  dealer/           ← Phase 2
  prover/           ← Phase 2
```

### 7. Game Lobby Flow

The exact on-chain sequence to start a game:

```
1. Player A calls create_game(map_size, dealer_address) → game_id
   - Contract stores game with status=Lobby
   - Event: GameCreated(game_id)

2. Player B calls join_game(game_id)
   - Contract stores Player B, status=WaitingForMap
   - Event: PlayerJoined(game_id, player)

3. Seed agreement (on-chain):
   a. Both players call commit_seed(game_id, H(random))
   b. Both players call reveal_seed(game_id, random)
   c. Contract computes combined_seed = Poseidon(random_A, random_B)
   d. Event: SeedAgreed(game_id, combined_seed)

4. Map generation (off-chain, Phase 1 can skip):
   - Phase 1: Contract generates map from seed (public)
   - Phase 2: Dealer generates map, posts commitment

5. Game starts:
   - Contract sets status=Active, turn=1, current_player=A
   - Event: GameStarted(game_id)

6. Player A submits first turn
```

Needs: Are steps 3-4 needed for Phase 1? In Phase 1 (public state), the map can be generated by the contract or a deterministic function that all clients run. Seed agreement is only strictly needed for Phase 2 (dealer-prover). For Phase 1, a simpler approach: the map seed = Poseidon(game_id, block_timestamp). Not ideal randomness, but sufficient for a public-state prototype.

---

## Checklist Before Writing Code

- [x] Pick hex coordinate system → **Axial (q, r)** — see `game_rules/01_hex_and_map.md`
- [x] Write unit stat table → **6 units, Civ VI values** — see `game_rules/02_units_and_combat.md`
- [x] Write tech tree → **18 techs, 2 eras** — see `game_rules/04_tech_tree.md`
- [x] Write terrain yield table → **Civ VI values, 10 resources** — see `game_rules/03_cities_and_economy.md`
- [x] Write movement cost table → **Civ VI values, no ZOC** — see `game_rules/02_units_and_combat.md`
- [x] Write combat formula → **Lookup table (81 entries)** — see `game_rules/02_units_and_combat.md`
- [x] Define city founding rules → **3-hex min distance, pop-based territory** — see `game_rules/03_cities_and_economy.md`
- [x] Define victory condition → **Domination + Score at turn 150** — see `game_rules/05_game_flow.md`
- [x] Decide turn timer values → **5 min, 3 timeouts = forfeit** — see `game_rules/05_game_flow.md`
- [x] Decide map generation → **Perlin noise, 32×20, validation pass** — see `game_rules/01_hex_and_map.md`
- [ ] Set up Scarb project and verify it compiles on Katana
- [ ] Decide project directory structure
