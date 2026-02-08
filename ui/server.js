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

// Action enum variant indices (must match Cairo enum order)
const ACTION = {
  MoveUnit:          0,
  AttackUnit:        1,
  RangedAttack:      2,
  FoundCity:         3,
  SetProduction:     4,
  SetResearch:       5,
  BuildImprovement:  6,
  RemoveImprovement: 7,
  FortifyUnit:       8,
  SkipUnit:          9,
  PurchaseWithGold: 10,
  UpgradeUnit:      11,
  DeclareWar:       12,
  EndTurn:          13,
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
    case 'FortifyUnit':       return [ACTION.FortifyUnit, a.unitId];
    case 'SkipUnit':          return [ACTION.SkipUnit, a.unitId];
    case 'DeclareWar':        return [ACTION.DeclareWar, a.target];
    case 'UpgradeUnit':       return [ACTION.UpgradeUnit, a.unitId];
    case 'EndTurn':           return [ACTION.EndTurn];
    default: throw new Error('Unknown action type: ' + a.type);
  }
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

// ---- Setup: deploy contract + create & join game ----
app.post('/api/setup', async (_req, res) => {
  try {
    provider = new RpcProvider({ nodeUrl: KATANA_URL, baseFetch: katanaFetch });

    // Detect predeployed accounts
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

    // Create accounts with V3 transaction version (required by Katana 1.7.x)
    accounts = [
      new Account(provider, acct0.address, pk0, '1', constants.TRANSACTION_VERSION.V3),
      new Account(provider, acct1.address, pk1, '1', constants.TRANSACTION_VERSION.V3),
    ];

    // Load artifacts
    const sierra = JSON.parse(fs.readFileSync(SIERRA, 'utf-8'));
    const casm   = JSON.parse(fs.readFileSync(CASM,   'utf-8'));
    sierraAbi    = sierra.abi;

    // Declare contract (skip fee estimation with explicit zero resource bounds)
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
      // If class is already declared (code 51), compute class hash and continue
      if (e.baseError?.code === 51) {
        console.log('  Class already declared, reusing...');
        const { hash } = require('starknet');
        classHash = hash.computeContractClassHash(sierra);
      } else {
        throw e;
      }
    }
    console.log('Class hash:', classHash);

    // Deploy contract
    console.log('Deploying contract...');
    const deployRes = await accounts[0].deployContract(
      { classHash, constructorCalldata: [] },
      { resourceBounds: RESOURCE_BOUNDS, skipValidate: true }
    );
    await provider.waitForTransaction(deployRes.transaction_hash);
    contractAddr = deployRes.contract_address;
    console.log('Contract deployed at:', contractAddr);

    // Build a read-only Contract for view calls
    contract = new Contract(sierraAbi, contractAddr, provider);

    // Create game (player A = account 0)
    console.log('Creating game...');
    const createTx = await accounts[0].execute(
      { contractAddress: contractAddr, entrypoint: 'create_game', calldata: ['2'] },
      { resourceBounds: RESOURCE_BOUNDS }
    );
    await provider.waitForTransaction(createTx.transaction_hash);

    // Read game ID (first game created is ID 1)
    gameId = 1;

    // Join game (player B = account 1)
    console.log('Joining game...');
    const joinTx = await accounts[1].execute(
      { contractAddress: contractAddr, entrypoint: 'join_game', calldata: [String(gameId)] },
      { resourceBounds: RESOURCE_BOUNDS }
    );
    await provider.waitForTransaction(joinTx.transaction_hash);
    console.log('Game started! ID:', gameId);

    res.json({
      contractAddress: contractAddr,
      gameId,
      players: [acct0.address, acct1.address],
    });
  } catch (e) {
    console.error('Setup error:', e.baseError || e.message || e);
    const msg = e.baseError
      ? JSON.stringify(e.baseError)
      : (e.message || String(e));
    res.status(500).json({ error: msg });
  }
});

// ---- Full game state ----
app.get('/api/state', async (_req, res) => {
  if (!contract || !gameId) return res.status(400).json({ error: 'Game not set up yet' });
  try {
    const gid = gameId;
    const readContract = new Contract(sierraAbi, contractAddr, provider);

    // Game metadata
    const [status, turn, currentPlayer] = await Promise.all([
      readContract.call('get_game_status',   [gid]),
      readContract.call('get_current_turn',  [gid]),
      readContract.call('get_current_player',[gid]),
    ]);

    // Fetch map tiles (32x20 = 640) in batches of 64
    const tiles = [];
    for (let batch = 0; batch < 10; batch++) {
      const promises = [];
      for (let i = 0; i < 64; i++) {
        const idx = batch * 64 + i;
        if (idx >= 640) break;
        const q = idx % 32, r = Math.floor(idx / 32);
        promises.push(
          readContract.call('get_tile', [gid, q, r])
            .then(t => ({ q, r, terrain: n(t.terrain), feature: n(t.feature), resource: n(t.resource), riverEdges: n(t.river_edges) }))
            .catch(() => ({ q, r, terrain: 0, feature: 0, resource: 0, riverEdges: 0 }))
        );
      }
      tiles.push(...(await Promise.all(promises)));
    }

    // Fetch player data
    const players = [];
    for (let p = 0; p < 2; p++) {
      const [unitCount, cityCount, treasury, techs, research, diplo] = await Promise.all([
        readContract.call('get_unit_count',     [gid, p]),
        readContract.call('get_city_count',     [gid, p]),
        readContract.call('get_treasury',       [gid, p]),
        readContract.call('get_completed_techs',[gid, p]),
        readContract.call('get_current_research',[gid, p]),
        readContract.call('get_diplomacy_status',[gid, 0, 1]),
      ]);

      // Fetch units
      const uc = n(unitCount);
      const units = [];
      for (let u = 0; u < uc; u++) {
        const unit = await readContract.call('get_unit', [gid, p, u]);
        units.push({
          id: u, unitType: n(unit.unit_type), q: n(unit.q), r: n(unit.r),
          hp: n(unit.hp), mp: n(unit.movement_remaining),
          charges: n(unit.charges), fortify: n(unit.fortify_turns),
        });
      }

      // Fetch cities
      const cc = n(cityCount);
      const cities = [];
      for (let c = 0; c < cc; c++) {
        const city = await readContract.call('get_city', [gid, p, c]);
        cities.push({
          id: c, name: shortString.decodeShortString(city.name?.toString() || '0'),
          q: n(city.q), r: n(city.r), population: n(city.population), hp: n(city.hp),
          production: n(city.current_production), buildings: n(city.buildings),
          isCapital: !!city.is_capital,
          foodStockpile: n(city.food_stockpile),
          prodStockpile: n(city.production_stockpile),
          foundedTurn: n(city.founded_turn),
        });
      }

      players.push({
        units, cities, treasury: n(treasury),
        completedTechs: techs?.toString() || '0',
        currentResearch: n(research),
        diplomacy: n(diplo),
      });
    }

    res.json({
      status: n(status), turn: n(turn), currentPlayer: n(currentPlayer),
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
  const { player, actions } = req.body;  // player: 0 or 1, actions: array of action objects
  if (player !== 0 && player !== 1) return res.status(400).json({ error: 'Invalid player' });
  if (!Array.isArray(actions) || actions.length === 0) return res.status(400).json({ error: 'No actions' });

  try {
    // Build raw calldata: game_id, array_len, ...action_felts
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
    const msg = e.baseError
      ? JSON.stringify(e.baseError)
      : (e.message || String(e));
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
    const msg = e.baseError
      ? JSON.stringify(e.baseError)
      : (e.message || String(e));
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
app.listen(PORT, () => {
  console.log(`\n  Cairo Civ UI server running at http://localhost:${PORT}`);
  console.log(`  Expecting Katana at ${KATANA_URL}\n`);
  console.log('  Steps:');
  console.log('    1. Make sure Katana is running:');
  console.log('       katana --dev --dev.no-fee --dev.no-account-validation');
  console.log('    2. Open browser to http://localhost:' + PORT);
  console.log('    3. Click "Deploy & Start Game"\n');
});
