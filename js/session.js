// Browser storage helpers. Storage can be missing or throw (private windows), so every access is guarded.
const mem = new Map();

function read(key) {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) { /* ignore */ }
  return mem.has(key) ? mem.get(key) : null;
}
function write(key, value) {
  mem.set(key, value);
  try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}
function remove(key) {
  mem.delete(key);
  try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

const ORG = 'ds:org';

export function getOrganizer() {
  const raw = read(ORG);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o.token !== 'string' || typeof o.exp !== 'number' || o.exp < Date.now()) {
      remove(ORG);
      return null;
    }
    return o;
  } catch (e) {
    remove(ORG);
    return null;
  }
}
export function setOrganizer(token, organizer, expiresInSec) {
  write(ORG, JSON.stringify({ token, id: organizer.id, name: organizer.name, exp: Date.now() + (expiresInSec - 60) * 1000 }));
}
export function clearOrganizer() {
  remove(ORG);
}
export function getToken() {
  const o = getOrganizer();
  return o ? o.token : null;
}

function randomSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_'); // 32 chars of base64url
}

// One secret per browser per tournament. The server only ever stores its hash.
export function getSecret(eventId, create) {
  const key = 'ds:secret:' + eventId;
  let s = read(key);
  if (!s && create) {
    s = randomSecret();
    write(key, s);
  }
  return s;
}
