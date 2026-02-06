# Game Flow: Lobby, Turns, Victory

## 1. Game Lobby

### Options

**A: On-chain lobby (all steps on-chain)** — create, join, seed agreement, all as transactions

- Pros: Fully trustless, no off-chain coordination needed
- Cons: 4-6 transactions just to start a game, slow

**B: Off-chain matchmaking + on-chain start** — players agree off-chain, then one create_game tx

- Pros: Faster setup, only 2-3 transactions (create, join, start)
- Cons: Needs an off-chain channel (Discord, website) for matchmaking

**C: Hybrid** — on-chain lobby for discovery, minimal on-chain setup

- Pros: Balance of discoverability and speed
- Cons: Slightly more complex

### Decision: **A — On-chain lobby** (simplified for Phase 1)

For MVP with 2 players, keep it minimal: 2 transactions to start a game.

### Phase 1 Lobby (MVP)

```
Step 1: Player A calls create_game(map_size=32x20)
    → game_id assigned, status = WaitingForPlayer
    → Event: GameCreated(game_id, player_A)

Step 2: Player B calls join_game(game_id)
    → map_seed = Poseidon(game_id, block_timestamp)
    → Contract generates map on-chain from seed (hash-based, see 01_hex_and_map.md)
    → Starting positions computed, each player gets Settler + Warrior
    → status = Active, turn 1 begins
    → Event: GameStarted(game_id)
```

Only 2 transactions. Map seed randomness comes from block_timestamp — not ideal, but acceptable for a public-state prototype where fog of war doesn't exist yet.

### Phase 2 Lobby (ZK — added later)

Phase 2 adds seed agreement and a dealer:

```
Step 1: Player A calls create_game(map_size=32x20, dealer=<address>)
Step 2: Player B calls join_game(game_id)
Step 3: Seed agreement (commit-reveal from both players, 4 transactions)
    → combined_seed = Poseidon(random_A, random_B)
Step 4: Dealer generates map off-chain, posts commitment
    → Dealer calls set_map_commitment(game_id, merkle_root)
Step 5: Both players commit initial state
    → status = Active
```

The seed agreement prevents either player from pre-knowing the map. The dealer ensures neither player sees the full map at start.

## 2. Turn Structure

### Per Turn

```
1. Contract checks: is it this player's turn? Is the deadline not passed?

2. Player computes actions off-chain:
    a. Move units
    b. Assign city production
    c. Set research
    d. Attack enemies
    e. Found cities
    f. Build improvements

3. Player submits: submit_turn(game_id, ...)
    Phase 1: actions are validated on-chain
    Phase 2: proof is verified on-chain

4. Contract processes outcomes:
    - Cities founded → create city in storage, assign territory
    - Combats → resolved IMMEDIATELY (Phase 1), emit CombatResolved
    - Improvements built → stored in tile_improvements
    - Tech/production completed → apply unlocks

5. End-of-turn processing:
    - City yields applied (food, production, gold, science)
    - Population growth checked
    - Production completion checked
    - Tech completion checked
    - Unit healing

6. Turn advances to next player
```

### Turn Order

Strict alternation: Player A → Player B → Player A → Player B → ...

```
current_player_index = game_turn % 2
// Player A (index 0) goes on even turns, Player B (index 1) on odd turns
```

**Why not rotate who goes first each round?** Round-based alternation adds complexity (the contract must track rounds separately from turns) for marginal benefit. In a 150-turn game, first-player advantage is negligible — both players get 75 turns. The simpler rule is better for MVP. Can revisit post-MVP if playtesting shows an issue.

## 3. Turn Timer

### Options

**A: 3 minutes** — fast, blitz-style

- Pros: Games finish in 2-3 hours, keeps engagement high
- Cons: Proof generation (~5-10s in Phase 2) eats into thinking time, stressful

**B: 5 minutes** — standard online

- Pros: Enough time to think + generate proof, matches online strategy game norms
- Cons: A 150-turn game could take 12+ hours if both players use full time

**C: 10 minutes** — casual / async-friendly

- Pros: No time pressure, forgiving for slow connections
- Cons: Games take very long

**D: 24 hours** — correspondence style

- Pros: Play at your own pace, no scheduling needed
- Cons: A game takes months

### Decision: **B — 5 minutes per turn, with nuances**

```
Turn Timer Rules:
    - Each player has 5 minutes per turn
    - Timer starts when it becomes their turn (contract records block timestamp)
    - Submitting a turn stops the timer
    
Timeout Handling:
    - First timeout: turn is skipped (no actions, state unchanged)
    - Second consecutive timeout: game offers opponent the choice to claim victory or continue
    - Third consecutive timeout: auto-forfeit, opponent wins
    
Timer Implementation:
    On submit_turn:
        assert block_timestamp <= turn_start_timestamp + 300  // 5 min = 300 sec
    
    On claim_timeout:
        assert block_timestamp > turn_start_timestamp + 300
        assert current_player != caller
        apply timeout penalty to current player
```

## 4. Victory Condition

### Options

**A: Domination only (capture capital)** — simplest, most direct

- Pros: Clear win condition, encourages combat, fast to check
- Cons: Only one way to win, defensive play has no counter-strategy

**B: Domination + Score** — capture capital OR highest score at turn limit

- Pros: Two viable strategies (military vs. economic), game always ends
- Cons: Score calculation needed, turn limit to decide

**C: Domination + Science + Score** — three victory paths

- Pros: Multiple strategies, closest to Civ VI
- Cons: Science victory needs late-game content (Spaceport, etc.) not in MVP

### Decision: **B — Domination + Score at turn limit**

Domination gives a military win path. Score at turn limit gives an economic/expansion win path. This prevents games from stalling if neither player can capture the capital.

```
DOMINATION VICTORY:
    A melee unit captures the opponent's original capital city
    → Immediate victory for the capturing player
    
    Capital capture process:
        1. Reduce city HP to 0 (via attacks)
        2. Move a melee unit onto the city tile
        3. City ownership transfers to attacker
        4. If the captured city is the opponent's ORIGINAL capital: game over

SCORE VICTORY:
    At turn 150, the player with the highest score wins.
    (If domination hasn't occurred by then.)

    Score calculation:
        + 5 per population (across all cities)
        + 10 per city owned
        + 3 per tech researched
        + 2 per tile explored
        + 4 per enemy unit killed (lifetime)
        + 15 per enemy city captured (currently held)
        + 10 for each building completed
    
    Score is PRIVATE (part of committed state) until turn 150.
    At turn 150, both players reveal their scores via their final turn proof.

Turn Limit: 150 turns total (75 rounds of A+B)
```

## 5. Starting Conditions

```
Each player starts with:
    - 1 Settler (at starting position)
    - 1 Warrior (adjacent to Settler)
    - 0 gold
    - No techs researched
    - Vision of tiles within 3 hexes of starting position

Game starts with:
    - Player A takes turn first (Round 1)
    - No cities exist yet (must found with Settler)
    - Map is fully hidden (Phase 2) or fully visible (Phase 1)
```

## 6. End-of-Game

```
When victory is achieved:
    1. Contract sets game_status = Finished
    2. Event: GameEnded(game_id, winner, victory_type)
    3. No more turns can be submitted
    4. Game state is final (commitments frozen)
```
