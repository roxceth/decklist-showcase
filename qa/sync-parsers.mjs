// Generates apps-script/Parsers.gs from shared/parsers.js (strips `export`).
// Usage: node qa/sync-parsers.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'shared/parsers.js'), 'utf8');
const header =
  '// GENERATED FILE - do not edit. Source: shared/parsers.js (run `npm run sync`).\n';
const out = header + src.replace(/^export\s+/gm, '');
const target = path.join(root, 'apps-script/Parsers.gs');

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (cur !== out) {
    console.error('Parsers.gs is out of sync with shared/parsers.js. Run: npm run sync');
    process.exit(1);
  }
  console.log('Parsers.gs is in sync.');
} else {
  fs.writeFileSync(target, out);
  console.log('Wrote', path.relative(root, target));
}
