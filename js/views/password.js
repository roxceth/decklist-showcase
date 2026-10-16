import { h, mount, setBusy, errorBanner, toast } from '../ui.js';
import { org } from '../api.js';
import { getOrganizer, setOrganizer } from '../session.js';
import { organizerShell } from './layout.js';

// Own password. Reached from the top bar, and forced after signing in with a temporary password.
export function passwordView() {
  const me = getOrganizer();
  const forced = !!(me && me.mustChange);
  const field = (id, label, auto) => ({
    input: h('input', { class: 'input', id, type: 'password', autocomplete: auto, maxlength: '200', required: true }),
    label
  });
  const cur = field('pw-cur', forced ? 'Temporary password' : 'Current password', 'current-password');
  const nw = field('pw-new', 'New password', 'new-password');
  const rep = field('pw-rep', 'Repeat new password', 'new-password');
  const msg = h('div');
  const btn = h('button', { class: 'btn primary block', type: 'submit', style: 'min-height:52px' }, forced ? 'Save and continue' : 'Change password');
  const form = h('form', { class: 'card', novalidate: true },
    h('h2', { class: 'sec', text: forced ? 'Choose your own password' : 'Change password' }),
    forced
      ? h('p', { class: 'subtitle', text: 'You signed in with a temporary password. Choose one only you know. You need at least 8 characters.' })
      : h('p', { class: 'subtitle', text: 'You need at least 8 characters. Other devices where you are signed in will be signed out.' }),
    ...[cur, nw, rep].map((f) => h('div', { class: 'stack' }, h('label', { class: 'lbl', for: f.input.id, text: f.label }), f.input)),
    msg, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.replaceChildren();
    let problem = '';
    if (!cur.input.value) problem = 'Enter your ' + (forced ? 'temporary' : 'current') + ' password.';
    else if (nw.input.value.length < 8) problem = 'The new password needs at least 8 characters.';
    else if (nw.input.value !== rep.input.value) problem = 'The two new passwords are not the same.';
    if (problem) {
      msg.replaceChildren(errorBanner({ message: problem }));
      return;
    }
    setBusy(btn, true, 'Saving...');
    try {
      const r = await org('changePassword', { currentPassword: cur.input.value, newPassword: nw.input.value });
      setOrganizer(r.token, r.organizer, r.expiresInSec);
      toast('Password saved');
      location.hash = '#/dashboard';
    } catch (err) {
      msg.replaceChildren(errorBanner(err));
      setBusy(btn, false);
    }
  });
  mount(organizerShell(
    h('div', null,
      h('h1', { class: 'title', text: forced ? 'Welcome' : 'Password' }),
      forced ? h('p', { class: 'subtitle', text: 'One quick step before you start.' }) : null),
    h('div', { class: 'page-narrow', style: 'margin:0' }, form)));
  cur.input.focus();
}
