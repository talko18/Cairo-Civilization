// Runs test/harness.html in headless Chrome and reads the R3D-RESULT title.
// Real time (not --virtual-time-budget): requestAnimationFrame does not tick
// under virtual time, and the renderer loop tests need real frames.
//
// Timeouts: SwiftShader renders in software, so the whole suite takes minutes
// and takes much longer again when anything else is competing for the CPU
// (another browser suite, a build). The deadline is therefore generous by
// default and overridable with R3D_TEST_DEADLINE_MS; whatever it is set to, a
// timeout prints a FAIL line and exits non-zero. It is never reported as an
// empty pass — the harness publishes its progress in the title so a timeout
// can say exactly which test it died in.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(here, 'harness.html');
const DEADLINE_MS = Number(process.env.R3D_TEST_DEADLINE_MS) || 600000;
const PORT_WAIT_MS = Number(process.env.R3D_TEST_PORT_WAIT_MS) || 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome = null, profile = null, done = false;
function finish(code) {
  if (done) return; done = true;
  const cleanup = () => {
    // maxRetries: Chrome may still be flushing files while it dies.
    try { if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (e) { /* ignore */ }
    process.exit(code);
  };
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return cleanup();
  chrome.once('exit', cleanup);
  setTimeout(cleanup, 5000).unref();
  try { chrome.kill('SIGKILL'); } catch (e) { cleanup(); }
}

// Launching Chrome is itself flaky: it has come up without ever writing
// DevToolsActivePort. That is a launch failure, not a test failure, so it gets
// one retry and a diagnostic that says what was waited for.
async function launch(attempt) {
  profile = mkdtempSync(path.join(tmpdir(), 'r3d-chrome-'));
  const proc = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--window-size=1400,850', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--disable-extensions', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome = proc;
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  proc.on('error', (e) => { stderr += 'spawn error: ' + e.message + '\n'; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const until = Date.now() + PORT_WAIT_MS;
  let port = 0;
  while (!port && Date.now() < until) {
    await sleep(100);
    try { port = Number(readFileSync(portFile, 'utf8').split('\n')[0]); } catch (e) { /* not written yet */ }
  }
  if (port) return port;
  console.error(`chrome did not expose a debugging port (attempt ${attempt}: waited ${PORT_WAIT_MS}ms for ${portFile}; `
    + `process ${proc.exitCode === null ? 'still running' : 'exited ' + proc.exitCode})`);
  console.error(stderr.split('\n').slice(-10).join('\n'));
  try { proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (e) { /* ignore */ }
  chrome = null; profile = null;
  return 0;
}

async function main() {
  let port = await launch(1);
  if (!port) { console.error('retrying chrome launch once'); port = await launch(2); }
  if (!port) { console.error('FAIL harness: chrome would not start'); return finish(1); }
  const base = `http://127.0.0.1:${port}`;
  const target = await (await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const started = Date.now(), deadline = started + DEADLINE_MS;
  let title = '', progress = '';
  while (Date.now() < deadline) {
    await sleep(250);
    const list = await (await fetch(`${base}/json`)).json();
    const t = list.find((x) => x.id === target.id);
    title = t ? t.title : '';
    if (title.startsWith('R3D-PROGRESS ')) progress = title.slice('R3D-PROGRESS '.length);
    if (title.startsWith('R3D-RESULT ')) break;
  }
  const unescape = (x) => x.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (!title.startsWith('R3D-RESULT ')) {
    // A timeout is a failure, never an empty result: say so in the same
    // "FAIL <name>" shape a real failure uses, and name the test it stalled in.
    const where = progress ? 'stalled in: ' + unescape(progress) : 'the harness never reported any progress (it probably failed to load)';
    console.error(`FAIL harness: timed out after ${Math.round((Date.now() - started) / 1000)}s (${where})`);
    console.error('raise R3D_TEST_DEADLINE_MS (currently ' + DEADLINE_MS + ') if the machine is simply slow');
    console.error('0 passed, 1 failed');
    return finish(1);
  }
  let result;
  try { result = JSON.parse(unescape(title.slice('R3D-RESULT '.length))); }
  catch (e) { console.error('FAIL harness: unparseable R3D-RESULT: ' + title); return finish(1); }
  for (const f of result.failures) console.error('FAIL ' + f);
  // Printed every run: the budget is a number to watch, not only a pass/fail.
  for (const b of (result.budget || [])) {
    if (b.ms !== undefined) { console.log(`BUDGET ${b.scene}: ${b.ms} ms`); continue; }
    console.log(`BUDGET ${b.scene}: ${b.calls} draw calls, ${b.tris} triangles, `
      + `${b.children} scene children, ${b.labels} DOM labels, ${b.anims} animations, ${b.fx} effect meshes`);
  }
  console.log(`${result.passed} passed, ${result.failed} failed`);
  finish(result.failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FAIL harness: ' + (e && e.stack || e)); finish(1); });
