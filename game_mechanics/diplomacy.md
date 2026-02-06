# Diplomacy & War

Diplomacy in Civilization VI evolves through the eras, becoming more sophisticated as
the game progresses. The system is built around relationships, agendas, and formal
diplomatic actions.

## Diplomatic Actions

### Basic Actions (Available from Game Start)

| Action | Effect |
|--------|--------|
| Declare Surprise War | Attack without warning. Highest warmonger penalty |
| Send Delegation | +3 relationship. Costs 25 Gold. Available immediately |
| Declare Friendship | Mutual agreement. Prevents war for 30 turns. Allows trading |
| Denounce | Public condemnation. -8 relationship. Required before Formal War |
| Make Peace | End a war. May involve concessions |
| Open Borders | Allow units to pass through territory. Mutual or one-sided |
| Trade | Exchange Gold, resources, Great Works, diplomatic agreements |

### Advanced Actions (Unlocked via Civics)

| Action | Unlock Civic | Effect |
|--------|-------------|--------|
| Formal War | Early Empire | Declare war after denouncing. Moderate penalties |
| Alliance | Civil Service | Deep cooperation. 5 types in Rise & Fall |
| Embassy | Diplomatic Service | Establish permanent diplomatic presence. +1 Diplomatic Visibility |
| Joint War | Varies | Coordinate war with an ally against a common enemy |

## Casus Belli (Types of War)

| Type | Unlock | Penalty | Condition |
|------|--------|---------|-----------|
| Surprise War | Always available | Highest (scales with era) | None needed |
| Formal War | Early Empire | Moderate (scales with era) | Must denounce first (5 turns) |
| Holy War | The Enlightenment | Low | Target converting your cities |
| Liberation War | Diplomatic Service | Very Low | Target holds cities of a 3rd party or your own |
| Reconquest War | Diplomatic Service | Very Low | Target holds one of your original cities |
| Protectorate War | Diplomatic Service | Low | Target attacked a city-state you are Suzerain of |
| Colonial War | Nationalism | Low | Target is 2+ eras behind you |
| War of Territorial Expansion | Mobilization | Moderate | General conquest justification |
| Emergency War | Various | None | Part of an emergency coalition |

### Era Scaling
- **Ancient Era:** No warmonger penalty for any war type
- **Classical through Modern:** Penalties escalate progressively
- **Information Era:** Maximum penalties

## Warmongering (Base Game / Rise & Fall)

Warmonger penalties are applied as flat relationship modifiers with all other civilizations:
- Declaring war: Penalty based on war type and era
- Capturing cities: Additional penalty per city
- Eliminating a civilization: Very large penalty
- Penalties decay slowly over time

## Grievances (Gathering Storm)

Replaces warmongering with a bilateral system:
- **Grievances** are accumulated between specific pairs of civilizations
- Both players can generate grievances against each other
- Grievances **decay over time** (faster for the stronger party)
- High grievances justify stronger war declarations
- Third parties judge based on who has more legitimate grievances

### Grievance Sources
| Action | Grievances Generated |
|--------|---------------------|
| Surprise War | 150 |
| Formal War | 75 |
| Capturing a city | 50-150 (scales with era) |
| Breaking a promise | 50 |
| Converting cities | 25-50 |
| Spying | 20-40 |

## Diplomatic Visibility

Four levels of intelligence on other civilizations:

| Level | Name | Reveals | How to Obtain |
|-------|------|---------|---------------|
| 0 | None | Nothing | Default (unmet civs) |
| 1 | Limited | Diplomatic approach | Meet the civilization |
| 2 | Open | Government type | Send Delegation or Establish Embassy |
| 3 | Secret | Policy cards in use | Spy or Alliance |
| 4 | Top Secret | Military plans, agendas | Spy + Alliance |

Each level of advantage grants **+3 Combat Strength** against that civilization.

## Agendas

Each AI leader has:
- **Historical Agenda:** Always known, based on the leader's real history
  - Example: Gandhi (Peacekeeper) - Likes peaceful civs, dislikes warmongers
  - Example: Montezuma (Tlatoani) - Likes civs with same luxury resources
- **Hidden Agenda:** Randomly assigned, discovered via Gossip/Espionage
  - Examples: City Planner, Technophile, Explorer, etc.

## Gossip System

Players learn about other civilizations' activities through gossip:
- Diplomatic Visibility determines what gossip you receive
- Low visibility: Only major events (war declarations, wonder completions)
- High visibility: Detailed info (unit movements, city production, spy activities)

## Espionage

### Spy Units
- Unlocked at **Diplomatic Service** civic
- Purchased with Gold or produced in cities
- Level up through successful missions (max level 3)

### Espionage Missions
| Mission | Target | Effect |
|---------|--------|--------|
| Gain Sources | Any district | Establishes spy, +1 Diplomatic Visibility |
| Steal Tech Boost | Campus | Gain a random Eureka |
| Siphon Funds | Commercial Hub / Harbor | Steal Gold |
| Great Work Heist | Theater Square | Steal a Great Work |
| Disrupt Rocketry | Spaceport | Damage and delay space projects |
| Sabotage Production | Industrial Zone | Damage buildings, halt production |
| Recruit Partisans | Any neighborhood | Spawn rebel units |
| Neutralize Governor | Government Plaza (R&F) | Remove governor for several turns |
| Breach Dam | Dam (GS) | Cause flooding |
| Counterspy | Any district | Defend against enemy spies |

## Alliances (Rise & Fall)

Five alliance types, each with three levels that improve over time:

| Alliance Type | Level 1 Bonus | Level 2 Bonus | Level 3 Bonus |
|--------------|---------------|---------------|---------------|
| Research | +Shared Research visibility | +Science from trade routes | +Tech boost on partner's research |
| Military | +5 CS vs common enemies | +Shared vision of partner's units | +Faster unit production |
| Economic | +Shared Trade Route visibility | +Gold from trade routes | +Great Merchant points |
| Cultural | +Open Borders | +Tourism bonus | +Great Works theming bonus |
| Religious | +Religious units ignore partner | +Faith from trade routes | +Shared religious pressure |

## Peace Deals

When making peace, players can negotiate:
- **Gold** (lump sum or per-turn payments)
- **Resources** (luxury or strategic)
- **Cities** (cede or return captured cities)
- **Open Borders**
- **Great Works**
- **Diplomatic Favor** (Gathering Storm)

## Promises

AI leaders may ask players to make promises:
- Stop converting their cities
- Move troops away from their borders
- Stop spying on them
- Stop settling near them

Breaking promises generates negative relationship modifiers and Grievances.
