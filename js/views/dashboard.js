import { h, mount, refreshButton, spinner, errorBanner, toast, modal, copyText, eventLink, formatDate, daysLeft, plural, icon } from '../ui.js';
import { org } from '../api.js';
import { getOrganizer } from '../session.js';
import { organizerShell } from './layout.js';

export async function dashboardView() {
  const me = getOrganizer();
  const body = h('div', { class: 'page-body' });
  mount(organizerShell(
    h('div', { class: 'row between' },
      h('div', null,
        h('h1', { class: 'title', text: 'Your tournaments' }),
        h('p', { class: 'subtitle', text: 'Every organizer can see and manage all tournaments. Signed in as ' + (me ? me.name : '') })),
      h('div', { class: 'row' }, refreshButton(() => dashboardView()), h('a', { class: 'btn primary', href: '#/new' }, icon('plus'), 'New tournament'))),
    body));
  body.append(spinner('Loading tournaments...'));
  let events;
  try {
    events = await org('listEvents');
  } catch (err) {
    if (err.code !== 'unauthorized') body.replaceChildren(errorBanner(err));
    return;
  }
  let filter = 'all';
  const list = h('div', { class: 'cards' });
  const allBtn = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: () => setFilter('all') }, 'All tournaments');
  const mineBtn = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: () => setFilter('mine') }, 'Mine only');
  function setFilter(f) {
    filter = f;
    allBtn.setAttribute('aria-pressed', String(f === 'all'));
    mineBtn.setAttribute('aria-pressed', String(f === 'mine'));
    draw();
  }
  function draw() {
    const shown = events.filter((e) => filter === 'all' || (me && e.createdBy === me.id));
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'card' },
        h('h2', { class: 'sec', text: events.length ? 'Nothing here yet' : 'No tournaments yet' }),
        h('p', { class: 'subtitle', text: events.length ? 'You have not created any tournament.' : 'Create one, paste the results and share the link with the players.' }),
        h('div', null, h('a', { class: 'btn primary', href: '#/new' }, icon('plus'), 'New tournament'))));
      return;
    }
    list.replaceChildren(...shown.map(card));
  }
  function card(e) {
    const all = e.playerCount > 0 && e.submittedCount >= e.playerCount;
    const status = e.status === 'closed' ? ['Closed', 'pill muted'] : all ? ['All in', 'pill green'] : ['Collecting', 'pill'];
    const pct = e.playerCount ? Math.round((e.submittedCount / e.playerCount) * 100) : 0;
    return h('article', { class: 'card ev' },
      h('div', { class: 'row between', style: 'align-items:flex-start;flex-wrap:nowrap' },
        h('h2', { text: e.name }), h('span', { class: status[1], text: status[0] })),
      h('div', null,
        h('div', { class: 'meta', text: formatDate(e.datePlayed) + ' · ' + plural(e.playerCount, 'player', 'players') }),
        h('div', { class: 'meta', text: 'Created by ' + e.createdByName })),
      h('div', { class: 'stack' },
        h('div', { class: 'row between', style: 'flex-wrap:nowrap' },
          h('span', { class: 'meta', text: 'Decklists submitted' }),
          h('strong', { text: e.submittedCount + ' / ' + e.playerCount })),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: 'width:' + pct + '%' }))),
      h('div', { class: 'meta', text: 'Auto-deletes in ' + plural(daysLeft(e.expiresAt), 'day', 'days') }),
      h('div', { class: 'btns' },
        h('a', { class: 'btn primary', style: 'font-size:16px', href: '#/present/' + e.eventId }, 'Present'),
        h('a', { class: 'btn', href: '#/edit/' + e.eventId }, 'Edit'),
        h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(eventLink(e.eventId))) ? 'Link copied' : 'Could not copy. Copy it from the Edit page.') }, 'Copy link'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => remove(e) }, 'Delete now')));
  }
  async function remove(e) {
    const ok = await modal({
      title: 'Delete "' + e.name + '"?', danger: true, okText: 'Delete now',
      body: h('p', { class: 'subtitle', text: 'This permanently deletes the tournament, every submitted list and all photos. It can not be undone.' }),
      onOk: async () => { await org('deleteEvent', { eventId: e.eventId }); }
    });
    if (ok) {
      events = events.filter((x) => x.eventId !== e.eventId);
      draw();
      toast('Tournament deleted');
    }
  }
  body.replaceChildren(h('div', { class: 'filters' }, allBtn, mineBtn), list);
  draw();
}
