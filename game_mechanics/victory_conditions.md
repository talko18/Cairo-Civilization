# Victory Conditions

There are five (or six with Gathering Storm) victory conditions in Civilization VI.
The first player to achieve any condition wins. If the turn limit is reached (2050 AD
on Standard speed), the player with the highest Score wins.

## Science Victory

### Requirements

1. **Launch Earth Satellite**
   - Research: Rocketry
   - Build: Spaceport district
   - Complete: Launch Earth Satellite project

2. **Land a Human on the Moon**
   - Research: Satellites
   - Complete: Launch Moon Landing project

3. **Establish a Martian Colony**
   - *Base Game / Rise & Fall:*
     - Research: Nuclear Fusion -> Launch Mars Reactor project
     - Research: Nanotechnology -> Launch Mars Hydroponics project
     - Research: Robotics -> Launch Mars Habitation project
     - (Three projects, completable in any order)
   - *Gathering Storm:*
     - Research: Nanotechnology -> Launch Mars Colony project (single consolidated project)

4. **Launch Exoplanet Expedition** (Gathering Storm only)
   - Research: Smart Materials
   - Complete: Exoplanet Expedition project

5. **Travel 50 Light-Years** (Gathering Storm only)
   - Automatic after launching the expedition
   - Base speed: 1 light-year per turn
   - Speed boosted by completing Terrestrial Laser Station and Lagrange Laser Station projects
   - Each laser station adds +1 light-year per turn (can be built in multiple cities)

### Key Tips
- All projects require a **Spaceport** district
- Projects must be completed sequentially (Satellite before Moon, Moon before Mars)
- Build multiple Spaceports to protect against spy sabotage
- Great Engineers (Robert Goddard, Sergei Korolev, Wernher von Braun) boost space projects
- Pingala's Space Initiative title: +30% Production toward space projects

## Culture Victory

### Requirements
Your **visiting tourists** (from all civilizations combined) must exceed every other
single civilization's **domestic tourists**.

### How Tourism Works

**Domestic Tourists** (your defense against others' Culture Victory):
```
Domestic Tourists = Total Culture generated over the entire game / 100
```

**Visiting Tourists** (your offense for Culture Victory):
```
Visiting Tourists from each civ = Total Tourism sent to them / (150 * number_of_civs)
  (In expansions: 200 * number_of_civs)
```

### Tourism Sources

| Source | Tourism Generated |
|--------|------------------|
| Great Works (Writing, Art, Music, Artifacts, Relics) | Base yield per type |
| Wonders | Tourism equal to Culture output |
| National Parks | Based on Appeal of 4 tiles |
| Seaside Resorts | Based on tile Appeal |
| Ski Resorts (GS) | Based on tile Appeal |
| Improvements with Culture (after Flight tech) | Culture yield becomes Tourism |
| Rock Bands (GS) | Burst Tourism at concert venues |
| Walls (after Conservation civic) | 1/2/3 Tourism for Ancient/Medieval/Renaissance |

### Tourism Modifiers
| Modifier | Effect |
|----------|--------|
| Trade Route to civ | +25% Tourism to that civ |
| Open Borders with civ | +25% Tourism to that civ |
| Same government type | +25% Tourism to that civ |
| Different government type | -25% Tourism to that civ (GS) |
| Computers tech | +100% all Tourism (25% in GS) |
| Environmentalism civic (GS) | +25% all Tourism |
| Heritage Tourism policy | +100% Tourism from Artifacts |
| Satellite Broadcasts policy | +200% Tourism from Great Works of Music |
| Online Communities policy | +50% Tourism from Trade Routes |

### Theming Bonuses
Museums gain bonus Tourism when their Great Works follow specific patterns:
- **Art Museum:** 3 works from different artists, same era
- **Archaeological Museum:** 3 artifacts from different civilizations, same era

## Domination Victory

### Requirements
Control the **original Capital** of every civilization in the game (whether they are
still alive or not).

### Key Rules
- You must capture the city that was each civ's starting Capital
- If a Capital has been captured by a third party, you must take it from them
- You do NOT need to eliminate other civilizations (just hold their Capitals)
- Losing your own original Capital does not prevent winning (you just need to recapture it)
- Use appropriate Casus Belli to minimize warmonger penalties
- Conquered cities may have Amenity and Loyalty problems

### War Weariness
- Prolonged war generates negative Amenities in your cities
- Losing units and fighting in your territory generates more weariness
- Policy cards and buildings can mitigate war weariness

## Religious Victory

### Requirements
Your religion must be the **predominant religion** (followed by more than 50% of cities)
in every civilization still in the game.

### Key Rules
- A city follows your religion when the majority of its population are followers
- You need >50% of each civ's cities converted
- The civ can lose their religion to natural spread, requiring reconversion
- While a **Religious Emergency** is active, the victory condition cannot trigger
- Conquering and razing non-converted cities changes the percentage calculation

### Strategy
- Start strong: Religious Victory gets exponentially harder as cities grow
- Prioritize Apostles for already-religious cities
- Use Missionaries for cities with no religion
- Protect religious units with military escorts when at war
- Launch Inquisition early to buy Inquisitors for defense
- Consider conquest as an alternative to conversion

## Diplomatic Victory (Gathering Storm)

### Requirements
Earn **20 Diplomatic Victory Points**.

### Ways to Earn Points

| Source | Points |
|--------|--------|
| Voting for winning World Congress resolution outcome | +1 |
| Winning Aid Request competition (1st place) | +2 |
| Winning non-emergency Scored Competition (1st place) | +1 |
| World Leader election (spend Diplomatic Favor to vote) | +2 (or -2) |
| Building Mahabodhi Temple wonder | +2 |
| Building Potala Palace wonder | +1 |
| Building Statue of Liberty wonder | +4 |
| Researching Seasteads (Future Era tech) | +1 |
| Discovering Global Warming Mitigation (Future Era civic) | +1 |

### Diplomatic Favor
- Currency used for World Congress voting
- Sources: Alliances (+1/turn per alliance), Suzerainty (+1/turn per city-state), government type bonuses, Trade Routes
- Can be traded with other civs

## Score Victory (Time Victory)

### Requirements
If no one achieves another victory by the **turn limit** (2050 AD Standard speed),
the player with the highest **Score** wins.

### Score Calculation (Rise & Fall / Gathering Storm)

| Category | Points |
|----------|--------|
| Per city owned | 5 |
| Per district owned | 2 (4 if unique district) |
| Per building owned | 1 |
| Per Citizen | 1 |
| Per civic researched | 3 |
| Per technology researched | 2 |
| Per Great Person earned | 5 |
| Per wonder owned | 15 |
| For founding a religion | 10 |
| Per foreign city following your religion | 2 |
| Era Score points | 1 per point |

### Tiebreakers (in order)
Civics -> Cities -> Districts -> Population -> Great People -> Religion -> Technologies -> Wonders

## Defeat

A player is defeated when:
- They have no cities and no Settlers
- Another player (not on their team) achieves a victory condition
- The turn limit expires with Score Victory disabled (all players lose)
- The player retires from the game
