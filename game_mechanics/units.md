# Units

Units are the primary way players interact with the map. They explore, fight, build,
trade, and spread religion.

## Unit Categories

### Military Units

#### Land Melee
Frontline fighters. Strong in close combat. Can capture cities.

| Era | Unit | CS | Notes |
|-----|------|----|-------|
| Ancient | Warrior | 20 | Starting unit |
| Ancient | Warrior Monk | 35 | Religious unit with melee capability |
| Classical | Swordsman | 36 | Requires Iron |
| Medieval | Man-At-Arms | 45 | Requires Iron |
| Renaissance | Musketman | 55 | Requires Niter |
| Industrial | Line Infantry | 65 | Requires Niter |
| Modern | Infantry | 70 | Requires Oil (GS: per-turn) |
| Atomic | Mechanized Infantry | 85 | Requires Oil |

#### Land Anti-Cavalry
Defensive specialists against cavalry. Bonus vs mounted units.

| Era | Unit | CS | Notes |
|-----|------|----|-------|
| Ancient | Spearman | 25 | +10 vs cavalry |
| Medieval | Pikeman | 41 | +10 vs cavalry |
| Renaissance | Pike and Shot | 55 | +10 vs cavalry |
| Industrial | AT Crew | 75 | +10 vs cavalry; has ranged attack |
| Modern | Modern AT | 85 | +10 vs cavalry |

#### Land Ranged
Damage dealers from distance. Cannot capture cities.

| Era | Unit | CS | RS | Range | Notes |
|-----|------|----|----|-------|-------|
| Ancient | Slinger | 5 | 15 | 1 | Cheapest ranged unit |
| Ancient | Archer | 15 | 25 | 2 | Unlocked by Archery |
| Medieval | Crossbowman | 30 | 40 | 2 | |
| Renaissance | Field Cannon | 50 | 60 | 2 | Requires Iron |
| Modern | Machine Gun | 65 | 75 | 2 | Requires Oil (GS) |

#### Land Siege
Specialized city-killers with Bombard Strength.

| Era | Unit | CS | Bombard | Range | Notes |
|-----|------|----|---------| ------|-------|
| Classical | Catapult | 23 | 35 | 2 | Cannot move and attack same turn |
| Renaissance | Bombard | 33 | 55 | 2 | Requires Niter |
| Industrial | Artillery | 50 | 70 | 3 | First 3-range siege. Requires Oil (GS) |
| Modern | Rocket Artillery | 60 | 90 | 3 | Requires Aluminum (GS) |

#### Light Cavalry
Fast, mobile units. Ignore Zone of Control. Good for pillaging and flanking.

| Era | Unit | CS | MP | Notes |
|-----|------|----|----|-------|
| Classical | Horseman | 36 | 4 | Requires Horses |
| Medieval | Courser | 44 | 5 | Requires Horses |
| Industrial | Cavalry | 62 | 5 | Requires Horses |
| Modern | Helicopter | 82 | 6 | Can move over Mountains |

#### Heavy Cavalry
Powerful mounted units. Can move after attacking.

| Era | Unit | CS | MP | Notes |
|-----|------|----|----|-------|
| Ancient | Heavy Chariot | 28 | 3 | No resource needed |
| Medieval | Knight | 48 | 4 | Requires Iron |
| Industrial | Cuirassier | 64 | 5 | Requires Niter |
| Modern | Tank | 80 | 5 | Requires Oil |
| Atomic | Modern Armor | 90 | 5 | Requires Oil |

#### Recon
Exploration-focused. Earn XP from Tribal Villages and Natural Wonders.

| Era | Unit | CS | MP | Notes |
|-----|------|----|----|-------|
| Ancient | Scout | 10 | 3 | Starting exploration unit |
| Medieval | Skirmisher | 30 | 3 | Ranged attack (Range 1) |
| Atomic | Ranger | 55 | 3 | Ranged attack |
| Information | Spec Ops | 70 | 3 | Can paradrop |

### Naval Units

#### Naval Melee
Can capture coastal cities. Strong in naval combat.

| Era | Unit | CS | MP | Notes |
|-----|------|----|----|-------|
| Ancient | Galley | 30 | 3 | Coast tiles only |
| Renaissance | Caravel | 55 | 5 | Can enter Ocean. Sight 3 |
| Modern | Ironclad | 70 | 5 | |
| Atomic | Destroyer | 85 | 5 | Has Anti-Air |

#### Naval Ranged
Bombardment from sea. No -17 penalty vs city defenses (but reduced vs Walls).

| Era | Unit | CS | RS | Range | Notes |
|-----|------|----|----|-------|-------|
| Renaissance | Frigate | 45 | 55 | 2 | |
| Modern | Battleship | 60 | 75 | 3 | |
| Atomic | Missile Cruiser | 75 | 85 | 3 | Can carry missiles |

#### Naval Raider
Invisible by default. Can Coastal Raid. Ignore Zone of Control.

| Era | Unit | CS | RS | Range | Notes |
|-----|------|----|----|-------|-------|
| Renaissance | Privateer | 40 | 40 | 2 | |
| Modern | Submarine | 65 | 75 | 2 | |
| Atomic | Nuclear Submarine | 80 | 85 | 2 | Can launch nukes |

#### Naval Carrier
| Era | Unit | CS | Capacity | Notes |
|-----|------|----|----|-------|
| Modern | Aircraft Carrier | 65 | 2-3 aircraft | Can be upgraded to hold more |

### Air Units

#### Fighters
| Era | Unit | CS | RS | Range | Notes |
|-----|------|----|----|-------|-------|
| Modern | Biplane | 60 | 70 | 6 | First air unit |
| Atomic | Fighter | 80 | 90 | 8 | |
| Information | Jet Fighter | 95 | 105 | 10 | |

#### Bombers
| Era | Unit | CS | Bombard | Range | Notes |
|-----|------|----|---------|-------|-------|
| Modern | Bomber | 65 | 85 | 10 | Bombard damage vs cities |
| Atomic | Jet Bomber | 80 | 100 | 15 | Can carry nukes |

### Support Units (Stack with Military)

| Unit | Era | Effect |
|------|-----|--------|
| Battering Ram | Ancient | Melee units do full damage to walls (effective up to Medieval Walls) |
| Siege Tower | Classical | Melee units bypass walls entirely |
| Military Engineer | Industrial | Build Forts, Airstrips, railroads. Accelerate engineering districts |
| Medic | Modern | +20 HP healing to adjacent units |
| Drone | Information | +5 CS and +1 Range to adjacent ranged units |
| Supply Convoy | Various | +20 HP healing to adjacent units, allows healing in enemy territory |
| Observation Balloon | Industrial | +1 Range to adjacent siege/ranged units |
| Anti-Air Gun | Modern | Intercepts air attacks in range |
| Mobile SAM | Information | Intercepts air attacks, can move |

### Civilian Units

| Unit | Purpose | Notes |
|------|---------|-------|
| Settler | Found new cities | Reduces city population by 1 when produced. Can be captured |
| Builder | Build improvements | 3 charges by default (modifiable). Instant improvements. Can be captured |
| Trader | Establish Trade Routes | Creates roads along route. Cannot be captured but route can be plundered |
| Spy | Espionage missions | Unlocked via Diplomatic Service civic |
| Archaeologist | Excavate Antiquity Sites | Requires Archaeological Museum |
| Naturalist | Create National Parks | Purchased with Faith only |
| Rock Band (GS) | Generate Tourism bursts | Purchased with Faith. Random promotions |

### Religious Units
(See religion.md for details)
- Missionary, Apostle, Inquisitor, Guru

## Promotions

Each military unit class has its own promotion tree with two paths converging at a final promotion.

### Earning XP
| Source | XP Gained |
|--------|-----------|
| Combat with civilizations | Full XP (varies by combat) |
| Combat with Barbarians (past Level 1) | 1 XP only |
| Tribal Village discovery (Recon only) | +10 XP |
| Natural Wonder discovery (Recon only) | +5 XP |
| Encampment/Harbor/Aerodrome buildings | Bonus XP multiplier |

### Promotion Rules
- Promoting a unit **fully heals it**
- Promoting **ends the unit's turn** (except Gran Colombia's units)
- Each promotion costs more XP than the last
- Level thresholds: 15, 45, 90, 150, 225, 315, 420 XP

## Unit Maintenance

Each unit has a per-turn Gold maintenance cost:
- Scouts: 0 Gold/turn
- Warriors: 0 Gold/turn
- Most Ancient units: 1 Gold/turn
- Classical units: 2-3 Gold/turn
- Medieval units: 3-4 Gold/turn
- Renaissance units: 4-5 Gold/turn
- Later units: 5-8 Gold/turn

In **Gathering Storm**, certain late-game units also require per-turn strategic resource maintenance.
Running out of resources applies a stacking **-1 CS penalty per unmaintained unit** (up to -20).

## Giant Death Robot (Gathering Storm)

The ultimate land unit:
- **CS:** 130
- **MP:** 4
- **Range:** 3 (ranged attack)
- Can move through Mountains
- Can retaliate against air attacks
- Requires Uranium to build and maintain
