import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from './pw.mjs';
import { startDevServer } from './dev-server.mjs';
import { PW, TXT } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(here, '..', 'docs', 'screenshots');
const FIXTURE = path.join(here, 'fixtures', 'deck-image.png');
fs.mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { viewport: { width: 1280, height: 800 } };
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

let srv, browser;
const s = { eventId: null, link: null };
const consoleErrors = [];

async function newPage(opts = DESKTOP) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
  });
  return page;
}

async function noHorizontalOverflow(page, label) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(m.sw <= m.cw + 1, `${label}: horizontal overflow ${m.sw} > ${m.cw}`);
}
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });

async function login(page, name = 'Hector D.', pass = PW) {
  await page.goto(srv.base + '/#/');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Your tournaments' }).waitFor();
}

before(async () => {
  srv = await startDevServer();
  srv.gas.run('addOrganizer', 'Hector D.', PW);
  srv.gas.run('addOrganizer', 'Organizer 2', 'another-long-pass');
  browser = await chromium.launch();
  // Fixture: an image that looks like an Exburst export (1080 x 1170 PNG), rendered by the browser itself.
  const p = await newPage({ viewport: { width: 1080, height: 1170 } });
  await p.setContent('<body style="margin:0;background:#101420;color:#fff;font:28px sans-serif"><div style="padding:40px"><h1>Ram + Rem</h1>' +
    Array.from({ length: 13 }, (_, i) => `<p>4 x UE24BT/REZ-1-${String(i + 1).padStart(3, '0')}</p>`).join('') + '</div></body>');
  await p.screenshot({ path: FIXTURE });
  await p.context().close();
});
after(async () => {
  await browser.close();
  await srv.close();
});

test('login: wrong password and empty fields show errors; correct login opens the dashboard', async () => {
  const page = await newPage();
  await page.goto(srv.base + '/#/');
  await shot(page, '01-login-desktop');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Enter your name and password.').waitFor();
  await page.getByLabel('Name').fill('Hector D.');
  await page.getByLabel('Password').fill('nope-nope-nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Wrong name or password.').waitFor();
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Your tournaments' }).waitFor();
  await page.getByText('No tournaments yet').waitFor();
  await noHorizontalOverflow(page, 'dashboard empty');
  await page.context().close();

  const m = await newPage(MOBILE);
  await m.goto(srv.base + '/#/');
  await shot(m, '01-login-mobile');
  await noHorizontalOverflow(m, 'login mobile');
  await m.context().close();
});

test('protected routes redirect to login when signed out', async () => {
  const page = await newPage();
  for (const hash of ['#/dashboard', '#/new', '#/edit/abcdef123456', '#/present/abcdef123456']) {
    await page.goto(srv.base + '/' + hash);
    await page.getByRole('heading', { name: 'Organizer sign-in' }).waitFor();
  }
  await page.goto(srv.base + '/#/e/not-an-id');
  await page.getByText('Page not found').waitFor();
  await page.context().close();
});

test('create tournament: preview, validation, share link', async () => {
  const page = await newPage();
  await login(page);
  await page.getByRole('link', { name: 'New tournament' }).first().click();
  await page.getByRole('heading', { name: 'Create tournament' }).waitFor();
  await page.getByRole('button', { name: 'Create & get link' }).click();
  await page.getByText('Enter a tournament name.').waitFor();
  await page.getByLabel('Tournament name').fill('Hotkei Weekly');
  await page.getByLabel('Results (one player per line)').fill('=bad\n');
  await page.getByText('cannot start with').first().waitFor();
  const results = ['1  Kenji  5-0', '2  Mara  4-1', '3  Dante  4-1', '4  Iris  3-2', '5  Tomas  3-2', '6  Lucia  3-2', '7  Bruno  2-3', '8  Nadia  2-3'].join('\n');
  await page.getByLabel('Results (one player per line)').fill(results);
  await page.getByText('8 players found').waitFor();
  await page.getByLabel('Exburst tournament link (optional)').fill('https://evil.com/tournaments/1');
  await page.getByRole('button', { name: 'Create & get link' }).click();
  await page.getByText('Only https://exburst.dev links are accepted.').waitFor();
  await page.getByLabel('Exburst tournament link (optional)').fill('https://exburst.dev/ua/en/tournaments/10963');
  await shot(page, '03-new-tournament-desktop');
  await page.getByRole('button', { name: 'Create & get link' }).click();
  await page.getByText('Tournament created with 8 players.').waitFor();
  s.link = await page.getByLabel('Public tournament link').inputValue();
  assert.match(s.link, /#\/e\/[a-f0-9]{12}$/);
  s.eventId = s.link.split('/').pop();
  await noHorizontalOverflow(page, 'new event');
  await page.context().close();

  const m = await newPage(MOBILE);
  await login(m);
  await m.goto(srv.base + '/#/new');
  await m.getByLabel('Results (one player per line)').fill(results);
  await noHorizontalOverflow(m, 'new event mobile');
  await shot(m, '03-new-tournament-mobile');
  await m.context().close();
});

async function playerClaimAndSend(page, playerName, secretTag, deck) {
  await page.goto(s.link.replace(/^https?:\/\/[^/]+/, srv.base));
  await page.getByRole('heading', { name: 'Find your name' }).waitFor();
  await page.locator('.claim-row', { hasText: playerName }).getByRole('button', { name: "That's me" }).click();
  await page.getByRole('heading', { name: 'Is this you?' }).waitFor();
  await page.getByRole('button', { name: "Yes, that's me" }).click();
  await page.getByRole('heading', { name: 'Send your decklist' }).waitFor();
  await deck(page);
}

test('player flow (mobile): claim, validation, send text, persists after reload', async () => {
  const page = await newPage(MOBILE);
  await page.goto(s.link.replace(/^https?:\/\/[^/]+/, srv.base));
  await page.getByRole('heading', { name: 'Find your name' }).waitFor();
  await shot(page, '04-player-claim-mobile');
  await noHorizontalOverflow(page, 'player picker');
  await page.locator('.claim-row', { hasText: 'Iris' }).getByRole('button', { name: "That's me" }).click();
  await shot(page, '04b-player-confirm-mobile');
  await page.getByRole('button', { name: 'Not me, go back' }).click();
  await page.locator('.claim-row', { hasText: 'Iris' }).getByRole('button', { name: "That's me" }).click();
  await page.getByRole('button', { name: "Yes, that's me" }).click();
  await page.getByRole('heading', { name: 'Send your decklist' }).waitFor();
  await noHorizontalOverflow(page, 'player form');
  await page.getByRole('button', { name: 'Submit decklist' }).click();
  await page.getByText('Pick your deck color.').waitFor();
  await page.getByRole('radio', { name: 'Yellow' }).click();
  await page.getByRole('button', { name: 'Submit decklist' }).click();
  await page.getByText('Paste your list first.').waitFor();
  await page.locator('#deck-text').fill('hello world');
  await page.getByRole('button', { name: 'Submit decklist' }).click();
  await page.getByText('No cards found.').first().waitFor();
  await page.locator('#deck-name').fill('Ram + Rem');
  await page.locator('#deck-text').fill(TXT);
  assert.equal(await page.locator('.banner.error').count(), 0, 'old error cleared when the player edits');
  await page.getByText('50 cards').waitFor();
  await shot(page, '05-player-submit-mobile');
  await page.getByRole('button', { name: 'Submit decklist' }).click();
  await page.getByRole('heading', { name: 'Your list is in' }).waitFor();
  await shot(page, '06-player-sent-mobile');
  await page.reload();
  await page.getByRole('heading', { name: 'Your list is in' }).waitFor();
  await page.getByText('Ram + Rem · Yellow').waitFor();
  // A different device (fresh storage) sees the name as submitted and can not take it.
  const other = await newPage(MOBILE);
  await other.goto(s.link.replace(/^https?:\/\/[^/]+/, srv.base));
  await other.getByRole('heading', { name: 'Find your name' }).waitFor();
  const row = other.locator('.claim-row', { hasText: 'Iris' });
  await row.getByText('List sent').waitFor();
  assert.equal(await row.getByRole('button').count(), 0);
  await other.context().close();
  await page.context().close();
});

test('player flow: send image (compressed in the browser) and an Exburst link', async () => {
  const p1 = await newPage(MOBILE);
  await playerClaimAndSend(p1, 'Kenji', 'k', async (page) => {
    await page.getByRole('radio', { name: 'Blue' }).click();
    await page.getByRole('tab', { name: 'Image' }).click();
    await page.getByRole('button', { name: 'Submit decklist' }).click();
    await page.getByText('Choose an image first.').waitFor();
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(FIXTURE);
    await page.getByText(/KB after shrinking/).waitFor();
    const info = await page.getByText(/KB after shrinking/).textContent();
    assert.match(info, /1080 × 1170 px/, 'not enlarged, not cropped');
    const kb = Number(/(\d+) KB/.exec(info)[1]);
    assert.ok(kb < fs.statSync(FIXTURE).size / 1024, 'JPEG is smaller than the PNG');
    await shot(page, '05b-player-image-mobile');
    await page.getByRole('button', { name: 'Submit decklist' }).click();
    await page.getByRole('heading', { name: 'Your list is in' }).waitFor();
  });
  await p1.context().close();

  const p2 = await newPage();
  await playerClaimAndSend(p2, 'Lucia', 'l', async (page) => {
    await page.getByRole('radio', { name: 'Green' }).click();
    await page.getByRole('tab', { name: 'Exburst link' }).click();
    await page.locator('#deck-link').fill('https://evil.com/deck/1');
    await page.getByText('Only https://exburst.dev links are accepted.').waitFor();
    await page.getByRole('button', { name: 'Submit decklist' }).click();
    await page.getByText('Only https://exburst.dev links are accepted.').first().waitFor();
    await page.locator('#deck-link').fill('https://exburst.dev/ua/en/deck/132316');
    await page.getByRole('button', { name: 'Submit decklist' }).click();
    await page.getByRole('heading', { name: 'Your list is in' }).waitFor();
    await noHorizontalOverflow(page, 'player sent desktop');
  });
  await p2.context().close();

  const p3 = await newPage(MOBILE);
  await playerClaimAndSend(p3, 'Mara', 'm', async (page) => {
    await page.getByRole('radio', { name: 'Red' }).click();
    await page.locator('#deck-text').fill(TXT.replace('REZ-1-001', 'REZ-1-777'));
    await page.getByRole('button', { name: 'Submit decklist' }).click();
    await page.getByRole('heading', { name: 'Your list is in' }).waitFor();
  });
  await p3.context().close();
  // Claimed but no list yet
  const p4 = await newPage(MOBILE);
  await p4.goto(s.link.replace(/^https?:\/\/[^/]+/, srv.base));
  await p4.locator('.claim-row', { hasText: 'Dante' }).getByRole('button', { name: "That's me" }).click();
  await p4.getByRole('button', { name: "Yes, that's me" }).click();
  await p4.getByRole('heading', { name: 'Send your decklist' }).waitFor();
  await p4.context().close();
});

test('organizer: dashboard, edit page, view list, release, undo, download, zip export', async () => {
  const page = await newPage();
  await login(page, 'Organizer 2', 'another-long-pass'); // another organizer sees everything
  await page.getByRole('heading', { name: 'Hotkei Weekly' }).waitFor();
  await page.getByText('4 / 8').waitFor();
  await page.getByText('Created by Hector D.').waitFor();
  await page.getByRole('button', { name: 'Mine only' }).click();
  await page.getByText('Nothing here yet').waitFor();
  await page.getByRole('button', { name: 'All tournaments' }).click();
  await shot(page, '02-dashboard-desktop');
  await noHorizontalOverflow(page, 'dashboard');
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByRole('heading', { name: 'Edit tournament' }).waitFor();
  await page.getByText('4 of 8 lists in').waitFor();
  await shot(page, '07-edit-desktop');
  await noHorizontalOverflow(page, 'edit desktop');
  // rows do not wrap their buttons on desktop
  const heights = await page.locator('.trow').evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
  assert.ok(Math.max(...heights) < 80, 'player rows stay on one line: ' + heights.join(','));
  const xs = await page.locator('.trow .st').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  assert.equal(new Set(xs).size, 1, 'status column is aligned: ' + xs.join(','));

  // view each type
  await page.locator('.trow', { hasText: 'Iris' }).getByRole('button', { name: 'View list' }).click();
  await page.locator('.modal pre').waitFor();
  assert.match(await page.locator('.modal pre').textContent(), /4 x UE24BT\/REZ-1-001/);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('.trow', { hasText: 'Kenji' }).getByRole('button', { name: 'View list' }).click();
  await page.locator('.modal img').waitFor();
  assert.ok(await page.locator('.modal img').evaluate((i) => i.complete && i.naturalWidth === 1080));
  await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('.trow', { hasText: 'Lucia' }).getByRole('button', { name: 'View list' }).click();
  const a = page.locator('.modal a', { hasText: 'Open on Exburst' });
  assert.equal(await a.getAttribute('href'), 'https://exburst.dev/ua/en/deck/132316');
  assert.equal(await a.getAttribute('rel'), 'noopener noreferrer');
  await page.getByRole('button', { name: 'Close' }).click();

  // download one .txt
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.trow', { hasText: 'Iris' }).getByRole('button', { name: 'Download .txt' }).click()]);
  assert.equal(dl.suggestedFilename(), '4 - Iris - Ram + Rem.txt');
  assert.equal(fs.readFileSync(await dl.path(), 'utf8'), TXT);

  // zip export
  const [zdl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export all lists (.zip)' }).click()]);
  assert.equal(zdl.suggestedFilename(), 'Hotkei Weekly - decklists.zip');
  const zp = path.join(os.tmpdir(), 'ds-e2e-' + Date.now() + '.zip');
  fs.copyFileSync(await zdl.path(), zp);
  execFileSync('unzip', ['-tq', zp]);
  const names = execFileSync('unzip', ['-Z1', zp]).toString().trim().split('\n').sort();
  assert.deepEqual(names, ['2 - Mara - Red.txt', '4 - Iris - Ram + Rem.txt', 'summary.csv']);
  const csv = execFileSync('unzip', ['-p', zp, 'summary.csv']).toString('utf8');
  assert.ok(csv.startsWith('\ufeff"Rank","Player"'), JSON.stringify(csv.slice(0, 30)));
  assert.match(csv, /"3","Dante","4-1","","","no list",""/);
  assert.match(csv, /"1","Kenji","5-0","","Blue","image",""/);
  assert.match(csv, /https:\/\/exburst\.dev\/ua\/en\/deck\/132316/);
  assert.equal(execFileSync('unzip', ['-p', zp, '2 - Mara - Red.txt']).toString('utf8'), TXT.replace('REZ-1-001', 'REZ-1-777'));
  fs.unlinkSync(zp);

  // release list -> player can send again; undo re-locks
  await page.locator('.trow', { hasText: 'Iris' }).getByRole('button', { name: 'Release list' }).click();
  await page.locator('.trow', { hasText: 'Iris' }).getByText('Reopened').waitFor();
  await page.locator('.trow', { hasText: 'Iris' }).getByRole('button', { name: 'Undo release' }).click();
  await page.locator('.trow', { hasText: 'Iris' }).getByText('List sent · locked').waitFor();
  await page.locator('.trow', { hasText: 'Iris' }).getByRole('button', { name: 'Release list' }).click();
  await page.locator('.trow', { hasText: 'Iris' }).getByText('Reopened').waitFor();

  // release name of Dante
  await page.locator('.trow', { hasText: 'Dante' }).getByRole('button', { name: 'Release name' }).click();
  await page.locator('.trow', { hasText: 'Dante' }).getByText('Not claimed yet').waitFor();

  // release the name of a player who already sent a list, from inside the Edit dialog
  await page.locator('.trow', { hasText: 'Mara' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Release name so someone else can claim it' }).click();
  await page.locator('.modal').waitFor({ state: 'detached' });
  await page.locator('.trow', { hasText: 'Mara' }).getByText('Reopened').waitFor();

  // edit player, add late player, remove player
  await page.locator('.trow', { hasText: 'Nadia' }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#p-name').fill('Nadia B.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.trow', { hasText: 'Nadia B.' }).waitFor();
  await page.getByRole('button', { name: 'Add late player' }).click();
  await page.locator('#a-name').fill('Late Larry');
  await page.getByRole('button', { name: 'Add player' }).click();
  await page.locator('.trow', { hasText: 'Late Larry' }).waitFor();
  await page.locator('.trow', { hasText: 'Late Larry' }).getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
  await page.locator('.trow', { hasText: 'Late Larry' }).waitFor({ state: 'detached' });
  // invalid edit shows the server message inside the dialog
  await page.locator('.trow', { hasText: 'Nadia B.' }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#p-name').fill('=SUM(1)');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('cannot start with').waitFor();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.context().close();
});

test('player whose list was reopened sees the form again and can replace it', async () => {
  const t = srv.gas.post({ action: 'login', name: 'Hector D.', password: PW }).data.token;
  const page = await newPage(MOBILE);
  await page.goto(srv.base + '/#/e/' + s.eventId);
  await page.locator('.claim-row', { hasText: 'Tomas' }).getByRole('button', { name: "That's me" }).click();
  await page.getByRole('button', { name: "Yes, that's me" }).click();
  await page.getByRole('radio', { name: 'Purple' }).click();
  await page.locator('#deck-text').fill(TXT);
  await page.getByRole('button', { name: 'Submit decklist' }).click();
  await page.getByRole('heading', { name: 'Your list is in' }).waitFor();
  const tomas = srv.gas.post({ action: 'getEventAdmin', token: t, eventId: s.eventId }).data.players.find((p) => p.name === 'Tomas');
  srv.gas.post({ action: 'releaseList', token: t, eventId: s.eventId, playerId: tomas.playerId });
  await page.reload();
  await page.getByText('The organizer reopened your list').waitFor();
  await page.getByRole('radio', { name: 'Blue' }).click();
  await page.getByRole('tab', { name: 'Exburst link' }).click();
  await page.locator('#deck-link').fill('https://exburst.dev/ua/en/deck/42');
  await page.getByRole('button', { name: 'Submit decklist' }).click();
  await page.getByRole('heading', { name: 'Your list is in' }).waitFor();
  await page.getByText('Blue').first().waitFor();
  await shot(page, '06b-player-resent-mobile');
  // stale validation errors disappear when the player edits
  await page.context().close();
  const dl = srv.gas.post({ action: 'getDecklists', token: t, eventId: s.eventId }).data.entries.find((e) => e.name === 'Tomas');
  assert.equal(dl.deck.type, 'link');
  srv.gas.post({ action: 'releaseName', token: t, eventId: s.eventId, playerId: tomas.playerId });
  srv.gas.post({ action: 'removePlayer', token: t, eventId: s.eventId, playerId: tomas.playerId });
});

test('organizer: edit page on mobile has no horizontal overflow', async () => {
  const page = await newPage(MOBILE);
  await login(page);
  await page.goto(srv.base + '/#/edit/' + s.eventId);
  await page.getByRole('heading', { name: 'Edit tournament' }).waitFor();
  await noHorizontalOverflow(page, 'edit mobile');
  await shot(page, '07-edit-mobile');
  await page.goto(srv.base + '/#/dashboard');
  await page.getByRole('heading', { name: 'Hotkei Weekly' }).waitFor();
  await noHorizontalOverflow(page, 'dashboard mobile');
  await shot(page, '02-dashboard-mobile');
  await page.context().close();
});

test('presentation: slides for text, image and link; keyboard; zoom; no horizontal overflow', async () => {
  const page = await newPage({ viewport: { width: 1280, height: 720 } });
  await login(page);
  await page.goto(srv.base + '/#/present/' + s.eventId);
  await page.locator('.pres-name').waitFor();
  const names = [];
  const count = Number((await page.locator('.count').textContent()).split('/')[1]);
  assert.equal(count, 4, 'only players with a list are presented');
  for (let k = 0; k < count; k++) {
    names.push(await page.locator('.pres-name').textContent());
    const kind = await page.locator('.pres-panel-head span').textContent();
    if (k === 0) { // rank 1 Kenji -> image
      await page.locator('.pres-photo img').waitFor();
      await shot(page, '09-present-photo', false);
      await page.keyboard.press('z');
      await page.locator('.pres-zoom img').waitFor();
      await shot(page, '09b-present-zoom', false);
      await page.keyboard.press('Escape');
      await page.locator('.pres-zoom').waitFor({ state: 'detached' });
    }
    if (/text|cards/.test(kind) && k > 0) {
      assert.ok((await page.locator('.cardrow').count()) >= 13);
      const box = await page.locator('.cardlist').boundingBox();
      const rows = await page.locator('.cardrow').evaluateAll((r) => r.map((x) => { const b = x.getBoundingClientRect(); return b.bottom; }));
      assert.ok(Math.max(...rows) <= box.y + box.height + 1, 'rows stay inside the panel');
      const cutN = await page.locator('.cardrow .c').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length);
      assert.equal(cutN, 0, 'no card code is truncated');
      if (k === 2) await shot(page, '08-present-text', false);
    }
    if (/link/.test(kind)) {
      assert.equal(await page.getByRole('link', { name: /Open on Exburst/ }).getAttribute('href'), 'https://exburst.dev/ua/en/deck/132316');
      await shot(page, '10-present-link', false);
    }
    await page.keyboard.press('ArrowRight');
  }
  assert.deepEqual(names.slice().sort(), ['Iris', 'Kenji', 'Lucia', 'Mara']);
  assert.equal(await page.locator('.count').textContent(), '4 / 4', 'does not go past the last slide');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('.count').textContent(), '3 / 4');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('.count').textContent(), '1 / 4');
  await noHorizontalOverflow(page, 'present');
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Your tournaments' }).waitFor();
  await page.context().close();
});

test('presentation with a long deck (30 different cards) uses 3 columns and stays inside the panel', async () => {
  const { eventId } = await seedBig();
  const page = await newPage({ viewport: { width: 1280, height: 720 } });
  await login(page);
  await page.goto(srv.base + '/#/present/' + eventId);
  await page.locator('.cardlist').waitFor();
  const cols = await page.locator('.cardlist').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(cols, 3);
  const box = await page.locator('.cardlist').boundingBox();
  const bottoms = await page.locator('.cardrow').evaluateAll((r) => r.map((x) => x.getBoundingClientRect().bottom));
  assert.ok(Math.max(...bottoms) <= box.y + box.height + 1);
  const cut = await page.locator('.cardrow .c').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length);
  assert.equal(cut, 0, 'no card code is truncated');
  await shot(page, '08b-present-text-long', false);
  await page.context().close();
});

async function seedBig() {
  const g = srv.gas;
  const t = g.post({ action: 'login', name: 'Hector D.', password: PW }).data.token;
  const r = g.post({ action: 'createEvent', token: t, name: 'Big Deck Cup', datePlayed: '2026-10-10', expireDays: 14, resultsText: 'Ana\nBen' });
  const eventId = r.data.eventId;
  const ev = g.post({ action: 'getEvent', eventId }).data;
  const secret = 'Z'.repeat(32);
  g.post({ action: 'claimPlayer', eventId, playerId: ev.players[0].playerId, secret });
  const lines = Array.from({ length: 30 }, (_, i) => `${i < 20 ? 1 : 2} x UE01BT/ABC-1-${String(i + 1).padStart(3, '0')}`).join('\n');
  const sub = g.post({ action: 'submitDeck', eventId, playerId: ev.players[0].playerId, secret, type: 'txt', deckName: 'Long', deckColor: 'Purple', content: '// Main deck\n' + lines });
  assert.equal(sub.ok, true, JSON.stringify(sub));
  return { eventId };
}

test('XSS: names, deck names and list text with HTML never execute, on every screen', async () => {
  const g = srv.gas;
  const t = g.post({ action: 'login', name: 'Hector D.', password: PW }).data.token;
  const evil = '<img src=x onerror="window.__pwned=1">';
  const r = g.post({ action: 'createEvent', token: t, name: evil + ' Cup', datePlayed: '2026-10-10', expireDays: 14, resultsText: evil + ' 5-0\n"><script>window.__pwned=2</script>' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const eventId = r.data.eventId;
  const ev = g.post({ action: 'getEvent', eventId }).data;
  const secret = 'Y'.repeat(32);
  g.post({ action: 'claimPlayer', eventId, playerId: ev.players[0].playerId, secret });
  const sub = g.post({
    action: 'submitDeck', eventId, playerId: ev.players[0].playerId, secret, type: 'txt', deckName: evil, deckColor: 'Red',
    content: '// Main deck\n4 x <svg onload=window.__pwned=3>\n3 <b>bold</b>'
  });
  assert.equal(sub.ok, true, JSON.stringify(sub));
  const page = await newPage();
  page.on('dialog', (d) => { consoleErrors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto(srv.base + '/#/e/' + eventId);
  await page.getByRole('heading', { name: 'Find your name' }).waitFor();
  await login(page);
  await page.getByRole('heading', { name: 'Your tournaments' }).waitFor();
  for (const hash of ['#/dashboard', '#/edit/' + eventId, '#/present/' + eventId]) {
    await page.goto(srv.base + '/' + hash);
    await page.waitForTimeout(600);
  }
  await page.locator('.pres-name').waitFor();
  assert.match(await page.locator('.pres-name').textContent(), /<img src=x/, 'shown as text');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('[onerror],[onload],script:not([src])').count(), 0, 'no injected elements or handlers');
  assert.equal(await page.locator('.cardlist b').count(), 0, 'list text is not parsed as HTML');
  await page.context().close();
  g.post({ action: 'deleteEvent', token: g.post({ action: 'login', name: 'Hector D.', password: PW }).data.token, eventId });
});

test('errors: network failure, garbage answer, closed tournament, expired session, expired event', async () => {
  const page = await newPage();
  await page.goto(srv.base + '/#/');
  await page.getByLabel('Name').fill('Hector D.');
  await page.getByLabel('Password').fill(PW);
  await page.route('**/api', (r) => r.abort('failed'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText("Can't reach the server.").waitFor();
  await page.unroute('**/api');
  srv.state.failNext = '<html>Google error page</html>';
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('unexpected answer').waitFor();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Your tournaments' }).waitFor();

  // closed tournament: players see the notice and no claim buttons
  const t = srv.gas.post({ action: 'login', name: 'Hector D.', password: PW }).data.token;
  srv.gas.post({ action: 'setStatus', token: t, eventId: s.eventId, status: 'closed' });
  const pl = await newPage(MOBILE);
  await pl.goto(srv.base + '/#/e/' + s.eventId);
  await pl.getByText('no longer accepting lists').waitFor();
  assert.equal(await pl.getByRole('button', { name: "That's me" }).count(), 0);
  await shot(pl, '11-player-closed-mobile');
  await pl.context().close();
  srv.gas.post({ action: 'setStatus', token: t, eventId: s.eventId, status: 'open' });

  // session expiry (server forgets the token) -> back to login with a notice
  srv.gas.advance(7 * 3600 * 1000);
  await page.goto(srv.base + '/#/new');
  await page.goto(srv.base + '/#/dashboard');
  await page.getByText('Your session expired. Please sign in again.').waitFor();
  await page.getByRole('heading', { name: 'Organizer sign-in' }).waitFor();

  // expired event: friendly not-found for players
  srv.gas.advance(30 * 86400000);
  const p2 = await newPage(MOBILE);
  await p2.goto(srv.base + '/#/e/' + s.eventId);
  await p2.getByText('Tournament not found').waitFor();
  await p2.context().close();
  await page.context().close();
});

test('branding and refresh buttons: name, logo fallback, dashboard / edit / player / presentation refresh without reloading the browser', async () => {
  const t = srv.gas.post({ action: 'login', name: 'Hector D.', password: PW }).data.token;
  const ev = srv.gas.post({ action: 'createEvent', token: t, name: 'Refresh Cup', datePlayed: '2026-10-11', expireDays: 14, resultsText: 'Uno\nDos\nTres' }).data.eventId;
  const page = await newPage();
  await login(page);
  assert.equal(await page.title(), 'CapyBurst Decklist Showcase');
  assert.match(await page.locator('.brand span').textContent(), /CAPYBURST DECKLIST SHOWCASE/);
  assert.equal(await page.locator('.brand img.brand-logo').count(), 1);
  await shot(page, '12-branding-desktop');
  // dashboard picks up an event created elsewhere
  srv.gas.post({ action: 'createEvent', token: t, name: 'Created Elsewhere', datePlayed: '2026-10-11', expireDays: 14, resultsText: 'A\nB' });
  assert.equal(await page.getByRole('heading', { name: 'Created Elsewhere' }).count(), 0);
  await page.getByRole('button', { name: /Refresh/ }).click();
  await page.getByRole('heading', { name: 'Created Elsewhere' }).waitFor();
  // edit page shows a claim made by a player in the meantime
  await page.goto(srv.base + '/#/edit/' + ev);
  await page.getByRole('heading', { name: 'Edit tournament' }).waitFor();
  const ps = srv.gas.post({ action: 'getEvent', eventId: ev }).data.players;
  srv.gas.post({ action: 'claimPlayer', eventId: ev, playerId: ps[0].playerId, secret: 'Q'.repeat(32) });
  await page.locator('.trow', { hasText: 'Uno' }).getByText('Not claimed yet').waitFor();
  await page.getByRole('button', { name: /Refresh/ }).click();
  await page.locator('.trow', { hasText: 'Uno' }).getByText('Claimed · no list yet').waitFor();
  // player page
  const pl = await newPage(MOBILE);
  await pl.goto(srv.base + '/#/e/' + ev);
  await pl.locator('.claim-row', { hasText: 'Dos' }).getByRole('button', { name: "That's me" }).waitFor();
  srv.gas.post({ action: 'claimPlayer', eventId: ev, playerId: ps[1].playerId, secret: 'R'.repeat(32) });
  await pl.getByRole('button', { name: /Refresh/ }).click();
  await pl.locator('.claim-row', { hasText: 'Dos' }).getByText(/Claimed/).waitFor();
  // a player filling the form is never refreshed under their hands: typed text survives the 60 s timer's guard
  await pl.locator('.claim-row', { hasText: 'Tres' }).getByRole('button', { name: "That's me" }).click();
  await pl.getByRole('button', { name: "Yes, that's me" }).click();
  await pl.locator('#deck-text').fill('4 x ABC');
  await pl.getByText('Send your decklist').waitFor();
  assert.equal(await pl.getByRole('button', { name: /Refresh/ }).count(), 0, 'no refresh button inside the form');
  await pl.context().close();
  // presentation: Reload (R) brings new lists and keeps the position
  const g = srv.gas;
  g.post({ action: 'submitDeck', eventId: ev, playerId: ps[0].playerId, secret: 'Q'.repeat(32), type: 'txt', deckColor: 'Red', content: '// Main deck\n4 x AAA-1' });
  await page.goto(srv.base + '/#/present/' + ev);
  await page.locator('.pres-name').waitFor();
  assert.equal(await page.locator('.count').textContent(), '1 / 1');
  g.post({ action: 'submitDeck', eventId: ev, playerId: ps[1].playerId, secret: 'R'.repeat(32), type: 'link', deckColor: 'Blue', content: 'https://exburst.dev/ua/en/deck/9' });
  await page.keyboard.press('r');
  await page.locator('.count', { hasText: '1 / 2' }).waitFor();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Reload (R)' }).click();
  await page.locator('.count', { hasText: '2 / 2' }).waitFor();
  assert.match(await page.locator('.pres-top .app').textContent(), /CapyBurst Decklist Showcase/);
  await page.context().close();
  g.post({ action: 'deleteEvent', token: t, eventId: ev });
});

test('logo falls back to the built-in icon when the configured file is missing', async () => {
  const page = await newPage();
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.DS_CONFIG={API_URL:'/api',APP_NAME:'X Showcase',LOGO_URL:'assets/does-not-exist.png'};" }));
  await page.goto(srv.base + '/#/');
  await page.locator('.brand svg').waitFor();
  assert.equal(await page.locator('.brand img').count(), 0);
  assert.match(await page.locator('.brand span').textContent(), /X SHOWCASE/);
  await page.context().close();
});

test('no unexpected console errors during the whole run', () => {
  assert.deepEqual(consoleErrors, []);
});
