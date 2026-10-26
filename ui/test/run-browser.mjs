// Runs test/harness.html in headless Chrome and reads the R3D-RESULT title.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(here, 'harness.html');
const res = spawnSync('google-chrome', [
  '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--window-size=1400,850', '--virtual-time-budget=30000', '--dump-dom', url,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (res.error) { console.error('failed to launch chrome:', res.error.message); process.exit(1); }
const m = /<title>R3D-RESULT (\{.*?\})<\/title>/s.exec(res.stdout || '');
if (!m) {
  console.error('no R3D-RESULT found in page output');
  if (res.stderr) console.error(res.stderr.split('\n').slice(-10).join('\n'));
  process.exit(1);
}
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
let result;
try { result = JSON.parse(unescape(m[1])); }
catch (e) { console.error('unparseable R3D-RESULT:', m[1]); process.exit(1); }
for (const f of result.failures) console.error('FAIL ' + f);
console.log(`${result.passed} passed, ${result.failed} failed`);
process.exit(result.failed > 0 ? 1 : 0);
