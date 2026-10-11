import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { crc32, zipFiles } from '../js/zip.js';
import { buildExport, deckFileName, safeName, summaryCsv } from '../js/exporter.js';
import { columnsFor } from '../js/views/present.js';

test('crc32 known vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip is valid for unzip, keeps UTF-8 names and exact bytes, incl. empty and large files', () => {
  const big = new Uint8Array(300000).map((_, i) => (i * 7) & 255);
  const files = [
    { name: 'a.txt', data: 'hello\n' }, { name: 'ñandú - Ünï.txt', data: 'x' }, { name: 'empty.txt', data: '' }, { name: 'big.bin', data: big }
  ];
  const zp = path.join(os.tmpdir(), 'ds-unit-' + Date.now() + '.zip');
  fs.writeFileSync(zp, zipFiles(files));
  execFileSync('unzip', ['-tq', zp]);
  assert.deepEqual(execFileSync('unzip', ['-Z1', zp]).toString().trim().split('\n'), files.map((f) => f.name));
  assert.equal(execFileSync('unzip', ['-p', zp, 'a.txt']).toString(), 'hello\n');
  assert.ok(Buffer.compare(execFileSync('unzip', ['-p', zp, 'big.bin'], { maxBuffer: 1e7 }), Buffer.from(big)) === 0);
  assert.equal(execFileSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(sorted(z.namelist())[0])`, zp]).toString().split('\n')[0], 'None');
  fs.unlinkSync(zp);
});

test('file names are safe: no path separators, reserved chars or leading dots', () => {
  assert.equal(safeName('../../etc/passwd'), 'etcpasswd');
  assert.equal(safeName('a:b*c?d"e<f>g|h'), 'abcdefgh');
  assert.equal(safeName('...hidden'), 'hidden');
  assert.equal(safeName(''), 'untitled');
  assert.equal(safeName('x'.repeat(100)).length, 60);
  const e = { rank: 3, name: 'Ana/../Bob', deck: { deckName: 'Ram: Rem', deckColor: 'Red' } };
  assert.equal(deckFileName(e), '3 - Ana..Bob - Ram Rem.txt');
});

test('export: raw text exactly as submitted, duplicates get unique names, CSV is formula-safe', () => {
  const t = '// Main deck\r\n4 x A\n';
  const entries = [
    { rank: 1, name: 'Ana', record: '5-0', deck: { type: 'txt', deckName: 'D', deckColor: 'Red', content: t } },
    { rank: 1, name: 'Ana', record: '5-0', deck: { type: 'txt', deckName: 'D', deckColor: 'Red', content: 'other' } },
    { rank: 2, name: '-cmd', record: '', deck: { type: 'link', deckName: '', deckColor: 'Blue', content: 'https://exburst.dev/deck/1' } },
    { rank: 3, name: 'Zed', record: '', deck: null }
  ];
  const files = buildExport(entries);
  assert.deepEqual(files.map((f) => f.name), ['1 - Ana - D.txt', '1 - Ana - D (2).txt', 'summary.csv']);
  assert.equal(files[0].data, t);
  const csv = files[2].data;
  assert.match(csv, /"'-cmd"/);
  assert.match(csv, /"no list"/);
  assert.equal(summaryCsv([]).split('\r\n')[0], '﻿"Rank","Player","Record","Deck","Color","Type","Link"');
});

test('presentation columns grow with the list length', () => {
  assert.deepEqual([1, 18, 19, 39, 40, 80].map(columnsFor), [2, 2, 3, 3, 4, 4]);
});
