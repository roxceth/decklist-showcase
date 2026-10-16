import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freshBackend, login, newEvent, PW, secretA, secretB, TXT, JPEG_B64, PNG_B64, WEBP_B64
} from './helpers.mjs';

const err = (r, code) => {
  assert.equal(r.ok, false, 'expected failure: ' + JSON.stringify(r));
  if (code) assert.equal(r.error.code, code, JSON.stringify(r));
};
const ok = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
};

function setup() {
  const gas = freshBackend();
  const token = login(gas);
  const eventId = newEvent(gas, token);
  const ev = ok(gas.post({ action: 'getEvent', eventId }));
  const pid = (name) => ev.players.find((p) => p.name === name).playerId;
  return { gas, token, eventId, pid };
}

const claim = (gas, eventId, playerId, secret = secretA) =>
  gas.post({ action: 'claimPlayer', eventId, playerId, secret });
const submit = (gas, eventId, playerId, extra = {}, secret = secretA) =>
  gas.post({
    action: 'submitDeck', eventId, playerId, secret, type: 'txt', deckName: 'Ram + Rem',
    deckColor: 'Yellow', content: TXT, ...extra
  });

test('ping and GET health', () => {
  const { gas } = setup();
  assert.equal(ok(gas.post({ action: 'ping' })).version, '0.2.0');
  assert.equal(gas.get().ok, true);
});

test('bad requests: not JSON, empty, array, unknown action, too large', () => {
  const { gas } = setup();
  err(gas.post('not json'), 'bad_request');
  err(gas.post(''), 'bad_request');
  err(gas.post('[1]'), 'bad_request');
  err(gas.post({ action: 'nope' }), 'unknown_action');
  err(gas.post({}), 'unknown_action');
  err(gas.post('{"a":"' + 'x'.repeat(3000001) + '"}'), 'too_large');
});

// ------------------------------------------------------------ auth
test('login: success, wrong password, unknown user give the same error', () => {
  const { gas } = setup();
  assert.ok(login(gas));
  const a = gas.post({ action: 'login', name: 'Hector D.', password: 'wrong-wrong' });
  const b = gas.post({ action: 'login', name: 'Nobody', password: 'wrong-wrong' });
  err(a, 'bad_login');
  err(b, 'bad_login');
  assert.equal(a.error.message, b.error.message);
  assert.ok(login(gas, 'hector d.', PW), 'name is case-insensitive');
});

test('login: lockout after 5 failures, even with the right password; resets after 15 min', () => {
  const { gas } = setup();
  for (let i = 0; i < 5; i++) err(gas.post({ action: 'login', name: 'Hector D.', password: 'bad-bad-bad' }), 'bad_login');
  err(gas.post({ action: 'login', name: 'Hector D.', password: PW }), 'locked');
  gas.advance(15 * 60 * 1000 + 1000);
  assert.ok(login(gas));
});

test('organizer actions require a valid session; fake and malformed tokens rejected', () => {
  const { gas, eventId } = setup();
  const actions = ['listEvents', 'createEvent', 'getEventAdmin', 'updateEvent', 'setStatus', 'addPlayer',
    'updatePlayer', 'removePlayer', 'releaseName', 'releaseList', 'undoRelease', 'getDecklists', 'getPhoto',
    'deleteEvent', 'logout'];
  for (const action of actions) {
    err(gas.post({ action, eventId }), 'unauthorized');
    err(gas.post({ action, eventId, token: 'f'.repeat(64) }), 'unauthorized');
    err(gas.post({ action, eventId, token: "' OR 1=1" }), 'unauthorized');
  }
});

test('session expires after 6 hours; logout invalidates the token', () => {
  const { gas, token } = setup();
  ok(gas.post({ action: 'listEvents', token }));
  gas.advance(6 * 3600 * 1000 + 1000);
  err(gas.post({ action: 'listEvents', token }), 'unauthorized');
  const t2 = login(gas);
  ok(gas.post({ action: 'logout', token: t2 }));
  err(gas.post({ action: 'listEvents', token: t2 }), 'unauthorized');
});

test('disabled organizer loses access immediately', () => {
  const { gas, token } = setup();
  gas.state.props.set('DISABLE_ORG_NAME', 'hector d.');
  gas.run('disableOrganizerFromProperties');
  err(gas.post({ action: 'listEvents', token }), 'unauthorized');
  assert.equal(login(gas), null);
});

test('addOrganizer: min length, upsert resets password, properties are cleaned', () => {
  const { gas } = setup();
  assert.throws(() => gas.run('addOrganizer', 'Short', '1234567'), /at least 8/);
  assert.throws(() => gas.run('addOrganizer', '=evil', 'long-enough-pass'), /Invalid/);
  gas.state.props.set('NEW_ORG_NAME', 'Hector D.');
  gas.state.props.set('NEW_ORG_PASSWORD', 'brand-new-pass');
  gas.run('addOrganizerFromProperties');
  assert.equal(gas.state.props.has('NEW_ORG_PASSWORD'), false);
  assert.equal(login(gas, 'Hector D.', PW), null);
  assert.ok(login(gas, 'Hector D.', 'brand-new-pass'));
  assert.equal(gas.table('Organizers').length, 2, 'no duplicate organizer');
});

test('password is stored salted and hashed, never in clear', () => {
  const { gas } = setup();
  const rows = JSON.stringify(gas.table('Organizers'));
  assert.ok(!rows.includes(PW));
  const [, , salt, hash] = gas.table('Organizers')[0];
  assert.equal(hash.length, 64);
  assert.ok(salt.length >= 16);
});

// ------------------------------------------------------------ events
test('createEvent: players, ranks, records, expiry, folder, defaults', () => {
  const { gas, eventId, token } = setup();
  const admin = ok(gas.post({ action: 'getEventAdmin', token, eventId }));
  assert.deepEqual(admin.players.map((p) => [p.rank, p.name, p.record]), [
    [1, 'Kenji', '5-0'], [2, 'Mara', '4-1'], [3, 'Dante', '4-1'], [4, 'Iris', '3-2']
  ]);
  assert.equal(admin.event.expiresAt, '2026-10-25T12:00:00.000Z');
  assert.equal(admin.event.createdByName, 'Hector D.');
  const e2 = newEvent(gas, token, { expireDays: undefined });
  const a2 = ok(gas.post({ action: 'getEventAdmin', token, eventId: e2 }));
  assert.equal(a2.event.expiresAt, '2026-10-25T12:00:00.000Z', 'default 14 days from Config');
});

test('createEvent validation', () => {
  const { gas, token } = setup();
  const base = { action: 'createEvent', token, name: 'X', datePlayed: '2026-10-11', expireDays: 14, resultsText: 'A\nB' };
  ok(gas.post(base));
  err(gas.post({ ...base, name: '' }), 'invalid');
  err(gas.post({ ...base, name: '=SUM(A1)' }), 'invalid');
  err(gas.post({ ...base, name: 'x'.repeat(81) }), 'invalid');
  err(gas.post({ ...base, datePlayed: '2026-02-30' }), 'invalid');
  err(gas.post({ ...base, datePlayed: '11/10/2026' }), 'invalid');
  err(gas.post({ ...base, expireDays: 0 }), 'invalid');
  err(gas.post({ ...base, expireDays: 91 }), 'invalid');
  err(gas.post({ ...base, expireDays: 1.5 }), 'invalid');
  err(gas.post({ ...base, resultsText: '' }), 'invalid');
  err(gas.post({ ...base, resultsText: '=cmd|calc' }), 'invalid');
  err(gas.post({ ...base, resultsText: '@evil' }), 'invalid');
  err(gas.post({ ...base, exburstUrl: 'http://exburst.dev/ua/en/tournaments/1' }), 'invalid');
  err(gas.post({ ...base, exburstUrl: 'https://evil.com/tournaments/1' }), 'invalid');
  err(gas.post({ ...base, exburstUrl: 'https://exburst.dev/ua/en/deck/1' }), 'invalid');
  ok(gas.post({ ...base, exburstUrl: 'https://exburst.dev/ua/en/tournaments/10963' }));
  const many = Array.from({ length: 201 }, (_, i) => 'P' + i).join('\n');
  err(gas.post({ ...base, resultsText: many }), 'invalid');
});

test('createEvent with 200 players uses few Sheets calls (performance guard)', () => {
  const { gas, token } = setup();
  const many = Array.from({ length: 200 }, (_, i) => `${i + 1} Player${i + 1} 3-2`).join('\n');
  const before = gas.state.calls.sheets;
  ok(gas.post({ action: 'createEvent', token, name: 'Big', datePlayed: '2026-10-11', expireDays: 5, resultsText: many }));
  assert.ok(gas.state.calls.sheets - before < 40, 'calls: ' + (gas.state.calls.sheets - before));
});

test('Sheets text formatting: dates/numbers/formula-like data survive as strings, also past row 1000', () => {
  const { gas, token } = setup();
  const many = Array.from({ length: 1100 / 100 }, () => '').length; // keep lint quiet
  void many;
  for (let i = 0; i < 6; i++) {
    const text = Array.from({ length: 200 }, (_, k) => `${k + 1} P${i}_${k}`).join('\n');
    ok(gas.post({ action: 'createEvent', token, name: 'E' + i, datePlayed: '2026-10-11', expireDays: 5, resultsText: text }));
  }
  const events = ok(gas.post({ action: 'listEvents', token }));
  assert.equal(events.length, 7);
  assert.ok(events.every((e) => e.datePlayed === '2026-10-11'));
  assert.ok(gas.table('Players').length > 1000);
  for (const row of gas.table('Players')) for (const cell of row) assert.equal(typeof cell, 'string');
});

test('all organizers see all events; counts are right', () => {
  const { gas, eventId, pid } = setup();
  const t2 = login(gas, 'Organizer 2', 'another-long-pass');
  const events = ok(gas.post({ action: 'listEvents', token: t2 }));
  assert.equal(events.length, 1);
  assert.equal(events[0].createdByName, 'Hector D.');
  assert.equal(events[0].playerCount, 4);
  assert.equal(events[0].submittedCount, 0);
  claim(gas, eventId, pid('Kenji'));
  submit(gas, eventId, pid('Kenji'));
  assert.equal(ok(gas.post({ action: 'listEvents', token: t2 }))[0].submittedCount, 1);
  ok(gas.post({ action: 'updateEvent', token: t2, eventId, name: 'Renamed', datePlayed: '2026-10-10', expireDays: 20, exburstUrl: '' }));
  const e = ok(gas.post({ action: 'listEvents', token: t2 }))[0];
  assert.equal(e.name, 'Renamed');
  assert.equal(e.expiresAt, '2026-10-31T12:00:00.000Z');
});

// ------------------------------------------------------------ public view + claim
test('getEvent exposes only names/ranks/records/state; no hashes, lists or folder ids', () => {
  const { gas, eventId, pid } = setup();
  claim(gas, eventId, pid('Kenji'));
  submit(gas, eventId, pid('Kenji'));
  const raw = JSON.stringify(gas.post({ action: 'getEvent', eventId }));
  assert.ok(!raw.includes(secretA));
  assert.ok(!/ClaimHash|hash|FolderID|UE24BT|content/i.test(raw), raw);
  const d = ok(gas.post({ action: 'getEvent', eventId }));
  assert.equal(d.players.find((p) => p.name === 'Kenji').state, 'submitted');
  assert.equal(d.me, null);
});

test('getEvent: unknown/invalid id, expired event is hidden', () => {
  const { gas, eventId } = setup();
  err(gas.post({ action: 'getEvent', eventId: 'abcdef123456' }), 'not_found');
  err(gas.post({ action: 'getEvent', eventId: '../../etc' }), 'invalid');
  err(gas.post({ action: 'getEvent' }), 'invalid');
  gas.advance(15 * 86400000);
  err(gas.post({ action: 'getEvent', eventId }), 'not_found');
});

test('claim: success, idempotent for same secret, taken by others, one secret one name', () => {
  const { gas, eventId, pid } = setup();
  assert.equal(ok(claim(gas, eventId, pid('Kenji'))).alreadyYours, false);
  assert.equal(ok(claim(gas, eventId, pid('Kenji'))).alreadyYours, true);
  err(claim(gas, eventId, pid('Kenji'), secretB), 'taken');
  err(claim(gas, eventId, pid('Mara')), 'already_claimed_other');
  ok(claim(gas, eventId, pid('Mara'), secretB));
});

test('claim: validation of secret and ids; closed events refuse', () => {
  const { gas, eventId, pid, token } = setup();
  err(claim(gas, eventId, pid('Kenji'), 'short'), 'invalid');
  err(claim(gas, eventId, pid('Kenji'), 'bad chars!!!'.padEnd(30, 'x')), 'invalid');
  err(claim(gas, eventId, 'zzzz'), 'invalid');
  err(claim(gas, eventId, '00000000'), 'not_found');
  ok(gas.post({ action: 'setStatus', token, eventId, status: 'closed' }));
  err(claim(gas, eventId, pid('Kenji')), 'closed');
  err(submit(gas, eventId, pid('Kenji')), 'closed');
  ok(gas.post({ action: 'setStatus', token, eventId, status: 'open' }));
  ok(claim(gas, eventId, pid('Kenji')));
});

test('claim: a player of another event can not be claimed through this event', () => {
  const { gas, token, eventId } = setup();
  const e2 = newEvent(gas, token, { name: 'Other' });
  const other = ok(gas.post({ action: 'getEvent', eventId: e2 })).players[0].playerId;
  err(claim(gas, eventId, other), 'not_found');
});

test('getEvent with secret returns "me" (restore after reload) and own deck info', () => {
  const { gas, eventId, pid } = setup();
  claim(gas, eventId, pid('Iris'));
  let d = ok(gas.post({ action: 'getEvent', eventId, secret: secretA }));
  assert.equal(d.me.playerId, pid('Iris'));
  assert.equal(d.players.find((p) => p.name === 'Iris').mine, true);
  submit(gas, eventId, pid('Iris'));
  d = ok(gas.post({ action: 'getEvent', eventId, secret: secretA }));
  assert.equal(d.me.locked, true);
  assert.equal(d.me.deck.deckName, 'Ram + Rem');
  d = ok(gas.post({ action: 'getEvent', eventId, secret: secretB }));
  assert.equal(d.me, null);
});

// ------------------------------------------------------------ submit
test('submit txt: stored raw, state submitted, locked', () => {
  const { gas, eventId, pid, token } = setup();
  claim(gas, eventId, pid('Kenji'));
  ok(submit(gas, eventId, pid('Kenji')));
  const dl = ok(gas.post({ action: 'getDecklists', token, eventId }));
  const k = dl.entries.find((e) => e.name === 'Kenji');
  assert.equal(k.deck.content, TXT);
  assert.equal(k.deck.type, 'txt');
  assert.equal(k.deck.deckColor, 'Yellow');
  assert.equal(dl.entries.find((e) => e.name === 'Mara').deck, null);
  err(submit(gas, eventId, pid('Kenji')), 'locked_list');
});

test('submit requires the claim secret of that very player', () => {
  const { gas, eventId, pid } = setup();
  err(submit(gas, eventId, pid('Kenji')), 'forbidden'); // not claimed
  claim(gas, eventId, pid('Kenji'));
  err(submit(gas, eventId, pid('Kenji'), {}, secretB), 'forbidden');
  claim(gas, eventId, pid('Mara'), secretB);
  err(submit(gas, eventId, pid('Kenji'), {}, secretB), 'forbidden'); // B owns Mara, not Kenji
});

test('submit txt validation', () => {
  const { gas, eventId, pid } = setup();
  claim(gas, eventId, pid('Kenji'));
  const p = pid('Kenji');
  err(submit(gas, eventId, p, { content: '' }), 'invalid');
  err(submit(gas, eventId, p, { content: '   \n  ' }), 'invalid');
  err(submit(gas, eventId, p, { content: 'hello world' }), 'invalid');
  err(submit(gas, eventId, p, { content: '=HYPERLINK("http://x")' }), 'invalid');
  err(submit(gas, eventId, p, { content: '+1 x' }), 'invalid');
  err(submit(gas, eventId, p, { content: '4 x A\n'.repeat(2000) }), 'invalid');
  err(submit(gas, eventId, p, { content: 123 }), 'invalid');
  err(submit(gas, eventId, p, { deckColor: 'Pink' }), 'invalid');
  err(submit(gas, eventId, p, { deckColor: undefined }), 'invalid');
  err(submit(gas, eventId, p, { deckName: 'x'.repeat(61) }), 'invalid');
  err(submit(gas, eventId, p, { deckName: '=bad' }), 'invalid');
  err(submit(gas, eventId, p, { type: 'pdf' }), 'invalid');
  ok(submit(gas, eventId, p, { deckName: '' }));
});

test('submit link: only https exburst.dev deck links', () => {
  const { gas, eventId, pid } = setup();
  claim(gas, eventId, pid('Kenji'));
  const p = pid('Kenji');
  const L = (content) => submit(gas, eventId, p, { type: 'link', content });
  err(L('http://exburst.dev/ua/en/deck/1'), 'invalid');
  err(L('https://exburst.dev.evil.com/deck/1'), 'invalid');
  err(L('https://evil.com/exburst.dev/deck/1'), 'invalid');
  err(L('https://exburst.dev@evil.com/deck/1'), 'invalid');
  err(L('https://exburst.dev/ua/en/tournaments/1'), 'invalid');
  err(L('javascript:alert(1)'), 'invalid');
  err(L('https://exburst.dev/deck/1 '.padEnd(600, 'a')), 'invalid');
  err(L(''), 'invalid');
  ok(L('https://exburst.dev/ua/en/deck/132316'));
});

test('submit photo: magic bytes decide, extension/mime from client are ignored', () => {
  const { gas, eventId, pid, token } = setup();
  const types = [['Kenji', JPEG_B64, 'image/jpeg'], ['Mara', PNG_B64, 'image/png'], ['Dante', WEBP_B64, 'image/webp']];
  const secrets = [secretA, secretB, 'C'.repeat(32)];
  types.forEach(([name, b64, mime], i) => {
    claim(gas, eventId, pid(name), secrets[i]);
    ok(submit(gas, eventId, pid(name), { type: 'photo', content: b64, mimeType: 'text/html' }, secrets[i]));
  });
  const dl = ok(gas.post({ action: 'getDecklists', token, eventId }));
  types.forEach(([name, b64, mime]) => {
    const deck = dl.entries.find((e) => e.name === name).deck;
    assert.equal(deck.type, 'photo');
    assert.equal(deck.content, '', 'photo bytes are not in the list payload');
    const ph = ok(gas.post({ action: 'getPhoto', token, eventId, deckId: deck.deckId }));
    assert.equal(ph.mime, mime);
    assert.equal(ph.base64, b64);
  });
});

test('submit photo: rejects non-images, huge, bad base64, empty', () => {
  const { gas, eventId, pid } = setup();
  claim(gas, eventId, pid('Kenji'));
  const p = pid('Kenji');
  const P = (content) => submit(gas, eventId, p, { type: 'photo', content });
  err(P(Buffer.from('<html><script>alert(1)</script></html>').toString('base64')), 'invalid');
  err(P(Buffer.from('GIF89a' + 'x'.repeat(50)).toString('base64')), 'invalid');
  err(P(Buffer.from('%PDF-1.4 ' + 'x'.repeat(50)).toString('base64')), 'invalid');
  err(P('not base64 !!!'), 'invalid');
  err(P(''), 'invalid');
  err(P(undefined), 'invalid');
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1572864 + 10, 7)]).toString('base64');
  err(P(big), 'too_large');
  const exactlyOk = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1572864 - 3, 7)]).toString('base64');
  ok(P(exactlyOk));
  assert.equal([...gas.state.files.values()].length, 1, 'rejected uploads left no files behind');
});

test('failed submit after upload (lock busy) does not leave orphan files', () => {
  const { gas, eventId, pid } = setup();
  claim(gas, eventId, pid('Kenji'));
  gas.state.lockBusy = true;
  err(submit(gas, eventId, pid('Kenji'), { type: 'photo', content: JPEG_B64 }), 'busy');
  gas.state.lockBusy = false;
  const live = [...gas.state.files.values()].filter((f) => !f.trashed);
  assert.equal(live.length, 0, 'orphan photo trashed');
  ok(submit(gas, eventId, pid('Kenji'), { type: 'photo', content: JPEG_B64 }));
});

test('write actions return "busy" when the lock can not be taken, reads still work', () => {
  const { gas, eventId, pid, token } = setup();
  gas.state.lockBusy = true;
  err(claim(gas, eventId, pid('Kenji')), 'busy');
  err(gas.post({ action: 'setStatus', token, eventId, status: 'closed' }), 'busy');
  ok(gas.post({ action: 'getEvent', eventId }));
  ok(gas.post({ action: 'listEvents', token }));
});

// ------------------------------------------------------------ release / edit flows
test('releaseList: old list stays until a new one arrives; undoRelease re-locks', () => {
  const { gas, eventId, pid, token } = setup();
  const p = pid('Kenji');
  claim(gas, eventId, p);
  submit(gas, eventId, p);
  ok(gas.post({ action: 'releaseList', token, eventId, playerId: p }));
  let d = ok(gas.post({ action: 'getEvent', eventId }));
  assert.equal(d.players[0].state, 'released');
  let dl = ok(gas.post({ action: 'getDecklists', token, eventId }));
  assert.equal(dl.entries[0].deck.content, TXT, 'old list still presented');
  ok(gas.post({ action: 'undoRelease', token, eventId, playerId: p }));
  err(submit(gas, eventId, p), 'locked_list');
  ok(gas.post({ action: 'releaseList', token, eventId, playerId: p }));
  ok(submit(gas, eventId, p, { type: 'link', content: 'https://exburst.dev/ua/en/deck/5', deckName: 'New' }));
  dl = ok(gas.post({ action: 'getDecklists', token, eventId }));
  assert.equal(dl.entries[0].deck.type, 'link');
  assert.equal(dl.entries[0].deck.deckName, 'New');
  assert.equal(gas.table('Decklists').length, 2, 'old version kept until event deletion');
  err(submit(gas, eventId, p), 'locked_list');
});

test('releaseList on a player without a list is refused', () => {
  const { gas, eventId, pid, token } = setup();
  err(gas.post({ action: 'releaseList', token, eventId, playerId: pid('Kenji') }), 'invalid');
  err(gas.post({ action: 'undoRelease', token, eventId, playerId: pid('Kenji') }), 'invalid');
});

test('releaseName: frees the name, clears the secret, someone else can claim', () => {
  const { gas, eventId, pid, token } = setup();
  const p = pid('Dante');
  claim(gas, eventId, p, secretA);
  ok(gas.post({ action: 'releaseName', token, eventId, playerId: p }));
  err(submit(gas, eventId, p, {}, secretA), 'forbidden');
  ok(claim(gas, eventId, p, secretB));
  ok(claim(gas, eventId, pid('Kenji'), secretA)); // A is free again for another name
  assert.ok(!JSON.stringify(gas.table('Players')).includes(secretA));
});

test('releaseName on a submitted player keeps their list but unlocks it', () => {
  const { gas, eventId, pid, token } = setup();
  const p = pid('Kenji');
  claim(gas, eventId, p);
  submit(gas, eventId, p);
  ok(gas.post({ action: 'releaseName', token, eventId, playerId: p }));
  assert.equal(ok(gas.post({ action: 'getEvent', eventId })).players[0].state, 'released');
  assert.equal(ok(gas.post({ action: 'getDecklists', token, eventId })).entries[0].deck.content, TXT);
  ok(claim(gas, eventId, p, secretB));
  ok(submit(gas, eventId, p, { deckName: 'Other' }, secretB));
});

test('add / update / remove player; ids are used, not rows', () => {
  const { gas, eventId, pid, token } = setup();
  const late = ok(gas.post({ action: 'addPlayer', token, eventId, name: 'Late One', record: '1-4' })).playerId;
  let admin = ok(gas.post({ action: 'getEventAdmin', token, eventId }));
  assert.equal(admin.players.at(-1).rank, 5);
  ok(gas.post({ action: 'updatePlayer', token, eventId, playerId: pid('Mara'), name: 'Mara L.', record: '5-0', rank: 1 }));
  admin = ok(gas.post({ action: 'getEventAdmin', token, eventId }));
  assert.ok(admin.players.some((p) => p.name === 'Mara L.' && p.record === '5-0'));
  claim(gas, eventId, pid('Kenji'));
  submit(gas, eventId, pid('Kenji'), { type: 'photo', content: JPEG_B64 });
  ok(gas.post({ action: 'updatePlayer', token, eventId, playerId: pid('Kenji'), name: 'Kenji Z' }));
  const afterEdit = ok(gas.post({ action: 'getEventAdmin', token, eventId })).players.find((p) => p.playerId === pid('Kenji'));
  assert.equal(afterEdit.state, 'submitted', 'editing a name keeps claim and list');
  ok(gas.post({ action: 'removePlayer', token, eventId, playerId: pid('Kenji') }));
  assert.equal(gas.table('Decklists').length, 0);
  assert.equal([...gas.state.files.values()].filter((f) => !f.trashed).length, 0);
  ok(gas.post({ action: 'removePlayer', token, eventId, playerId: late }));
  admin = ok(gas.post({ action: 'getEventAdmin', token, eventId }));
  assert.equal(admin.players.length, 3);
  err(gas.post({ action: 'updatePlayer', token, eventId, playerId: pid('Mara'), record: 'win' }), 'invalid');
  err(gas.post({ action: 'updatePlayer', token, eventId, playerId: pid('Mara'), name: '=x' }), 'invalid');
  err(gas.post({ action: 'updatePlayer', token, eventId, playerId: pid('Mara'), rank: 0 }), 'invalid');
  err(gas.post({ action: 'addPlayer', token, eventId, name: '' }), 'invalid');
});

test('getEventAdmin never returns hashes or secrets', () => {
  const { gas, eventId, pid, token } = setup();
  claim(gas, eventId, pid('Kenji'));
  const raw = JSON.stringify(ok(gas.post({ action: 'getEventAdmin', token, eventId })));
  assert.ok(!/hash/i.test(raw));
  assert.ok(!raw.includes(secretA));
  assert.ok(!JSON.stringify(ok(gas.post({ action: 'listEvents', token }))).match(/hash|folder/i));
});

test('getPhoto: wrong event / non-photo deck / unknown id are refused', () => {
  const { gas, eventId, pid, token } = setup();
  claim(gas, eventId, pid('Kenji'));
  submit(gas, eventId, pid('Kenji'));
  const e2 = newEvent(gas, token, { name: 'E2' });
  const deckId = gas.table('Decklists')[0][0];
  err(gas.post({ action: 'getPhoto', token, eventId, deckId }), 'not_found'); // txt deck
  err(gas.post({ action: 'getPhoto', token, eventId: e2, deckId }), 'not_found');
  err(gas.post({ action: 'getPhoto', token, eventId, deckId: 'bad' }), 'invalid');
});

// ------------------------------------------------------------ delete / cleanup
test('deleteEvent removes rows and trashes the Drive folder (with its photos)', () => {
  const { gas, eventId, pid, token } = setup();
  const keep = newEvent(gas, token, { name: 'Keep' });
  claim(gas, eventId, pid('Kenji'));
  submit(gas, eventId, pid('Kenji'), { type: 'photo', content: PNG_B64 });
  ok(gas.post({ action: 'deleteEvent', token, eventId }));
  err(gas.post({ action: 'getEvent', eventId }), 'not_found');
  assert.equal(gas.table('Decklists').length, 0);
  assert.ok(gas.table('Players').every((r) => r[1] === keep));
  const f = [...gas.state.folders.values()].find((x) => x.name === 'event-' + eventId);
  assert.equal(f.trashed, true);
  ok(gas.post({ action: 'getEvent', eventId: keep }));
});

test('cleanupExpired deletes only expired events (daily trigger installed by setup)', () => {
  const { gas, token, eventId } = setup();
  const longer = newEvent(gas, token, { name: 'Longer', expireDays: 30 });
  assert.deepEqual(gas.state.triggers, ['cleanupExpired']);
  gas.advance(15 * 86400000);
  assert.equal(gas.run('cleanupExpired'), 1);
  assert.equal(gas.table('Events').length, 1);
  assert.equal(gas.table('Events')[0][0], longer);
  assert.equal(gas.table('Players').filter((r) => r[1] === eventId).length, 0);
  assert.equal(ok(gas.post({ action: 'listEvents', token: login(gas) })).length, 1);
});

test('cleanupExpired prunes old audit lines', () => {
  const { gas } = setup();
  assert.ok(gas.table('Audit').length > 0);
  gas.advance(100 * 86400000);
  gas.run('cleanupExpired');
  assert.ok(gas.table('Audit').every((r) => r[0] >= '2026'), 'ok');
  assert.ok(gas.table('Audit').length <= 1, 'only the autoDelete line remains');
});

test('setup is idempotent: no duplicate sheets, trigger or folder', () => {
  const { gas } = setup();
  const props = [...gas.state.props.entries()].filter(([k]) => ['SHEET_ID', 'ROOT_FOLDER_ID'].includes(k));
  gas.run('setup');
  gas.run('setup');
  assert.equal(gas.state.triggers.length, 1);
  assert.deepEqual([...gas.state.props.entries()].filter(([k]) => ['SHEET_ID', 'ROOT_FOLDER_ID'].includes(k)), props);
  assert.equal(gas.state.sheets.size, 1);
});

test('before setup every call answers "not_setup" instead of crashing', async () => {
  const { createGas } = await import('./mock-gas.mjs');
  const gas = createGas();
  err(gas.post({ action: 'getEvent', eventId: 'abcdef123456' }), 'not_setup');
});

test('unexpected internal errors are hidden from the client and logged', () => {
  const { gas, eventId } = setup();
  gas.ctx.readAll_ = () => { throw new Error('secret internal detail /path'); };
  const r = gas.post({ action: 'getEvent', eventId });
  err(r, 'server_error');
  assert.ok(!JSON.stringify(r).includes('secret internal'));
  assert.ok(gas.state.logs.some((l) => l[0] === 'error'));
});

test('audit never contains secrets, hashes or list content', () => {
  const { gas, eventId, pid, token } = setup();
  claim(gas, eventId, pid('Kenji'));
  submit(gas, eventId, pid('Kenji'));
  gas.post({ action: 'releaseList', token, eventId, playerId: pid('Kenji') });
  const raw = JSON.stringify(gas.table('Audit'));
  assert.ok(!raw.includes(secretA) && !raw.includes('UE24BT') && !raw.includes(PW));
  assert.ok(gas.table('Audit').length >= 4);
});

test('concurrent-looking double submit: second one is refused (lock re-check)', () => {
  const { gas, eventId, pid } = setup();
  claim(gas, eventId, pid('Kenji'));
  ok(submit(gas, eventId, pid('Kenji')));
  err(submit(gas, eventId, pid('Kenji'), { deckName: 'Dup' }), 'locked_list');
  assert.equal(gas.table('Decklists').length, 1);
});

test('stored data keeps names/decks with odd characters intact (no HTML escaping server side)', () => {
  const { gas, token } = setup();
  const id = newEvent(gas, token, { resultsText: '1 <b>Bold</b> 2-1\n2 Ñandú "Q" 1-2' });
  const ev = ok(gas.post({ action: 'getEvent', eventId: id }));
  assert.deepEqual(ev.players.map((p) => p.name), ['<b>Bold</b>', 'Ñandú "Q"']);
});
