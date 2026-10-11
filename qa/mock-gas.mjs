// In-memory emulation of the Apps Script services used by apps-script/Code.gs.
// It runs the REAL Code.gs + Parsers.gs inside a vm context. It is a test double:
// it can not prove behaviour of the real Google services (see qa/live-smoke.mjs for that).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuf = (arr) => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b)));

export function createGas(opts = {}) {
  const clock = { now: opts.now ?? Date.parse('2026-10-11T12:00:00.000Z') };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(clock.now);
      else super(...a);
    }
    static now() {
      return clock.now;
    }
  }

  const state = {
    sheets: new Map(), // spreadsheetId -> {name, sheets: Map(name -> sheet)}
    files: new Map(),
    folders: new Map(),
    props: new Map(),
    cache: new Map(),
    triggers: [],
    lockBusy: false,
    calls: { sheets: 0 },
    logs: []
  };
  let idSeq = 0;
  const nid = (p) => `${p}${++idSeq}${crypto.randomBytes(4).toString('hex')}`;

  // ---- Sheets
  class Sheet {
    constructor(name) {
      this.name = name;
      this.cells = []; // rows of arrays
      this.fmt = []; // rows of arrays ('@' or '')
      this.maxRows = 1000;
      this.maxCols = 26;
    }
    _grow(r, c) {
      while (this.cells.length < r) {
        this.cells.push([]);
        this.fmt.push([]);
      }
      this.maxRows = Math.max(this.maxRows, r);
      this.maxCols = Math.max(this.maxCols, c);
    }
    getLastRow() {
      for (let r = this.cells.length; r >= 1; r--) {
        if (this.cells[r - 1].some((v) => v !== '' && v !== undefined && v !== null)) return r;
      }
      return 0;
    }
    getMaxRows() {
      return this.maxRows;
    }
    setFrozenRows() {}
    getRange(r, c, nr = 1, nc = 1) {
      const sh = this;
      state.calls.sheets++;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) {
              const v = (sh.cells[r - 1 + i] || [])[c - 1 + j];
              row.push(v === undefined ? '' : v);
            }
            out.push(row);
          }
          return out;
        },
        setValues(vals) {
          if (vals.length !== nr || vals.some((row) => row.length !== nc)) {
            throw new Error(`setValues size mismatch: expected ${nr}x${nc}`);
          }
          sh._grow(r - 1 + nr, c - 1 + nc);
          for (let i = 0; i < nr; i++) {
            for (let j = 0; j < nc; j++) {
              const isText = (sh.fmt[r - 1 + i][c - 1 + j] || '') === '@';
              sh.cells[r - 1 + i][c - 1 + j] = coerce(vals[i][j], isText);
            }
          }
        },
        setNumberFormat(f) {
          sh._grow(r - 1 + nr, c - 1 + nc);
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.fmt[r - 1 + i][c - 1 + j] = f;
        },
        clearContent() {
          for (let i = 0; i < nr; i++) {
            for (let j = 0; j < nc; j++) {
              if (sh.cells[r - 1 + i]) sh.cells[r - 1 + i][c - 1 + j] = '';
            }
          }
        }
      };
    }
  }
  // Spreadsheet behaviour on non-text cells: numbers, dates and formulas get interpreted.
  function coerce(v, isText) {
    if (isText || typeof v !== 'string') return v;
    if (/^=/.test(v)) return { formula: v };
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new RealDate(v + 'T00:00:00Z');
    return v;
  }

  const SpreadsheetApp = {
    create(name) {
      const id = nid('ss');
      const book = {
        id,
        name,
        sheets: new Map([['Sheet1', new Sheet('Sheet1')]])
      };
      state.sheets.set(id, book);
      return wrapBook(book);
    },
    openById(id) {
      const b = state.sheets.get(id);
      if (!b) throw new Error('Spreadsheet not found');
      return wrapBook(b);
    }
  };
  function wrapBook(b) {
    return {
      getId: () => b.id,
      getUrl: () => `https://docs.google.com/spreadsheets/d/${b.id}`,
      getSheetByName: (n) => b.sheets.get(n) || null,
      insertSheet: (n) => {
        const s = new Sheet(n);
        b.sheets.set(n, s);
        return s;
      },
      deleteSheet: (s) => b.sheets.delete(s.name)
    };
  }

  // ---- Drive
  const mkBlob = (bytes, mime, name) => ({
    getBytes: () => bytes,
    getContentType: () => mime,
    getName: () => name
  });
  function wrapFolder(f) {
    return {
      getId: () => f.id,
      createFolder(name) {
        const c = { id: nid('fo'), name, parent: f.id, trashed: false };
        state.folders.set(c.id, c);
        return wrapFolder(c);
      },
      createFile(blob) {
        const file = {
          id: nid('fi'), name: blob.getName(), mime: blob.getContentType(),
          bytes: blob.getBytes().slice(), parent: f.id, trashed: false
        };
        state.files.set(file.id, file);
        return wrapFile(file);
      },
      setTrashed(t) {
        f.trashed = t;
        return this;
      }
    };
  }
  function fileTrashed(file) {
    let p = state.folders.get(file.parent);
    while (p) {
      if (p.trashed) return true;
      p = state.folders.get(p.parent);
    }
    return file.trashed;
  }
  function wrapFile(file) {
    return {
      getId: () => file.id,
      getMimeType: () => file.mime,
      getBlob: () => mkBlob(file.bytes, file.mime, file.name),
      setTrashed(t) {
        file.trashed = t;
        return this;
      }
    };
  }
  const DriveApp = {
    createFolder(name) {
      const f = { id: nid('fo'), name, parent: null, trashed: false };
      state.folders.set(f.id, f);
      return wrapFolder(f);
    },
    getFolderById(id) {
      const f = state.folders.get(id);
      if (!f) throw new Error('Folder not found');
      return wrapFolder(f);
    },
    getFileById(id) {
      const f = state.files.get(id);
      if (!f) throw new Error('File not found');
      if (fileTrashed(f)) {
        /* Real Drive still returns trashed files; keep the same. */
      }
      return wrapFile(f);
    }
  };

  // ---- Utilities / Cache / Lock / Properties / Script / Content
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, str) => toSigned(crypto.createHash('sha256').update(String(str), 'utf8').digest()),
    getUuid: () => crypto.randomUUID(),
    base64Encode: (b) => (typeof b === 'string' ? Buffer.from(b) : toBuf(b)).toString('base64'),
    base64Decode: (s) => toSigned(Buffer.from(String(s), 'base64')),
    newBlob: (bytes, mime, name) => mkBlob(bytes, mime, name)
  };
  const CacheService = {
    getScriptCache: () => ({
      get(k) {
        const e = state.cache.get(k);
        if (!e) return null;
        if (e.exp <= clock.now) {
          state.cache.delete(k);
          return null;
        }
        return e.v;
      },
      put(k, v, ttl = 600) {
        if (String(v).length > 100 * 1024) throw new Error('Argument too large: value');
        state.cache.set(k, { v: String(v), exp: clock.now + Math.min(ttl, 21600) * 1000 });
      },
      remove(k) {
        state.cache.delete(k);
      }
    })
  };
  const LockService = {
    getScriptLock: () => ({
      held: false,
      tryLock() {
        if (state.lockBusy) return false;
        this.held = true;
        state.lockCount = (state.lockCount || 0) + 1;
        return true;
      },
      releaseLock() {
        this.held = false;
      }
    })
  };
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (state.props.has(k) ? state.props.get(k) : null),
      setProperty: (k, v) => state.props.set(k, String(v)),
      deleteProperty: (k) => state.props.delete(k)
    })
  };
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.map((t) => ({ getHandlerFunction: () => t })),
    newTrigger: (fn) => ({
      timeBased() {
        return this;
      },
      everyDays() {
        return this;
      },
      atHour() {
        return this;
      },
      create() {
        state.triggers.push(fn);
      }
    })
  };
  const ContentService = {
    MimeType: { JSON: 'json' },
    createTextOutput: (s) => ({
      content: s,
      setMimeType() {
        return this;
      },
      getContent() {
        return this.content;
      }
    })
  };

  const sandbox = {
    Date: FakeDate,
    SpreadsheetApp, DriveApp, Utilities, CacheService, LockService, PropertiesService, ScriptApp, ContentService,
    console: {
      log: (...a) => state.logs.push(['log', ...a]),
      warn: (...a) => state.logs.push(['warn', ...a]),
      error: (...a) => state.logs.push(['error', ...a])
    }
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['Parsers.gs', 'Code.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', f), 'utf8'), ctx, { filename: f });
  }

  const api = {
    state,
    ctx,
    setNow: (ms) => (clock.now = ms),
    advance: (ms) => (clock.now += ms),
    now: () => clock.now,
    run(fn, ...args) {
      vm.runInContext('ctxCache_ = null', ctx);
      return ctx[fn](...args);
    },
    // Emulates doPost for a JSON body. Fresh globals per request, like a real execution.
    post(body) {
      vm.runInContext('ctxCache_ = null', ctx);
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      const out = ctx.doPost({ postData: { contents: raw, type: 'text/plain' } });
      return JSON.parse(out.getContent());
    },
    get() {
      return JSON.parse(ctx.doGet({}).getContent());
    },
    // Raw rows of a table, as stored (for assertions about what is persisted).
    table(name) {
      const id = state.props.get('SHEET_ID');
      const sh = state.sheets.get(id).sheets.get(name);
      return sh.cells.filter((r) => r.some((v) => v !== '' && v !== undefined)).slice(1);
    },
    setupAll() {
      api.run('setup');
      return api;
    }
  };
  return api;
}
