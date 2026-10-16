import { h, mount, setBusy, errorBanner, icon, rankTone } from '../ui.js';
import { call } from '../api.js';
import { setOrganizer, getOrganizer } from '../session.js';
import { brand } from './layout.js';

// A static picture of what the organizer gets: the standings, one deck per player.
function sample() {
  const rows = [[1, 'Kenji', '5-0', 'Yellow', 'Ram + Rem'], [2, 'Mara', '4-1', 'Blue', 'Blue'], [3, 'Dante', '4-1', 'Red', 'Red'], [4, 'Iris', '3-2', 'Green', 'Green']];
  return h('div', { class: 'sample', 'aria-hidden': 'true' },
    h('div', { class: 'sample-cap', text: 'Sample tournament' }),
    rows.map(([rank, who, rec, color, deck]) => h('div', { class: 'mini-row ' + rankTone(rank) },
      h('span', { class: 'mini-rank', text: String(rank) }),
      h('span', { class: 'mini-name', text: who }),
      h('span', { class: 'mini-rec', text: rec }),
      h('span', { class: 'mini-deck' }, h('span', { class: 'dot ' + color }), deck))));
}

export function loginView(notice) {
  if (getOrganizer()) {
    location.hash = getOrganizer().mustChange ? '#/password' : '#/dashboard';
    return;
  }
  const name = h('input', { class: 'input', id: 'org-name', type: 'text', autocomplete: 'username', maxlength: '60', required: true });
  const pass = h('input', { class: 'input', id: 'org-pass', type: 'password', autocomplete: 'current-password', maxlength: '200', required: true });
  const msg = h('div');
  const btn = h('button', { class: 'btn primary block', type: 'submit', style: 'min-height:52px' }, 'Sign in');
  const form = h('form', { class: 'card login-card', novalidate: true },
    h('div', null, h('h2', { class: 'sec', text: 'Organizer sign-in' }),
      h('p', { class: 'subtitle', style: 'margin-top:4px', text: 'Every organizer can see and manage all tournaments.' })),
    notice ? h('div', { class: 'banner info', text: notice }) : null,
    h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'org-name', text: 'Name' }), name),
    h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'org-pass', text: 'Password' }), pass),
    msg, btn,
    h('p', { class: 'hint', text: 'Players never need an account. They only open the link you share. Events delete themselves after the days you choose (14 by default).' }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.replaceChildren();
    if (!name.value.trim() || !pass.value) {
      msg.replaceChildren(errorBanner({ message: 'Enter your name and password.' }));
      return;
    }
    setBusy(btn, true, 'Signing in...');
    try {
      const r = await call('login', { name: name.value, password: pass.value });
      setOrganizer(r.token, r.organizer, r.expiresInSec);
      location.hash = r.organizer.mustChange ? '#/password' : '#/dashboard';
    } catch (err) {
      msg.replaceChildren(errorBanner(err));
      setBusy(btn, false);
    }
  });
  mount(h('div', { class: 'shell' },
    h('header', { class: 'topbar' }, brand('#/')),
    h('main', { class: 'page' },
      h('div', { class: 'hero' },
        h('div', { class: 'hero-text' },
          h('h1', null, 'Every decklist.', h('br'), 'One link.'),
          h('p', { class: 'subtitle', text: 'Post your tournament results, share the link, and players claim their name and submit what they played. Then present all the lists in one view.' }),
          sample()),
        form))));
  name.focus();
}
