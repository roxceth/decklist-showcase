import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDeckText, parseResults, checkDeckLink, checkTournamentLink, startsWithFormulaChar } from '../shared/parsers.js';

test('parseDeckText: Exburst "Copy the list" sample', () => {
  const t = '// Main deck\n4 x UE24BT/REZ-1-007\n4 x UE24BT/REZ-1-008\n2 x UE24BT/REZ-1-016\n';
  const r = parseDeckText(t);
  assert.deepEqual(r.entries.map((e) => [e.qty, e.code]), [[4, 'UE24BT/REZ-1-007'], [4, 'UE24BT/REZ-1-008'], [2, 'UE24BT/REZ-1-016']]);
  assert.equal(r.total, 10);
  assert.equal(r.warnings.length, 1, 'not 50 cards');
  assert.deepEqual(r.sections, ['Main deck']);
});

test('parseDeckText: exactly 50 cards gives no warning; CRLF, blank lines, spacing variants', () => {
  const lines = Array.from({ length: 12 }, (_, i) => `4x CODE-${i}`).concat(['2  CODE-99']);
  const r = parseDeckText('// Main deck\r\n\r\n' + lines.join('\r\n'));
  assert.equal(r.total, 50);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(parseDeckText('3 X ABC/1-1').entries[0], { qty: 3, code: 'ABC/1-1', section: '', main: true });
  assert.equal(parseDeckText('3 × ABC').entries[0].code, 'ABC');
  assert.equal(parseDeckText('2 xylo-1').entries[0].code, 'xylo-1', 'x glued to a code is part of the code');
});

test('parseDeckText: other sections are not counted in the main deck', () => {
  const r = parseDeckText('// Main deck\n4 x A\n// Side\n3 x B');
  assert.equal(r.total, 4);
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[1].main, false);
});

test('parseDeckText: garbage is reported, not thrown', () => {
  for (const v of [null, undefined, '', '   ', 'hello', '0 x A', 123, '4 x ' + 'A'.repeat(60)]) {
    const r = parseDeckText(v);
    assert.equal(r.entries.length, 0, String(v));
  }
  const r = parseDeckText('4 x A\nrandom words');
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.unrecognized, ['random words']);
});

test('parseResults: formats', () => {
  const rows = (t) => parseResults(t).players.map((p) => [p.rank, p.name, p.record]);
  assert.deepEqual(rows('1  Kenji  5-0\n2  Mara  4-1'), [[1, 'Kenji', '5-0'], [2, 'Mara', '4-1']]);
  assert.deepEqual(rows('Kenji\nMara'), [[1, 'Kenji', ''], [2, 'Mara', '']]);
  assert.deepEqual(rows('Kenji 5-0\nMara Lopez 4-1-1'), [[1, 'Kenji', '5-0'], [2, 'Mara Lopez', '4-1-1']]);
  assert.deepEqual(rows('1. Kenji\n2) Mara\n3rd Dante'), [[1, 'Kenji', ''], [2, 'Mara', ''], [3, 'Dante', '']]);
  assert.deepEqual(rows('1\tKenji\t5-0\r\n\r\n2\tMara\t4-1\r\n'), [[1, 'Kenji', '5-0'], [2, 'Mara', '4-1']]);
  assert.deepEqual(rows('  Ana   María  '), [[1, 'Ana María', '']]);
});

test('parseResults: numbers that are part of a name are kept unless they are exactly 1..N', () => {
  const rows = (t) => parseResults(t).players.map((p) => p.name);
  assert.deepEqual(rows('21 Savage\nMara'), ['21 Savage', 'Mara']);
  assert.deepEqual(rows('3 Doors Down\n1 Kenji'), ['3 Doors Down', '1 Kenji']);
  assert.deepEqual(rows('1 Kenji\n2 Mara\n4 Iris'), ['1 Kenji', '2 Mara', '4 Iris']);
});

test('parseResults: errors and warnings', () => {
  assert.equal(parseResults('').players.length, 0);
  assert.match(parseResults('=SUM(1)').errors[0], /cannot start/);
  assert.match(parseResults('1. ').errors[0], /no player name/);
  assert.match(parseResults('x'.repeat(61)).errors[0], /longer than 60/);
  assert.equal(parseResults('Ana\nana').warnings.length, 1);
  assert.match(parseResults(Array.from({ length: 201 }, (_, i) => 'P' + i).join('\n')).errors.at(-1), /Too many/);
});

test('links', () => {
  assert.equal(checkDeckLink('https://exburst.dev/ua/en/deck/132316'), '');
  assert.equal(checkDeckLink('https://www.exburst.dev/ua/en/deck/132316?x=1'), '');
  for (const bad of ['', 'http://exburst.dev/deck/1', 'https://exburst.dev/ua/en/tournaments/1', 'https://exburst.dev.evil.com/deck/1',
    'https://exburst.dev@evil.com/deck/1', 'https://exburst.dev:8080/deck/1', 'https://exburst.dev/deck/1#frag', 'https://exburst.dev/deck/ 1']) {
    assert.notEqual(checkDeckLink(bad), '', bad);
  }
  assert.equal(checkTournamentLink(''), '');
  assert.equal(checkTournamentLink('https://exburst.dev/ua/en/tournaments/10963'), '');
  assert.notEqual(checkTournamentLink('https://exburst.dev/ua/en/deck/1'), '');
});

test('formula guard', () => {
  for (const s of ['=1', '+1', '@x', '  =1']) assert.equal(startsWithFormulaChar(s), true, s);
  for (const s of ['a=1', '-1', '// Main deck']) assert.equal(startsWithFormulaChar(s), false, s);
});

test('Parsers.gs is generated from shared/parsers.js and has no export keywords', () => {
  const gs = fs.readFileSync(new URL('../apps-script/Parsers.gs', import.meta.url), 'utf8');
  assert.ok(!/^export\s/m.test(gs));
  assert.ok(gs.startsWith('// GENERATED FILE'));
});
