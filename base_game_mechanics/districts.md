# Districts

Districts are the signature mechanic of Civilization VI. They represent specialized areas
of a city, built on individual hex tiles within the city's territory.

## District Types

### Specialty Districts (Limited by Population)

Population requirements: 1 district at Pop 1, 2 at Pop 4, 3 at Pop 7, +1 per 3 additional Population.

| District | Focus | Unlock Tech/Civic | Adjacency Bonuses |
|----------|-------|-------------------|-------------------|
| Campus | Science | Writing | +1 per Mountain, +0.5 per Rainforest, +0.5 per district |
| Holy Site | Faith | Astrology | +2 per Natural Wonder, +1 per Mountain, +0.5 per Woods, +0.5 per district |
| Encampment | Military | Bronze Working | Cannot be adjacent to City Center |
| Theater Square | Culture | Drama and Poetry | +2 per Wonder, +0.5 per district |
| Commercial Hub | Gold | Currency | +2 per River, +2 per Harbor, +0.5 per district |
| Harbor | Gold/Naval | Celestial Navigation | +2 per City Center, +1 per sea resource, +0.5 per district. Must be on Coast tile adjacent to land |
| Industrial Zone | Production | Apprenticeship | +1 per Mine, +1 per Quarry, +0.5 per district |
| Entertainment Complex | Amenities | Games and Recreation | No standard adjacency bonuses |
| Aerodrome | Air Units | Flight | Must be on flat land. No adjacency bonuses |

### Non-Specialty Districts (No Population Requirement)

| District | Focus | Unlock Tech/Civic | Placement Rules |
|----------|-------|-------------------|-----------------|
| City Center | Core | Automatic | Founded with the city |
| Aqueduct | Housing | Engineering | Adjacent to City Center AND fresh water source (River, Lake, Oasis, Mountain) |
| Neighborhood | Housing | Urbanization | Housing based on tile Appeal (+2 to +6) |
| Spaceport | Science Victory | Rocketry | Must be on flat land. Cost: 1800 Production (does not scale) |

## Adjacency Bonuses

Districts gain yields based on surrounding tiles. These are the primary yields before any
buildings are constructed:

### Standard Adjacency Values
- **Major bonus (+2):** Specific terrain features (e.g., Mountains for Campus)
- **Standard bonus (+1):** Secondary features
- **Minor bonus (+0.5):** Other districts or tertiary features

### Japan Special Rule
Japan's civilization ability **Meiji Restoration** gives +1 adjacency per adjacent district
(instead of the standard +0.5), making district clustering highly rewarding.

## District Buildings

Each specialty district has a building chain (typically 3 tiers):

### Campus (Science)
| Tier | Building | Effects |
|------|----------|---------|
| 1 | Library | +2 Science, +1 Great Scientist point, +1 Citizen slot |
| 2 | University | +4 Science, +1 Great Scientist point, +1 Housing, +1 Citizen slot |
| 3 | Research Lab | +5 Science, +1 Great Scientist point, +1 Citizen slot |

### Holy Site (Faith)
| Tier | Building | Effects |
|------|----------|---------|
| 1 | Shrine | +2 Faith, +1 Great Prophet point, allows Missionaries |
| 2 | Temple | +4 Faith, +1 Great Prophet point, +1 Relic slot, allows Apostles/Inquisitors/Gurus |
| 3 | Worship Building | Varies by religion choice (Cathedral, Mosque, Pagoda, etc.) |

### Encampment (Military)
| Tier | Building | Effects |
|------|----------|---------|
| 1 | Barracks OR Stable | +25% XP for melee/ranged/anti-cav OR cavalry respectively, +1 Production, +1 Housing, +1 Great General point |
| 2 | Armory | +25% XP for all land units, +1 Production, allows Military Engineers |
| 3 | Military Academy | Allows building Corps/Armies directly, +25% XP, +1 Production, +1 Great General point |

### Theater Square (Culture)
| Tier | Building | Effects |
|------|----------|---------|
| 1 | Amphitheater | +2 Culture, +1 Great Writer point, 2 Great Writing slots |
| 2 | Art Museum OR Archaeological Museum | Great Art/Artifact slots, +1 Great Artist/+1 Archaeologist respectively |
| 3 | Broadcast Center | +4 Culture, +1 Great Musician point, 1 Great Music slot |

### Commercial Hub (Gold)
| Tier | Building | Effects |
|------|----------|---------|
| 1 | Market | +3 Gold, +1 Great Merchant point, +1 Citizen slot |
| 2 | Bank | +5 Gold, +1 Great Merchant point, +1 Citizen slot |
| 3 | Stock Exchange | +7 Gold, +1 Great Merchant point, +1 Citizen slot |

### Harbor (Gold/Naval)
| Tier | Building | Effects |
|------|----------|---------|
| 1 | Lighthouse | +1 Food, +1 Gold, +1 Housing, +25% XP for naval units |
| 2 | Shipyard | +1 Production to unimproved Coast/Ocean tiles, bonus Production toward naval units |
| 3 | Seaport | Allows building Fleets/Armadas directly, +2 Gold, +1 Food, +2 Production |

### Industrial Zone (Production)
| Tier | Building | Effects |
|------|----------|---------|
| 1 | Workshop | +2 Production, +1 Great Engineer point, +1 Citizen slot |
| 2 | Factory | +3 Production (6-tile area effect), +1 Great Engineer point, +1 Citizen slot |
| 3 | Power Plant | +4 Production (6-tile area effect), +1 Great Engineer point |

### Entertainment Complex (Amenities)
| Tier | Building | Effects |
|------|----------|---------|
| 1 | Arena | +1 Amenity, +1 Culture |
| 2 | Zoo | +1 Amenity (6-tile area effect) |
| 3 | Stadium | +1 Amenity (6-tile area effect) |

## District Production Cost

District costs scale with game progression:

```
Cost = [1 + 9 * max(T, C)] * base_cost

Where:
  T = proportion of tech tree researched (0.0 to 1.0)
  C = proportion of civics tree researched (0.0 to 1.0)
  base_cost = 54 Production for most districts
```

### Base Costs
| District | Base Cost |
|----------|-----------|
| Most specialty districts | 54 Production |
| Aqueduct | 36 Production |
| Spaceport | 1800 Production (does NOT scale) |
| Unique districts | Half of the standard version |

### District Discount
A 40% discount applies when:
1. Total completed specialty districts >= number of unlocked district types
2. The district type has fewer copies than the average across all types

This encourages building a diverse set of districts.

## District Placement Rules

1. Must be within the city's territory (up to 3 tiles from City Center)
2. Cannot be placed on tiles with Strategic or Luxury Resources
3. Cannot be placed on tiles with Antiquity Sites or Shipwrecks
4. Removes any existing Bonus Resource, feature (Woods/Rainforest/Marsh), or improvement
5. Cannot be placed adjacent to another city's City Center
6. Specific districts have additional placement requirements (see individual entries)
7. Hidden strategic resources do NOT block district placement (they're revealed later)
8. Once placed, a district cannot be moved or removed (only destroyed by razing the city)
9. District ownership cannot be swapped between cities

## Area-Effect Buildings

Certain buildings radiate benefits to all cities whose City Center is within 6 tiles:

| Building | Area Effect |
|----------|-------------|
| Factory | +3 Production |
| Power Plant | +4 Production |
| Zoo | +1 Amenity |
| Stadium | +1 Amenity |

**Important:** Same-type building effects do NOT stack. Two Factories within range of a city
only provide +3 Production, not +6.

## Unique Districts

Some civilizations have unique districts replacing standard ones:

| Civilization | Unique District | Replaces | Special Feature |
|-------------|----------------|----------|-----------------|
| Greece | Acropolis | Theater Square | +1 Culture per adjacent district; must be on Hills |
| Germany | Hansa | Industrial Zone | +2 per adjacent Commercial Hub, +1 per resource, +0.5 per district |
| Russia | Lavra | Holy Site | Great Prophet points from adjacency; border expansion on Great Person use |
| Japan | Electronics Factory | (Building) | +4 Culture to cities within 6 tiles (instead of standard Factory Production) |
| England | Royal Navy Dockyard | Harbor | +1 Movement for naval units built here; bonus Gold for buildings on foreign continent |
| Brazil | Street Carnival | Entertainment Complex | Carnival project for extra Great People points |
| Kongo | Mbanza | Neighborhood | Available much earlier; provides +5 Housing, +2 Food, +4 Gold |

All unique districts cost **half** the Production of the standard district they replace.
