// Single source of truth for parsing. Used by the browser (ES module) and,
// through qa/sync-parsers.mjs, copied to apps-script/Parsers.gs (plain functions).
// Keep this file free of imports and browser/Node-only APIs.

export var LIMITS = {
  MAX_PLAYERS: 200,
  MAX_NAME: 60,
  MAX_DECK_NAME: 60,
  MAX_TXT_CHARS: 10000,
  MAX_LINK_CHARS: 500,
  MAX_IMAGE_BYTES: 1572864,
  MAIN_DECK_SIZE: 50
};

export var DECK_COLORS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple'];

export function startsWithFormulaChar(s) {
  return /^[=+@]/.test(String(s).replace(/^\s+/, ''));
}

// "Copy the list" format from Exburst:
//   // Main deck
//   4 x UE24BT/REZ-1-007
export function parseDeckText(text) {
  var out = { entries: [], unrecognized: [], total: 0, warnings: [], sections: [] };
  var section = '';
  var lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
  var re = /^\s*(\d{1,2})\s*(?:[xX×](?=\s)\s*|\s)\s*(\S.*?)\s*$/;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf('//') === 0) {
      section = line.replace(/^\/\/+\s*/, '');
      out.sections.push(section);
      continue;
    }
    var m = re.exec(line);
    var qty = m ? parseInt(m[1], 10) : 0;
    var code = m ? m[2] : '';
    if (!m || qty < 1 || code.length > 40 || /[\u0000-\u001f]/.test(code)) {
      out.unrecognized.push(line);
      continue;
    }
    var isMain = section === '' || /main/i.test(section);
    out.entries.push({ qty: qty, code: code, section: section, main: isMain });
    if (isMain) out.total += qty;
  }
  if (out.entries.length && out.total !== LIMITS.MAIN_DECK_SIZE) {
    out.warnings.push('Main deck has ' + out.total + ' cards (expected ' + LIMITS.MAIN_DECK_SIZE + ').');
  }
  if (out.unrecognized.length) {
    out.warnings.push(out.unrecognized.length + ' line(s) could not be read.');
  }
  return out;
}

// One player per line, in finishing order. Optional leading rank, optional trailing record (5-0).
export function parseResults(text) {
  var res = { players: [], errors: [], warnings: [] };
  var lines = String(text == null ? '' : text)
    .replace(/\r/g, '')
    .split('\n')
    .map(function (l) { return l.replace(/\t/g, ' ').trim(); })
    .filter(function (l) { return l.length > 0; });

  // Decide whether leading numbers are ranks.
  var lead = lines.map(function (l) { return /^(\d{1,3})(?=\s)/.exec(l); });
  var allSequential =
    lines.length > 0 &&
    lead.every(function (m, i) { return m && parseInt(m[1], 10) === i + 1; });

  var seen = {};
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var rest = line;
    var ordinal = /^#?(\d{1,3})(?:\s*[.)]|(?:st|nd|rd|th)\b)\s*/i.exec(rest);
    if (ordinal) {
      rest = rest.slice(ordinal[0].length);
    } else if (allSequential) {
      rest = rest.replace(/^\d{1,3}\s+/, '');
    }
    var record = '';
    var rm = /\s+(\d{1,2}-\d{1,2}(?:-\d{1,2})?)$/.exec(rest);
    if (rm) {
      record = rm[1];
      rest = rest.slice(0, rest.length - rm[0].length);
    }
    var name = rest.replace(/\s+/g, ' ').trim();
    if (!name) {
      res.errors.push('Line ' + (i + 1) + ': no player name found.');
      continue;
    }
    if (name.length > LIMITS.MAX_NAME) {
      res.errors.push('Line ' + (i + 1) + ': name is longer than ' + LIMITS.MAX_NAME + ' characters.');
      continue;
    }
    if (startsWithFormulaChar(name)) {
      res.errors.push('Line ' + (i + 1) + ': name cannot start with =, + or @.');
      continue;
    }
    var key = name.toLowerCase();
    if (seen[key]) res.warnings.push('"' + name + '" appears more than once.');
    seen[key] = true;
    res.players.push({ rank: res.players.length + 1, name: name, record: record });
  }
  if (res.players.length > LIMITS.MAX_PLAYERS) {
    res.errors.push('Too many players (max ' + LIMITS.MAX_PLAYERS + ').');
  }
  return res;
}

// Exburst deck link rules. Returns '' when valid, otherwise an error message.
export function checkDeckLink(url) {
  var u = String(url == null ? '' : url).trim();
  if (!u) return 'Paste a link.';
  if (u.length > LIMITS.MAX_LINK_CHARS) return 'The link is too long.';
  var m = /^https:\/\/(?:www\.)?exburst\.dev(\/[A-Za-z0-9\-._~%\/]*)(\?[A-Za-z0-9\-._~%=&+\/]*)?$/.exec(u);
  if (!m) return 'Only https://exburst.dev links are accepted.';
  if (m[1].indexOf('/deck/') === -1) return 'That is not a deck link (it should contain /deck/).';
  return '';
}

export function checkTournamentLink(url) {
  var u = String(url == null ? '' : url).trim();
  if (!u) return '';
  if (u.length > LIMITS.MAX_LINK_CHARS) return 'The link is too long.';
  var m = /^https:\/\/(?:www\.)?exburst\.dev(\/[A-Za-z0-9\-._~%\/]*)(\?[A-Za-z0-9\-._~%=&+\/]*)?$/.exec(u);
  if (!m) return 'Only https://exburst.dev links are accepted.';
  if (m[1].indexOf('/tournaments/') === -1) return 'That is not a tournament link (it should contain /tournaments/).';
  return '';
}
