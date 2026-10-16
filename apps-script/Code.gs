/**
 * Decklist Showcase v0.1 - JSON API on Google Apps Script.
 *
 * Deploy: Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * First run (in the editor): run `setup`, then add organizers (see addOrganizerFromProperties).
 * Parsers.gs is generated from shared/parsers.js. Do not edit it by hand.
 */

var VERSION = '0.2.0';
var SESSION_TTL_SEC = 21600; // 6 h (CacheService maximum)
var LOGIN_MAX_FAILS = 5;
var LOGIN_LOCK_SEC = 900;
var MIN_PASSWORD = 8;
var LOCK_WAIT_MS = 10000;
var MAX_BODY_CHARS = 3000000;
var DEFAULT_EXPIRE_DAYS = 14;
var MAX_EXPIRE_DAYS = 90;
var AUDIT_KEEP_DAYS = 90;
var TEMP_PASSWORD_HOURS = 72;
var MAX_ORGANIZERS = 50;
// A person whose temporary password is pending can only call these.
var ALLOWED_WHILE_TEMP = { changePassword: 1, logout: 1, whoami: 1 };
var TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // 31 symbols, no look-alikes

var SCHEMA = {
  // Role: 'admin' or ''. TempUntil: ISO time until which a temporary password works; '' once the person chose their own.
  Organizers: ['OrganizerID', 'Name', 'PassSalt', 'PassHash', 'Active', 'CreatedAt', 'Role', 'TempUntil'],
  Events: ['EventID', 'Name', 'DatePlayed', 'CreatedBy', 'CreatedAt', 'ExpiresAt', 'Status', 'FolderID', 'ExburstUrl'],
  Players: ['PlayerID', 'EventID', 'Rank', 'Name', 'Record', 'ClaimHash', 'ClaimedAt', 'CurrentDeckID', 'ListLocked'],
  Decklists: ['DeckID', 'EventID', 'PlayerID', 'Type', 'DeckName', 'DeckColor', 'Content', 'FileID', 'SubmittedAt'],
  Audit: ['At', 'EventID', 'Actor', 'Action', 'Detail'],
  Config: ['Key', 'Value']
};

var PUBLIC_ACTIONS = { ping: 1, getEvent: 1, claimPlayer: 1, submitDeck: 1, login: 1 };

// ---------------------------------------------------------------- errors

function ApiError(code, message) {
  this.name = 'ApiError';
  this.code = code;
  this.message = message;
}
ApiError.prototype = Object.create(Error.prototype);

function fail_(code, message) {
  throw new ApiError(code, message);
}

// ---------------------------------------------------------------- entry points

function doGet(e) {
  return respond_({ ok: true, data: { name: 'Decklist Showcase API', version: VERSION } });
}

function doPost(e) {
  var body;
  try {
    var raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || raw.length === 0) fail_('bad_request', 'Empty request.');
    if (raw.length > MAX_BODY_CHARS) fail_('too_large', 'Request is too large.');
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail_('bad_request', 'Invalid request.');
  } catch (err) {
    if (err instanceof ApiError) return respond_(errorBody_(err));
    return respond_(errorBody_(new ApiError('bad_request', 'Invalid JSON.')));
  }
  return respond_(dispatch_(body));
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorBody_(err) {
  return { ok: false, error: { code: err.code, message: err.message } };
}

function dispatch_(body) {
  try {
    var action = String(body.action || '');
    var handler = HANDLERS[action];
    if (!handler) fail_('unknown_action', 'Unknown action.');
    var ctx = {};
    if (!PUBLIC_ACTIONS[action]) {
      ctx.organizer = requireSession_(body.token);
      if (ctx.organizer.mustChange && !ALLOWED_WHILE_TEMP[action]) {
        fail_('password_change_required', 'Choose your own password first.');
      }
    }
    return { ok: true, data: handler(body, ctx) };
  } catch (err) {
    if (err instanceof ApiError) return errorBody_(err);
    console.error(err && err.stack ? err.stack : String(err));
    return errorBody_(new ApiError('server_error', 'Something went wrong. Try again.'));
  }
}

// ---------------------------------------------------------------- small utils

function nowIso_() {
  return new Date().toISOString();
}

function toHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

function sha256_(text) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
}

function newId_(len) {
  var s = '';
  while (s.length < len) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, len);
}

function safeEqual_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reqStr_(v, field, max, required) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') fail_('invalid', field + ' must be text.');
  v = v.replace(/\s+/g, ' ').trim();
  if (required && !v) fail_('invalid', field + ' is required.');
  if (v.length > max) fail_('invalid', field + ' is too long (max ' + max + ').');
  if (startsWithFormulaChar(v)) fail_('invalid', field + ' cannot start with =, + or @.');
  if (/[\u0000-\u001f]/.test(v)) fail_('invalid', field + ' has invalid characters.');
  return v;
}

function reqId_(v, field) {
  if (typeof v !== 'string' || !/^[a-f0-9]{6,32}$/.test(v)) fail_('invalid', 'Invalid ' + field + '.');
  return v;
}

function reqDate_(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail_('invalid', 'Date must be YYYY-MM-DD.');
  var p = v.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (d.getUTCFullYear() !== p[0] || d.getUTCMonth() !== p[1] - 1 || d.getUTCDate() !== p[2]) {
    fail_('invalid', 'That date does not exist.');
  }
  return v;
}

function reqExpireDays_(v) {
  if (v === undefined || v === null || v === '') return configInt_('DefaultExpireDays', DEFAULT_EXPIRE_DAYS);
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > MAX_EXPIRE_DAYS) {
    fail_('invalid', 'Auto-delete days must be a whole number from 1 to ' + MAX_EXPIRE_DAYS + '.');
  }
  return n;
}

function reqSecret_(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{24,128}$/.test(v)) fail_('invalid', 'Invalid claim secret.');
  return v;
}

function addDays_(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86400000).toISOString();
}

// ---------------------------------------------------------------- storage layer

var ctxCache_ = null;

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function ss_() {
  if (!ctxCache_) ctxCache_ = {};
  if (!ctxCache_.ss) {
    var id = prop_('SHEET_ID');
    if (!id) fail_('not_setup', 'The backend is not set up yet. Run setup() in the Apps Script editor.');
    ctxCache_.ss = SpreadsheetApp.openById(id);
  }
  return ctxCache_.ss;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) fail_('not_setup', 'Missing sheet ' + name + '. Run setup().');
  return sh;
}

function readAll_(name) {
  var sh = sheet_(name);
  var headers = SCHEMA[name];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var o = { _row: i + 2 };
    for (var c = 0; c < headers.length; c++) {
      var v = values[i][c];
      o[headers[c]] = v === null || v === undefined ? '' : String(v);
    }
    if (o[headers[0]] !== '') rows.push(o);
  }
  return rows;
}

function objToRow_(name, obj) {
  return SCHEMA[name].map(function (h) {
    return obj[h] === undefined || obj[h] === null ? '' : String(obj[h]);
  });
}

function appendObj_(name, obj) {
  appendObjs_(name, [obj]);
}

// One write for many rows (Sheets calls are slow, ~100 ms each).
function appendObjs_(name, objs) {
  if (!objs.length) return;
  var headers = SCHEMA[name];
  var sh = sheet_(name);
  var target = sh.getLastRow() + 1;
  var range = sh.getRange(target, 1, objs.length, headers.length);
  range.setNumberFormat('@'); // keep everything text, also on rows added past the formatted area
  range.setValues(objs.map(function (o) { return objToRow_(name, o); }));
}

function updateObj_(name, existing, patch) {
  var headers = SCHEMA[name];
  var row = headers.map(function (h) {
    var v = patch[h] !== undefined ? patch[h] : existing[h];
    return v === undefined || v === null ? '' : String(v);
  });
  sheet_(name).getRange(existing._row, 1, 1, headers.length).setValues([row]);
}

// Removes matching rows with a constant number of Sheets calls: rewrite the kept rows, then clear the tail.
function deleteWhere_(name, predicate) {
  var all = readAll_(name);
  var keep = all.filter(function (r) { return !predicate(r); });
  var removed = all.length - keep.length;
  if (removed === 0) return 0;
  var sh = sheet_(name);
  var n = SCHEMA[name].length;
  var last = sh.getLastRow();
  if (keep.length) {
    sh.getRange(2, 1, keep.length, n).setValues(keep.map(function (r) { return objToRow_(name, r); }));
  }
  var tailStart = keep.length + 2;
  if (last >= tailStart) sh.getRange(tailStart, 1, last - tailStart + 1, n).clearContent();
  return removed;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) fail_('busy', 'The server is busy. Try again in a few seconds.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function configInt_(key, fallback) {
  var rows = readAll_('Config');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Key === key) {
      var n = parseInt(rows[i].Value, 10);
      if (isFinite(n)) return n;
    }
  }
  return fallback;
}

function audit_(eventId, actor, action, detail) {
  appendObj_('Audit', {
    At: nowIso_(),
    EventID: eventId || '',
    Actor: actor,
    Action: action,
    Detail: detail ? 'info: ' + String(detail).slice(0, 200) : ''
  });
}

// ---------------------------------------------------------------- sessions / login

function passwordHash_(salt, password) {
  return sha256_(salt + ':' + password);
}

function orgView_(o) {
  return { id: o.OrganizerID, name: o.Name, role: o.Role === 'admin' ? 'admin' : 'organizer', mustChange: tempPending_(o) };
}

function tempPending_(o) {
  return o.TempUntil !== '';
}

// A session is tied to the password it was created with: changing or resetting the password ends every older session.
function sessionMark_(o) {
  return o.PassHash.slice(0, 16);
}

function newSession_(o) {
  var token = newId_(64);
  CacheService.getScriptCache().put('sess:' + token, JSON.stringify({ id: o.OrganizerID, pv: sessionMark_(o) }), SESSION_TTL_SEC);
  return token;
}

function failKey_(name) {
  return 'fail:' + sha256_(String(name).toLowerCase()).slice(0, 32);
}

function loginHandler_(b) {
  var name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
  var password = typeof b.password === 'string' ? b.password : '';
  if (!name || !password || name.length > 60 || password.length > 200) {
    fail_('bad_login', 'Wrong name or password.');
  }
  var cache = CacheService.getScriptCache();
  var failKey = failKey_(name);
  var fails = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= LOGIN_MAX_FAILS) {
    fail_('locked', 'Too many failed attempts. Try again in 15 minutes.');
  }
  var orgs = readAll_('Organizers');
  var found = null;
  for (var i = 0; i < orgs.length; i++) {
    if (orgs[i].Name.toLowerCase() === name.toLowerCase() && orgs[i].Active === 'TRUE') found = orgs[i];
  }
  var salt = found ? found.PassSalt : 'x';
  var hash = passwordHash_(salt, password);
  if (!found || !safeEqual_(hash, found.PassHash)) {
    cache.put(failKey, String(fails + 1), LOGIN_LOCK_SEC);
    fail_('bad_login', 'Wrong name or password.');
  }
  if (tempPending_(found) && found.TempUntil < nowIso_()) {
    fail_('temp_expired', 'That temporary password expired. Ask an administrator for a new one.');
  }
  cache.remove(failKey);
  return { token: newSession_(found), organizer: orgView_(found), expiresInSec: SESSION_TTL_SEC };
}

function requireSession_(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail_('unauthorized', 'Please sign in again.');
  var raw = CacheService.getScriptCache().get('sess:' + token);
  if (!raw) fail_('unauthorized', 'Please sign in again.');
  var sess = JSON.parse(raw);
  var orgs = readAll_('Organizers');
  for (var i = 0; i < orgs.length; i++) {
    var o = orgs[i];
    // Role and status are read from the sheet on every call. The browser never says what it is allowed to do.
    if (o.OrganizerID === sess.id && o.Active === 'TRUE' && sess.pv === sessionMark_(o)) {
      if (tempPending_(o) && o.TempUntil < nowIso_()) break;
      return orgView_(o);
    }
  }
  CacheService.getScriptCache().remove('sess:' + token);
  fail_('unauthorized', 'Please sign in again.');
}

function whoamiHandler_(b, ctx) {
  return { organizer: ctx.organizer };
}

function findOrganizer_(id) {
  var orgs = readAll_('Organizers');
  for (var i = 0; i < orgs.length; i++) if (orgs[i].OrganizerID === id) return orgs[i];
  fail_('not_found', 'Organizer not found.');
}

function validNewPassword_(pw) {
  if (typeof pw !== 'string') fail_('invalid', 'Enter a new password.');
  if (pw.length < MIN_PASSWORD) fail_('invalid', 'The new password needs at least ' + MIN_PASSWORD + ' characters.');
  if (pw.length > 200) fail_('invalid', 'The new password is too long.');
  return pw;
}

// Own password change. Needs the current (or temporary) password, shares the login lockout, returns a fresh session.
function changePasswordHandler_(b, ctx) {
  var current = typeof b.currentPassword === 'string' ? b.currentPassword : '';
  var next = validNewPassword_(b.newPassword);
  var cache = CacheService.getScriptCache();
  var failKey = failKey_(ctx.organizer.name);
  var fails = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= LOGIN_MAX_FAILS) fail_('locked', 'Too many failed attempts. Try again in 15 minutes.');
  return withLock_(function () {
    var o = findOrganizer_(ctx.organizer.id);
    if (!safeEqual_(passwordHash_(o.PassSalt, current), o.PassHash)) {
      cache.put(failKey, String(fails + 1), LOGIN_LOCK_SEC);
      fail_('bad_password', 'The current password is not right.');
    }
    if (next === current) fail_('invalid', 'Choose a password different from the current one.');
    cache.remove(failKey);
    var salt = newId_(32);
    updateObj_('Organizers', o, { PassSalt: salt, PassHash: passwordHash_(salt, next), TempUntil: '' });
    var updated = findOrganizer_(o.OrganizerID);
    cache.remove('sess:' + b.token);
    audit_('', o.Name, 'passwordChanged', '');
    return { token: newSession_(updated), organizer: orgView_(updated), expiresInSec: SESSION_TTL_SEC };
  });
}

function logoutHandler_(b) {
  if (typeof b.token === 'string' && /^[a-f0-9]{64}$/.test(b.token)) {
    CacheService.getScriptCache().remove('sess:' + b.token);
  }
  return {};
}

// ---------------------------------------------------------------- domain helpers

function findEvent_(eventId, opts) {
  reqId_(eventId, 'event');
  var rows = readAll_('Events');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].EventID === eventId) {
      if (!(opts && opts.allowExpired) && rows[i].ExpiresAt < nowIso_()) break;
      return rows[i];
    }
  }
  fail_('not_found', 'Tournament not found. It may have been deleted.');
}

function playersOf_(eventId) {
  return readAll_('Players')
    .filter(function (p) { return p.EventID === eventId; })
    .sort(function (a, b) { return Number(a.Rank) - Number(b.Rank); });
}

function findPlayer_(eventId, playerId) {
  reqId_(playerId, 'player');
  var list = playersOf_(eventId);
  for (var i = 0; i < list.length; i++) if (list[i].PlayerID === playerId) return list[i];
  fail_('not_found', 'Player not found.');
}

function playerState_(p) {
  var claimed = p.ClaimHash !== '';
  var hasDeck = p.CurrentDeckID !== '';
  var locked = p.ListLocked === 'TRUE';
  if (hasDeck && !locked) return 'released';
  if (hasDeck) return 'submitted';
  return claimed ? 'claimed' : 'open';
}

function eventPublic_(e) {
  return {
    eventId: e.EventID,
    name: e.Name,
    datePlayed: e.DatePlayed,
    status: e.Status,
    expiresAt: e.ExpiresAt,
    exburstUrl: e.ExburstUrl
  };
}

function decksOf_(eventId) {
  return readAll_('Decklists').filter(function (d) { return d.EventID === eventId; });
}

function trashFile_(id) {
  if (!id) return;
  try {
    DriveApp.getFileById(id).setTrashed(true);
  } catch (err) {
    console.warn('trashFile failed: ' + String(err));
  }
}

function trashFolder_(id) {
  if (!id) return;
  try {
    DriveApp.getFolderById(id).setTrashed(true);
  } catch (err) {
    console.warn('trashFolder failed: ' + String(err));
  }
}

function deleteEventData_(event) {
  trashFolder_(event.FolderID);
  deleteWhere_('Decklists', function (d) { return d.EventID === event.EventID; });
  deleteWhere_('Players', function (p) { return p.EventID === event.EventID; });
  deleteWhere_('Events', function (e) { return e.EventID === event.EventID; });
}

// ---------------------------------------------------------------- public handlers

function getEventHandler_(b) {
  var event = findEvent_(b.eventId);
  var players = playersOf_(event.EventID);
  var myHash = null;
  if (b.secret !== undefined && b.secret !== null && b.secret !== '') myHash = sha256_(reqSecret_(b.secret));
  var me = null;
  var list = players.map(function (p) {
    var mine = myHash !== null && p.ClaimHash !== '' && safeEqual_(p.ClaimHash, myHash);
    if (mine) {
      var deck = null;
      if (p.CurrentDeckID) {
        var d = decksOf_(event.EventID).filter(function (x) { return x.DeckID === p.CurrentDeckID; })[0];
        if (d) deck = { type: d.Type, deckName: d.DeckName, deckColor: d.DeckColor, submittedAt: d.SubmittedAt };
      }
      me = { playerId: p.PlayerID, locked: p.ListLocked === 'TRUE', deck: deck };
    }
    return {
      playerId: p.PlayerID,
      rank: Number(p.Rank),
      name: p.Name,
      record: p.Record,
      state: playerState_(p),
      mine: mine
    };
  });
  return { event: eventPublic_(event), players: list, me: me };
}

function claimPlayerHandler_(b) {
  var secret = reqSecret_(b.secret);
  var hash = sha256_(secret);
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    if (event.Status !== 'open') fail_('closed', 'This tournament is closed for submissions.');
    var players = playersOf_(event.EventID);
    var target = null;
    reqId_(b.playerId, 'player');
    for (var i = 0; i < players.length; i++) {
      if (players[i].PlayerID === b.playerId) target = players[i];
    }
    if (!target) fail_('not_found', 'Player not found.');
    if (target.ClaimHash !== '' && safeEqual_(target.ClaimHash, hash)) {
      return { playerId: target.PlayerID, alreadyYours: true };
    }
    if (target.ClaimHash !== '') fail_('taken', 'That name was already claimed. Ask the organizer to release it.');
    for (var j = 0; j < players.length; j++) {
      if (players[j].ClaimHash !== '' && safeEqual_(players[j].ClaimHash, hash)) {
        fail_('already_claimed_other', 'You already claimed another name in this tournament.');
      }
    }
    updateObj_('Players', target, { ClaimHash: hash, ClaimedAt: nowIso_() });
    audit_(event.EventID, 'player:' + target.PlayerID, 'claim', '');
    return { playerId: target.PlayerID, alreadyYours: false };
  });
}

function decodeImage_(b64) {
  if (typeof b64 !== 'string' || b64.length === 0) fail_('invalid', 'The image is missing.');
  if (b64.length > 2200000) fail_('too_large', 'The image is too large.');
  if (!/^[A-Za-z0-9+\/]+={0,2}$/.test(b64)) fail_('invalid', 'The image data is not valid.');
  var bytes = Utilities.base64Decode(b64);
  if (bytes.length > LIMITS.MAX_IMAGE_BYTES) fail_('too_large', 'The image is too large (max 1.5 MB).');
  var u = function (i) { return bytes[i] < 0 ? bytes[i] + 256 : bytes[i]; };
  var mime = null;
  var ext = null;
  if (bytes.length > 12 && u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) {
    mime = 'image/jpeg';
    ext = 'jpg';
  } else if (
    bytes.length > 12 && u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47 &&
    u(4) === 0x0d && u(5) === 0x0a && u(6) === 0x1a && u(7) === 0x0a
  ) {
    mime = 'image/png';
    ext = 'png';
  } else if (
    bytes.length > 12 && u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 &&
    u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50
  ) {
    mime = 'image/webp';
    ext = 'webp';
  }
  if (!mime) fail_('invalid', 'Only JPEG, PNG or WEBP images are accepted.');
  return { bytes: bytes, mime: mime, ext: ext };
}

function submitDeckHandler_(b) {
  var secret = reqSecret_(b.secret);
  var hash = sha256_(secret);
  reqId_(b.eventId, 'event');
  reqId_(b.playerId, 'player');
  var type = b.type;
  if (type !== 'txt' && type !== 'photo' && type !== 'link') fail_('invalid', 'Unknown list type.');
  var deckName = reqStr_(b.deckName, 'Deck name', LIMITS.MAX_DECK_NAME, false);
  if (DECK_COLORS.indexOf(b.deckColor) === -1) fail_('invalid', 'Pick a deck color.');

  var content = '';
  var image = null;
  if (type === 'txt') {
    if (typeof b.content !== 'string') fail_('invalid', 'The list is missing.');
    content = b.content.replace(/\r/g, '');
    if (content.trim().length === 0) fail_('invalid', 'The list is empty.');
    if (content.length > LIMITS.MAX_TXT_CHARS) fail_('invalid', 'The list is too long.');
    if (startsWithFormulaChar(content)) fail_('invalid', 'The list cannot start with =, + or @.');
    var parsed = parseDeckText(content);
    if (parsed.entries.length === 0) fail_('invalid', 'No cards found. Paste the text from Exburst (Export > Copy the list).');
  } else if (type === 'link') {
    content = typeof b.content === 'string' ? b.content.trim() : '';
    var linkErr = checkDeckLink(content);
    if (linkErr) fail_('invalid', linkErr);
  } else {
    image = decodeImage_(b.content);
  }

  // Cheap pre-check outside the lock, so we do not upload files for requests that will fail.
  var pre = findEvent_(b.eventId);
  if (pre.Status !== 'open') fail_('closed', 'This tournament is closed for submissions.');
  var prePlayer = findPlayer_(pre.EventID, b.playerId);
  checkCanSubmit_(prePlayer, hash);

  var fileId = '';
  if (image) {
    var deckId0 = newId_(12);
    var folder = DriveApp.getFolderById(pre.FolderID);
    var blob = Utilities.newBlob(image.bytes, image.mime, prePlayer.PlayerID + '-' + deckId0 + '.' + image.ext);
    fileId = folder.createFile(blob).getId();
    content = '';
  }

  try {
    return withLock_(function () {
      var event = findEvent_(b.eventId);
      if (event.Status !== 'open') fail_('closed', 'This tournament is closed for submissions.');
      var player = findPlayer_(event.EventID, b.playerId);
      checkCanSubmit_(player, hash);
      var deckId = newId_(12);
      appendObj_('Decklists', {
        DeckID: deckId, EventID: event.EventID, PlayerID: player.PlayerID, Type: type,
        DeckName: deckName, DeckColor: b.deckColor, Content: content, FileID: fileId, SubmittedAt: nowIso_()
      });
      updateObj_('Players', player, { CurrentDeckID: deckId, ListLocked: 'TRUE' });
      audit_(event.EventID, 'player:' + player.PlayerID, 'submit', type);
      return { deckId: deckId, type: type };
    });
  } catch (err) {
    trashFile_(fileId);
    throw err;
  }
}

function checkCanSubmit_(player, hash) {
  if (player.ClaimHash === '' || !safeEqual_(player.ClaimHash, hash)) {
    fail_('forbidden', 'This name is not claimed by you.');
  }
  if (player.CurrentDeckID !== '' && player.ListLocked === 'TRUE') {
    fail_('locked_list', 'Your list is already sent. Ask the organizer to reopen it if you need to change it.');
  }
}

// ---------------------------------------------------------------- administrator handlers

function requireAdmin_(ctx) {
  if (ctx.organizer.role !== 'admin') fail_('forbidden', 'Only administrators can do this.');
}

// 12 characters from a 31-symbol alphabet (about 59 bits), written in groups of 4. Rejection sampling avoids modulo bias.
function tempPassword_() {
  var out = '';
  while (out.length < 12) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i + 1 < hex.length && out.length < 12; i += 2) {
      var n = parseInt(hex.substr(i, 2), 16);
      if (n < 248) out += TEMP_ALPHABET.charAt(n % 31); // 248 = 31 * 8
    }
  }
  return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12);
}

function activeAdminCount_(orgs, exceptId) {
  return orgs.filter(function (o) { return o.Role === 'admin' && o.Active === 'TRUE' && o.OrganizerID !== exceptId; }).length;
}

function listOrganizersHandler_(b, ctx) {
  requireAdmin_(ctx);
  var now = nowIso_();
  return readAll_('Organizers')
    .sort(function (a, c) { return a.Name.toLowerCase() < c.Name.toLowerCase() ? -1 : 1; })
    .map(function (o) {
      return {
        id: o.OrganizerID, name: o.Name, role: o.Role === 'admin' ? 'admin' : 'organizer',
        active: o.Active === 'TRUE', createdAt: o.CreatedAt,
        tempPending: tempPending_(o) && o.TempUntil >= now, tempExpired: tempPending_(o) && o.TempUntil < now,
        isMe: o.OrganizerID === ctx.organizer.id
      };
    });
}

function createOrganizerHandler_(b, ctx) {
  requireAdmin_(ctx);
  var name = reqStr_(b.name, 'Name', 60, true);
  var role = b.role === 'admin' ? 'admin' : '';
  return withLock_(function () {
    var orgs = readAll_('Organizers');
    if (orgs.length >= MAX_ORGANIZERS) fail_('limit', 'There are already ' + MAX_ORGANIZERS + ' organizers.');
    if (orgs.some(function (o) { return o.Name.toLowerCase() === name.toLowerCase(); })) {
      fail_('exists', 'Someone already uses that name.');
    }
    var temp = tempPassword_();
    var salt = newId_(32);
    var id = newId_(8);
    appendObj_('Organizers', {
      OrganizerID: id, Name: name, PassSalt: salt, PassHash: passwordHash_(salt, temp), Active: 'TRUE',
      CreatedAt: nowIso_(), Role: role, TempUntil: addDays_(nowIso_(), TEMP_PASSWORD_HOURS / 24)
    });
    audit_('', ctx.organizer.name, 'orgCreate', name + (role ? ' (admin)' : ''));
    return { id: id, name: name, role: role === 'admin' ? 'admin' : 'organizer', tempPassword: temp, validHours: TEMP_PASSWORD_HOURS };
  });
}

function resetOrganizerPasswordHandler_(b, ctx) {
  requireAdmin_(ctx);
  var id = reqId_(b.organizerId, 'organizer');
  if (id === ctx.organizer.id) fail_('invalid', 'Use "Change password" for your own account.');
  return withLock_(function () {
    var o = findOrganizer_(id);
    var temp = tempPassword_();
    var salt = newId_(32);
    updateObj_('Organizers', o, {
      PassSalt: salt, PassHash: passwordHash_(salt, temp), Active: 'TRUE', TempUntil: addDays_(nowIso_(), TEMP_PASSWORD_HOURS / 24)
    });
    CacheService.getScriptCache().remove(failKey_(o.Name));
    audit_('', ctx.organizer.name, 'orgReset', o.Name);
    return { id: o.OrganizerID, name: o.Name, tempPassword: temp, validHours: TEMP_PASSWORD_HOURS };
  });
}

function setOrganizerActiveHandler_(b, ctx) {
  requireAdmin_(ctx);
  var id = reqId_(b.organizerId, 'organizer');
  if (typeof b.active !== 'boolean') fail_('invalid', 'Active must be true or false.');
  if (id === ctx.organizer.id) fail_('invalid', 'You can not disable your own account.');
  return withLock_(function () {
    var orgs = readAll_('Organizers');
    var o = findOrganizer_(id);
    if (!b.active && o.Role === 'admin' && activeAdminCount_(orgs, id) < 1) {
      fail_('last_admin', 'There must be at least one active administrator.');
    }
    updateObj_('Organizers', o, { Active: b.active ? 'TRUE' : 'FALSE' });
    audit_('', ctx.organizer.name, b.active ? 'orgEnable' : 'orgDisable', o.Name);
    return { id: o.OrganizerID, active: b.active };
  });
}

function setOrganizerRoleHandler_(b, ctx) {
  requireAdmin_(ctx);
  var id = reqId_(b.organizerId, 'organizer');
  if (b.role !== 'admin' && b.role !== 'organizer') fail_('invalid', 'Role must be admin or organizer.');
  return withLock_(function () {
    var orgs = readAll_('Organizers');
    var o = findOrganizer_(id);
    if (b.role === 'organizer' && o.Role === 'admin' && o.Active === 'TRUE' && activeAdminCount_(orgs, id) < 1) {
      fail_('last_admin', 'There must be at least one active administrator.');
    }
    updateObj_('Organizers', o, { Role: b.role === 'admin' ? 'admin' : '' });
    audit_('', ctx.organizer.name, 'orgRole', o.Name + ' -> ' + b.role);
    return { id: o.OrganizerID, role: b.role };
  });
}

// ---------------------------------------------------------------- organizer handlers

function listEventsHandler_() {
  var events = readAll_('Events');
  var players = readAll_('Players');
  var orgs = readAll_('Organizers');
  var now = nowIso_();
  var names = {};
  orgs.forEach(function (o) { names[o.OrganizerID] = o.Name; });
  return events
    .filter(function (e) { return e.ExpiresAt >= now; })
    .sort(function (a, b) { return a.CreatedAt < b.CreatedAt ? 1 : -1; })
    .map(function (e) {
      var ps = players.filter(function (p) { return p.EventID === e.EventID; });
      return {
        eventId: e.EventID, name: e.Name, datePlayed: e.DatePlayed, status: e.Status,
        createdBy: e.CreatedBy, createdByName: names[e.CreatedBy] || 'Unknown', createdAt: e.CreatedAt,
        expiresAt: e.ExpiresAt, playerCount: ps.length,
        submittedCount: ps.filter(function (p) { return p.CurrentDeckID !== ''; }).length
      };
    });
}

function createEventHandler_(b, ctx) {
  var name = reqStr_(b.name, 'Tournament name', 80, true);
  var date = reqDate_(b.datePlayed);
  var days = reqExpireDays_(b.expireDays);
  var link = typeof b.exburstUrl === 'string' ? b.exburstUrl.trim() : '';
  var linkErr = checkTournamentLink(link);
  if (linkErr) fail_('invalid', linkErr);
  var parsed = parseResults(typeof b.resultsText === 'string' ? b.resultsText : '');
  if (parsed.errors.length) fail_('invalid', parsed.errors[0]);
  if (parsed.players.length === 0) fail_('invalid', 'Add at least one player.');

  var eventId = newId_(12);
  var root = DriveApp.getFolderById(prop_('ROOT_FOLDER_ID'));
  var folder = root.createFolder('event-' + eventId);
  var created = nowIso_();
  try {
    return withLock_(function () {
      appendObj_('Events', {
        EventID: eventId, Name: name, DatePlayed: date, CreatedBy: ctx.organizer.id, CreatedAt: created,
        ExpiresAt: addDays_(created, days), Status: 'open', FolderID: folder.getId(), ExburstUrl: link
      });
      appendObjs_('Players', parsed.players.map(function (p) {
        return {
          PlayerID: newId_(8), EventID: eventId, Rank: p.rank, Name: p.name, Record: p.record,
          ClaimHash: '', ClaimedAt: '', CurrentDeckID: '', ListLocked: 'FALSE'
        };
      }));
      audit_(eventId, ctx.organizer.name, 'createEvent', parsed.players.length + ' players');
      return { eventId: eventId, playerCount: parsed.players.length, warnings: parsed.warnings };
    });
  } catch (err) {
    trashFolder_(folder.getId());
    throw err;
  }
}

function adminPlayers_(event) {
  var decks = decksOf_(event.EventID);
  var byId = {};
  decks.forEach(function (d) { byId[d.DeckID] = d; });
  return playersOf_(event.EventID).map(function (p) {
    var d = p.CurrentDeckID ? byId[p.CurrentDeckID] : null;
    return {
      playerId: p.PlayerID, rank: Number(p.Rank), name: p.Name, record: p.Record,
      state: playerState_(p), claimed: p.ClaimHash !== '', claimedAt: p.ClaimedAt,
      deck: d ? { deckId: d.DeckID, type: d.Type, deckName: d.DeckName, deckColor: d.DeckColor, submittedAt: d.SubmittedAt } : null
    };
  });
}

function getEventAdminHandler_(b) {
  var event = findEvent_(b.eventId);
  var names = {};
  readAll_('Organizers').forEach(function (o) { names[o.OrganizerID] = o.Name; });
  var e = eventPublic_(event);
  e.createdByName = names[event.CreatedBy] || 'Unknown';
  e.createdAt = event.CreatedAt;
  return { event: e, players: adminPlayers_(event) };
}

function updateEventHandler_(b, ctx) {
  var name = reqStr_(b.name, 'Tournament name', 80, true);
  var date = reqDate_(b.datePlayed);
  var days = reqExpireDays_(b.expireDays);
  var link = typeof b.exburstUrl === 'string' ? b.exburstUrl.trim() : '';
  var linkErr = checkTournamentLink(link);
  if (linkErr) fail_('invalid', linkErr);
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    updateObj_('Events', event, {
      Name: name, DatePlayed: date, ExburstUrl: link, ExpiresAt: addDays_(event.CreatedAt, days)
    });
    audit_(event.EventID, ctx.organizer.name, 'updateEvent', '');
    return {};
  });
}

function setStatusHandler_(b, ctx) {
  if (b.status !== 'open' && b.status !== 'closed') fail_('invalid', 'Status must be open or closed.');
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    updateObj_('Events', event, { Status: b.status });
    audit_(event.EventID, ctx.organizer.name, 'setStatus', b.status);
    return {};
  });
}

function reqRank_(v) {
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > 999) fail_('invalid', 'Rank must be a whole number from 1 to 999.');
  return n;
}

function reqRecord_(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !/^\d{1,2}-\d{1,2}(-\d{1,2})?$/.test(v.trim())) {
    fail_('invalid', 'Record must look like 5-0 or 3-1-1.');
  }
  return v.trim();
}

function addPlayerHandler_(b, ctx) {
  var name = reqStr_(b.name, 'Player name', LIMITS.MAX_NAME, true);
  var record = reqRecord_(b.record);
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    var players = playersOf_(event.EventID);
    if (players.length >= LIMITS.MAX_PLAYERS) fail_('invalid', 'Too many players.');
    var maxRank = players.reduce(function (m, p) { return Math.max(m, Number(p.Rank)); }, 0);
    var rank = b.rank === undefined || b.rank === null || b.rank === '' ? maxRank + 1 : reqRank_(b.rank);
    var id = newId_(8);
    appendObj_('Players', {
      PlayerID: id, EventID: event.EventID, Rank: rank, Name: name, Record: record,
      ClaimHash: '', ClaimedAt: '', CurrentDeckID: '', ListLocked: 'FALSE'
    });
    audit_(event.EventID, ctx.organizer.name, 'addPlayer', id);
    return { playerId: id };
  });
}

function updatePlayerHandler_(b, ctx) {
  var patch = {};
  if (b.name !== undefined) patch.Name = reqStr_(b.name, 'Player name', LIMITS.MAX_NAME, true);
  if (b.rank !== undefined) patch.Rank = reqRank_(b.rank);
  if (b.record !== undefined) patch.Record = reqRecord_(b.record);
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    var p = findPlayer_(event.EventID, b.playerId);
    updateObj_('Players', p, patch);
    audit_(event.EventID, ctx.organizer.name, 'updatePlayer', p.PlayerID);
    return {};
  });
}

function removePlayerHandler_(b, ctx) {
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    var p = findPlayer_(event.EventID, b.playerId);
    decksOf_(event.EventID)
      .filter(function (d) { return d.PlayerID === p.PlayerID; })
      .forEach(function (d) { trashFile_(d.FileID); });
    deleteWhere_('Decklists', function (d) { return d.EventID === event.EventID && d.PlayerID === p.PlayerID; });
    deleteWhere_('Players', function (x) { return x.PlayerID === p.PlayerID && x.EventID === event.EventID; });
    audit_(event.EventID, ctx.organizer.name, 'removePlayer', p.PlayerID);
    return {};
  });
}

function releaseNameHandler_(b, ctx) {
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    var p = findPlayer_(event.EventID, b.playerId);
    updateObj_('Players', p, { ClaimHash: '', ClaimedAt: '', ListLocked: 'FALSE' });
    audit_(event.EventID, ctx.organizer.name, 'releaseName', p.PlayerID);
    return {};
  });
}

function releaseListHandler_(b, ctx) {
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    var p = findPlayer_(event.EventID, b.playerId);
    if (p.CurrentDeckID === '') fail_('invalid', 'This player has no list to release.');
    updateObj_('Players', p, { ListLocked: 'FALSE' });
    audit_(event.EventID, ctx.organizer.name, 'releaseList', p.PlayerID);
    return {};
  });
}

function undoReleaseHandler_(b, ctx) {
  return withLock_(function () {
    var event = findEvent_(b.eventId);
    var p = findPlayer_(event.EventID, b.playerId);
    if (p.CurrentDeckID === '') fail_('invalid', 'Nothing to undo.');
    updateObj_('Players', p, { ListLocked: 'TRUE' });
    audit_(event.EventID, ctx.organizer.name, 'undoRelease', p.PlayerID);
    return {};
  });
}

function getDecklistsHandler_(b) {
  var event = findEvent_(b.eventId);
  var decks = {};
  decksOf_(event.EventID).forEach(function (d) { decks[d.DeckID] = d; });
  return {
    event: eventPublic_(event),
    entries: playersOf_(event.EventID).map(function (p) {
      var d = p.CurrentDeckID ? decks[p.CurrentDeckID] : null;
      return {
        playerId: p.PlayerID, rank: Number(p.Rank), name: p.Name, record: p.Record,
        deck: d ? {
          deckId: d.DeckID, type: d.Type, deckName: d.DeckName, deckColor: d.DeckColor,
          content: d.Type === 'photo' ? '' : d.Content, submittedAt: d.SubmittedAt
        } : null
      };
    })
  };
}

function getPhotoHandler_(b) {
  var event = findEvent_(b.eventId);
  reqId_(b.deckId, 'deck');
  var deck = decksOf_(event.EventID).filter(function (d) { return d.DeckID === b.deckId; })[0];
  if (!deck || deck.Type !== 'photo' || !deck.FileID) fail_('not_found', 'Photo not found.');
  var file = DriveApp.getFileById(deck.FileID);
  return { mime: file.getMimeType(), base64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function deleteEventHandler_(b, ctx) {
  return withLock_(function () {
    var event = findEvent_(b.eventId, { allowExpired: true });
    deleteEventData_(event);
    audit_(event.EventID, ctx.organizer.name, 'deleteEvent', '');
    return {};
  });
}

var HANDLERS = {
  ping: function () { return { version: VERSION, time: nowIso_() }; },
  login: loginHandler_,
  logout: logoutHandler_,
  whoami: whoamiHandler_,
  changePassword: changePasswordHandler_,
  listOrganizers: listOrganizersHandler_,
  createOrganizer: createOrganizerHandler_,
  resetOrganizerPassword: resetOrganizerPasswordHandler_,
  setOrganizerActive: setOrganizerActiveHandler_,
  setOrganizerRole: setOrganizerRoleHandler_,
  getEvent: getEventHandler_,
  claimPlayer: claimPlayerHandler_,
  submitDeck: submitDeckHandler_,
  listEvents: listEventsHandler_,
  createEvent: createEventHandler_,
  getEventAdmin: getEventAdminHandler_,
  updateEvent: updateEventHandler_,
  setStatus: setStatusHandler_,
  addPlayer: addPlayerHandler_,
  updatePlayer: updatePlayerHandler_,
  removePlayer: removePlayerHandler_,
  releaseName: releaseNameHandler_,
  releaseList: releaseListHandler_,
  undoRelease: undoReleaseHandler_,
  getDecklists: getDecklistsHandler_,
  getPhoto: getPhotoHandler_,
  deleteEvent: deleteEventHandler_
};

// ---------------------------------------------------------------- scheduled cleanup

function cleanupExpired() {
  return withLock_(function () {
    var now = nowIso_();
    var removed = 0;
    readAll_('Events').forEach(function (e) {
      if (e.ExpiresAt < now) {
        deleteEventData_(e);
        audit_(e.EventID, 'system', 'autoDelete', '');
        removed++;
      }
    });
    var cutoff = addDays_(now, -AUDIT_KEEP_DAYS);
    deleteWhere_('Audit', function (a) { return a.At < cutoff; });
    return removed;
  });
}

// ---------------------------------------------------------------- editor-run admin functions

/** Run once from the editor. Safe to run again. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss;
  var id = props.getProperty('SHEET_ID');
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('DecklistShowcase_DB');
    props.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = SCHEMA[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('Sheet1');
  if (first) {
    try { ss.deleteSheet(first); } catch (err) { /* ignore */ }
  }
  var cfg = ss.getSheetByName('Config');
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, 1, 2).setValues([['DefaultExpireDays', String(DEFAULT_EXPIRE_DAYS)]]);
  }
  if (!props.getProperty('ROOT_FOLDER_ID')) {
    props.setProperty('ROOT_FOLDER_ID', DriveApp.createFolder('DecklistShowcase_Photos').getId());
  }
  installTrigger_();
  ctxCache_ = null;
  return 'Setup done. Sheet: ' + ss.getUrl();
}

function installTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'cleanupExpired') return;
  }
  ScriptApp.newTrigger('cleanupExpired').timeBased().everyDays(1).atHour(3).create();
}

/**
 * Create an organizer or reset a password (same name). Not callable from the web.
 * Set Script properties NEW_ORG_NAME and NEW_ORG_PASSWORD, run this, and the properties are removed.
 */
function addOrganizerFromProperties() {
  var props = PropertiesService.getScriptProperties();
  var name = props.getProperty('NEW_ORG_NAME');
  var password = props.getProperty('NEW_ORG_PASSWORD');
  try {
    return addOrganizer(name, password);
  } finally {
    props.deleteProperty('NEW_ORG_NAME');
    props.deleteProperty('NEW_ORG_PASSWORD');
  }
}

/** Editor-only. role = 'admin' creates or promotes an administrator. A password set here is final (no forced change). */
function addOrganizer(name, password, role) {
  name = String(name || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 60 || startsWithFormulaChar(name)) throw new Error('Invalid organizer name.');
  if (String(password || '').length < MIN_PASSWORD) throw new Error('Password must have at least ' + MIN_PASSWORD + ' characters.');
  return withLock_(function () {
    var salt = newId_(32);
    var hash = passwordHash_(salt, password);
    var existing = readAll_('Organizers').filter(function (o) { return o.Name.toLowerCase() === name.toLowerCase(); })[0];
    if (existing) {
      var patch = { PassSalt: salt, PassHash: hash, Active: 'TRUE', TempUntil: '' };
      if (role === 'admin') patch.Role = 'admin';
      updateObj_('Organizers', existing, patch);
      return 'Password reset for ' + existing.Name;
    }
    appendObj_('Organizers', {
      OrganizerID: newId_(8), Name: name, PassSalt: salt, PassHash: hash, Active: 'TRUE', CreatedAt: nowIso_(),
      Role: role === 'admin' ? 'admin' : '', TempUntil: ''
    });
    return 'Organizer created: ' + name;
  });
}

/**
 * Editor-only, run once after updating: makes an existing organizer an administrator.
 * Set Script property ADMIN_ORG_NAME, run this, then it is removed. There is no way to do this from the web.
 */
function makeAdminFromProperties() {
  var props = PropertiesService.getScriptProperties();
  var name = String(props.getProperty('ADMIN_ORG_NAME') || '').toLowerCase();
  props.deleteProperty('ADMIN_ORG_NAME');
  return withLock_(function () {
    var o = readAll_('Organizers').filter(function (x) { return x.Name.toLowerCase() === name; })[0];
    if (!o) throw new Error('Organizer not found.');
    updateObj_('Organizers', o, { Role: 'admin', Active: 'TRUE' });
    return o.Name + ' is now an administrator.';
  });
}

/** Set Script property DISABLE_ORG_NAME, run this, then it is removed. */
function disableOrganizerFromProperties() {
  var props = PropertiesService.getScriptProperties();
  var name = String(props.getProperty('DISABLE_ORG_NAME') || '').toLowerCase();
  props.deleteProperty('DISABLE_ORG_NAME');
  return withLock_(function () {
    var o = readAll_('Organizers').filter(function (x) { return x.Name.toLowerCase() === name; })[0];
    if (!o) throw new Error('Organizer not found.');
    updateObj_('Organizers', o, { Active: 'FALSE' });
    return 'Disabled ' + o.Name;
  });
}
