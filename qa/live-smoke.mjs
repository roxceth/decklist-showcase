// Smoke test against the REAL deployed Apps Script web app (not the mock).
// Usage:  API_URL="https://script.google.com/macros/s/.../exec" ORG_NAME="Hector D." ORG_PASSWORD="..." node qa/live-smoke.mjs
// It creates a temporary tournament, exercises the main flow (including a photo through Drive) and deletes it.
const API = process.env.API_URL;
const NAME = process.env.ORG_NAME;
const PASS = process.env.ORG_PASSWORD;
if (!API || !NAME || !PASS) {
  console.error('Set API_URL, ORG_NAME and ORG_PASSWORD.');
  process.exit(2);
}

let token = null;
let eventId = null;
const results = [];

async function call(action, body = {}, auth = true) {
  const t0 = Date.now();
  const res = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ ...body, action, ...(auth && token ? { token } : {}) })
  });
  const json = await res.json();
  const ms = Date.now() - t0;
  return { json, ms };
}
async function step(label, fn) {
  try {
    const info = await fn();
    results.push([true, label, info || '']);
    console.log('PASS', label, info || '');
  } catch (e) {
    results.push([false, label, e.message]);
    console.log('FAIL', label, '-', e.message);
  }
}
const need = (r, code) => {
  if (code) { if (r.json.ok || r.json.error.code !== code) throw new Error(`expected error ${code}, got ${JSON.stringify(r.json).slice(0, 200)}`); return; }
  if (!r.json.ok) throw new Error(JSON.stringify(r.json.error));
};

const secret = 'S'.repeat(32);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 5)]).toString('base64');
const txt = '// Main deck\n' + Array.from({ length: 12 }, (_, i) => `4 x UE24BT/REZ-1-${String(i + 1).padStart(3, '0')}`).join('\n') + '\n2 x UE24BT/REZ-1-099';

await step('ping (cold start may take a few seconds)', async () => { const r = await call('ping', {}, false); need(r); return r.ms + ' ms, v' + r.json.data.version; });
await step('wrong password is refused', async () => { need(await call('login', { name: NAME, password: 'definitely-wrong-123' }, false), 'bad_login'); });
await step('login', async () => { const r = await call('login', { name: NAME, password: PASS }, false); need(r); token = r.json.data.token; return r.ms + ' ms'; });
await step('organizer action without token is refused', async () => { need(await call('listEvents', {}, false), 'unauthorized'); });
await step('createEvent (creates Drive folder)', async () => {
  const r = await call('createEvent', { name: 'ZZ smoke test', datePlayed: new Date().toISOString().slice(0, 10), expireDays: 1, resultsText: '1 Alice 3-0\n2 Bob 2-1\n3 Cara 1-2' });
  need(r); eventId = r.json.data.eventId; return r.ms + ' ms';
});
let alice, bob;
await step('getEvent as a player', async () => {
  const r = await call('getEvent', { eventId }, false); need(r);
  alice = r.json.data.players[0].playerId; bob = r.json.data.players[1].playerId;
  if (/hash/i.test(JSON.stringify(r.json))) throw new Error('response mentions hash');
  return r.ms + ' ms';
});
await step('claimPlayer', async () => { need(await call('claimPlayer', { eventId, playerId: alice, secret }, false)); });
await step('same secret can not claim a second name', async () => { need(await call('claimPlayer', { eventId, playerId: bob, secret }, false), 'already_claimed_other'); });
await step('submitDeck text', async () => { const r = await call('submitDeck', { eventId, playerId: alice, secret, type: 'txt', deckColor: 'Red', deckName: 'Smoke', content: txt }, false); need(r); return r.ms + ' ms'; });
await step('second submit is locked', async () => { need(await call('submitDeck', { eventId, playerId: alice, secret, type: 'txt', deckColor: 'Red', content: txt }, false), 'locked_list'); });
await step('releaseList then submitDeck photo (Drive upload)', async () => {
  need(await call('releaseList', { eventId, playerId: alice }));
  const r = await call('submitDeck', { eventId, playerId: alice, secret, type: 'photo', deckColor: 'Blue', content: jpeg }, false); need(r); return r.ms + ' ms';
});
await step('getDecklists + getPhoto roundtrip', async () => {
  const d = await call('getDecklists', { eventId }); need(d);
  const deck = d.json.data.entries[0].deck;
  const p = await call('getPhoto', { eventId, deckId: deck.deckId }); need(p);
  if (p.json.data.base64 !== jpeg || p.json.data.mime !== 'image/jpeg') throw new Error('photo differs');
  return `list ${d.ms} ms, photo ${p.ms} ms`;
});
await step('non-image upload is refused', async () => { need(await call('submitDeck', { eventId, playerId: alice, secret, type: 'photo', deckColor: 'Blue', content: Buffer.from('<html></html>' + 'x'.repeat(30)).toString('base64') }, false), 'invalid'); });
await step('cleanup: deleteEvent', async () => { need(await call('deleteEvent', { eventId })); eventId = null; });
if (eventId) { try { await call('deleteEvent', { eventId }); } catch (e) { /* best effort */ } }

const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
