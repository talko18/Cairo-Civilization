# Design Validation — Choice Analysis & Bug Fixes

Every major design choice reviewed against at least 2 alternatives. Bugs found and fixed.

---

## Bugs Found

### Bug 1: Unit Fog of War Is Broken (CRITICAL)

**The problem**: Doc 05 says "each player's turn proof includes a list of enemy units they can currently see." But enemy unit positions are private (inside the opponent's commitment). Player A has vision over tile (5,3) but has NO WAY to know Player B has a unit there. Self-reporting requires knowing what to report — and you don't.

The owner of the unit has no incentive to self-report either. There is no mechanism that forces visibility detection between two private states.

**Root cause**: Unit fog of war requires interaction between two private states. Without a challenge protocol, zone-based detection, or some interaction mechanism, it simply doesn't work.

**Fix**: For MVP, **unit positions are public**. Each turn, the player's proof public outputs include all their unit positions. The things that stay private: city production, current research, gold, explored tiles. This is still strategically meaningful — you know WHERE the enemy army is but not what they're building, researching, or can afford.

**Post-MVP**: Add unit fog of war via **vision bitmask** embedded in the turn proof — zero extra transactions, zero waiting. Each player publishes which tiles they can see; the opponent's proof enforces reveals for any units in that vision. Further upgrade: zone bitmask + mini-challenge for overlapping zones only. See `05_fog_of_war.md` §4.2–4.4.

### Bug 2: ExternalEvent Uses Private unit_id

**The problem**: `CombatDamage: (u32, u16)` references a `unit_id` that only exists in the player's private state. The contract never sees unit IDs.

**Fix**: Reference `combat_id` instead. The player internally maps combat_id to their unit (they know which unit they sent to attack or was attacked).

### Bug 3: Attacker Can Attack Empty Tiles

**The problem**: With private unit positions, the attacker doesn't know what's at the target tile. And the defender can't efficiently prove "no unit here" with a flat hash.

**Fix**: Resolved by Bug 1 fix — unit positions are public, so the attacker knows what's there. The contract can also verify the target tile has an enemy unit.

### Bug 4: Turn Salt Leaked During Combat

**The problem**: Attacker reveals `turn_salt` as a public output for combat randomness. This is the SAME salt in `Poseidon(state, salt) = commitment`. While brute-forcing ~5K felts is infeasible, revealing one component of the hash equation is an unnecessary risk.

**Fix**: Derive a separate `combat_salt = Poseidon(state_salt, "COMBAT_SALT")`. The proof asserts the derivation is correct. The state salt itself is never revealed.

### Bug 5: set_map_commitment Has No Access Control

**The problem**: Anyone can call `set_map_commitment(game_id, commitment)` and overwrite the map commitment for any game.

**Fix**: Add a `dealer` address field per game, set during `create_game`. Only the registered dealer can call `set_map_commitment`. Both players see and accept the dealer address when joining.

---

## Design Choice Validation

### Choice 1: Single Contract

| Option | Pros | Cons |
|---|---|---|
| **A: Single contract (chosen)** | No inter-contract calls, no access control bugs, simpler deploy/test/upgrade, all state co-located | Larger contract, harder to read in one file, can't upgrade parts independently |
| B: Multiple engine contracts | Separation of concerns, independent upgrades | Inter-contract call bugs, access control matrix, upgrade coordination, higher gas for cross-contract calls |
| C: Dojo ECS world | Built-in indexing (Torii), community tooling | Dependency risk, abstraction mismatch with ZK commitments, learning curve |

**Verdict: A is correct.** The game has one core loop (submit_turn). Splitting into engines adds indirection for no benefit at MVP scale. If the contract grows too large, Cairo modules within one contract provide separation without deployment boundaries. Re-evaluate after Phase 2 when we know the actual contract size.

### Choice 2: Flat Poseidon Hash (Commitment)

| Option | Pros | Cons |
|---|---|---|
| **A: Flat hash (chosen)** | Simple, no tree management, fast enough for MVP state size (~5K felts) | Full state hashed every turn, no partial reveals |
| B: Merkle tree | Partial reveals (reveal one unit without full rehash), constant proof path | Complex (SMT, branch management, insertion/deletion), over-engineered for MVP |
| C: Accumulator (RSA/bilinear) | Constant-size proofs for set membership | Trusted setup required, not STARK-native, complex cryptography |

**Verdict: A is correct for MVP.** The state is small. Hashing 5K felts with Poseidon takes <1s in a STARK circuit. Merkle trees become worth it when state exceeds ~50K felts or when we need efficient non-membership proofs (for unit fog of war challenge protocol post-MVP). The upgrade path is clean: swap the hash function, contract interface unchanged.

### Choice 3: Dealer-Prover for Map Generation

| Option | Pros | Cons |
|---|---|---|
| **A: Dealer-prover (chosen)** | Only way to hide map from players, commitment prevents cheating | Single point of failure, dealer knows full map, requires off-chain service |
| B: On-chain generation | Fully trustless, no external service | Full map visible to all L2 nodes — fog of war is impossible |
| C: Collaborative seed (all players generate) | Decentralized, no trusted party | Every player knows the full map — fog of war completely broken |
| D: MPC among players | No single party knows map | Complex, high latency for map generation, still needs N/2+ honest parties |

**Verdict: A is correct.** B and C fundamentally break fog of war. D is correct but too complex for MVP. A is the simplest approach that actually works. The commitment on-chain prevents the dealer from cheating (can't change the map after posting). The only risk is dealer downtime (mitigated by seed-based fallback). MPC is a post-MVP upgrade for competitive play.

### Choice 4: Unit Positions Public (NEW — was self-reporting)

| Option | Pros | Cons |
|---|---|---|
| **A: Public positions (now chosen)** | Simple, correct, no interaction protocol needed, combat targeting is straightforward | No unit fog of war |
| B: Self-reporting | Simple | **Broken** — can't report what you don't know (Bug 1) |
| C: Challenge protocol | Correct, preserves unit privacy | Extra transactions, complex, needs Merkle trees for non-membership proofs |
| D: Vision set exchange | Moderate complexity, mostly correct | Leaks approximate positions through vision set, complex circuit constraints |

**Verdict: A is the only correct simple option.** B is broken. C and D work but add significant complexity. Making unit positions public still preserves meaningful hidden information (production, research, gold, terrain fog of war). Post-MVP, move to C.

### Choice 5: 2-TX Combat Protocol

| Option | Pros | Cons |
|---|---|---|
| **A: 2-TX (chosen)** | Minimal transactions, embedded in regular turns, no extra rounds | Defender waits 1 turn to respond |
| B: 1-TX (instant resolution) | Fastest | Impossible — need both players' data, and each proof is from one player |
| C: 4-TX (separate commit-reveal for randomness) | More rigorous randomness | 4× the latency, 4× the gas, impractical at StarkNet block times |

**Verdict: A is correct.** B is impossible (two private states). C is the old design we already fixed — too slow. A is the minimum viable protocol.

### Choice 6: Salt Derived from Opponent's Commitment

| Option | Pros | Cons |
|---|---|---|
| **A: Poseidon(old_salt, turn, opponent_commitment) (chosen)** | Unpredictable future randomness, prevents grinding | Requires opponent's commitment as proof public input |
| B: Poseidon(old_salt, turn) | Simpler | Player can pre-compute all future salts and cherry-pick favorable combat timing |
| C: VRF (Verifiable Random Function) from chain | Trustless randomness | Expensive, requires oracle or special chain support, adds dependency |

**Verdict: A is correct.** B is what we had before and was rightly flagged as exploitable. C adds an external dependency. A achieves the goal with zero extra infrastructure.

### Choice 7: Event Chain Hash for State Sync

| Option | Pros | Cons |
|---|---|---|
| **A: Rolling hash (chosen)** | Compact (1 felt252), verifiable, prevents skipping events | Players must track the hash locally |
| B: Per-event on-chain list | Explicit, easy to audit | Storage grows unbounded, expensive |
| C: No verification (trust players to incorporate) | Simplest | Players can skip events, state diverges, game breaks |

**Verdict: A is correct.** C breaks the game. B is wasteful. A is compact and sufficient.

### Choice 8: Poseidon Hash

| Option | Pros | Cons |
|---|---|---|
| **A: Poseidon (chosen)** | ZK-native, low constraint count, fast in STARK circuits | Newer, less battle-tested than Pedersen |
| B: Pedersen | Built into StarkNet, well-tested | Higher constraint count, slower in circuits |
| C: Keccak256 | Industry standard, ultra battle-tested | Extremely expensive in STARK circuits (~200K constraints per hash) |

**Verdict: A is correct.** The game state hash is computed thousands of times in the proof circuit. Poseidon's lower constraint count directly reduces proving time. Pedersen is viable but slower. Keccak is prohibitively expensive.

### Choice 9: Browser localStorage for State Backup

| Option | Pros | Cons |
|---|---|---|
| **A: localStorage (chosen)** | Zero infrastructure, zero latency, works offline | Lost on device loss/browser wipe, no cross-device |
| B: Encrypted IPFS/DA backup | Cross-device, survives device loss | Requires IPFS infrastructure, upload latency, encryption key management |
| C: Server-side backup (custodial) | Simple for player, cross-device | Trust required, server can read state, centralization |

**Verdict: A is correct for MVP.** B is the right long-term answer but adds infrastructure. C defeats the purpose of trustless gameplay. For a 2-player MVP, localStorage is sufficient. Game forfeit on device loss is acceptable — it's the default for most online games.

### Choice 10: Immediate Tile Reveals

| Option | Pros | Cons |
|---|---|---|
| **A: Immediate (chosen)** | Simple, no batching logic | Reveals exploration direction |
| B: Delayed/batched every N turns | Hides exploration timing | Complex, tiles are stale for up to N turns, batching logic in circuit |
| C: Never reveal (keep tiles private per player) | Maximum privacy | Other player never learns terrain, can't verify your map claims |

**Verdict: A is correct for MVP.** The movement leak from immediate reveals is minor — terrain doesn't change, and knowing someone explored an area doesn't reveal much when unit positions are already public (Bug 1 fix). B adds complexity for marginal gain. C breaks shared terrain knowledge.

### Choice 11: One Circuit (TurnProof)

| Option | Pros | Cons |
|---|---|---|
| **A: One circuit (chosen)** | One thing to implement/test/audit, all actions are just public outputs | Circuit is large (all game rules in one program) |
| B: Multiple specialized circuits | Smaller individual circuits, easier to reason about | Multiple verifiers on-chain, circuit routing logic, duplication of state verification |
| C: Recursive proof composition | Modular circuits composed into one | Complex, recursive proving is expensive, tooling is immature |

**Verdict: A is correct.** The game has one fundamental operation: "state S + actions A → state S'". This is naturally one circuit. Splitting it creates duplication (every circuit needs to verify the state commitment) and routing complexity. If the circuit grows too large for proving time, optimize with Merkle trees (reduce hash work) rather than splitting the logic.

### Choice 12: Sequential Turns

| Option | Pros | Cons |
|---|---|---|
| **A: Sequential (chosen)** | No conflict resolution, simple combat protocol, clear turn order | Slow with many players, waiting time |
| B: Simultaneous | Fast (all act at once) | Conflict resolution, priority systems, combat needs 3-phase protocol |
| C: Async (submit anytime, resolve periodically) | Maximum flexibility | Complex ordering, race conditions, nondeterministic |

**Verdict: A is correct for MVP.** B and C add complexity that's not justified for a 2-player game. With 2 players, sequential turns have minimal wait time. Re-evaluate for 3+ player support.

### Choice 13: u8 IDs On-Chain

| Option | Pros | Cons |
|---|---|---|
| **A: u8 on-chain, enums off-chain (chosen)** | Minimal storage, simple serialization, contract doesn't need game semantics | Less readable on-chain, need off-chain mapping |
| B: Full Cairo enums on-chain | Type-safe, self-documenting | Larger storage, more complex serialization, contract needs all game definitions |
| C: felt252 string IDs | Human-readable | Expensive storage, comparison overhead |

**Verdict: A is correct.** The on-chain contract is a thin verifier — it stores commitments, routes public actions, and resolves combat math. It doesn't need to know what "terrain type 3" means. The off-chain circuit has the full type system.

---

## Summary of Changes Required

| Bug | Fix | Files Affected |
|---|---|---|
| 1. Unit visibility broken | Make unit positions public for MVP | 01, 04, 05, 06 |
| 2. ExternalEvent uses private unit_id | Reference combat_id instead | 04 |
| 3. Attack empty tiles | Resolved by Bug 1 (positions public → attacker knows target) | — |
| 4. Turn salt exposed during combat | Derive separate combat_salt | 02, 04, 06 |
| 5. No access control on set_map_commitment | Add dealer address per game | 03, 05 |
