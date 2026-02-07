# Tech Tree (MVP — 18 Techs)

## Design Approach

### Options

**A: Full Civ VI Ancient + Classical (30+ techs)** — every base game tech through Classical era

- Pros: Complete, faithful
- Cons: Many techs unlock things not in MVP (districts, wonders, naval units)

**B: Curated subset (~18 techs)** — only techs whose unlocks are relevant to MVP mechanics

- Pros: Every tech feels meaningful, no dead-end techs that unlock nothing
- Cons: Missing some Civ VI flavor techs

**C: Flat linear tree (~10 techs)** — no branching, one tech after another

- Pros: Simplest
- Cons: No strategic choice in research path, doesn't feel like Civ

### Decision: **B — Curated subset (18 techs, 2 eras)**

Every tech unlocks something usable in MVP. Two eras (Ancient + Classical) give enough depth for a duel game (~100-150 turns).

## The Tech Tree

### Ancient Era (10 Techs)

```
                    ┌── Animal Husbandry (25) ── Horseback Riding
                    │
START ──┬── Mining (25) ──┬── Bronze Working (50)
        │                 ├── Masonry (50) ──┐
        │                 └── The Wheel (50) ┴── Construction (80)
        │
        ├── Pottery (25) ──── Irrigation (40)
        │                └──── Writing (45)
        │
        ├── Archery (35) ──── Machinery (100, + Engineering)
        │
        └── Sailing (40) ──── Celestial Nav. (80)
```

| # | Tech | Cost | Prerequisites | Unlocks |
|---|---|---|---|---|
| 1 | Mining | 25 | — | Mine improvement (+1 prod on hills) |
| 2 | Pottery | 25 | — | Granary building |
| 3 | Animal Husbandry | 25 | — | Reveals Horses resource, Pasture improvement |
| 4 | Archery | 35 | — | Archer unit (upgrade from Slinger) |
| 5 | Sailing | 40 | — | Coast tiles worked by cities get +1 food (passive; no builder needed) |
| 6 | Irrigation | 40 | Pottery | Farm improvement (+1 food on flat tiles) |
| 7 | Writing | 45 | Pottery | Library building |
| 8 | Masonry | 50 | Mining | Walls building, Quarry improvement |
| 9 | Bronze Working | 50 | Mining | Reveals Iron resource, Barracks building |
| 10 | The Wheel | 50 | Mining | Water Mill building (river cities) |

### Classical Era (8 Techs)

```
Bronze Working ──── Iron Working (80)
                    
Writing ──────────── Mathematics (100)

Masonry ──────┬──── Construction (80)
              │
The Wheel ────┘

Sailing ──────────── Celestial Navigation (80)

Animal Husb. ─────── Horseback Riding (80)

Archery ──────────── Machinery (100)

Currency standalone ─ (60, requires Writing)
```

| # | Tech | Cost | Prerequisites | Unlocks |
|---|---|---|---|---|
| 11 | Currency | 60 | Writing | Market building |
| 12 | Construction | 80 | Masonry + The Wheel | Lumber Mill improvement (+1 prod in woods) |
| 13 | Horseback Riding | 80 | Animal Husbandry | +1 movement for mounted units (future) |
| 14 | Iron Working | 80 | Bronze Working | Swordsman unit (future — post-MVP) |
| 15 | Celestial Navigation | 80 | Sailing | +1 vision for coastal cities |
| 16 | Mathematics | 100 | Writing | +1 range for ranged units (Archer → 3 range) |
| 17 | Engineering | 100 | Construction | +1 movement for all units on roads (future) |
| 18 | Machinery | 100 | Archery + Engineering | Crossbowman unit (future — post-MVP) |

### Notes

- Techs 14, 17, 18 unlock things for post-MVP (Swordsman, roads, Crossbowman). They still provide science milestones and the player can choose to research them for future benefit.
- **Stepping-stone techs**: Sailing and Horseback Riding have limited MVP unlocks (Sailing gives a passive coast food bonus; Horseback Riding has no MVP unit). They exist because they lead to meaningful Classical-era techs (Celestial Navigation, Cavalry in post-MVP). This is normal in Civ VI — not every tech is equally impactful.
- Total science to research everything: ~1,135. With ~5-10 science per turn early game, full tree takes ~100-200 turns. Appropriate for a duel.
- The tree has meaningful branches: military path (Archery → Machinery), economic path (Pottery → Writing → Currency), expansion path (Mining → Masonry → Construction).

## Tech Completion

```
When a tech is completed:
    - Unlock becomes available immediately
    - If it reveals a resource: mark resource tiles on the player's explored map
    - If it unlocks a unit upgrade: existing Slingers can upgrade to Archers (costs gold)
    - If it unlocks a building: building appears in city production lists
    - If it unlocks an improvement: Builder can now build that improvement

Unit upgrade cost: 50% of the new unit's production cost, in gold
    Slinger → Archer: 30 gold
```
