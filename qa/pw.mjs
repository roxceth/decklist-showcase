import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
for (const p of ['playwright', '/opt/npm-tools/node_modules/playwright']) {
  try { pw = require(p); break; } catch (e) { /* try next */ }
}
if (!pw) throw new Error('Playwright not found. Install it (npm i -D playwright) or adjust qa/pw.mjs.');
export const chromium = pw.chromium;
