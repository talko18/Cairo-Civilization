// Cairo Civ — Scenario Replay System
// Defines test scenarios that can be visually replayed in the UI.
// Each scenario is a generator that yields turns: {player, label, actions, focus?}
// Helpers reference globals from index.html (G, getTile, allNeighbors, hexDist, etc.)

// Tech prerequisites (mirrors Cairo tech.cairo)
const TECH_PREREQS = {
  1:[],2:[],3:[],4:[3],5:[],6:[2],7:[2],8:[1],9:[1],10:[1],
  11:[7],12:[8,10],13:[3],14:[9],15:[5],16:[11,12],17:[12],18:[4,17]
};

const PROD = {
  SETTLER:1, BUILDER:2, SCOUT:3, WARRIOR:4, SLINGER:5, ARCHER:6,
  MONUMENT:64, GRANARY:65, WALLS:66, LIBRARY:67, MARKET:68,
  BARRACKS:69, WATER_MILL:70, ARENA:71,
};

// ═══════════════════════════════════════════════════════════════
// Helpers — rely on globals: G, getTile, allNeighbors, hexDist,
//           getValidImprovements (all defined in index.html)
// ═══════════════════════════════════════════════════════════════

function scHasTech(player, techId) {
  if (!techId) return true;
  const bits = BigInt(G.players[player].completedTechs || '0');
  return (bits & (1n << BigInt(techId - 1))) !== 0n;
}

function scCanResearch(player, techId) {
  if (scHasTech(player, techId)) return false;
  for (const p of TECH_PREREQS[techId]) {
    if (!scHasTech(player, p)) return false;
  }
  return true;
}

function scNextTech(player) {
  const order = [1,2,3,8,10,7,4,9,6,5,11,12,13,14,15,16,17,18];
  for (const t of order) {
    if (scCanResearch(player, t)) return t;
  }
  return 0;
}

// Strategic tech order: Mining+Pottery for economy, then AH→Archery for military,
// then Masonry (Walls), Writing (Library), Bronze Working (Barracks)
function scStrategicTech(player) {
  const priority = [1,2,3,4,8,7,10,9,6,5,12,11,14,13,15,16,17,18];
  for (const t of priority) {
    if (scCanResearch(player, t)) return t;
  }
  return 0;
}

// Choose what to produce based on game phase and city state
function scChooseProduction(player, city, round) {
  const p = G.players[player];
  const b = city.buildings;
  const numMilitary = p.units.filter(u => u.hp > 0 && u.unitType >= 3).length;
  const numBuilders = scAlive(player, 1).length;
  const numSettlers = scAlive(player, 0).length;
  const numCities = p.cities.length;
  const isCapital = city.isCapital;

  // Phase 1 (turns 2-5): Monument first for culture
  if (!(b & 1)) return PROD.MONUMENT;

  // Expand: build a settler from capital once we have a warrior and pop >= 2
  if (isCapital && numCities < 2 && numSettlers === 0 && numMilitary >= 1 &&
      city.population >= 2 && round >= 5 && round <= 25) {
    return PROD.SETTLER;
  }

  // Need at least 1 builder for improvements
  if (numBuilders === 0 && numMilitary >= 1 && round <= 20) return PROD.BUILDER;

  // Economy buildings (Granary for growth, Library for science)
  if (scHasTech(player, 2) && !(b & 2)) return PROD.GRANARY;
  if (scHasTech(player, 7) && !(b & 8)) return PROD.LIBRARY;

  // Defensive buildings before war
  if (scHasTech(player, 8) && !(b & 4) && round >= 12) return PROD.WALLS;
  if (scHasTech(player, 9) && !(b & 32) && round >= 15) return PROD.BARRACKS;

  // Gold building
  if (scHasTech(player, 11) && !(b & 16)) return PROD.MARKET;

  // Military: prefer Slingers (cheap ranged) once available, otherwise Warriors
  if (scHasTech(player, 3) || scCanResearch(player, 4)) return PROD.SLINGER;
  return PROD.WARRIOR;
}

// Find a valid tile for a settler to found a new city
function scFindSettlerTarget(player, settler) {
  const allCities = [];
  for (let pl = 0; pl < 2; pl++) {
    for (const c of G.players[pl].cities) allCities.push(c);
  }
  const myCity = G.players[player].cities[0];
  let best = null, bestScore = -Infinity;
  for (const t of G.tiles) {
    if (t.terrain === 0 || t.terrain === 1 || t.terrain === 12) continue;
    let tooClose = false;
    for (const c of allCities) {
      if (hexDist(t.q, t.r, c.q, c.r) < 3) { tooClose = true; break; }
    }
    if (tooClose) continue;
    const distSettler = hexDist(settler.q, settler.r, t.q, t.r);
    if (distSettler > 10) continue;
    const distHome = myCity ? hexDist(t.q, t.r, myCity.q, myCity.r) : 0;
    if (distHome > 8) continue;
    let score = 10;
    if (t.resource > 0) score += 5;
    if (t.terrain === 2 || t.terrain === 4) score += 3;
    if (t.terrain === 3 || t.terrain === 5) score += 2;
    score -= distHome * 0.5;
    score -= distSettler * 0.3;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

// Move settler toward target and found city when arrived
function scSettlerActions(player, claimed) {
  const actions = [];
  const settlers = scAlive(player, 0);
  const cityNames = player === 0
    ? ['Athens','Sparta','Thebes','Corinth','Delphi']
    : ['Rome','Carthage','Syracuse','Milan','Naples'];
  for (const s of settlers) {
    if (s.mp <= 0) continue;
    const target = scFindSettlerTarget(player, s);
    if (!target) continue;
    if (s.q === target.q && s.r === target.r) {
      const name = cityNames[G.players[player].cities.length] || ('Colony ' + G.players[player].cities.length);
      actions.push({type: 'FoundCity', settlerId: s.id, name});
    } else {
      const mv = scMoveToward(player, s.id, target.q, target.r, claimed);
      if (mv) { actions.push(mv); if (claimed) claimed.add(mv.destQ + ',' + mv.destR); }
    }
  }
  return actions;
}

function scAlive(player, type) {
  return G.players[player].units.filter(u => u.hp > 0 && (type === undefined || u.unitType === type));
}

function scMoveToward(player, unitId, tq, tr, claimed) {
  const u = G.players[player].units.find(x => x.id === unitId);
  if (!u || u.hp <= 0 || u.mp <= 0) return null;
  let best = null, bestD = hexDist(u.q, u.r, tq, tr);
  for (const [nq, nr] of allNeighbors(u.q, u.r)) {
    if (nq < 0 || nq >= 32 || nr < 0 || nr >= 20) continue;
    const tile = getTile(nq, nr);
    if (!tile || tile.terrain === 0 || tile.terrain === 1 || tile.terrain === 12) continue;
    if (G.players[player].units.some(u2 => u2.hp > 0 && u2.id !== unitId && u2.q === nq && u2.r === nr)) continue;
    if (G.players[1 - player].units.some(u2 => u2.hp > 0 && u2.q === nq && u2.r === nr)) continue;
    if (claimed && claimed.has(nq + ',' + nr)) continue;
    const d = hexDist(nq, nr, tq, tr);
    if (d < bestD) { bestD = d; best = [nq, nr]; }
  }
  return best ? {type: 'MoveUnit', unitId, destQ: best[0], destR: best[1]} : null;
}

function scEnsureResearch(player) {
  const p = G.players[player];
  if (p.cities.length > 0 && !p.currentResearch) {
    const t = scNextTech(player);
    if (t) return [{type: 'SetResearch', techId: t}];
  }
  return [];
}

function scEnsureProduction(player, defaultItem) {
  const actions = [];
  for (const c of G.players[player].cities) {
    if (c.production === 0) {
      actions.push({type: 'SetProduction', cityId: c.id, itemId: defaultItem || PROD.WARRIOR});
    }
  }
  return actions;
}

function scSkipActions(player) {
  return [...scEnsureResearch(player), ...scEnsureProduction(player, PROD.WARRIOR)];
}

function scScoutActions(player, claimed) {
  const actions = [];
  const enemy = 1 - player;
  const enemyCity = G.players[enemy].cities[0];
  const myCity = G.players[player].cities[0];
  const warriors = G.players[player].units.filter(u => u.hp > 0 && u.mp > 0 && u.unitType >= 3);
  for (const w of warriors) {
    // If close to home (<= 2 hexes), move outward toward the enemy side
    // If far from home (> 6 hexes), head back
    // Otherwise, keep exploring toward enemy
    const distHome = myCity ? hexDist(w.q, w.r, myCity.q, myCity.r) : 0;
    let target;
    if (distHome > 6 && myCity) {
      target = myCity;
    } else if (enemyCity) {
      target = enemyCity;
    } else {
      // No enemy city yet — move to center of map
      target = {q: 16, r: 10};
    }
    const mv = scMoveToward(player, w.id, target.q, target.r, claimed);
    if (mv) {
      actions.push(mv);
      if (claimed) claimed.add(mv.destQ + ',' + mv.destR);
    }
  }
  return actions;
}

function scIsOnCityTile(enemy, q, r) {
  return G.players[enemy].cities.some(c => c.hp > 0 && c.q === q && c.r === r);
}

function scMilitaryActions(player, claimed) {
  const actions = [];
  const enemy = 1 - player;
  const marchTarget = G.players[enemy].cities[0];
  if (!marchTarget) return actions;

  // Ranged units: soften cities (garrison is protected), or shoot units in the open
  const ranged = G.players[player].units.filter(u => u.hp > 0 && u.mp > 0 && (u.unitType === 4 || u.unitType === 5));
  for (const r of ranged) {
    const range = r.unitType === 5 ? 2 : 1;

    // Priority 1: shoot an enemy city in range (damages city, garrison protected)
    const cityTarget = G.players[enemy].cities.find(c =>
      c.hp > 0 && hexDist(r.q, r.r, c.q, c.r) <= range);
    if (cityTarget) {
      actions.push({type: 'RangedAttack', unitId: r.id, targetQ: cityTarget.q, targetR: cityTarget.r});
      continue;
    }
    // Priority 2: shoot any enemy unit NOT on a city tile
    const unitTarget = G.players[enemy].units.find(e =>
      e.hp > 0 && hexDist(r.q, r.r, e.q, e.r) <= range && !scIsOnCityTile(enemy, e.q, e.r));
    if (unitTarget) {
      actions.push({type: 'RangedAttack', unitId: r.id, targetQ: unitTarget.q, targetR: unitTarget.r});
      continue;
    }
    // No target — march toward enemy city
    const mv = scMoveToward(player, r.id, marchTarget.q, marchTarget.r, claimed);
    if (mv) { actions.push(mv); if (claimed) claimed.add(mv.destQ + ',' + mv.destR); }
  }

  // Melee units: siege cities or fight units in the open
  const melee = G.players[player].units.filter(u => u.hp > 0 && u.mp > 0 && u.unitType === 3);
  for (const w of melee) {
    // Priority 1: attack an adjacent enemy city (siege — garrison dies on capture)
    const adjCity = G.players[enemy].cities.find(c =>
      c.hp > 0 && hexDist(w.q, w.r, c.q, c.r) === 1);
    if (adjCity) {
      actions.push({type: 'AttackUnit', unitId: w.id, targetQ: adjCity.q, targetR: adjCity.r});
      continue;
    }
    // Priority 2: attack an adjacent enemy unit NOT on a city tile
    const adjEnemy = G.players[enemy].units.find(e =>
      e.hp > 0 && hexDist(w.q, w.r, e.q, e.r) === 1 && e.unitType >= 2
      && !scIsOnCityTile(enemy, e.q, e.r));
    if (adjEnemy) {
      actions.push({type: 'AttackUnit', unitId: w.id, targetQ: adjEnemy.q, targetR: adjEnemy.r});
      continue;
    }
    // No attack available — march toward enemy city
    const mv = scMoveToward(player, w.id, marchTarget.q, marchTarget.r, claimed);
    if (mv) { actions.push(mv); if (claimed) claimed.add(mv.destQ + ',' + mv.destR); }
  }
  return actions;
}

function scBuilderActions(player) {
  const actions = [];
  const builders = scAlive(player, 1);
  for (const b of builders) {
    if (b.mp <= 0 || b.charges <= 0) continue;
    const curTile = getTile(b.q, b.r);
    if (curTile && curTile.improvement === 0 && curTile.ownerPlayer === player && curTile.ownerCity > 0) {
      const imps = getValidImprovements(curTile, G.players[player].completedTechs);
      const ok = imps.filter(i => i.ok);
      if (ok.length > 0) {
        actions.push({type: 'BuildImprovement', builderId: b.id, q: b.q, r: b.r, improvement: ok[0].id});
        continue;
      }
    }
    // Move toward an improvable tile
    let bestTile = null, bestDist = Infinity;
    for (const t of G.tiles) {
      if (t.improvement !== 0 || t.ownerPlayer !== player || t.ownerCity <= 0) continue;
      if (t.terrain === 0 || t.terrain === 1 || t.terrain === 12) continue;
      if (t.q === b.q && t.r === b.r) continue;
      const imps = getValidImprovements(t, G.players[player].completedTechs);
      if (!imps.some(i => i.ok)) continue;
      const d = hexDist(b.q, b.r, t.q, t.r);
      if (d < bestDist) { bestDist = d; bestTile = t; }
    }
    if (bestTile) {
      const mv = scMoveToward(player, b.id, bestTile.q, bestTile.r);
      if (mv) actions.push(mv);
    }
  }
  return actions;
}

// ═══════════════════════════════════════════════════════════════
// Scenario Definitions
// ═══════════════════════════════════════════════════════════════

const SCENARIOS = [
  // ── 1. Quick Start ──
  {
    id: 'quick_start',
    name: 'Quick Start',
    desc: 'Both players found cities and develop for 10 turns — shows basics of city founding and production.',
    generate() {
      return (function*() {
        const sA = scAlive(0, 0)[0];
        if (sA) yield { player: 0, label: 'Player A founds capital "Alpha"', focus: sA,
          actions: [{type:'FoundCity', settlerId:sA.id, name:'Alpha'}, {type:'SetResearch', techId:1}, {type:'SetProduction', cityId:0, itemId:PROD.MONUMENT}] };
        const sB = scAlive(1, 0)[0];
        if (sB) yield { player: 1, label: 'Player B founds capital "Beta"', focus: sB,
          actions: [{type:'FoundCity', settlerId:sB.id, name:'Beta'}, {type:'SetResearch', techId:1}, {type:'SetProduction', cityId:0, itemId:PROD.MONUMENT}] };
        for (let i = 0; i < 10; i++) {
          if (G.status === 2) return;
          const clA = new Set(), clB = new Set();
          const focusA = G.players[0].units.find(u => u.hp > 0 && u.unitType >= 3);
          const focusB = G.players[1].units.find(u => u.hp > 0 && u.unitType >= 3);
          yield { player: 0, label: `Round ${i+2}: Player A scouting`, actions: [...scSkipActions(0), ...scScoutActions(0, clA)], focus: focusA };
          yield { player: 1, label: `Round ${i+2}: Player B scouting`, actions: [...scSkipActions(1), ...scScoutActions(1, clB)], focus: focusB };
        }
      })();
    },
  },

  // ── 2. Economy & Builders ──
  {
    id: 'economy',
    name: 'Economy & Builders',
    desc: 'Research techs, build buildings and builders, improve tiles — demonstrates the economy system.',
    generate() {
      return (function*() {
        const sA = scAlive(0, 0)[0];
        if (sA) yield { player: 0, label: 'Player A founds "Farmville"', focus: sA,
          actions: [{type:'FoundCity', settlerId:sA.id, name:'Farmville'}, {type:'SetResearch', techId:1}, {type:'SetProduction', cityId:0, itemId:PROD.BUILDER}] };
        const sB = scAlive(1, 0)[0];
        if (sB) yield { player: 1, label: 'Player B founds "Ironburg"', focus: sB,
          actions: [{type:'FoundCity', settlerId:sB.id, name:'Ironburg'}, {type:'SetResearch', techId:2}, {type:'SetProduction', cityId:0, itemId:PROD.MONUMENT}] };

        for (let i = 0; i < 30; i++) {
          if (G.status === 2) return;
          const actionsA = [...scEnsureResearch(0), ...scEnsureProduction(0, PROD.BUILDER), ...scBuilderActions(0)];
          const focusBuilder = scAlive(0, 1)[0];
          yield { player: 0, label: `Round ${i+2}: Player A building economy`, actions: actionsA,
            focus: focusBuilder || G.players[0].cities[0] };
          yield { player: 1, label: `Round ${i+2}: Player B developing`, actions: scSkipActions(1) };
        }
      })();
    },
  },

  // ── 3. Rush War ──
  {
    id: 'rush_war',
    name: 'Rush War',
    desc: 'Build warriors, declare war at turn 12, march and fight — shows combat animations.',
    generate() {
      return (function*() {
        const sA = scAlive(0, 0)[0];
        if (sA) yield { player: 0, label: 'Player A founds "Sparta"', focus: sA,
          actions: [{type:'FoundCity', settlerId:sA.id, name:'Sparta'}, {type:'SetResearch', techId:1}, {type:'SetProduction', cityId:0, itemId:PROD.WARRIOR}] };
        const sB = scAlive(1, 0)[0];
        if (sB) yield { player: 1, label: 'Player B founds "Troy"', focus: sB,
          actions: [{type:'FoundCity', settlerId:sB.id, name:'Troy'}, {type:'SetResearch', techId:1}, {type:'SetProduction', cityId:0, itemId:PROD.WARRIOR}] };

        for (let i = 0; i < 10; i++) {
          if (G.status === 2) return;
          const clA = new Set(), clB = new Set();
          const scoutA = scScoutActions(0, clA), scoutB = scScoutActions(1, clB);
          const focusA = G.players[0].units.find(u => u.hp > 0 && u.unitType >= 3);
          const focusB = G.players[1].units.find(u => u.hp > 0 && u.unitType >= 3);
          yield { player: 0, label: `Round ${i+2}: Sparta scouts & trains`, actions: [...scSkipActions(0), ...scoutA], focus: focusA };
          yield { player: 1, label: `Round ${i+2}: Troy scouts & trains`, actions: [...scSkipActions(1), ...scoutB], focus: focusB };
        }

        yield { player: 0, label: 'Sparta DECLARES WAR!',
          actions: [{type:'DeclareWar', target:1}, ...scSkipActions(0)] };
        yield { player: 1, label: 'Troy prepares for battle', actions: scSkipActions(1) };

        for (let i = 0; i < 40; i++) {
          if (G.status === 2) return;
          for (let pl = 0; pl <= 1; pl++) {
            if (G.status === 2) return;
            const claimed = new Set();
            const military = scMilitaryActions(pl, claimed);
            const actions = [...scSkipActions(pl), ...military];
            const focusUnit = G.players[pl].units.find(u => u.hp > 0 && u.unitType >= 3);
            const attacking = military.some(a => a.type==='AttackUnit' || a.type==='RangedAttack');
            yield { player: pl, label: `Round ${i+13}: ${pl===0?'Sparta':'Troy'} ${attacking?'attacks!':'advances'}`,
              actions, focus: focusUnit || G.players[pl].cities[0] };
          }
        }
      })();
    },
  },

  // ── 4. AI vs AI ──
  {
    id: 'auto_play',
    name: 'AI vs AI',
    desc: 'Strategic AI game: expand cities, research tech, build economy, raise diverse armies, and wage war.',
    generate() {
      return (function*() {
        const sA = scAlive(0, 0)[0];
        if (sA) yield { player: 0, label: 'Athens is founded', focus: sA,
          actions: [{type:'FoundCity', settlerId:sA.id, name:'Athens'}, {type:'SetResearch', techId:1}, {type:'SetProduction', cityId:0, itemId:PROD.MONUMENT}] };
        const sB = scAlive(1, 0)[0];
        if (sB) yield { player: 1, label: 'Rome is founded', focus: sB,
          actions: [{type:'FoundCity', settlerId:sB.id, name:'Rome'}, {type:'SetResearch', techId:2}, {type:'SetProduction', cityId:0, itemId:PROD.MONUMENT}] };

        let warDeclared = false;
        const names = ['Athens', 'Rome'];

        for (let round = 2; round <= 150; round++) {
          if (G.status === 2) return;
          for (let pl = 0; pl <= 1; pl++) {
            if (G.status === 2) return;
            const p = G.players[pl];
            const enemy = 1 - pl;
            const actions = [];
            const claimed = new Set();

            // ── Research: strategic tech ordering ──
            if (p.cities.length > 0 && !p.currentResearch) {
              const tid = scStrategicTech(pl);
              if (tid) actions.push({type: 'SetResearch', techId: tid});
            }

            // ── Production: phase-aware choices per city ──
            for (const c of p.cities) {
              if (c.production === 0) {
                const item = scChooseProduction(pl, c, round);
                actions.push({type: 'SetProduction', cityId: c.id, itemId: item});
              }
            }

            // ── Builder: improve tiles near cities ──
            actions.push(...scBuilderActions(pl));

            // ── Settler: move and found new cities ──
            actions.push(...scSettlerActions(pl, claimed));

            // ── Upgrade Slingers → Archers when Archery is researched ──
            if (scHasTech(pl, 4)) {
              for (const u of p.units.filter(u => u.hp > 0 && u.unitType === 4)) {
                actions.push({type: 'UpgradeUnit', unitId: u.id});
              }
            }

            // ── War declaration: when we have enough military advantage ──
            if (!warDeclared && pl === 0 && round >= 20) {
              const myArmy = p.units.filter(u => u.hp > 0 && u.unitType >= 3).length;
              if (myArmy >= 4) {
                actions.push({type: 'DeclareWar', target: 1});
                warDeclared = true;
              }
            }

            // ── Military: attack or scout ──
            if (warDeclared) {
              actions.push(...scMilitaryActions(pl, claimed));
            } else {
              actions.push(...scScoutActions(pl, claimed));
            }

            // ── Skip idle scouts ──
            for (const u of p.units.filter(u => u.hp > 0 && u.mp > 0 && u.unitType === 2)) {
              actions.push({type: 'SkipUnit', unitId: u.id});
            }

            // ── Build label ──
            const numCities = p.cities.length;
            const numMilitary = p.units.filter(u => u.hp > 0 && u.unitType >= 3).length;
            let phase = '';
            if (round <= 8) phase = 'building economy';
            else if (!warDeclared && numCities < 2) phase = 'expanding';
            else if (!warDeclared) phase = 'preparing for war';
            else phase = actions.some(a => a.type === 'AttackUnit' || a.type === 'RangedAttack') ? 'attacking!' : 'advancing';

            let label = `Turn ${round}: ${names[pl]} — ${phase}`;
            if (warDeclared && round === 20 && pl === 0) label = `Turn ${round}: ${names[pl]} DECLARES WAR!`;
            label += ` (${numCities} cities, ${numMilitary} units)`;

            // Focus camera on combat > settler > military > city
            const hasAttack = actions.find(a => a.type === 'AttackUnit' || a.type === 'RangedAttack');
            const settler = scAlive(pl, 0)[0];
            const focusMilitary = p.units.find(u => u.hp > 0 && u.unitType >= 3);
            const focus = hasAttack ? focusMilitary : (settler || focusMilitary || p.cities[0]);
            yield { player: pl, label, actions, focus };
          }
        }
      })();
    },
  },
];
