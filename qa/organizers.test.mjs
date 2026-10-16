import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBackend, login, newEvent, PW } from './helpers.mjs';

const err = (r, code) => {
  assert.equal(r.ok, false, 'expected failure: ' + JSON.stringify(r));
  if (code) assert.equal(r.error.code, code, JSON.stringify(r));
};
const ok = (r) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
};
const loginFull = (gas, name, password) => gas.post({ action: 'login', name, password });

function setup() {
  const gas = freshBackend(); // 'Hector D.' is admin, 'Organizer 2' is a normal organizer
  const admin = login(gas);
  const plain = login(gas, 'Organizer 2', 'another-long-pass');
  return { gas, admin, plain };
}
const create = (gas, token, name, role) => gas.post({ action: 'createOrganizer', token, name, role });

test('login tells the browser the role; plain organizers are not admins', () => {
  const { gas } = setup();
  assert.equal(ok(loginFull(gas, 'Hector D.', PW)).organizer.role, 'admin');
  const o2 = ok(loginFull(gas, 'Organizer 2', 'another-long-pass')).organizer;
  assert.equal(o2.role, 'organizer');
  assert.equal(o2.mustChange, false);
});

test('only administrators can use the team actions (role is read from the sheet, not from the browser)', () => {
  const { gas, plain } = setup();
  for (const body of [
    { action: 'listOrganizers' }, { action: 'createOrganizer', name: 'Eve' },
    { action: 'resetOrganizerPassword', organizerId: 'abcdef12' },
    { action: 'setOrganizerActive', organizerId: 'abcdef12', active: false },
    { action: 'setOrganizerRole', organizerId: 'abcdef12', role: 'admin' }
  ]) err(gas.post({ ...body, token: plain }), 'forbidden');
  // Fields a hostile browser might add are ignored.
  err(gas.post({ action: 'listOrganizers', token: plain, role: 'admin', isAdmin: true }), 'forbidden');
  err(gas.post({ action: 'listOrganizers' }), 'unauthorized');
  assert.equal(gas.table('Organizers').length, 2);
});

test('admin creates an organizer: temporary password shown once, stored only as a hash', () => {
  const { gas, admin } = setup();
  const r = ok(create(gas, admin, 'Kenji'));
  assert.match(r.tempPassword, /^[a-km-z2-9]{4}-[a-km-z2-9]{4}-[a-km-z2-9]{4}$/);
  assert.equal(r.validHours, 72);
  assert.ok(!JSON.stringify(gas.table('Organizers')).includes(r.tempPassword), 'not stored in clear');
  assert.ok(!JSON.stringify(gas.state.logs).includes(r.tempPassword), 'not logged');
  assert.ok(!JSON.stringify(gas.table('Audit')).includes(r.tempPassword), 'not in the audit trail');
  const list = ok(gas.post({ action: 'listOrganizers', token: admin }));
  assert.ok(!JSON.stringify(list).match(/Hash|Salt|tempPassword/), 'the list never exposes secrets');
  const kenji = list.find((o) => o.name === 'Kenji');
  assert.equal(kenji.tempPending, true);
  assert.equal(kenji.role, 'organizer');
  assert.equal(gas.table('Audit').filter((a) => a[3] === 'orgCreate').length, 1);
});

test('create: duplicate names (any case), formulas, empty and over-long names are refused', () => {
  const { gas, admin } = setup();
  err(create(gas, admin, 'hector d.'), 'exists');
  err(create(gas, admin, '=cmd'), 'invalid');
  err(create(gas, admin, '   '), 'invalid');
  err(create(gas, admin, 'x'.repeat(61)), 'invalid');
  err(gas.post({ action: 'createOrganizer', token: admin, name: { a: 1 } }), 'invalid');
  assert.equal(gas.table('Organizers').length, 2);
});

test('temporary passwords are random and long enough', () => {
  const { gas, admin } = setup();
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(ok(create(gas, admin, 'User' + i)).tempPassword);
  assert.equal(seen.size, 20);
});

test('first sign-in with a temporary password: only changePassword, whoami and logout work', () => {
  const { gas, admin } = setup();
  const { tempPassword } = ok(create(gas, admin, 'Kenji'));
  const r = ok(loginFull(gas, 'Kenji', tempPassword));
  assert.equal(r.organizer.mustChange, true);
  err(gas.post({ action: 'listEvents', token: r.token }), 'password_change_required');
  err(gas.post({ action: 'createEvent', token: r.token, name: 'x' }), 'password_change_required');
  err(gas.post({ action: 'listOrganizers', token: r.token }), 'password_change_required');
  assert.equal(ok(gas.post({ action: 'whoami', token: r.token })).organizer.mustChange, true);
});

test('changePassword: wrong current is refused and counted; right one frees the account and issues a new session', () => {
  const { gas, admin } = setup();
  const { tempPassword } = ok(create(gas, admin, 'Kenji'));
  const first = ok(loginFull(gas, 'Kenji', tempPassword));
  err(gas.post({ action: 'changePassword', token: first.token, currentPassword: 'nope-nope-nope', newPassword: 'my-own-password' }), 'bad_password');
  err(gas.post({ action: 'changePassword', token: first.token, currentPassword: tempPassword, newPassword: 'short' }), 'invalid');
  err(gas.post({ action: 'changePassword', token: first.token, currentPassword: tempPassword, newPassword: tempPassword }), 'invalid');
  const done = ok(gas.post({ action: 'changePassword', token: first.token, currentPassword: tempPassword, newPassword: 'my-own-password' }));
  assert.equal(done.organizer.mustChange, false);
  ok(gas.post({ action: 'listEvents', token: done.token }));
  err(gas.post({ action: 'listEvents', token: first.token }), 'unauthorized'); // old session is gone
  err(loginFull(gas, 'Kenji', tempPassword), 'bad_login'); // temp password no longer works
  ok(loginFull(gas, 'Kenji', 'my-own-password'));
  const row = gas.table('Organizers').find((r) => r[1] === 'Kenji');
  assert.equal(row[7], '', 'TempUntil cleared');
  assert.ok(!JSON.stringify(gas.table('Organizers')).includes('my-own-password'));
});

test('changePassword: a stolen token can not guess the current password (5 tries then locked)', () => {
  const { gas, plain } = setup();
  for (let i = 0; i < 5; i++) {
    err(gas.post({ action: 'changePassword', token: plain, currentPassword: 'guess-guess-' + i, newPassword: 'whatever-long' }), 'bad_password');
  }
  err(gas.post({ action: 'changePassword', token: plain, currentPassword: 'another-long-pass', newPassword: 'whatever-long' }), 'locked');
  err(loginFull(gas, 'Organizer 2', 'another-long-pass'), 'locked');
});

test('changing the password ends every other session of that person', () => {
  const { gas, plain } = setup();
  const other = login(gas, 'Organizer 2', 'another-long-pass');
  const r = ok(gas.post({ action: 'changePassword', token: plain, currentPassword: 'another-long-pass', newPassword: 'a-new-long-pass' }));
  err(gas.post({ action: 'listEvents', token: other }), 'unauthorized');
  ok(gas.post({ action: 'listEvents', token: r.token }));
});

test('temporary password expires after 72 hours', () => {
  const { gas, admin } = setup();
  const { tempPassword } = ok(create(gas, admin, 'Kenji'));
  const live = ok(loginFull(gas, 'Kenji', tempPassword));
  gas.advance(73 * 3600 * 1000);
  err(gas.post({ action: 'changePassword', token: live.token, currentPassword: tempPassword, newPassword: 'my-own-password' }), 'unauthorized');
  err(loginFull(gas, 'Kenji', tempPassword), 'temp_expired');
  const adminAgain = login(gas) || ok(loginFull(gas, 'Hector D.', PW)).token;
  assert.ok(adminAgain);
});

test('reset: new temporary password, old password and sessions stop working, lockout is cleared', () => {
  const { gas, admin, plain } = setup();
  for (let i = 0; i < 5; i++) err(loginFull(gas, 'Organizer 2', 'bad-bad-bad'), 'bad_login');
  err(loginFull(gas, 'Organizer 2', 'another-long-pass'), 'locked');
  const id = ok(gas.post({ action: 'listOrganizers', token: admin })).find((o) => o.name === 'Organizer 2').id;
  const r = ok(gas.post({ action: 'resetOrganizerPassword', token: admin, organizerId: id }));
  err(gas.post({ action: 'listEvents', token: plain }), 'unauthorized');
  err(loginFull(gas, 'Organizer 2', 'another-long-pass'), 'bad_login');
  assert.equal(ok(loginFull(gas, 'Organizer 2', r.tempPassword)).organizer.mustChange, true);
});

test('reset: an admin can not reset themself (they use Change password); unknown ids fail cleanly', () => {
  const { gas, admin } = setup();
  const me = ok(gas.post({ action: 'listOrganizers', token: admin })).find((o) => o.isMe);
  assert.equal(me.name, 'Hector D.');
  err(gas.post({ action: 'resetOrganizerPassword', token: admin, organizerId: me.id }), 'invalid');
  err(gas.post({ action: 'resetOrganizerPassword', token: admin, organizerId: 'abcdef12' }), 'not_found');
  err(gas.post({ action: 'resetOrganizerPassword', token: admin, organizerId: '../x' }), 'invalid');
});

test('disable: ends the session at once, blocks login, can be undone; cannot disable yourself', () => {
  const { gas, admin, plain } = setup();
  const list = ok(gas.post({ action: 'listOrganizers', token: admin }));
  const o2 = list.find((o) => o.name === 'Organizer 2');
  const me = list.find((o) => o.isMe);
  err(gas.post({ action: 'setOrganizerActive', token: admin, organizerId: me.id, active: false }), 'invalid');
  ok(gas.post({ action: 'setOrganizerActive', token: admin, organizerId: o2.id, active: false }));
  err(gas.post({ action: 'listEvents', token: plain }), 'unauthorized');
  err(loginFull(gas, 'Organizer 2', 'another-long-pass'), 'bad_login');
  ok(gas.post({ action: 'setOrganizerActive', token: admin, organizerId: o2.id, active: true }));
  ok(loginFull(gas, 'Organizer 2', 'another-long-pass'));
  err(gas.post({ action: 'setOrganizerActive', token: admin, organizerId: o2.id, active: 'no' }), 'invalid');
});

test('roles: promote, demote, and the last active administrator can never be removed', () => {
  const { gas, admin, plain } = setup();
  const list = ok(gas.post({ action: 'listOrganizers', token: admin }));
  const o2 = list.find((o) => o.name === 'Organizer 2');
  const me = list.find((o) => o.isMe);
  err(gas.post({ action: 'setOrganizerRole', token: admin, organizerId: me.id, role: 'organizer' }), 'last_admin');
  err(gas.post({ action: 'setOrganizerRole', token: admin, organizerId: o2.id, role: 'root' }), 'invalid');
  ok(gas.post({ action: 'setOrganizerRole', token: admin, organizerId: o2.id, role: 'admin' }));
  ok(gas.post({ action: 'listOrganizers', token: plain })); // takes effect on the very next call, same session
  // now there are two admins: the first may step down, the second may not
  ok(gas.post({ action: 'setOrganizerRole', token: plain, organizerId: me.id, role: 'organizer' }));
  err(gas.post({ action: 'listOrganizers', token: admin }), 'forbidden');
  err(gas.post({ action: 'setOrganizerRole', token: plain, organizerId: o2.id, role: 'organizer' }), 'last_admin');
  err(gas.post({ action: 'setOrganizerActive', token: plain, organizerId: o2.id, active: false }), 'invalid'); // not yourself
});

test('a disabled administrator does not count as an available administrator', () => {
  const { gas, admin } = setup();
  const o2 = ok(gas.post({ action: 'listOrganizers', token: admin })).find((o) => o.name === 'Organizer 2');
  ok(gas.post({ action: 'setOrganizerRole', token: admin, organizerId: o2.id, role: 'admin' }));
  ok(gas.post({ action: 'setOrganizerActive', token: admin, organizerId: o2.id, active: false }));
  const me = ok(gas.post({ action: 'listOrganizers', token: admin })).find((o) => o.isMe);
  err(gas.post({ action: 'setOrganizerRole', token: admin, organizerId: me.id, role: 'organizer' }), 'last_admin');
});

test('editor functions: makeAdminFromProperties cleans its property; addOrganizer keeps working as before', () => {
  const { gas, plain } = setup();
  err(gas.post({ action: 'listOrganizers', token: plain }), 'forbidden');
  gas.state.props.set('ADMIN_ORG_NAME', 'organizer 2');
  gas.run('makeAdminFromProperties');
  assert.equal(gas.state.props.has('ADMIN_ORG_NAME'), false);
  ok(gas.post({ action: 'listOrganizers', token: plain }));
  gas.state.props.set('ADMIN_ORG_NAME', 'Nobody');
  assert.throws(() => gas.run('makeAdminFromProperties'), /not found/);
  assert.equal(gas.state.props.has('ADMIN_ORG_NAME'), false);
  assert.throws(() => gas.run('addOrganizer', 'Short', '1234567'), /at least 8/);
  // an editor-set password is final and clears any pending temporary state
  const { tempPassword } = ok(create(gas, plain, 'Zed'));
  gas.run('addOrganizer', 'Zed', 'editor-set-pass');
  assert.equal(ok(loginFull(gas, 'Zed', 'editor-set-pass')).organizer.mustChange, false);
  err(loginFull(gas, 'Zed', tempPassword), 'bad_login');
});

test('upgrade path: rows written before roles existed (blank Role/TempUntil) still work as normal organizers', () => {
  const { gas } = setup();
  const sh = gas.state.sheets.get(gas.state.props.get('SHEET_ID')).sheets.get('Organizers');
  sh.cells.forEach((row) => { row.length = 6; }); // as an old sheet would have them
  const r = ok(loginFull(gas, 'Organizer 2', 'another-long-pass'));
  assert.equal(r.organizer.role, 'organizer');
  assert.equal(r.organizer.mustChange, false);
  ok(gas.post({ action: 'listEvents', token: r.token }));
});

test('organizer limit and tournament data are untouched by team changes', () => {
  const { gas, admin } = setup();
  const eventId = newEvent(gas, admin);
  const o2 = ok(gas.post({ action: 'listOrganizers', token: admin })).find((o) => o.name === 'Organizer 2');
  ok(gas.post({ action: 'setOrganizerActive', token: admin, organizerId: o2.id, active: false }));
  const evs = ok(gas.post({ action: 'listEvents', token: admin }));
  assert.equal(evs.length, 1);
  assert.equal(evs[0].eventId, eventId);
  for (let i = 0; i < 48; i++) ok(create(gas, admin, 'Bulk' + i));
  err(create(gas, admin, 'OneTooMany'), 'limit');
});
