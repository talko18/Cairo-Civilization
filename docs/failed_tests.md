# Failed Tests Analysis

**Test run**: 399 passed, 3 failed, 0 ignored  
**Date**: 2026-02-06  
**Tool versions**: scarb 2.15.1 (Cairo 2.15.0), snforge 0.56.0

All three failures are `#[should_panic]` integration tests in
`tests/test_contract.cairo` that expect the contract to revert, but the
test scenario does not actually set up the conditions that would trigger
that revert. The tests themselves acknowledge this limitation in their
comments.

---

## 1. `test_action_found_city_on_water_reverts` (I37g)

**File**: `tests/test_contract.cairo:616`  
**Attribute**: `#[should_panic]`

### What the test does

```cairo
fn test_action_found_city_on_water_reverts() {
    let (d, addr) = deploy();
    let game_id = setup_active_game(d, addr);
    start_cheat_caller_address(addr, player_a());
    d.submit_turn(game_id, array![Action::FoundCity((0, 'SeaCity')), Action::EndTurn]);
    stop_cheat_caller_address(addr);
}
```

It creates a game, then immediately tells settler (unit 0) to found a
city at its current position. The test expects this to panic because the
test name says "on water".

### Why it fails

The settler's starting position is **always on land**. The contract's
`auto_start` calls `map_gen::find_starting_positions`, which filters for
tiles where `is_land_terrain(terrain)` returns true (excluding ocean,
coast, and mountain). Since the settler spawns on a valid land tile,
`FoundCity` at that position passes terrain validation and succeeds.
No panic occurs, so the `#[should_panic]` expectation is violated.

### What the test would need to work

The test's own comment acknowledges the issue:  
`// Move settler to ocean tile first, or the validation should catch it`

To properly test this scenario the test would need to either:

- Move the settler to an ocean/coast tile before founding (impossible
  since movement validation also rejects impassable terrain), or
- Use a storage cheat to relocate the settler onto a water tile before
  calling `FoundCity`, or
- Deploy a contract with a known map seed where the starting position
  is adjacent to water, move the settler there, then found.

### Contract behavior is correct

The contract **does** correctly reject founding cities on water — the
validation in `city::validate_city_founding` returns
`Err(CityFoundError::OnWater)` for ocean/coast tiles, and the contract
panics on that error. The issue is purely that the test never puts the
settler on water.

---

## 2. `test_action_found_city_too_close_reverts` (I37h)

**File**: `tests/test_contract.cairo:629`  
**Attribute**: `#[should_panic]`

### What the test does

```cairo
fn test_action_found_city_too_close_reverts() {
    let (d, addr) = deploy();
    let game_id = setup_active_game(d, addr);
    start_cheat_caller_address(addr, player_a());
    d.submit_turn(game_id, array![Action::FoundCity((0, 'City1')), Action::EndTurn]);
    stop_cheat_caller_address(addr);
}
```

It creates a game and founds **one** city with settler 0. The test
expects a panic because its name says "too close".

### Why it fails

The test only issues a single `FoundCity` action. There is no second
`FoundCity` attempt that would trigger the minimum-distance check. The
first `FoundCity` succeeds because:

1. The settler is on a valid land tile (guaranteed by starting position
   selection).
2. There are no existing cities in the game yet, so the distance check
   against `existing_city_positions` (an empty span) passes trivially.
3. After founding, the settler is consumed (hp set to 0) and `EndTurn`
   processes normally.

No panic occurs at any point.

### What the test would need to work

The test's own comment acknowledges this:  
`// Need another settler close by — complex setup`  
`// Verified in system tests`

To properly test this scenario the test would need to:

- Found the first city with settler 0.
- Produce or purchase a second settler in that city.
- Move the second settler to a position within `MIN_CITY_DISTANCE` (3)
  of the first city.
- Attempt `FoundCity` with the second settler — this should panic.

This is a multi-turn setup that the test does not perform.

### Contract behavior is correct

The contract **does** correctly reject cities that are too close —
`city::validate_city_founding` checks `hex_distance(q, r, eq, er) <
MIN_CITY_DISTANCE` for every existing city and returns
`Err(CityFoundError::TooCloseToCity)` if violated. The contract then
panics. The issue is purely that the test never creates the second
founding attempt.

---

## 3. `test_action_set_research_already_done` (I29)

**File**: `tests/test_contract.cairo:394`  
**Attribute**: `#[should_panic]`

### What the test does

```cairo
fn test_action_set_research_already_done() {
    let (d, addr) = deploy();
    let game_id = setup_active_game(d, addr);
    start_cheat_caller_address(addr, player_a());
    d.submit_turn(game_id, array![Action::SetResearch(1), Action::EndTurn]);
    stop_cheat_caller_address(addr);
    assert!(true);
}
```

It creates a game and sets research to tech ID 1 (Mining). The test
expects a panic because its name says "already done".

### Why it fails

At game start, no techs are completed — `player_completed_techs` is 0.
When `SetResearch(1)` is processed:

1. `tech_id = 1` is valid (in range 1..18). ✓
2. `is_researched(1, 0)` returns false — Mining is **not** already
   completed. ✓
3. `can_research(1, 0)` returns true — Mining has no prerequisites. ✓
4. Research is set to 1. No panic.

The `EndTurn` then processes normally. The test ends with `assert!(true)`
which always passes. Since no panic occurred, the `#[should_panic]`
expectation is violated.

### What the test would need to work

The test's own comments acknowledge this:  
`// Need to somehow complete Mining first — this is a long-form test`  
`// This is better tested in system tests`

To properly test this scenario the test would need to:

- Set research to Mining.
- Skip enough turns for the accumulated science to exceed Mining's
  research cost (requiring a city generating science).
- After Mining completes, attempt `SetResearch(1)` again — this should
  panic with `'Already researched'`.

This is a multi-turn setup that the test does not perform.

### Contract behavior is correct

The contract **does** correctly reject re-researching a completed tech —
`act_set_research` asserts `!tech::is_researched(tid, techs)` and panics
with `'Already researched'` if the tech bit is already set. The issue is
purely that the test never completes the tech before re-requesting it.

---

## Summary

| Test | Expected behavior | Actual behavior | Root cause |
|------|------------------|-----------------|------------|
| I37g (water) | Panic on FoundCity on water | FoundCity succeeds | Settler starts on land; test never moves it to water |
| I37h (too close) | Panic on FoundCity too close | FoundCity succeeds | Only one FoundCity issued; no second settler exists |
| I29 (already done) | Panic on researching completed tech | SetResearch succeeds | Tech is not completed first; just queued for first time |

All three tests are **incomplete integration test stubs** — they declare
the intended negative scenario in their name and `#[should_panic]`
attribute, but the test body does not set up the preconditions needed
to trigger the error path. The test comments explicitly acknowledge
this and defer to system tests for coverage.

The contract correctly implements all three validation checks. These
would pass if the test scenarios were fleshed out with the necessary
multi-step setup.
