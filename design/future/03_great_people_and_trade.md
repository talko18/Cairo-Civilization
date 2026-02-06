# Future: Great People & Trade Routes

## Great People

### What It Adds

- Great People points earned per category (Great Scientist, Engineer, Merchant, etc.)
- When threshold reached: earn a specific Great Person with a unique ability
- Great Person activation (one-time bonus at a city/tile)

### Design

- Points tracking is private (in committed state)
- Earning a Great Person is a public event (prevents two players from earning the same one)
- The turn proof verifies point accumulation is correct and the threshold was reached
- Contract maintains a public registry of which Great People have been earned (globally)

### Contract Changes

- New public action: `GreatPersonEarned(person_id)`
- New storage: `great_people_claimed: LegacyMap<(u64, u8), ContractAddress>` — (game, person_id) → who claimed

---

## Trade Routes

### What It Adds

- Trader unit moves to destination city → establishes route
- Route generates yields per turn for both players
- Routes follow specific paths (public once established)
- Enemy units can plunder routes

### Design

- Establishing a route is a public action (source and destination cities are public)
- Route yields are computed locally (in private state, verified by proof)
- Plundering is a public action (military unit on a route tile)

### Contract Changes

- New public actions: `TradeRouteEstablished(source_city, dest_city)`, `TradeRoutePlundered(route_id)`
- New storage: active trade routes per game

### Estimated Effort

Great People: Low-Medium. Straightforward point tracking + public registry.
Trade Routes: Medium. Path computation, plunder detection, yield calculation across two players.
