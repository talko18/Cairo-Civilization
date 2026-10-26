// Live-chain tests: start Katana and the real server, and check that the API
// reports what actually happened on-chain.
//
// Not part of `npm test`, because it needs a Katana binary and takes ~40s.
// Run it with `npm run test:chain`.
//
// The bug this exists for: starknet.js resolves waitForTransaction as soon as a
// transaction reaches a success state, and it matches finality before execution
// status. A REVERTED transaction on Katana is still ACCEPTED_ON_L2, so the
// promise resolved normally and every endpoint replied {ok:true}. A reverted
// turn — a calldata failure, 'Already submitted', 'City has no production' —
// looked to the player exactly like a successful submission.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const KATANA_PORT = 5055, SERVER_PORT = 3055;
const BASE = `http://localhost:${SERVER_PORT}`;
const UI_DIR = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch (_) {}
    await sleep(500);
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what}`);
}

const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let katana, server;
try {
  katana = spawn('katana', ['--dev', '--dev.no-fee', '--dev.no-account-validation',
    '--http.port', String(KATANA_PORT)], { stdio: 'ignore' });
  await waitFor(async () => {
    const r = await fetch(`http://localhost:${KATANA_PORT}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'starknet_chainId', params: [], id: 1 }),
    });
    return r.ok;
  }, 60000, 'katana');

  server = spawn('node', ['server.js'], {
    cwd: UI_DIR,
    env: { ...process.env, PORT: String(SERVER_PORT), KATANA_URL: `http://localhost:${KATANA_PORT}` },
    stdio: 'ignore',
  });
  await waitFor(async () => (await fetch(BASE + '/api/game-status')).status < 500, 60000, 'server');

  const setup = await post('/api/setup', { numPlayers: 2 });
  check('setup succeeds', setup.status === 200, JSON.stringify(setup.body));

  // A turn that really does go through still reports success — the fix must not
  // start calling good transactions failures.
  const good = await post('/api/turn', { player: 0, actions: [] });
  check('a turn that succeeds still reports ok', good.status === 200 && good.body.ok === true,
    `status ${good.status} ${JSON.stringify(good.body)}`);

  // Submitting again reverts on-chain with 'Already submitted'. Before the fix
  // this returned 200 {ok:true} and the player was never told.
  const dup = await post('/api/turn', { player: 0, actions: [] });
  check('a REVERTED turn is reported as a failure, not ok',
    dup.status >= 400 && !dup.body.ok,
    `status ${dup.status} ${JSON.stringify(dup.body)}`);
  check('the revert reason reaches the client',
    typeof dup.body.error === 'string' && dup.body.error.length > 0,
    JSON.stringify(dup.body));
  console.log(`       reason shown to the player: ${JSON.stringify(dup.body.error)}`);
} catch (e) {
  fail++;
  console.log(`  FAIL harness — ${e.message}`);
} finally {
  if (server) server.kill('SIGKILL');
  if (katana) katana.kill('SIGKILL');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
