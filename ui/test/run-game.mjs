// Runs test/game-page.html in headless Chrome against the REAL ui/index.html.
//
// run-browser.mjs proves the renderer in isolation. This proves the game: it
// serves the real page from a tiny fake server (a recorded game state instead
// of Katana), loads it in an iframe exactly as a player would, and drives it
// with synthetic input. The result is read from the page title, as in
// run-browser.mjs. Real time, because requestAnimationFrame does not tick
// under virtual time.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(here, '..');
const fixture = readFileSync(path.join(here, 'game-fixture.json'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

// The real index.html, with the test-only renderer hooks switched on. ?nowebgl
// makes WebGL unavailable so the failure message can be tested.
function page(query) {
  let html = readFileSync(path.join(ui, 'index.html'), 'utf8');
  let inject = '<script>window.R3D_TEST = true;</script>';
  if (query.includes('nowebgl')) {
    inject += '<script>(() => { const g = HTMLCanvasElement.prototype.getContext;'
      + ' HTMLCanvasElement.prototype.getContext = function (t, ...r) { return /webgl/.test(t) ? null : g.call(this, t, ...r); }; })();</script>';
  }
  return html.replace('<head>', '<head>' + inject);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url.pathname === '/' || url.pathname === '/index.html') return send(200, 'text/html', page(url.search));
  if (url.pathname === '/api/lobby-status') return send(200, 'application/json', JSON.stringify({ phase: 'active', gameId: 1, contractAddress: '0x1' }));
  if (url.pathname === '/api/state') return send(200, 'application/json', fixture);
  if (url.pathname.startsWith('/api/')) return send(200, 'application/json', JSON.stringify({ success: true }));
  const file = path.join(ui, path.normalize(url.pathname));
  if (file.startsWith(ui) && existsSync(file) && !file.includes('node_modules')) {
    return send(200, TYPES[path.extname(file)] || 'application/octet-stream', readFileSync(file));
  }
  send(404, 'text/plain', 'not found');
});

const profile = mkdtempSync(path.join(tmpdir(), 'r3d-game-'));
let chrome = null, done = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function finish(code) {
  if (done) return; done = true;
  server.close();
  const cleanup = () => {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (e) { /* ignore */ }
    process.exit(code);
  };
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return cleanup();
  chrome.once('exit', cleanup);
  setTimeout(cleanup, 5000).unref();
  try { chrome.kill('SIGKILL'); } catch (e) { cleanup(); }
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--window-size=1400,850', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--disable-extensions', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chrome.stderr.on('data', (d) => { stderr += d; });
  chrome.on('error', (e) => { console.error('failed to launch chrome:', e.message); finish(1); });

  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = Number(readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (e) { /* not yet */ }
  }
  if (!port) { console.error('chrome did not expose a debugging port'); console.error(stderr.split('\n').slice(-10).join('\n')); return finish(1); }
  const dbg = `http://127.0.0.1:${port}`;
  const target = await (await fetch(`${dbg}/json/new?${encodeURIComponent(base + '/test/game-page.html' + (process.env.GAME_TEST_FILTER ? '?filter=' + encodeURIComponent(process.env.GAME_TEST_FILTER) : ''))}`, { method: 'PUT' })).json();
  const deadline = Date.now() + (Number(process.env.GAME_TEST_DEADLINE_MS) || 600000);
  let title = '';
  while (Date.now() < deadline) {
    await sleep(250);
    const list = await (await fetch(`${dbg}/json`)).json();
    const t = list.find((x) => x.id === target.id);
    title = t ? t.title : '';
    if (title.startsWith('GAME-RESULT ')) break;
  }
  if (!title.startsWith('GAME-RESULT ')) {
    console.error('no GAME-RESULT found (timed out); last title: ' + title);
    return finish(1);
  }
  const unescape = (x) => x.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let result;
  try { result = JSON.parse(unescape(title.slice('GAME-RESULT '.length))); }
  catch (e) { console.error('unparseable GAME-RESULT:', title); return finish(1); }
  for (const f of result.failures) console.error('FAIL ' + f);
  console.log(`${result.passed} passed, ${result.failed} failed`);
  finish(result.failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); finish(1); });
