// Cairo Civ — Express server that deploys the contract on Katana and
// exposes a JSON API consumed by the browser UI.

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { RpcProvider, Account, Contract, shortString, CallData, constants } = require('starknet');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const KATANA_URL = process.env.KATANA_URL || 'http://localhost:5050';
const PORT       = process.env.PORT || 3000;
const HOST       = process.env.HOST || 'localhost';
const ARTIFACTS  = path.join(__dirname, '..', 'target', 'dev');
const SIERRA     = path.join(ARTIFACTS, 'cairo_civ_CairoCiv.contract_class.json');
const CASM       = path.join(ARTIFACTS, 'cairo_civ_CairoCiv.compiled_contract_class.json');

// ---------------------------------------------------------------------------
// Katana 1.7.x compatibility
// ---------------------------------------------------------------------------
// Katana 1.7.x uses StarkNet RPC spec 0.9.0 which:
//   1. Does NOT support the "pending" block tag (only "latest")
//   2. Only accepts V3 transactions (with resource_bounds, tip, etc.)
//   3. Needs --dev flag for dev_predeployedAccounts RPC
//   4. Needs --dev.no-fee to skip fee requirements
//   5. Needs --dev.no-account-validation to skip signature checks
//
// We handle (1) by intercepting fetch to rewrite "pending" → "latest".
// We handle (2) by creating accounts with V3 and passing zero resource bounds.
// We handle (3-5) by documenting the correct startup command.

/** Custom fetch that rewrites "pending" block tag to "latest" for Katana. */
const katanaFetch = async (url, options) => {
  if (options?.body) {
    const body = typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body);
    options = { ...options, body: body.replace(/"pending"/g, '"latest"') };
  }
  return fetch(url, options);
};

/** Zero resource bounds — Katana with --dev.no-fee accepts these. */
const RESOURCE_BOUNDS = {
  l1_gas:      { max_amount: '0x0', max_price_per_unit: '0x0' },
  l2_gas:      { max_amount: '0x0', max_price_per_unit: '0x0' },
  l1_data_gas: { max_amount: '0x0', max_price_per_unit: '0x0' },
};

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
let provider      = null;
let accounts      = [];   // [Account, Account]
let contract      = null; // Contract bound to provider (for reads)
let contractAddr  = null;
let sierraAbi     = null;
let gameId        = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const n = v => (typeof v === 'bigint' ? Number(v) : Number(v || 0));

// Action enum variant indices (must match Cairo enum order in types.cairo)
const ACTION = {
  MoveUnit:          0,
  AttackUnit:        1,
  RangedAttack:      2,
  FoundCity:         3,
  SetProduction:     4,
  SetResearch:       5,
  BuildImprovement:  6,
  RemoveImprovement: 7,
  RemoveFeature:     8,
  FortifyUnit:       9,
  SkipUnit:         10,
  PurchaseWithGold: 11,
  UpgradeUnit:      12,
  DeclareWar:       13,
  AssignCitizen:    14,
  UnassignCitizen:  15,
  EndTurn:          16,
};

/** Encode a single UI action object into raw calldata felts. */
function encodeAction(a) {
  switch (a.type) {
    case 'MoveUnit':          return [ACTION.MoveUnit, a.unitId, a.destQ, a.destR];
    case 'AttackUnit':        return [ACTION.AttackUnit, a.unitId, a.targetQ, a.targetR];
    case 'RangedAttack':      return [ACTION.RangedAttack, a.unitId, a.targetQ, a.targetR];
    case 'FoundCity':         return [ACTION.FoundCity, a.settlerId, shortString.encodeShortString(a.name || 'City')];
    case 'SetProduction':     return [ACTION.SetProduction, a.cityId, a.itemId];
    case 'SetResearch':       return [ACTION.SetResearch, a.techId];
    case 'BuildImprovement':  return [ACTION.BuildImprovement, a.builderId, a.q, a.r, a.improvement];
    case 'RemoveImprovement': return [ACTION.RemoveImprovement, a.builderId, a.q, a.r];
    case 'RemoveFeature':     return [ACTION.RemoveFeature, a.builderId, a.q, a.r];
    case 'FortifyUnit':       return [ACTION.FortifyUnit, a.unitId];
    case 'SkipUnit':          return [ACTION.SkipUnit, a.unitId];
    case 'DeclareWar':        return [ACTION.DeclareWar, a.target];
    case 'UpgradeUnit':       return [ACTION.UpgradeUnit, a.unitId];
    case 'AssignCitizen':     return [ACTION.AssignCitizen, a.cityId, a.q, a.r];
    case 'UnassignCitizen':   return [ACTION.UnassignCitizen, a.cityId, a.q, a.r];
    case 'EndTurn':           return [ACTION.EndTurn];
    default: throw new Error('Unknown action type: ' + a.type);
  }
}

/**
 * Extract a human-readable error message from a starknet.js exception.
 * Cairo panics encode the reason as felt252 short-strings inside the error.
 */
function extractRevertReason(e) {
  // Try to find felt252 panic data in various error structures
  const raw = e.baseError || e;
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);

  // Pattern 1: Look for hex-encoded short strings (0x followed by hex digits)
  // Cairo panic data appears as hex felts that decode to ASCII
  const hexMatches = str.match(/0x[0-9a-fA-F]{2,62}/g);
  if (hexMatches) {
    const decoded = [];
    for (const h of hexMatches) {
      try {
        const s = shortString.decodeShortString(h);
        // Filter out garbage — only keep printable ASCII strings
        if (s && s.length > 1 && /^[\x20-\x7E]+$/.test(s)) {
          decoded.push(s);
        }
      } catch (_) {}
    }
    if (decoded.length > 0) {
      // Return the longest decoded string (most likely the panic message)
      decoded.sort((a, b) => b.length - a.length);
      return decoded[0];
    }
  }

  // Pattern 2: Look for plain-text error in known fields
  if (e.message && typeof e.message === 'string') {
    // Execution reverted messages sometimes contain the reason in quotes
    const quoted = e.message.match(/'([^']+)'/);
    if (quoted) return quoted[1];
    // Truncate long messages
    if (e.message.length > 200) return e.message.slice(0, 200) + '...';
    return e.message;
  }

  // Fallback
  return str.length > 200 ? str.slice(0, 200) + '...' : str;
}

/** Verify Katana is reachable. */
async function checkKatanaAlive() {
  try {
    const res = await fetch(KATANA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'starknet_chainId', params: [], id: 1 }),
    });
    const json = await res.json();
    return !!(json.result);
  } catch (_) {
    return false;
  }
}

/** Fetch predeployed accounts from Katana. */
async function fetchKatanaAccounts() {
  const alive = await checkKatanaAlive();
  if (!alive) {
    console.error('ERROR: Cannot reach Katana at', KATANA_URL);
    console.error('Make sure Katana is running:');
    console.error('  katana --dev --dev.no-fee --dev.no-account-validation');
    return null;
  }
  console.log('Katana is reachable at', KATANA_URL);

  // Try the dev RPC method (requires --dev flag)
  const methods = [
    'dev_predeployedAccounts',
    'katana_predeployedAccounts',
  ];
  for (const method of methods) {
    try {
      console.log('  Trying RPC method:', method);
      const res = await fetch(KATANA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params: [], id: 1 }),
      });
      const json = await res.json();
      if (json.error) {
        console.log('    -> error:', json.error.message || JSON.stringify(json.error));
        continue;
      }
      if (json.result && json.result.length >= 2) {
        console.log('    -> found', json.result.length, 'accounts');
        return json.result;
      }
    } catch (e) {
      console.log('    -> exception:', e.message);
    }
  }

  // If RPC detection fails, check for env vars
  if (process.env.ACCOUNT0_ADDRESS && process.env.ACCOUNT0_PRIVKEY &&
      process.env.ACCOUNT1_ADDRESS && process.env.ACCOUNT1_PRIVKEY) {
    console.log('Using accounts from environment variables.');
    return [
      { address: process.env.ACCOUNT0_ADDRESS, privateKey: process.env.ACCOUNT0_PRIVKEY },
      { address: process.env.ACCOUNT1_ADDRESS, privateKey: process.env.ACCOUNT1_PRIVKEY },
    ];
  }

  // Fallback: hardcoded Katana 1.7.x default accounts (seed 0)
  console.log('');
  console.log('WARNING: Could not detect accounts via RPC.');
  console.log('This usually means Katana was started without the --dev flag.');
  console.log('Please restart Katana with:');
  console.log('  katana --dev --dev.no-fee --dev.no-account-validation');
  console.log('');
  console.log('Falling back to hardcoded Katana default accounts (seed 0)...');
  return [
    {
      address:    '0x127fd5f1fe78a71f8bcd1fec63e3fe2f0486b6ecd5c86a0466c3a21fa5cfcec',
      privateKey: '0xc5b2fcab997346f3ea1c00b002ecf6f382c5f9c9659a3894eb783c5320f912',
    },
    {
      address:    '0x13d9ee239f33fea4f8785b9e3870ade909e20a9599ae7cd62c1c292b73af1b7',
      privateKey: '0x1c9053c053edf324aec366a34c6901b1095b07af69495bffec7d7fe21effb1b',
    },
  ];
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(__dirname));                       // serves index.html
app.use('/artifacts', express.static(ARTIFACTS));          // serves contract json

// ---- Deploy: connect to Katana, declare & deploy contract ----
app.post('/api/deploy', async (_req, res) => {
  try {
    provider = new RpcProvider({ nodeUrl: KATANA_URL, baseFetch: katanaFetch });

    const predeployed = await fetchKatanaAccounts();
    if (!predeployed || predeployed.length < 2) {
      return res.status(500).json({
        error: 'Cannot detect Katana predeployed accounts. '
             + 'Start Katana with: katana --dev --dev.no-fee --dev.no-account-validation'
      });
    }
    const acct0 = predeployed[0];
    const acct1 = predeployed[1];
    const pk0 = acct0.private_key || acct0.privateKey;
    const pk1 = acct1.private_key || acct1.privateKey;

    accounts = [
      new Account(provider, acct0.address, pk0, '1', constants.TRANSACTION_VERSION.V3),
      new Account(provider, acct1.address, pk1, '1', constants.TRANSACTION_VERSION.V3),
    ];

    const sierra = JSON.parse(fs.readFileSync(SIERRA, 'utf-8'));
    const casm   = JSON.parse(fs.readFileSync(CASM,   'utf-8'));
    sierraAbi    = sierra.abi;

    console.log('Declaring contract...');
    let classHash;
    try {
      const declareRes = await accounts[0].declare(
        { contract: sierra, casm },
        { resourceBounds: RESOURCE_BOUNDS, skipValidate: true }
      );
      await provider.waitForTransaction(declareRes.transaction_hash);
      classHash = declareRes.class_hash;
    } catch (e) {
      if (e.baseError?.code === 51) {
        console.log('  Class already declared, reusing...');
        const { hash } = require('starknet');
        classHash = hash.computeContractClassHash(sierra);
      } else {
        throw e;
      }
    }
    console.log('Class hash:', classHash);

    console.log('Deploying contract...');
    const deployRes = await accounts[0].deployContract(
      { classHash, constructorCalldata: [] },
      { resourceBounds: RESOURCE_BOUNDS, skipValidate: true }
    );
    await provider.waitForTransaction(deployRes.transaction_hash);
    contractAddr = deployRes.contract_address;
    console.log('Contract deployed at:', contractAddr);

    contract = new Contract(sierraAbi, contractAddr, provider);

    res.json({
      contractAddress: contractAddr,
      accounts: [acct0.address, acct1.address],
    });
  } catch (e) {
    console.error('Deploy error:', e.baseError || e.message || e);
    const msg = e.baseError ? JSON.stringify(e.baseError) : (e.message || String(e));
    res.status(500).json({ error: msg });
  }
});

// ---- Create game: player A creates a new game lobby ----
app.post('/api/create-game', async (req, res) => {
  if (!contract) return res.status(400).json({ error: 'Contract not deployed yet' });
  const { numPlayers } = req.body;
  const np = numPlayers || 2;
  try {
    console.log(`Creating ${np}-player game...`);
    const createTx = await accounts[0].execute(
      { contractAddress: contractAddr, entrypoint: 'create_game', calldata: [String(np)] },
      { resourceBounds: RESOURCE_BOUNDS }
    );
    await provider.waitForTransaction(createTx.transaction_hash);
    gameId = (gameId || 0) + 1;
    console.log('Game created! ID:', gameId);
    res.json({ gameId, creator: accounts[0].address });
  } catch (e) {
    console.error('Create game error:', e.baseError || e.message || e);
    res.status(500).json({ error: extractRevertReason(e) });
  }
});

// ---- Join game: player B joins an existing game ----
app.post('/api/join-game', async (req, res) => {
  if (!contract) return res.status(400).json({ error: 'Contract not deployed yet' });
  const { player } = req.body;
  const pid = (player === 0 || player === 1) ? player : 1;
  const gid = req.body.gameId || gameId;
  if (!gid) return res.status(400).json({ error: 'No game ID' });
  try {
    console.log(`Player ${pid} joining game ${gid}...`);
    const joinTx = await accounts[pid].execute(
      { contractAddress: contractAddr, entrypoint: 'join_game', calldata: [String(gid)] },
      { resourceBounds: RESOURCE_BOUNDS }
    );
    await provider.waitForTransaction(joinTx.transaction_hash);
    gameId = gid;
    console.log(`Player ${pid} joined game ${gid}!`);
    res.json({ ok: true, gameId: gid });
  } catch (e) {
    console.error('Join game error:', e.baseError || e.message || e);
    res.status(500).json({ error: extractRevertReason(e) });
  }
});

// ---- Game status: check if game is in lobby, active, or finished ----
app.get('/api/game-status', async (_req, res) => {
  if (!contract || !gameId) return res.json({ status: 'no_game' });
  try {
    const rc = new Contract(sierraAbi, contractAddr, provider);
    const status = await rc.call('get_game_status', [gameId]);
    res.json({ gameId, status: n(status) });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ---- Lobby status: tells new browsers what state the server is in ----
app.get('/api/lobby-status', async (_req, res) => {
  if (!contract || !contractAddr) return res.json({ phase: 'none' });
  if (!gameId) return res.json({ phase: 'deployed', contractAddress: contractAddr });
  try {
    const rc = new Contract(sierraAbi, contractAddr, provider);
    const status = n(await rc.call('get_game_status', [gameId]));
    if (status === 0) {
      return res.json({ phase: 'waiting_for_join', gameId, contractAddress: contractAddr });
    }
    if (status === 1) {
      return res.json({ phase: 'active', gameId, contractAddress: contractAddr });
    }
    return res.json({ phase: 'finished', gameId, contractAddress: contractAddr });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ---- Legacy setup: deploy + create + join in one step (for scenario replays) ----
app.post('/api/setup', async (_req, res) => {
  try {
    provider = new RpcProvider({ nodeUrl: KATANA_URL, baseFetch: katanaFetch });
    const predeployed = await fetchKatanaAccounts();
    if (!predeployed || predeployed.length < 2) {
      return res.status(500).json({ error: 'Cannot detect Katana accounts' });
    }
    const pk0 = predeployed[0].private_key || predeployed[0].privateKey;
    const pk1 = predeployed[1].private_key || predeployed[1].privateKey;
    accounts = [
      new Account(provider, predeployed[0].address, pk0, '1', constants.TRANSACTION_VERSION.V3),
      new Account(provider, predeployed[1].address, pk1, '1', constants.TRANSACTION_VERSION.V3),
    ];
    const sierra = JSON.parse(fs.readFileSync(SIERRA, 'utf-8'));
    const casm   = JSON.parse(fs.readFileSync(CASM,   'utf-8'));
    sierraAbi    = sierra.abi;
    let classHash;
    try {
      const declareRes = await accounts[0].declare({ contract: sierra, casm }, { resourceBounds: RESOURCE_BOUNDS, skipValidate: true });
      await provider.waitForTransaction(declareRes.transaction_hash);
      classHash = declareRes.class_hash;
    } catch (e) {
      if (e.baseError?.code === 51) { const { hash } = require('starknet'); classHash = hash.computeContractClassHash(sierra); }
      else throw e;
    }
    const deployRes = await accounts[0].deployContract({ classHash, constructorCalldata: [] }, { resourceBounds: RESOURCE_BOUNDS, skipValidate: true });
    await provider.waitForTransaction(deployRes.transaction_hash);
    contractAddr = deployRes.contract_address;
    contract = new Contract(sierraAbi, contractAddr, provider);
    const createTx = await accounts[0].execute({ contractAddress: contractAddr, entrypoint: 'create_game', calldata: ['2'] }, { resourceBounds: RESOURCE_BOUNDS });
    await provider.waitForTransaction(createTx.transaction_hash);
    gameId = 1;
    const joinTx = await accounts[1].execute({ contractAddress: contractAddr, entrypoint: 'join_game', calldata: [String(gameId)] }, { resourceBounds: RESOURCE_BOUNDS });
    await provider.waitForTransaction(joinTx.transaction_hash);
    res.json({ contractAddress: contractAddr, gameId, players: [predeployed[0].address, predeployed[1].address] });
  } catch (e) {
    console.error('Setup error:', e.baseError || e.message || e);
    res.status(500).json({ error: e.baseError ? JSON.stringify(e.baseError) : (e.message || String(e)) });
  }
});

// ---- Full game state (FAST — uses batch view functions, ~5 RPC calls total) ----
app.get('/api/state', async (_req, res) => {
  if (!contract || !gameId) return res.status(400).json({ error: 'Game not set up yet' });
  try {
    const gid = gameId;
    const rc = new Contract(sierraAbi, contractAddr, provider);
    const t0 = Date.now();

    // ── 1. Fire ALL batch calls in parallel ──
    const [status, turn, currentPlayer, winner, victoryType, p0score, p1score, mapBatch, p0summary, p1summary, p0units, p1units, p0cities, p1cities] = await Promise.all([
      rc.call('get_game_status',   [gid]),
      rc.call('get_current_turn',  [gid]),
      rc.call('get_current_player',[gid]),
      rc.call('get_winner',        [gid]),
      rc.call('get_victory_type',  [gid]),
      rc.call('get_score',         [gid, 0]),
      rc.call('get_score',         [gid, 1]),
      rc.call('get_map_batch',     [gid]),
      rc.call('get_player_summary',[gid, 0]),
      rc.call('get_player_summary',[gid, 1]),
      rc.call('get_all_units',     [gid, 0]),
      rc.call('get_all_units',     [gid, 1]),
      rc.call('get_all_cities',    [gid, 0]),
      rc.call('get_all_cities',    [gid, 1]),
    ]);

    // ── 2. Decode map batch (640 packed felt252 values) ──
    const mapArr = Array.isArray(mapBatch) ? mapBatch : (mapBatch || []);
    const tiles = [];
    for (let idx = 0; idx < 640; idx++) {
      const q = idx % 32, r = Math.floor(idx / 32);
      const raw = mapArr[idx];
      if (!raw) {
        tiles.push({ q, r, terrain: 0, feature: 0, resource: 0, riverEdges: 0, improvement: 0, ownerPlayer: 0, ownerCity: 0 });
        continue;
      }
      const v = BigInt(raw.toString());
      tiles.push({
        q, r,
        terrain:     Number(v & 0xFFn),
        feature:     Number((v >> 8n)  & 0xFFn),
        resource:    Number((v >> 16n) & 0xFFn),
        riverEdges:  Number((v >> 24n) & 0xFFn),
        improvement: Number((v >> 32n) & 0xFFn),
        ownerPlayer: Number((v >> 40n) & 0xFFn),
        ownerCity:   Number((v >> 48n) & 0xFFFFFFFFn),
      });
    }

    // ── 3. Decode player data ──
    const players = [];
    const summaries = [p0summary, p1summary];
    const unitBatches = [p0units, p1units];
    const cityBatches = [p0cities, p1cities];

    for (let p = 0; p < 2; p++) {
      // Decode player summary: [uc, cc, treasury, techs, research, accSci, diplo, submitted]
      const sm = Array.isArray(summaries[p]) ? summaries[p] : [];
      const uc       = n(sm[0]);
      const cc       = n(sm[1]);
      const treasury = n(sm[2]);
      const techs    = sm[3]?.toString() || '0';
      const curResearch = n(sm[4]);
      const accSci   = n(sm[5]);
      const diplo    = n(sm[6]);
      const submitted = n(sm[7]) !== 0;

      // Decode units
      const uArr = Array.isArray(unitBatches[p]) ? unitBatches[p] : [];
      const units = [];
      for (let i = 0; i < uArr.length; i++) {
        const v = BigInt(uArr[i].toString());
        units.push({
          id: i,
          unitType: Number(v & 0xFFn),
          q:        Number((v >> 8n)  & 0xFFn),
          r:        Number((v >> 16n) & 0xFFn),
          hp:       Number((v >> 24n) & 0xFFn),
          mp:       Number((v >> 32n) & 0xFFn),
          charges:  Number((v >> 40n) & 0xFFn),
          fortify:  Number((v >> 48n) & 0xFFn),
        });
      }

      // Decode cities (3 words per city: name, packed_fields, locked_tiles)
      const cArr = Array.isArray(cityBatches[p]) ? cityBatches[p] : [];
      const cities = [];
      for (let ci = 0; ci * 3 + 2 < cArr.length + 1 && ci * 3 < cArr.length; ci++) {
        const nameRaw = cArr[ci * 3];
        const fieldsRaw = cArr[ci * 3 + 1];
        const lockedRaw = cArr[ci * 3 + 2];

        const name = shortString.decodeShortString(nameRaw?.toString() || '0');
        const f = BigInt((fieldsRaw || 0).toString());

        const population = Number((f >> 16n) & 0xFFn);
        const buildings = Number((f >> 72n) & 0xFFFFFFFFn);
        const isCapital = Number((f >> 128n) & 0xFFn) !== 0;

        // Decode locked tiles from packed word
        const lv = BigInt((lockedRaw || 0).toString());
        const lockedCount = Number(lv & 0xFFn);
        const lockedTiles = [];
        for (let s = 0; s < lockedCount && s < 6; s++) {
          const shift = BigInt(8 + s * 16);
          const lq = Number((lv >> shift) & 0xFFn);
          const lr = Number((lv >> (shift + 8n)) & 0xFFn);
          lockedTiles.push({ q: lq, r: lr });
        }

        cities.push({
          id: ci, name,
          q:          Number(f & 0xFFn),
          r:          Number((f >> 8n)  & 0xFFn),
          population,
          hp:         Number((f >> 24n) & 0xFFn),
          foodStockpile:  Number((f >> 32n) & 0xFFFFn),
          prodStockpile:  Number((f >> 48n) & 0xFFFFn),
          production: Number((f >> 64n) & 0xFFn),
          buildings,
          foundedTurn: Number((f >> 104n) & 0xFFFFn),
          isCapital,
          lockedTiles,
        });
      }

      // Compute half-science per turn
      let halfSciPerTurn = 0;
      for (const c of cities) {
        halfSciPerTurn += c.population * 1;
        if (c.isCapital) halfSciPerTurn += 4;
        if (c.buildings & (1 << 3)) halfSciPerTurn += 2;
      }

      players.push({
        units, cities, treasury,
        completedTechs: techs,
        currentResearch: curResearch,
        accumulatedHalfScience: accSci,
        halfSciencePerTurn: halfSciPerTurn,
        diplomacy: diplo,
        submitted,
      });
    }

    console.log(`State fetched in ${Date.now() - t0}ms (batch mode)`);
    res.json({
      status: n(status), turn: n(turn), currentPlayer: n(currentPlayer),
      winner: n(winner), victoryType: n(victoryType),
      scores: [n(p0score), n(p1score)],
      tiles, players, gameId: gid,
    });
  } catch (e) {
    console.error('State error:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ---- Submit turn ----
app.post('/api/turn', async (req, res) => {
  if (!contract || !gameId) return res.status(400).json({ error: 'Game not set up yet' });
  const { player, actions: rawActions } = req.body;
  if (player !== 0 && player !== 1) return res.status(400).json({ error: 'Invalid player' });
  const actions = Array.isArray(rawActions) ? rawActions : [];

  try {
    const actionFelts = [];
    for (const a of actions) {
      actionFelts.push(...encodeAction(a).map(String));
    }
    const calldata = [String(gameId), String(actions.length), ...actionFelts];

    const tx = await accounts[player].execute(
      { contractAddress: contractAddr, entrypoint: 'submit_turn', calldata },
      { resourceBounds: RESOURCE_BOUNDS }
    );
    await provider.waitForTransaction(tx.transaction_hash);

    res.json({ ok: true, txHash: tx.transaction_hash });
  } catch (e) {
    console.error('Turn error:', e.baseError || e.message || e);
    const msg = extractRevertReason(e);
    res.status(500).json({ error: msg });
  }
});

// ---- Submit actions mid-turn (no end-of-turn) ----
app.post('/api/actions', async (req, res) => {
  if (!contract || !gameId) return res.status(400).json({ error: 'Game not set up yet' });
  const { player, actions } = req.body;
  if (player !== 0 && player !== 1) return res.status(400).json({ error: 'Invalid player' });
  if (!Array.isArray(actions) || actions.length === 0) return res.status(400).json({ error: 'No actions' });

  try {
    const actionFelts = [];
    for (const a of actions) {
      actionFelts.push(...encodeAction(a).map(String));
    }
    const calldata = [String(gameId), String(actions.length), ...actionFelts];

    const tx = await accounts[player].execute(
      { contractAddress: contractAddr, entrypoint: 'submit_actions', calldata },
      { resourceBounds: RESOURCE_BOUNDS }
    );
    await provider.waitForTransaction(tx.transaction_hash);

    res.json({ ok: true, txHash: tx.transaction_hash });
  } catch (e) {
    console.error('Actions error:', e.baseError || e.message || e);
    const msg = extractRevertReason(e);
    res.status(500).json({ error: msg });
  }
});

// ---- Forfeit ----
app.post('/api/forfeit', async (req, res) => {
  const { player } = req.body;
  try {
    const tx = await accounts[player].execute(
      { contractAddress: contractAddr, entrypoint: 'forfeit', calldata: [String(gameId)] },
      { resourceBounds: RESOURCE_BOUNDS }
    );
    await provider.waitForTransaction(tx.transaction_hash);
    res.json({ ok: true });
  } catch (e) {
    const msg = e.baseError
      ? JSON.stringify(e.baseError)
      : (e.message || String(e));
    res.status(500).json({ error: msg });
  }
});

// ---- Start server ----
app.listen(PORT, HOST, () => {
  console.log(`\n  Cairo Civ UI server running at http://${HOST}:${PORT}`);
  console.log(`  Expecting Katana at ${KATANA_URL}\n`);
  console.log('  Steps:');
  console.log('    1. Make sure Katana is running:');
  console.log('       katana --dev --dev.no-fee --dev.no-account-validation');
  console.log('    2. Open browser to http://localhost:' + PORT);
  console.log('    3. Click "Deploy & Start Game"\n');
});
