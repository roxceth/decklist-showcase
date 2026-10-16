import { getToken, getOrganizer, setOrganizer, clearOrganizer } from './session.js';

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

function apiUrl() {
  return (window.DS_CONFIG && window.DS_CONFIG.API_URL) || '';
}

// POST with text/plain avoids the CORS preflight that Apps Script web apps can not answer.
export async function call(action, body = {}, opts = {}) {
  const url = apiUrl();
  if (!url) throw new ApiError('config', 'The site is not connected to its server yet (API_URL is empty in config.js).');
  const payload = Object.assign({}, body, { action });
  if (opts.auth) {
    const token = getToken();
    if (!token) {
      onUnauthorized();
      throw new ApiError('unauthorized', 'Please sign in again.');
    }
    payload.token = token;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    throw new ApiError('network', "Can't reach the server. Check your connection and try again.");
  }
  clearTimeout(timer);
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new ApiError('bad_response', 'The server sent an unexpected answer. Try again in a moment.');
  }
  if (!json || json.ok !== true) {
    const err = (json && json.error) || { code: 'server_error', message: 'Something went wrong.' };
    if (err.code === 'unauthorized' && opts.auth) {
      clearOrganizer();
      onUnauthorized();
    }
    if (err.code === 'password_change_required' && opts.auth) {
      const me = getOrganizer();
      if (me) setOrganizer(me.token, Object.assign({}, me, { mustChange: true }), Math.round((me.exp - Date.now()) / 1000) + 60);
      location.hash = '#/password';
    }
    throw new ApiError(err.code, err.message);
  }
  return json.data;
}

export const org = (action, body, opts) => call(action, body, Object.assign({ auth: true }, opts));
