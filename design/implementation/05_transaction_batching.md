# Transaction Batching Design

## Problem

Every player action currently sends a separate on-chain transaction. This is
expensive and slow, especially on StarkNet where each transaction incurs gas
and latency.

## Solution — Predicted / Unpredicted Action Classification

Actions are split into two categories:

| Category | Meaning | Examples |
|---|---|---|
| **Predicted** | Deterministic, does not depend on hidden on-chain state. The client can optimistically apply the result locally. | `SetResearch`, `SetProduction`, `FortifyUnit`, `SkipUnit`, `DeclareWar`, `BuildImprovement`, `RemoveImprovement`, `PurchaseWithGold`, `UpgradeUnit` |
| **Unpredicted** | Depends on on-chain state the client may not have, or has non-deterministic outcomes (combat). Must be validated on-chain. | `MoveUnit`, `AttackUnit`, `RangedAttack`, `FoundCity`, `EndTurn` |

### Client-side queue

1. When the player performs a **predicted** action, it is pushed to a local
   `pendingActions` queue and applied optimistically to the local game state
   (e.g. research icon updates immediately).
2. When the player performs an **unpredicted** action, the client flushes:
   `[...pendingActions, unpredictedAction]` as a single transaction.
3. The pending queue is cleared after the transaction succeeds.

### Order preservation

Because predicted and unpredicted actions are sent in a single ordered array,
the contract processes them in sequence. This handles cases like:

> Set production → Granary  
> Chop forest (BuildImprovement) → completes Granary  
> Set production → Monument  

The contract sees `[SetProduction(Granary), BuildImprovement(chop), SetProduction(Monument)]`
and processes them left-to-right, so the second SetProduction correctly follows
the completion triggered by the chop.

## Contract changes

A new entry point `submit_actions` is added alongside `submit_turn`:

- `submit_actions(game_id, actions)` — processes an array of actions mid-turn.
  Does NOT end the turn. Does NOT switch player. Still validates caller and
  timer.
- `submit_turn(game_id, actions)` — unchanged. Processes actions, then runs
  end-of-turn, then switches player. Used when the batch ends with `EndTurn`.

## Server changes

A new `/api/actions` endpoint calls `submit_actions`. The existing `/api/turn`
endpoint continues to call `submit_turn` (used when `EndTurn` is in the batch).

## Transaction count comparison

| Scenario (one turn) | Before | After |
|---|---|---|
| Set research, set production, move 3 units, end turn | 6 txns | 2 txns (move×3 bundles predicted, end turn) |
| Set research, end turn | 2 txns | 1 txn (end turn bundles research) |
| Set production, chop forest, set production, move, end turn | 5 txns | 2 txns |
| Just end turn (no actions) | 1 txn | 1 txn |
