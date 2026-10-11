import { runLeave, mount, h, toast } from './ui.js';
import { setUnauthorizedHandler } from './api.js';
import { getOrganizer } from './session.js';
import { loginView } from './views/login.js';
import { dashboardView } from './views/dashboard.js';
import { newEventView } from './views/newEvent.js';
import { editEventView } from './views/editEvent.js';
import { playerView } from './views/player.js';
import { presentView } from './views/present.js';
import { brand } from './views/layout.js';

let sessionNotice = '';
setUnauthorizedHandler(() => {
  sessionNotice = 'Your session expired. Please sign in again.';
  if (location.hash !== '#/') location.hash = '#/';
  else route();
});

function notFound() {
  mount(h('div', { class: 'shell' },
    h('header', { class: 'topbar' }, brand('#/')),
    h('main', { class: 'page page-narrow' },
      h('h1', { class: 'title', text: 'Page not found' }),
      h('p', { class: 'subtitle', text: 'Check the link you were given.' }),
      h('a', { class: 'btn', href: '#/' }, 'Home'))));
}

const ORG_ROUTES = new Set(['dashboard', 'new', 'edit', 'present']);

function route() {
  runLeave();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = parts[0] || '';
  const id = parts[1] || '';
  document.body.classList.remove('presenting');
  if (ORG_ROUTES.has(name) && !getOrganizer()) {
    location.hash = '#/';
    return;
  }
  const needsId = name === 'edit' || name === 'present' || name === 'e';
  if (needsId && !/^[a-f0-9]{6,32}$/.test(id)) return notFound();
  switch (name) {
    case '': { const n = sessionNotice; sessionNotice = ''; return loginView(n); }
    case 'dashboard': return dashboardView();
    case 'new': return newEventView();
    case 'edit': return editEventView(id);
    case 'present': return presentView(id);
    case 'e': return playerView(id);
    default: return notFound();
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Something went wrong. Reload the page and try again.', 'error');
});
route();
