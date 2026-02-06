# Terrain & Map

The game world is a hex-based map composed of various terrain types, features, and
natural wonders. Terrain fundamentally affects city placement, district adjacency,
movement, combat, and overall strategy.

## Base Terrain Types

| Terrain | Food | Production | Gold | Movement Cost | Defense Bonus | Notes |
|---------|------|-----------|------|---------------|---------------|-------|
| Grassland | 2 | 0 | 0 | 1 | 0 | Best for Food |
| Plains | 1 | 1 | 0 | 1 | 0 | Balanced yields |
| Desert | 0 | 0 | 0 | 1 | 0 | Very low yields; some civs specialize |
| Tundra | 1 | 0 | 0 | 1 | 0 | Low yields; Russia gets bonuses |
| Snow | 0 | 0 | 0 | 1 | 0 | Worst base terrain |
| Coast | 1 | 0 | 1 | 1 | 0 | Water tile; fishable |
| Ocean | 1 | 0 | 0 | 1 | 0 | Deep water; requires Cartography to cross |
| Lake | 1 | 0 | 1 | 1 | 0 | Fresh water source; small enclosed body |

## Hills Variant

Most land terrains can have a Hills variant:
- **+1 Production** to the base terrain yields
- **+3 Combat Strength** defensive bonus
- **+1 Movement Cost** to enter (2 MP total for units without bonuses)
- Provides **line of sight advantage** for ranged units

| Terrain | With Hills Yields |
|---------|------------------|
| Grassland Hills | 2 Food, 1 Production |
| Plains Hills | 1 Food, 2 Production |
| Desert Hills | 0 Food, 1 Production |
| Tundra Hills | 1 Food, 1 Production |
| Snow Hills | 0 Food, 1 Production |

## Terrain Features

Features are overlaid on base terrain and modify yields and movement.

| Feature | Yield Modifier | Movement Cost | Defense Bonus | Notes |
|---------|---------------|---------------|---------------|-------|
| Woods | +1 Production | 2 total | +3 CS | Removable (Mining tech). Provides adjacency for Holy Site |
| Rainforest | +1 Food | 2 total | +3 CS | Removable (Bronze Working). Adjacency for Campus |
| Marsh | -1 Production (from base) | 2 total | -2 CS | Removable (Irrigation). Unfavorable terrain |
| Floodplains (River) | +3 Food on Desert, +1 Food others | 1 | -2 CS | Fertile but risky (GS: floods) |
| Floodplains (Volcanic, GS) | +1 Food | 1 | -2 CS | Near volcanoes |
| Oasis | +3 Food, +1 Gold | 1 | 0 | Cannot be improved; provides fresh water |
| Reef | +1 Food, +1 Production | 2 | +3 CS (naval, R&F) | Ocean feature |
| Ice | N/A | Impassable | N/A | Blocks all movement |
| Geothermal Fissure (GS) | +2 Science, +1 Faith | 1 | 0 | Adjacency for Campus and Holy Site |
| Volcanic Soil (GS) | +1 Food, +1 Production | 1 | 0 | Created by volcanic eruptions |

## Mountains

- **Impassable** to all land units (exceptions: Inca units, Spec Ops paradrop, helicopters)
- **Block line of sight** for ranged attacks
- Provide **+1 adjacency** to Campus and Holy Site districts
- **Fresh water source** for Aqueduct connections
- National Parks require Mountain tiles in some configurations
- Inca's Mit'a ability allows Citizens to work Mountains (+2 Production)

## Rivers

- Flow between tiles (on hex edges, not on tiles themselves)
- Provide **fresh water** to adjacent cities (+5 Housing base)
- Crossing a river **costs all remaining movement** (unless on a road)
- Defending across a river grants **+5 Combat Strength**
- **+2 adjacency** for Commercial Hub districts
- Enable construction of Water Mill building in City Center
- In Gathering Storm: rivers can flood, damaging but also fertilizing tiles

## Cliffs

- Found on coastal land tiles
- **Block embarkation/disembarkation** (cannot land on cliffs)
- Units cannot make amphibious attacks across cliffs
- Provide natural coastal defense

## Appeal

Appeal is a per-tile rating that affects:
- **Neighborhood** Housing (+2 to +6 based on Appeal)
- **Seaside Resort** Tourism (Tourism = Appeal value)
- **National Park** eligibility (requires Charming or better)
- **Ski Resort** Tourism (GS)
- Some civilization bonuses (Australia gets district yield bonuses from Appeal)

### Appeal Calculation

| Factor | Appeal Modifier |
|--------|----------------|
| Each adjacent Mountain | +1 |
| Adjacent Coast or Lake | +1 |
| Adjacent Natural Wonder | +2 |
| Adjacent Woods (owned) | +1 |
| Each adjacent Holy Site, Theater Square, Entertainment Complex, Water Park | +1 |
| Adjacent National Park | +1 (per tile) |
| Each adjacent Industrial Zone, Encampment, Aerodrome, Spaceport | -1 |
| Adjacent Rainforest (unowned or enemy) | -1 |
| Adjacent Marsh | -1 |
| Adjacent Floodplains | -1 |
| Each adjacent Mine, Quarry, Oil Well | -1 |
| Adjacent Barbarian Outpost | -1 |

### Appeal Ratings

| Rating | Appeal Value |
|--------|-------------|
| Breathtaking | 4+ |
| Charming | 2-3 |
| Average | 0-1 |
| Uninviting | -1 to -2 |
| Disgusting | -3 or less |

## Continents

- The map is divided into **continents** (landmasses)
- Continents affect certain game mechanics:
  - Spain's Treasure Fleet gives bonuses for inter-continent Trade Routes
  - Some civs get bonuses on their home continent
  - Colonial War casus belli can apply to civs on different continents
- Continent assignment is determined at map generation

## Natural Wonders

Natural Wonders are unique terrain features that provide special bonuses:
- Provide **+2 adjacency** to Holy Site districts
- Grant yields to adjacent tiles
- Discoverable by exploration (first to discover gets Era Score in R&F)
- Cannot be improved or removed
- Some are single-tile, others span multiple tiles

### Notable Natural Wonders

| Wonder | Tiles | Yields/Effects |
|--------|-------|---------------|
| Torres del Paine | 2 | Doubles terrain yields of adjacent tiles |
| Mount Kilimanjaro | 1 | +2 Food to adjacent tiles |
| Cliffs of Dover | 2 | +2 Culture, +2 Gold to adjacent tiles |
| Great Barrier Reef | 2 | +3 Food, +2 Science per tile |
| Mount Everest | 3 | Religious units passing get +10 Religious Strength |
| Galápagos Islands | 2 | +2 Science to adjacent tiles |
| Dead Sea | 2 | +2 Faith, +2 Culture per tile. Full HP healing for adjacent units |
| Paititi | 2 | +3 Gold, +2 Culture per tile |
| Bermuda Triangle (GS) | 3 | Naval units entering gain +1 Movement. Teleports to another ocean |

## Map Types

| Map Type | Description |
|----------|-------------|
| Continents | 2-3 major landmasses separated by ocean |
| Pangaea | Single large landmass |
| Archipelago | Many small islands |
| Island Plates | Medium-sized islands |
| Inland Sea | Landmasses surrounding a central body of water |
| Fractal | Random, unpredictable landmass shapes |
| Shuffle | Randomly selects a map type |
| Earth (True Start Location) | Real-world geography with civs starting at historical locations |
| Splintered Fractal | Fragmented landmasses |
| Primordial (GS) | Volcanic, with many natural features |

## Fog of War

- Unexplored tiles are completely hidden (black)
- Previously explored but not currently visible tiles show terrain but not units ("fog")
- Tiles within unit Sight range are fully visible
- Visibility is key for:
  - Preventing barbarian outpost spawns
  - Tracking enemy troop movements
  - Planning military strategies
