// Runs test/harness.html in headless Chrome and reads the R3D-RESULT title.
// Real time (not --virtual-time-budget): requestAnimationFrame does not tick
// under virtual time, and the renderer loop tests need real frames.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(here, 'harness.html');
const profile = mkdtempSync(path.join(tmpdir(), 'r3d-chrome-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--window-size=1400,850', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--disable-extensions', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
chrome.stderr.on('data', (d) => { stderr += d; });
chrome.on('error', (e) => { console.error('failed to launch chrome:', e.message); finish(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let done = false;
function finish(code) {
  if (done) return; done = true;
  const cleanup = () => {
    // maxRetries: Chrome may still be flushing files while it dies.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (e) { /* ignore */ }
    process.exit(code);
  };
  if (chrome.exitCode !== null || chrome.signalCode !== null) return cleanup();
  chrome.once('exit', cleanup);
  setTimeout(cleanup, 5000).unref();
  try { chrome.kill('SIGKILL'); } catch (e) { cleanup(); }
}

async function main() {
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = Number(readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (e) { /* not yet */ }
  }
  if (!port) { console.error('chrome did not expose a debugging port'); console.error(stderr.split('\n').slice(-10).join('\n')); return finish(1); }
  const base = `http://127.0.0.1:${port}`;
  const target = await (await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const deadline = Date.now() + 90000;
  let title = '';
  while (Date.now() < deadline) {
    await sleep(250);
    const list = await (await fetch(`${base}/json`)).json();
    const t = list.find((x) => x.id === target.id);
    title = t ? t.title : '';
    if (title.startsWith('R3D-RESULT ')) break;
  }
  if (!title.startsWith('R3D-RESULT ')) {
    console.error('no R3D-RESULT found (timed out); last title: ' + title);
    console.error(stderr.split('\n').slice(-10).join('\n'));
    return finish(1);
  }
  let result;
  const unescape = (x) => x.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  try { result = JSON.parse(unescape(title.slice('R3D-RESULT '.length))); }
  catch (e) { console.error('unparseable R3D-RESULT:', title); return finish(1); }
  for (const f of result.failures) console.error('FAIL ' + f);
  console.log(`${result.passed} passed, ${result.failed} failed`);
  finish(result.failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); finish(1); });
