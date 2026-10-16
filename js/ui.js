// Tiny DOM helpers. User data is only ever put in the page with textContent / text nodes.
const SVG = {
  logo: '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="3" y="6" width="14" height="19" rx="2" stroke="#e0b14a" stroke-width="2"/><rect x="10" y="3" width="14" height="19" rx="2" fill="#0d0f14" stroke="#e0b14a" stroke-width="2"/></svg>',
  left: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12 4L6 10l6 6" stroke="#eef0f4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M8 4l6 6-6 6" stroke="#0d0f14" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ext: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M7 3H4a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M10 3h5v5M15 3l-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  link: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1" stroke="#e0b14a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8a5 5 0 11-1.6-3.7M13 2.5v3h-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
};

export function appName() {
  return (window.DS_CONFIG && window.DS_CONFIG.APP_NAME) || 'Decklist Showcase';
}

// Team logo from config (falls back to the built-in icon if the file is missing).
export function logoEl() {
  const url = window.DS_CONFIG && window.DS_CONFIG.LOGO_URL;
  const fallback = () => icon('logo');
  if (!url) return fallback();
  const img = document.createElement('img');
  img.className = 'brand-logo';
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.src = url;
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

// "Refresh" button: runs fn (async), shows busy state, reports failures as a toast.
export function refreshButton(fn, label = 'Refresh') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small';
  const setLabel = (text) => { btn.replaceChildren(icon('refresh'), document.createTextNode(' ' + text)); };
  setLabel(label);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    setLabel('Refreshing...');
    try {
      await fn();
    } catch (e) {
      toast((e && e.message) || 'Could not refresh.', 'error');
    }
    if (btn.isConnected) {
      btn.disabled = false;
      setLabel(label);
    }
  });
  return btn;
}

export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = SVG[name]; // static markup only
  return t.content.firstChild;
}

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden']);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (PROPS.has(k)) el[k] = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function mount(node) {
  const app = document.getElementById('app');
  app.replaceChildren(node);
  window.scrollTo(0, 0);
  return node;
}

export function toast(message, kind) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : ''), text: message });
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

export function spinner(text) {
  return h('div', { class: 'center' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text ? h('span', { text }) : null);
}

export function errorBanner(err) {
  return h('div', { class: 'banner error', role: 'alert', text: (err && err.message) || 'Something went wrong.' });
}

// Confirm / form dialog. Resolves to true/false (or whatever `onOk` returns) and cleans up after itself.
export function modal({ title, body, okText = 'OK', cancelText = 'Cancel', danger = false, hideOk = false, onOk }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const errBox = h('div');
    const okBtn = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button' }, okText);
    const cancelBtn = h('button', { class: 'btn', type: 'button' }, cancelText);
    const close = (v) => {
      bg.remove();
      document.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    okBtn.addEventListener('click', async () => {
      if (!onOk) return close(true);
      okBtn.disabled = true;
      errBox.replaceChildren();
      try {
        const r = await onOk();
        close(r === undefined ? true : r);
      } catch (e) {
        okBtn.disabled = false;
        errBox.replaceChildren(errorBanner(e));
      }
    });
    cancelBtn.addEventListener('click', () => close(false));
    const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', { text: title }), body, errBox,
      h('div', { class: 'row', style: 'justify-content:flex-end' }, cancelBtn, hideOk ? null : okBtn));
    const bg = h('div', { class: 'modal-bg' }, dlg);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(false); });
    document.addEventListener('keydown', onKey);
    document.body.append(bg);
    (dlg.querySelector('input,textarea') || okBtn).focus();
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { /* ignore */ }
    ta.remove();
    return ok;
  }
}

export function eventLink(eventId) {
  return location.href.split('#')[0] + '#/e/' + eventId;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatDate(iso) {
  // iso: YYYY-MM-DD. Parsed manually so the user's time zone never shifts the day.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

export function daysLeft(expiresAtIso) {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

export const COLORS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple'];

export function setBusy(btn, busy, textWhileBusy) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    if (textWhileBusy) btn.textContent = textWhileBusy;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

// Views register cleanup callbacks (listeners, timers); the router runs them on every route change.
const leaveFns = [];
export function onLeave(fn) {
  leaveFns.push(fn);
}
export function runLeave() {
  while (leaveFns.length) {
    try { leaveFns.pop()(); } catch (e) { /* ignore */ }
  }
}

// Colour family for a finishing position: gold, silver, bronze, then neutral.
export function rankTone(n) {
  n = Number(n);
  return n === 1 ? 'r1' : n === 2 ? 'r2' : n === 3 ? 'r3' : 'rn';
}
