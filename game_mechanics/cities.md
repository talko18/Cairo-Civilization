# Cities

Cities are the foundation of a civilization in Civ6. They produce units, buildings,
districts, and wonders, and serve as the primary engine for generating all yields.

## Founding a City

- Cities are founded by **Settler** units
- The first city becomes the **Capital** (contains the Palace building)
- Settling consumes the Settler unit
- A new city starts with 1 Population and a City Center district
- Cities must be founded at least **3 tiles apart** from any other City Center
- The tile the city is founded on becomes the **City Center** district

## City Center

The City Center is the core district, automatically created on the founding tile. It:
- Provides base yields from the tile
- Generates +2 Production if on a Hills tile
- Can build basic buildings: Monument, Granary, Water Mill, Ancient Walls, Medieval Walls, Renaissance Walls
- Contains the Palace in the Capital (+5 Gold, +2 Science, +1 Culture, +1 Production, +1 Housing, +3 Great Work slots)
- Has a ranged attack once Walls are built (Urban Defenses after Steel tech for all City Centers)

## Population & Growth

### Growth Formula
- Each Citizen requires **Food** to sustain (2 Food per Citizen)
- Excess Food accumulates in a growth bucket
- When the bucket fills, a new Citizen is born
- Growth threshold increases with each new Citizen

### Growth Modifiers
- **Housing** limits growth: at the Housing cap, growth is reduced by 75%; over cap, growth stops
- **Amenities** affect growth: Happy cities grow faster; Unhappy cities grow slower
- Buildings like Granary (+2 Food, +1 Housing) and Water Mill (+1 Food, +1 Production) help early growth

### Citizens and Tile Working
- Each Citizen can **work** one tile within the city's borders (up to 3 tiles from City Center)
- Working a tile generates its yields for the city
- Citizens can also be assigned as **Specialists** in district buildings
- The AI auto-assigns citizens, but players can manually lock assignments

## Housing

Housing is a per-city metric that limits population growth:

| Source | Housing Provided |
|--------|-----------------|
| City Center near Fresh Water (River, Lake, Oasis) | 5 base |
| City Center on Coast (no fresh water) | 3 base |
| City Center with no water access | 2 base |
| Aqueduct district | +2 (up to 6 if no fresh water) |
| Granary | +2 |
| Sewer (replaces Granary in late game) | +2 additional |
| Farm | +0.5 per Farm (after certain techs) |
| Pasture/Camp/Plantation | +0.5 each |
| Neighborhood district | +2 to +6 (based on Appeal) |
| Various buildings | Varies |

### Housing Effects on Growth
| Citizens vs Housing | Growth Rate |
|--------------------|-------------|
| Population < Housing - 2 | 100% growth |
| Population = Housing - 1 | 50% growth |
| Population = Housing | 25% growth |
| Population > Housing | 0% growth |

## Amenities

Amenities represent city happiness. Each city needs amenities based on population:
- Cities with 1-2 Population need 0 Amenities
- For each 2 additional Citizens beyond that, 1 more Amenity is required

### Amenity Sources
| Source | Details |
|--------|---------|
| Luxury Resources | Each unique luxury provides +1 Amenity to up to 4 cities (auto-distributed to neediest cities) |
| Entertainment Complex / Water Park | Buildings provide local and area-effect amenities |
| Certain Wonders | e.g., Colosseum (+2 to cities within 6 tiles) |
| Policy Cards | e.g., Retainers (+1 Amenity to cities with garrisons) |
| Religion | Certain beliefs provide amenities |
| Great People | Some provide amenities |
| National Parks | +2 to the city |
| War Weariness | Negative amenity source during prolonged wars |

### Amenity Effects
| Status | Amenities vs Need | Effect |
|--------|-------------------|--------|
| Ecstatic | +3 or more | +10% non-Food growth, +20% non-Food yields |
| Happy | +1 to +2 | +10% non-Food growth, +10% non-Food yields |
| Content | 0 | No modifier |
| Displeased | -1 to -2 | -15% non-Food growth, -10% non-Food yields |
| Unhappy | -3 to -4 | -30% non-Food growth, -20% non-Food yields |
| Unrest | -5 to -6 | -100% non-Food growth, -30% non-Food yields, rebel units may spawn |
| Revolt | -7 or worse | No growth, -40% non-Food yields, rebel units spawn |

## Borders

- City borders expand over time via **Culture** accumulation
- Tiles can also be **purchased** with Gold (or Faith with certain Governors)
- **Culture Bombs** instantly claim adjacent tiles (triggered by certain abilities)
- Cities can work tiles up to 3 hexes from the City Center
- Borders can expand up to 5 hexes from the City Center (but only tiles within 3 hexes can be worked)

## Capturing Cities

- A city is captured when a **melee or heavy cavalry unit** moves into the City Center after reducing its defenses to 0 HP
- Ranged units **cannot** capture cities
- Upon capture, the player can choose to:
  - **Keep** the city (population reduced, buildings may be damaged)
  - **Raze** the city (destroyed over several turns; Capitals and Holy Cities cannot be razed)
  - **Liberate** the city (return to original owner; gives diplomatic bonuses)
  - **Make a Free City** (Gathering Storm, if the city was a Free City before)

## City Combat

- Cities with Walls have a **ranged attack** and **Outer Defenses** (additional HP bar)
- City ranged attack uses Ranged Strength equal to the strongest unit the owner can build
- **Outer Defenses** must be depleted before the main city HP can be damaged by melee attacks
- Siege units (Catapults, Bombards, Artillery) deal full damage to Outer Defenses
- Ranged units deal reduced damage (-17) to city defenses
- **Battering Rams** allow melee units to bypass Walls (effective until Renaissance Walls if opponent has not researched certain techs)
- **Siege Towers** allow melee units to attack the city directly, ignoring Walls

## City Projects

Districts can run **Projects** that provide yields and Great Person points upon completion:
- Campus Research Grants (Science + Great Scientist points)
- Holy Site Prayers (Faith + Great Prophet points)
- Theater Square performances (Culture + Great Artist/Writer/Musician points)
- Commercial Hub investments (Gold + Great Merchant points)
- And many more per district type

Projects can be repeated indefinitely and are useful when no buildings remain to construct.
