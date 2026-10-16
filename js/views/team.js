import { h, mount, refreshButton, spinner, errorBanner, toast, modal, copyText, setBusy, icon } from '../ui.js';
import { org } from '../api.js';
import { organizerShell } from './layout.js';

function siteUrl() {
  return location.origin + location.pathname;
}

// Administrators only (the server checks too). Create accounts, reset passwords, disable, promote.
export async function teamView() {
  const body = h('div', { class: 'page-body' });
  const reveal = h('div'); // the one-time temporary password panel
  mount(organizerShell(
    h('div', { class: 'row between' },
      h('div', null,
        h('h1', { class: 'title', text: 'Team' }),
        h('p', { class: 'subtitle', text: 'Create accounts here. You give each person a temporary password, and they choose their own the first time they sign in.' })),
      h('div', { class: 'row head-actions' }, refreshButton(() => teamView()), h('a', { class: 'btn', href: '#/dashboard' }, 'Tournaments'))),
    reveal, body));
  body.append(spinner('Loading team...'));
  let people;
  try {
    people = await org('listOrganizers');
  } catch (err) {
    if (err.code !== 'unauthorized') body.replaceChildren(errorBanner(err));
    return;
  }

  function showPassword(title, name, temp, hours) {
    const message = 'Hi ' + name + '! Sign in at ' + siteUrl() + '\nName: ' + name + '\nTemporary password: ' + temp +
      '\nYou will choose your own password right away. The temporary one works for ' + hours + ' hours.';
    reveal.replaceChildren(h('section', { class: 'card reveal', 'aria-live': 'polite' },
      h('h2', { class: 'sec', text: title }),
      h('p', { class: 'subtitle', text: 'Send this to ' + name + ' privately. It is shown only now and can not be looked up later.' }),
      h('div', { class: 'temp-pass', text: temp }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => toast((await copyText(message)) ? 'Message copied' : 'Could not copy. Select the password and copy it.') }, 'Copy message'),
        h('button', { class: 'btn', type: 'button', onclick: () => reveal.replaceChildren() }, 'Done')),
      h('p', { class: 'hint', text: 'Works for ' + hours + ' hours. If it expires, reset the password.' })));
    reveal.scrollIntoView({ block: 'nearest' });
  }

  const nameIn = h('input', { class: 'input', id: 'new-org-name', type: 'text', maxlength: '60', autocomplete: 'off', required: true });
  const adminIn = h('input', { type: 'checkbox', id: 'new-org-admin' });
  const addMsg = h('div');
  const addBtn = h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Add organizer');
  const addForm = h('form', { class: 'card', novalidate: true },
    h('h2', { class: 'sec', text: 'Add an organizer' }),
    h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'new-org-name', text: 'Name' }), nameIn,
      h('p', { class: 'hint', text: 'This is the name they type to sign in.' })),
    h('label', { class: 'check', for: 'new-org-admin' }, adminIn, h('span', { text: 'Administrator (can also manage the team)' })),
    addMsg, h('div', null, addBtn));
  nameIn.addEventListener('input', () => addMsg.replaceChildren());
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    addMsg.replaceChildren();
    if (!nameIn.value.trim()) {
      addMsg.replaceChildren(errorBanner({ message: 'Enter a name.' }));
      return;
    }
    setBusy(addBtn, true, 'Adding...');
    try {
      const r = await org('createOrganizer', { name: nameIn.value, role: adminIn.checked ? 'admin' : 'organizer' });
      showPassword('Account created for ' + r.name, r.name, r.tempPassword, r.validHours);
      nameIn.value = '';
      adminIn.checked = false;
      people = await org('listOrganizers');
      draw();
    } catch (err) {
      addMsg.replaceChildren(errorBanner(err));
    }
    setBusy(addBtn, false);
  });

  const list = h('div', { class: 'team-list' });
  async function act(fn) {
    await fn();
    people = await org('listOrganizers');
    draw();
  }
  function confirmThen(p, opts) {
    return modal(Object.assign({ body: h('p', { class: 'subtitle', text: opts.text }) }, opts));
  }
  function row(p) {
    const pills = [];
    if (p.role === 'admin') pills.push(h('span', { class: 'pill', text: 'Admin' }));
    if (!p.active) pills.push(h('span', { class: 'pill muted', text: 'Disabled' }));
    else if (p.tempExpired) pills.push(h('span', { class: 'pill muted', text: 'Temporary password expired' }));
    else if (p.tempPending) pills.push(h('span', { class: 'pill muted', text: 'Has not signed in yet' }));
    const btns = [];
    if (!p.isMe) {
      btns.push(h('button', {
        class: 'btn small', type: 'button', 'aria-label': 'Reset password for ' + p.name,
        onclick: () => confirmThen(p, {
          title: 'Reset password for ' + p.name + '?', okText: 'Reset password',
          text: 'Their current password stops working and they are signed out everywhere. You will get a new temporary password to send them.',
          onOk: async () => {
            const r = await org('resetOrganizerPassword', { organizerId: p.id });
            await act(async () => {});
            showPassword('New temporary password for ' + r.name, r.name, r.tempPassword, r.validHours);
          }
        })
      }, 'Reset password'));
      btns.push(h('button', {
        class: 'btn small', type: 'button', 'aria-label': (p.role === 'admin' ? 'Remove admin from ' : 'Make admin ') + p.name,
        onclick: () => confirmThen(p, {
          title: (p.role === 'admin' ? 'Remove admin rights from ' : 'Make ') + p.name + (p.role === 'admin' ? '?' : ' an administrator?'),
          okText: p.role === 'admin' ? 'Remove admin' : 'Make admin',
          text: p.role === 'admin' ? 'They can still create and present tournaments, but not manage the team.' : 'They will be able to add and disable organizers and reset passwords.',
          onOk: () => act(() => org('setOrganizerRole', { organizerId: p.id, role: p.role === 'admin' ? 'organizer' : 'admin' }))
        })
      }, p.role === 'admin' ? 'Remove admin' : 'Make admin'));
      btns.push(h('button', {
        class: 'btn small' + (p.active ? ' danger' : ''), type: 'button', 'aria-label': (p.active ? 'Disable ' : 'Enable ') + p.name,
        onclick: () => confirmThen(p, {
          title: (p.active ? 'Disable ' : 'Enable ') + p.name + '?', danger: p.active, okText: p.active ? 'Disable' : 'Enable',
          text: p.active ? 'They are signed out now and can not sign in. Their tournaments stay. You can enable them again.' : 'They can sign in again with their current password.',
          onOk: () => act(() => org('setOrganizerActive', { organizerId: p.id, active: !p.active }))
        })
      }, p.active ? 'Disable' : 'Enable'));
    }
    return h('li', { class: 'team-row' + (p.active ? '' : ' off') },
      h('div', { class: 'team-who' },
        h('strong', { text: p.name }), p.isMe ? h('span', { class: 'meta', text: 'You' }) : null, ...pills),
      btns.length ? h('div', { class: 'team-btns' }, ...btns) : null);
  }
  function draw() {
    list.replaceChildren(h('h2', { class: 'sec', text: 'Everyone (' + people.length + ')' }), h('ul', { class: 'team-ul' }, ...people.map(row)));
  }
  body.replaceChildren(h('div', { class: 'grid-2' }, addForm, list));
  draw();
}
