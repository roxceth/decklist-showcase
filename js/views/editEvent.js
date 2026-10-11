import { h, mount, refreshButton, spinner, errorBanner, toast, modal, copyText, eventLink, formatDate, plural } from '../ui.js';
import { org } from '../api.js';
import { parseDeckText, checkTournamentLink } from '../../shared/parsers.js';
import { downloadTxt, downloadZip } from '../exporter.js';
import { organizerShell } from './layout.js';

const STATE_TEXT = {
  submitted: 'List sent · locked',
  released: 'Reopened · waiting for new list',
  claimed: 'Claimed · no list yet',
  open: 'Not claimed yet'
};
const TYPE_TEXT = { txt: 'text', photo: 'image', link: 'link' };

export async function editEventView(eventId) {
  const root = h('div', { class: 'page-body' });
  mount(organizerShell(root));
  root.append(spinner('Loading tournament...'));
  let data;

  async function load() {
    data = await org('getEventAdmin', { eventId });
  }
  try {
    await load();
  } catch (err) {
    if (err.code !== 'unauthorized') root.replaceChildren(errorBanner(err), h('a', { class: 'btn', href: '#/dashboard' }, 'Back to tournaments'));
    return;
  }

  async function refresh() {
    try {
      await load();
      draw();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function draw() {
    const ev = data.event;
    const link = eventLink(ev.eventId);
    const days = Math.max(1, Math.round((new Date(ev.expiresAt) - new Date(ev.createdAt)) / 86400000));

    // ---- details
    const name = h('input', { class: 'input', id: 'e-name', maxlength: '80', value: ev.name });
    const date = h('input', { class: 'input', id: 'e-date', type: 'date', value: ev.datePlayed });
    const daysIn = h('input', { class: 'input', id: 'e-days', type: 'number', min: '1', max: '90', step: '1', value: String(days) });
    const exb = h('input', { class: 'input', id: 'e-exb', type: 'url', placeholder: 'https://exburst.dev/ua/en/tournaments/...', value: ev.exburstUrl || '' });
    const detailsMsg = h('div');
    const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Save changes');
    const details = h('form', { class: 'card', novalidate: true },
      h('h2', { class: 'sec', text: 'Details' }),
      h('div', { class: 'row', style: 'align-items:flex-start' },
        h('div', { class: 'stack', style: 'flex:2 1 220px' }, h('label', { class: 'lbl', for: 'e-name', text: 'Tournament name' }), name),
        h('div', { class: 'stack', style: 'flex:1 1 160px' }, h('label', { class: 'lbl', for: 'e-date', text: 'Date played' }), date),
        h('div', { class: 'stack', style: 'flex:1 1 160px' }, h('label', { class: 'lbl', for: 'e-days', text: 'Auto-delete after (days)' }), daysIn)),
      h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'e-exb', text: 'Exburst tournament link (optional)' }), exb),
      detailsMsg,
      h('div', { class: 'row' }, saveBtn,
        h('span', { class: 'hint', text: 'Auto-deletes on ' + formatDate(ev.expiresAt.slice(0, 10)) + ', counted from when it was created.' })));
    details.addEventListener('submit', async (e) => {
      e.preventDefault();
      detailsMsg.replaceChildren();
      const d = Number(daysIn.value);
      const linkErr = checkTournamentLink(exb.value);
      if (!name.value.trim()) return detailsMsg.replaceChildren(errorBanner({ message: 'Enter a tournament name.' }));
      if (!date.value) return detailsMsg.replaceChildren(errorBanner({ message: 'Pick the date played.' }));
      if (!Number.isInteger(d) || d < 1 || d > 90) return detailsMsg.replaceChildren(errorBanner({ message: 'Auto-delete must be a whole number of days from 1 to 90.' }));
      if (linkErr) return detailsMsg.replaceChildren(errorBanner({ message: linkErr }));
      saveBtn.disabled = true;
      try {
        await org('updateEvent', { eventId, name: name.value, datePlayed: date.value, expireDays: d, exburstUrl: exb.value.trim() });
        toast('Changes saved');
        await refresh();
      } catch (err) {
        detailsMsg.replaceChildren(errorBanner(err));
        saveBtn.disabled = false;
      }
    });

    // ---- share + status
    const linkInput = h('input', { class: 'input', readonly: true, value: link, 'aria-label': 'Public tournament link' });
    linkInput.addEventListener('focus', () => linkInput.select());
    const open = ev.status === 'open';
    const share = h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('h2', { class: 'sec', text: 'Share link' }),
        h('span', { class: 'pill ' + (open ? '' : 'muted'), text: open ? 'Accepting lists' : 'Closed' })),
      h('div', { class: 'linkbox' }, linkInput,
        h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(link)) ? 'Link copied' : 'Select the link and copy it') }, 'Copy')),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            try {
              await org('setStatus', { eventId, status: open ? 'closed' : 'open' });
              await refresh();
            } catch (err) { toast(err.message, 'error'); }
          }
        }, open ? 'Stop accepting lists' : 'Accept lists again'),
        h('a', { class: 'btn primary', style: 'font-size:16px', href: '#/present/' + ev.eventId }, 'Present'),
        refreshButton(async () => { await load(); draw(); })));

    // ---- players
    const submittedCount = data.players.filter((p) => p.deck).length;
    const rows = data.players.map(playerRow);
    const players = h('div', { class: 'card' },
      h('div', { class: 'row between' },
        h('div', null,
          h('h2', { class: 'sec', text: 'Players and decklists' }),
          h('p', { class: 'hint', text: submittedCount + ' of ' + data.players.length + ' lists in. Release a list so the player can send a new one. Their old list is kept until they replace it.' })),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary small', type: 'button', style: 'font-size:14px', disabled: submittedCount === 0, onclick: exportAll }, 'Export all lists (.zip)'),
          h('button', { class: 'btn small', type: 'button', onclick: addPlayer }, 'Add late player'))),
      h('div', { class: 'table' }, rows),
      h('p', { class: 'hint', text: "Editing a name, rank or record keeps the player's claim and list. Removing a player also deletes their list. Text lists download as .txt; images and links are listed in summary.csv inside the .zip." }));

    const del = h('div', { class: 'row between' },
      h('button', { class: 'btn danger', type: 'button', onclick: deleteEvent }, 'Delete tournament and all lists'),
      h('a', { class: 'btn', href: '#/dashboard' }, 'Back to tournaments'));

    root.replaceChildren(
      h('div', null,
        h('h1', { class: 'title', text: 'Edit tournament' }),
        h('p', { class: 'subtitle', text: ev.name + ' · created by ' + ev.createdByName })),
      share, details, players, del);
  }

  function playerRow(p) {
    const good = p.state === 'submitted';
    const stateText = good && p.deck ? STATE_TEXT.submitted + ' · ' + TYPE_TEXT[p.deck.type] : STATE_TEXT[p.state];
    const acts = [];
    if (p.deck) acts.push(h('button', { class: 'btn small', type: 'button', onclick: () => viewList(p) }, 'View list'));
    if (p.deck && p.deck.type === 'txt') acts.push(h('button', { class: 'btn small', type: 'button', onclick: () => downloadOne(p) }, 'Download .txt'));
    if (p.state === 'submitted') acts.push(h('button', { class: 'btn small warn', type: 'button', onclick: () => act('releaseList', p, 'List released') }, 'Release list'));
    if (p.state === 'released') acts.push(h('button', { class: 'btn small warn', type: 'button', onclick: () => act('undoRelease', p, 'Release undone, list locked again') }, 'Undo release'));
    if (p.state === 'claimed') acts.push(h('button', { class: 'btn small warn', type: 'button', onclick: () => act('releaseName', p, 'Name released') }, 'Release name'));
    acts.push(h('button', { class: 'btn small', type: 'button', onclick: () => editPlayer(p) }, 'Edit'));
    acts.push(h('button', { class: 'btn small danger', type: 'button', onclick: () => removePlayer(p) }, 'Remove'));
    return h('div', { class: 'trow' },
      h('span', { class: 'rank', text: String(p.rank) }),
      h('span', { class: 'nm', text: p.name }),
      h('span', { class: 'rec', text: p.record }),
      h('span', { class: 'st ' + (good ? 'good' : p.state === 'released' ? 'warn' : ''), text: stateText }),
      h('div', { class: 'acts' }, acts));
  }

  async function act(action, p, doneText) {
    try {
      await org(action, { eventId, playerId: p.playerId });
      toast(doneText);
      await refresh();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function fetchEntries() {
    const d = await org('getDecklists', { eventId });
    return d.entries;
  }

  async function downloadOne(p) {
    try {
      const entries = await fetchEntries();
      const e = entries.find((x) => x.playerId === p.playerId);
      if (!e || !e.deck || e.deck.type !== 'txt') throw new Error('This player has no text list.');
      downloadTxt(e);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function exportAll() {
    try {
      downloadZip(data.event.name, await fetchEntries());
      toast('Export downloaded');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function viewList(p) {
    const body = h('div', { class: 'stack' }, spinner('Loading...'));
    const dlg = modal({ title: p.name + ' · ' + (p.deck.deckName || p.deck.deckColor), body, cancelText: 'Close', hideOk: true });
    try {
      const entries = await fetchEntries();
      const e = entries.find((x) => x.playerId === p.playerId);
      const d = e && e.deck;
      if (!d) throw new Error('No list found.');
      if (d.type === 'txt') {
        const parsed = parseDeckText(d.content);
        body.replaceChildren(
          h('div', { class: 'hint', text: parsed.total + ' cards in the main deck · ' + plural(parsed.entries.length, 'different card', 'different cards') + (parsed.warnings.length ? ' · ' + parsed.warnings.join(' ') : '') }),
          h('pre', { text: d.content }));
      } else if (d.type === 'link') {
        body.replaceChildren(
          h('p', { class: 'hint', text: 'This list was sent as an Exburst link.' }),
          h('a', { class: 'btn primary', href: d.content, target: '_blank', rel: 'noopener noreferrer' }, 'Open on Exburst'),
          h('input', { class: 'input', readonly: true, value: d.content, 'aria-label': 'Deck link' }));
      } else {
        const ph = await org('getPhoto', { eventId, deckId: d.deckId });
        if (!/^image\/(jpeg|png|webp)$/.test(ph.mime)) throw new Error('Unexpected image type.');
        body.replaceChildren(h('img', { src: 'data:' + ph.mime + ';base64,' + ph.base64, alt: 'Decklist image from ' + p.name }));
      }
    } catch (err) {
      body.replaceChildren(errorBanner(err));
    }
    await dlg;
  }

  async function editPlayer(p) {
    const n = h('input', { class: 'input', id: 'p-name', maxlength: '60', value: p.name });
    const r = h('input', { class: 'input', id: 'p-rank', type: 'number', min: '1', max: '999', step: '1', value: String(p.rank) });
    const rec = h('input', { class: 'input', id: 'p-rec', maxlength: '8', placeholder: '3-2', value: p.record });
    const body = h('div', { class: 'stack', style: 'gap:14px' },
      h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'p-name', text: 'Name' }), n),
      h('div', { class: 'row', style: 'align-items:flex-start' },
        h('div', { class: 'stack', style: 'flex:1 1 120px' }, h('label', { class: 'lbl', for: 'p-rank', text: 'Rank' }), r),
        h('div', { class: 'stack', style: 'flex:1 1 120px' }, h('label', { class: 'lbl', for: 'p-rec', text: 'Record' }), rec)),
      h('p', { class: 'hint', text: 'Changing these keeps the name claimed and the list as it is.' }),
      p.claimed && p.state !== 'claimed' ? h('div', null, h('button', {
        class: 'btn warn small', type: 'button',
        onclick: async (ev) => {
          ev.target.disabled = true;
          try {
            await org('releaseName', { eventId, playerId: p.playerId });
            toast('Name released');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // closes the dialog
            await refresh();
          } catch (err) { toast(err.message, 'error'); ev.target.disabled = false; }
        }
      }, 'Release name so someone else can claim it')) : null);
    const ok = await modal({
      title: 'Edit ' + p.name, body, okText: 'Save',
      onOk: async () => {
        await org('updatePlayer', { eventId, playerId: p.playerId, name: n.value, rank: Number(r.value), record: rec.value.trim() });
      }
    });
    if (ok) {
      toast('Player updated');
      await refresh();
    }
  }

  async function addPlayer() {
    const n = h('input', { class: 'input', id: 'a-name', maxlength: '60' });
    const rec = h('input', { class: 'input', id: 'a-rec', maxlength: '8', placeholder: '3-2 (optional)' });
    const ok = await modal({
      title: 'Add late player', okText: 'Add player',
      body: h('div', { class: 'stack', style: 'gap:14px' },
        h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'a-name', text: 'Name' }), n),
        h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'a-rec', text: 'Record' }), rec),
        h('p', { class: 'hint', text: 'The player is added at the end. Edit the rank afterwards if needed.' })),
      onOk: async () => { await org('addPlayer', { eventId, name: n.value, record: rec.value.trim() }); }
    });
    if (ok) {
      toast('Player added');
      await refresh();
    }
  }

  async function removePlayer(p) {
    const ok = await modal({
      title: 'Remove ' + p.name + '?', danger: true, okText: 'Remove',
      body: h('p', { class: 'subtitle', text: p.deck ? 'Their submitted list is deleted too. This can not be undone.' : 'They disappear from the list the players see.' }),
      onOk: async () => { await org('removePlayer', { eventId, playerId: p.playerId }); }
    });
    if (ok) {
      toast('Player removed');
      await refresh();
    }
  }

  async function deleteEvent() {
    const ok = await modal({
      title: 'Delete "' + data.event.name + '"?', danger: true, okText: 'Delete tournament',
      body: h('p', { class: 'subtitle', text: 'This permanently deletes the tournament, every submitted list and all photos. It can not be undone.' }),
      onOk: async () => { await org('deleteEvent', { eventId }); }
    });
    if (ok) {
      toast('Tournament deleted');
      location.hash = '#/dashboard';
    }
  }

  draw();
}
