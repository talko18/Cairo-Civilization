# Cities & Economy

## 1. Terrain Yields (Civ VI Values)

### Options

**A: Exact Civ VI yields** — full terrain/feature/resource yield tables

- Pros: Faithful, well-balanced (years of playtesting), extensive documentation available
- Cons: Many edge cases (floodplains, oases, reef), resource bonuses require the full resource list

**B: Simplified Civ VI** — keep terrain/feature yields, reduce resources to ~10 types

- Pros: Core feel preserved, fewer resources to balance, simpler map generation
- Cons: Less variety than Civ VI

**C: Flat yields** — every land tile gives 1 food + 1 production, resources add bonuses

- Pros: Dead simple, easy to balance
- Cons: Terrain choice doesn't matter, boring city planning

### Decision: **A for terrain/features, B for resources**

Terrain and feature yields are straightforward tables — no reason to simplify. But the full Civ VI resource list (40+ types) is unnecessary for MVP. Keep ~10 resources.

### Terrain Base Yields

| Terrain | Food | Production | Gold |
|---|---|---|---|
| Grassland | 2 | 0 | 0 |
| Grassland Hills | 2 | 1 | 0 |
| Plains | 1 | 1 | 0 |
| Plains Hills | 1 | 2 | 0 |
| Desert | 0 | 0 | 0 |
| Desert Hills | 0 | 1 | 0 |
| Tundra | 1 | 0 | 0 |
| Tundra Hills | 1 | 1 | 0 |
| Snow | 0 | 0 | 0 |
| Snow Hills | 0 | 1 | 0 |
| Coast | 1 | 0 | 1 |
| Ocean | 1 | 0 | 0 |

### Feature Modifiers (Added to Base)

| Feature | Food | Production | Gold |
|---|---|---|---|
| Woods | 0 | +1 | 0 |
| Rainforest | +1 | 0 | 0 |
| Marsh | +1 | 0 | 0 |
| Oasis | +3 | 0 | +1 |

### Resources (MVP — 10 Types)

| Resource | Type | Terrain | Food | Prod | Gold |
|---|---|---|---|---|---|
| Wheat | Bonus | Grassland/Plains | +1 | 0 | 0 |
| Rice | Bonus | Grassland/Marsh | +1 | 0 | 0 |
| Cattle | Bonus | Grassland | +1 | 0 | 0 |
| Stone | Bonus | Grassland/Plains Hills | 0 | +1 | 0 |
| Fish | Bonus | Coast | +1 | 0 | 0 |
| Horses | Strategic | Grassland/Plains | +1 | +1 | 0 |
| Iron | Strategic | Hills (any) | 0 | +1 | 0 |
| Silver | Luxury | Hills/Tundra | 0 | 0 | +3 |
| Silk | Luxury | Woods | 0 | 0 | +3 |
| Dyes | Luxury | Rainforest/Woods | 0 | 0 | +3 |

Strategic resources (Horses, Iron) are revealed by specific techs (Animal Husbandry, Bronze Working). Luxury resources provide amenities (for post-MVP) and gold.

---

## 2. City Mechanics

### City Founding

| Rule | Value | Civ VI Match? |
|---|---|---|
| Minimum distance between cities | 3 hexes (center to center) | Yes (Civ VI = 4, but 3 works for small maps) |
| Valid terrain | Any land tile except Mountains | Yes |
| Starting population | 1 | Yes |
| Starting territory | City center tile + all 6 adjacent tiles | Yes |
| Capital bonus | Palace (free, intrinsic): +2 production, +2 science, +5 gold | No culture in MVP; changed culture→science. Palace is not a building in the bitmask — it's automatic for is_capital cities. |
| Settler consumed | Yes | Yes |

### Population Growth

#### Options

**A: Civ VI formula** — food needed = 15 + 8×(pop - 1) + pop²

- Pros: Exact match, well-balanced for long games
- Cons: Complex polynomial, high food thresholds at large pop

**B: Simplified linear** — food needed = 15 + 6×pop

- Pros: Easy to compute, close approximation for pop 1-10
- Cons: Diverges from Civ VI at high populations

**C: Flat** — food needed = 20 per growth

- Pros: Trivial
- Cons: Growth is too predictable, no diminishing returns

#### Decision: **B — Simplified linear**

Close enough to Civ VI for MVP pop range (1-10). The formula:

```
food_for_growth = 15 + 6 × current_population

Each turn:
    food_surplus = city_food_yield - (population × 2)  // 2 food per citizen to not starve
    food_stockpile += food_surplus

    // Housing check — population can't exceed housing capacity
    housing = base_housing + building_housing_bonuses
    // base_housing = 2 (no fresh water), 3 (coast), 5 (river)
    // Granary: +2 housing

    if food_stockpile >= food_for_growth AND population < housing:
        population += 1
        food_stockpile -= food_for_growth
    if population >= housing:
        food_stockpile = min(food_stockpile, food_for_growth)  // excess food wasted
    if food_stockpile < 0:
        population -= 1  // starvation
        food_stockpile = 0
```

**Housing** limits city size. Without housing, cities grow endlessly with enough food — breaking balance. This is a core Civ VI mechanic and simple to implement (just a cap check). Fresh water (river adjacency) gives the biggest housing bonus, encouraging river cities — a classic Civ VI dynamic.

### Territory Expansion

#### Options

**A: Culture-based (Civ VI)** — cities accumulate culture and expand borders

- Pros: Faithful to Civ VI, interesting strategic choice
- Cons: Requires culture yield tracking, complex selection of which tile to claim

**B: Population-based** — territory = pop-based ring expansion

- Pros: Simple, predictable
- Cons: No player choice in expansion direction

**C: Fixed territory** — city always owns the initial 7 tiles, never expands

- Pros: Simplest possible, no expansion logic
- Cons: Unrealistic, limits city growth and citizen assignment

#### Decision: **B — Population-based**

Simpler than culture-based but more interesting than fixed. Rule:

```
Territory radius = 1 + floor(population / 3)
    Pop 1-2: radius 1 (7 tiles)
    Pop 3-5: radius 2 (19 tiles)
    Pop 6-8: radius 3 (37 tiles)

When population crosses a threshold:
    Add the highest-yield unclaimed tile within the new radius
```

### Citizen Assignment

Each citizen works one tile within the city's territory:

```
- City center tile is always worked (free, no citizen needed)
- Each additional citizen can be assigned to one tile
- Unassigned citizens are auto-assigned to highest-food tiles
- A tile can only be worked by one city
- Tiles must be within city territory
```

For MVP, auto-assignment only (player doesn't manually assign citizens). Prioritize: food > production > gold.

---

## 3. Buildings (MVP)

### Options

**A: Full district system (Civ VI)** — buildings inside districts, district placement with adjacency

- Pros: Faithful to Civ VI, deep strategy
- Cons: District placement is a complex spatial problem, adjacency bonuses need hex math, scope creep

**B: Simplified buildings (no districts)** — buildings placed directly in city, no adjacency

- Pros: Captures the yield bonuses without district complexity, fast to implement
- Cons: Missing the district placement strategy

**C: No buildings** — cities only get yields from worked tiles

- Pros: Simplest, no building production needed
- Cons: Tech tree has little to unlock, cities feel flat

### Decision: **B — Simplified buildings (no districts)**

Districts are deferred to post-MVP. Buildings are built in the city center directly.

### Building List (MVP)

| Building | Cost | Yields / Effect | Requires Tech |
|---|---|---|---|
| Monument | 60 | +1 science, +1 production | None |
| Granary | 65 | +1 food, +2 housing | Pottery |
| Walls | 80 | +50 city HP, city gains ranged attack (range 2) | Masonry |
| Library | 90 | +2 science | Writing |
| Market | 100 | +3 gold | Currency |
| Barracks | 90 | +1 production, new military units start at 110 HP | Bronze Working |
| Water Mill | 80 | +1 food, +1 production (requires river) | The Wheel |

**Building design notes**:
- **Monument**: Civ VI gives culture/loyalty — neither exists in MVP. Changed to +1 science/+1 production. A useful early building. Revisit when culture is added (Phase 3).
- **Barracks**: Civ VI gives XP for promotions — not in MVP. Changed to +10 starting HP for military units. Simple, concrete bonus.
- **Walls**: City ranged attack CS = city's own CS (not a fixed 15). Cities cannot attack without Walls.

### Tile Improvements (Builder-Constructed)

Improvements are built by Builders (1 charge per improvement). They modify tile yields and are stored separately from terrain (see `tile_improvements` in contract storage).

| Improvement | Requires Tech | Valid Terrain | Yield Bonus |
|---|---|---|---|
| Mine | Mining | Hills (any type) | +1 production |
| Farm | Irrigation | Flat land (grassland, plains) | +1 food |
| Quarry | Masonry | Stone resource tiles | +1 production |
| Pasture | Animal Husbandry | Horses resource tiles | +1 production |
| Lumber Mill | Construction | Woods tiles | +1 production |

**Improvement storage**: `tile_improvements: LegacyMap<(game_id, q, r), u8>` — 0=None, 1=Farm, 2=Mine, 3=Quarry, 4=Pasture, 5=LumberMill.

**Rules**:
- Only one improvement per tile
- Building an improvement on a tile with an existing improvement replaces it
- Improvements are destroyed when an enemy captures the city that owns the tile
- Improvement yield bonus is added to the tile's base yield when worked by a citizen

### Production Queue

```
Each turn:
    production_yield = city production per turn (from tiles + buildings)
    production_stockpile += production_yield
    if production_stockpile >= current_item.cost:
        complete item (create unit, add building)
        production_stockpile -= current_item.cost
        advance to next item in queue (or idle)
```

For MVP, queue depth = 1 (no queuing, just one item at a time).

---

## 4. Gold Economy

```
Income:
    + Gold from tile yields
    + Gold from buildings (Market)
    + Palace gold (+5)

Expenses:
    - Unit maintenance: 1 gold per military unit
    - Building maintenance: 0 gold (simplified for MVP)

Per turn:
    gold_per_turn = income - expenses
    treasury += gold_per_turn
    if treasury < 0: disband a unit (lowest HP first)

Gold purchases:
    Units and buildings can be bought with gold
    Purchase cost = production_cost × 4 (Civ VI ratio)
```

---

## 5. Science

```
Each turn:
    // Science tracked in HALF-POINTS internally to avoid floating point.
    // Display to player as full points (divide by 2).
    half_science_per_turn = population + (building_bonuses × 2) + palace_bonus(4)
    // population × 1 half-point = 0.5 science per citizen (matches Civ VI)
    // Library: +2 science = +4 half-points
    // Palace: +2 science = +4 half-points

    tech_half_progress += half_science_per_turn
    if tech_half_progress >= current_tech.cost × 2:
        complete tech
        tech_half_progress -= current_tech.cost × 2
        unlock tech benefits
```

**Why half-points?** Per-citizen science is 0.5 in Civ VI. Using `population / 2` (integer division) loses 0.5 science every turn for odd-population cities. Tracking in half-points is exact with zero floating point. The tech costs in the tree are already integers — just double them internally.

Alternative considered: just use `population / 2` and accept the rounding. Rejected because early game (pop 1 = 0 science from citizens) makes research painfully slow. Half-points give pop 1 = 0.5 science = meaningful contribution.
