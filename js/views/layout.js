import { h, icon } from '../ui.js';
import { getOrganizer, clearOrganizer } from '../session.js';
import { call } from '../api.js';

export function brand(href = '#/') {
  return h('a', { class: 'brand', href, 'aria-label': 'Decklist Showcase home' }, icon('logo'), h('span', { text: 'DECKLIST SHOWCASE' }));
}

export function organizerShell(...pageChildren) {
  const o = getOrganizer();
  const signOut = h('button', {
    class: 'btn small', type: 'button',
    onclick: async () => {
      try { await call('logout', { token: o && o.token }); } catch (e) { /* the session may already be gone */ }
      clearOrganizer();
      location.hash = '#/';
    }
  }, 'Sign out');
  return h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      brand('#/dashboard'),
      h('div', { class: 'topbar-right' },
        o ? h('span', { class: 'who' }, 'Signed in as ', h('strong', { text: o.name })) : null,
        o ? signOut : null)),
    h('main', { class: 'page' }, ...pageChildren));
}

export function playerShell(...pageChildren) {
  return h('div', { class: 'shell' },
    h('header', { class: 'topbar' }, brand('#/')),
    h('main', { class: 'page page-narrow' }, ...pageChildren));
}
