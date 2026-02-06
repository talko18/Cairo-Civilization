# Future: Espionage System

## What It Adds

- Spy units placed in foreign cities (hidden placement)
- Missions: steal tech, sabotage production, gain sources (see enemy info)
- Counter-espionage: assign spies to defend your own cities
- Detection system: spies can be caught

## Key Design Challenges

- **Spy placement is fully private**: The spy's location is part of the player's private state. No one knows where your spy is until it acts or is detected.
- **Mission resolution requires opponent's city data**: The spy's success depends on the target city's counter-espionage level. But the defender's city data is private. Solution: the mission proof uses the LAST KNOWN observation of the city (from the attacker's explored data). The defender's actual counter-espionage level is revealed if a detection check is triggered.
- **Detection randomness**: Uses the same committed-salt randomness as combat. Mission outcome = f(spy_level, city_counter_espionage, Poseidon(attacker_salt, defender_salt, mission_id)).

## Contract Changes

- New public actions: `SpyMissionSuccess`, `SpyDetected`, `SpyCaptured`
- No storage changes (spy state is private, results are events)

## Estimated Effort

High. Espionage touches both players' private states and has complex interaction patterns (mission, detection, counter-espionage). Should be one of the last features added.
