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
| Alliance | Civil Service | Deep cooperation pact |
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

### Era Scaling
- **Ancient Era:** No warmonger penalty for any war type
- **Classical through Modern:** Penalties escalate progressively
- **Information Era:** Maximum penalties

## Warmongering

Warmonger penalties are applied as flat relationship modifiers with all other civilizations:
- Declaring war: Penalty based on war type and era
- Capturing cities: Additional penalty per city
- Eliminating a civilization: Very large penalty
- Penalties decay slowly over time

All civilizations track your warmongering. The penalty is global -- every AI that knows
you will have a negative opinion if you wage aggressive wars.

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
  - Examples: City Planner, Technophile, Explorer, Standing Army, Money Grubber, etc.

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
| Sabotage Production | Industrial Zone | Damage buildings, halt production |
| Recruit Partisans | Any neighborhood | Spawn rebel units |
| Counterspy | Any district | Defend against enemy spies |

## Alliances

In the base game, alliances are simpler than in expansions:
- Formed with a civilization you have Declared Friendship with
- Prevents war between allied civilizations
- Provides Open Borders
- Shared visibility of each other's territory

## Peace Deals

When making peace, players can negotiate:
- **Gold** (lump sum or per-turn payments)
- **Resources** (luxury or strategic)
- **Cities** (cede or return captured cities)
- **Open Borders**
- **Great Works**

## Promises

AI leaders may ask players to make promises:
- Stop converting their cities
- Move troops away from their borders
- Stop spying on them
- Stop settling near them

Breaking promises generates negative relationship modifiers.
