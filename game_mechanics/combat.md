# Combat System

Combat in Civilization VI uses a detailed strength-based system where the difference
between attacker and defender strength determines damage dealt.

## Combat Statistics

| Stat | Description |
|------|-------------|
| Hit Points (HP) | All military units have **100 HP**. Reduced to 0 = death |
| Combat Strength (CS) | General strength. For melee: both offense and defense. For ranged: defense only |
| Ranged Strength (RS) | Offensive power for ranged attacks. Suffers **-17 penalty** vs city/district defenses and naval units |
| Bombard Strength | Siege unit offensive power. Suffers **-17 penalty** vs land units. Full damage vs defenses and naval units |
| Anti-Air Strength | Damage dealt to intercepted aircraft |
| Range | Number of tiles a ranged/siege unit can attack across |
| Movement (MP) | Points consumed when moving. Default: 1 MP per flat tile |
| Sight | Visibility radius (typically 2 tiles) |

## Damage Formula

```
Damage(HP) = 30 * e^(0.04 * StrengthDifference) * random(0.8, 1.2)
```

Where:
- **e** = Euler's number (~2.71828)
- **StrengthDifference** = Attacker's effective strength - Defender's effective strength
- **random** = Random multiplier between 80% and 120%

### Key Damage Benchmarks

| Strength Difference | Expected Damage | Notes |
|--------------------|-----------------|-------|
| 0 (equal) | ~30 HP each | Range: 24-36 |
| +10 | ~45 HP dealt, ~20 HP received | |
| +20 | ~66 HP dealt, ~13 HP received | |
| +26 to +35 | Possible one-hit kill | |
| +36 or more | Guaranteed one-hit kill | |

### Important Properties
- Only **strength difference** matters, not ratio (a +10 bonus is equally effective at CS 20 as at CS 100)
- Each strength point multiplies damage by ~1.041
- Melee attacks cause retaliation damage to the attacker
- Ranged attacks do NOT cause retaliation damage

## Combat Modifiers

All modifiers are **additive** (flat CS bonuses/penalties, not percentages).

### Terrain Modifiers (apply to DEFENDER)

| Modifier | CS Change | Conditions |
|----------|-----------|------------|
| Hills | +3 | Defender on Hills |
| Woods | +3 | Defender in Woods |
| Rainforest | +3 | Defender in Rainforest |
| Hills + Woods/Rainforest | +6 | Bonuses stack |
| Reef (R&F) | +3 | Defender on Reef (naval) |
| Marsh | -2 | Defender on Marsh |
| Floodplains | -2 | Defender on Floodplains |
| River defense | +5 | Melee attack across a River |
| Amphibious attack | -10 | Embarked unit attacking land |

### Flanking and Support

| Modifier | CS Change | Conditions |
|----------|-----------|------------|
| Flanking bonus | +2 per unit | Per friendly unit adjacent to the DEFENDER (melee attacks only) |
| Support bonus | +2 per unit | Per friendly unit adjacent to the ATTACKER |

### Fortification

| Condition | CS Bonus |
|-----------|----------|
| 1 turn without moving/acting | +3 |
| 2+ turns without moving/acting | +6 |
| In a Fort improvement | Instant +6 (2-turn fortification) |

### Unit Class Modifiers

| Attacker | Target | CS Bonus |
|----------|--------|----------|
| Melee units | Anti-Cavalry units | +5 |
| Anti-Cavalry units | Light/Heavy/Ranged Cavalry | +10 |

### Wounded Unit Penalty

Units lose CS as they take damage:
```
Penalty = round(10 - HP/10)
```
- At 100 HP: 0 penalty
- At 50 HP: -5 CS
- At 1 HP: -10 CS

Exceptions: Samurai never suffer this penalty.

### Diplomatic Visibility Bonus
+3 CS for each level of Diplomatic Visibility advantage over the enemy.
Mongolia gets +6 per level instead.

### Difficulty Level
On higher difficulties, AI military units receive flat CS bonuses.

## Attacking Rules

### Melee Attacks
- Attacker must have enough MP to enter the defender's tile
- If attacker wins, it advances into the defender's tile
- Both attacker and defender take damage

### Ranged Attacks
- Must be within Range AND have line of sight
- Can attack with any remaining MP (even a fraction)
- Line of sight blocked by: Woods, Rainforest, Hills, Mountains
- Higher ground (Hills) ignores lower-ground obstacles
- Units with Range 3+ can lob over obstacles if target is visible
- No retaliation damage to attacker

### Siege Units
- **Cannot attack on the same turn they move** (unless they have Expert Crew promotion or a Movement bonus)
- Ideal for attacking city defenses (full Bombard damage vs walls)

### Air Units
- Attack without retaliation from land units (except Giant Death Robot in GS)
- Can be intercepted by Anti-Air units and certain naval units
- Fighters can Patrol/Intercept; Bombers have Bombard-type damage vs cities

## Unit Formations

### Corps/Fleet (Industrial Era - Nationalism civic)
- Merge 2 units of the same type into a **Corps** (land) or **Fleet** (naval)
- **+10 Combat Strength** bonus
- **+10 Embarked CS** bonus

### Army/Armada (Modern Era - Mobilization civic)
- Merge 3 units (or add a unit to a Corps/Fleet)
- **+17 Combat Strength** bonus
- **+17 Embarked CS** bonus

### Escort Formations
- Military unit + Civilian unit can form an escort
- Civilian is protected; attacks target the military unit
- Both units move together

## Embarked Units

Land units on water tiles use generic "transport ship" combat strength:
| Era | Embarked CS |
|-----|-------------|
| Classical/Medieval | 15 |
| Renaissance | 30 |
| Industrial | 35 |
| Modern | 50 |
| Atomic+ | 55 |

- Embarked units **cannot attack** other water units
- Embarked units CAN attack adjacent land targets (with amphibious penalty)
- Always escort embarked armies with naval units

## Zone of Control

- All melee units exert a Zone of Control (ZoC) on the 6 tiles surrounding them
- Enemy units entering a ZoC tile must stop (all remaining MP consumed)
- Cavalry units and religious units ignore ZoC

## Healing

| Location | HP per Turn |
|----------|-------------|
| Neutral territory | 10 HP |
| Friendly territory | 15 HP |
| On a District | 20 HP |
| Enemy territory | 5 HP |

- Healing only occurs if the unit did NOT move or act that turn
- Medic support unit: +20 HP healing to all units on and adjacent to its tile
- Naval units can only heal in friendly territory (unless promoted or Norwegian)

## Capturing Units

- Move a military unit onto a tile occupied by an enemy civilian (Settler, Builder) to capture it
- Captured Settlers become Builders (in some versions) or remain Settlers
- Religious units, Great People, Archaeologists, Naturalists, and Traders cannot be captured

## Condemning Heretics

- Military units can use the **Condemn Heretic** action on enemy religious units in the same tile
- Instantly destroys the religious unit
- Reduces religious pressure of the condemned unit's religion in nearby cities
- Requires being at war with the religious unit's civilization

## Pillaging

| Target | MP Cost | Yield |
|--------|---------|-------|
| Improvements | 3 MP | Gold, Faith, or Healing (50 HP) depending on type |
| District buildings | 3 MP | Science, Culture, Gold, Faith, or Healing depending on district |
| Trade Routes | Full action | Large Gold sum |
| Barbarian Outposts | Move onto tile | 50 Gold |
| Roads | 3 MP | No yield (removes road) |

- Light cavalry with **Depredation** promotion: only 1 MP to pillage
- Pillaging does not end the unit's turn if it has remaining MP
- Naval raiders can **Coastal Raid** (pillage adjacent land tiles from water)
- Pillaging yields scale with era progression in Gathering Storm

## Nuclear Weapons

Two types of nuclear devices:
| Type | Range | Area of Effect | Unlock Tech |
|------|-------|---------------|-------------|
| Nuclear Device | 12 tiles | 1 hex (7 tiles) | Nuclear Fission |
| Thermonuclear Device | 15 tiles | 2 hexes (19 tiles) | Nuclear Fusion |

- Stored in a global stockpile after production
- Launched from: Missile Silo (improvement), Nuclear Submarine, Bomber
- Effects: massive damage to units, cities lose population, fallout contaminates tiles
- Using nukes generates enormous warmonger penalties and Grievances
