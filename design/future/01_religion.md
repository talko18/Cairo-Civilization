# Future: Religion System

## What It Adds

- Found a religion (choose beliefs)
- Religious units: Missionary, Apostle, Inquisitor
- Religious pressure between cities (passive spreading)
- Theological combat (religious units fight each other)
- Religious victory condition (your religion dominant in all civs)

## Key Design Challenges

- **Passive pressure requires knowing foreign city data**: A player can only compute pressure from cities they've explored. Use last-known observation data from private state. Cities in fog of war use stale data.
- **Theological combat**: Same 2-tx split proof protocol as military combat, but with religious combat strength.
- **Religious victory tracking**: Requires each player to report their cities' religious composition. This is an external event — when a city flips religion, it's reported publicly.

## Contract Changes

- New public actions: `FoundReligion`, `SpreadReligion`, `TheologicalCombat`
- New storage: religion registry (which player founded which religion)
- Victory checker updated for religious victory

## Estimated Effort

Medium. The core mechanics (pressure, spreading, combat) reuse existing patterns. The complexity is in getting the pressure calculation right with partial information.
