import { h, mount, errorBanner, setBusy, toast, copyText, eventLink, plural, rankTone } from '../ui.js';
import { org } from '../api.js';
import { parseResults, checkTournamentLink } from '../../shared/parsers.js';
import { organizerShell } from './layout.js';

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function newEventView() {
  const name = h('input', { class: 'input', id: 'tname', type: 'text', maxlength: '80', placeholder: 'Hotkei Weekly', autocomplete: 'off' });
  const date = h('input', { class: 'input', id: 'tdate', type: 'date', value: today() });
  const days = h('input', { class: 'input', id: 'tdays', type: 'number', min: '1', max: '90', step: '1', value: '14', inputmode: 'numeric' });
  const results = h('textarea', { class: 'textarea', id: 'tresults', rows: '9', placeholder: '1  Kenji  5-0\n2  Mara  4-1\n3  Dante  4-1', spellcheck: 'false' });
  const exburst = h('input', { class: 'input', id: 'texburst', type: 'url', placeholder: 'https://exburst.dev/ua/en/tournaments/...', autocomplete: 'off' });
  const preview = h('div');
  const previewCount = h('span', { class: 'hint' });
  const formMsg = h('div');
  const submit = h('button', { class: 'btn primary', type: 'submit', style: 'flex:1 1 200px;min-height:52px' }, 'Create & get link');
  const sharePanel = h('div', { class: 'card', hidden: true }); // appears only once the tournament exists

  function drawPreview() {
    const r = parseResults(results.value);
    previewCount.textContent = r.players.length ? plural(r.players.length, 'player', 'players') + ' found' : '';
    const kids = [];
    if (r.players.length) {
      const t = h('div', { class: 'preview-table' },
        h('div', { class: 'h', text: '#' }), h('div', { class: 'h', text: 'PLAYER' }), h('div', { class: 'h rec', text: 'RECORD' }));
      for (const p of r.players.slice(0, 200)) {
        t.append(h('div', { class: 'r ' + rankTone(p.rank), text: String(p.rank) }), h('div', { text: p.name }), h('div', { class: 'rec', text: p.record }));
      }
      kids.push(t);
    } else {
      kids.push(h('p', { class: 'hint', text: 'Paste the final standings to see the players here.' }));
    }
    r.errors.forEach((e) => kids.push(h('div', { class: 'err', text: e })));
    r.warnings.forEach((e) => kids.push(h('div', { class: 'hint', text: 'Note: ' + e })));
    preview.replaceChildren(...kids);
    return r;
  }
  results.addEventListener('input', drawPreview);

  const form = h('form', { class: 'card', novalidate: true, oninput: () => { if (formMsg.querySelector('.banner.error')) formMsg.replaceChildren(); } },
    h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'tname', text: 'Tournament name' }), name),
    h('div', { class: 'row', style: 'align-items:flex-start' },
      h('div', { class: 'stack', style: 'flex:1 1 180px' }, h('label', { class: 'lbl', for: 'tdate', text: 'Date played' }), date),
      h('div', { class: 'stack', style: 'flex:1 1 180px' }, h('label', { class: 'lbl', for: 'tdays', text: 'Auto-delete after (days)' }), days)),
    h('div', { class: 'stack' },
      h('label', { class: 'lbl', for: 'tresults', text: 'Results (one player per line)' }), results,
      h('span', { class: 'hint', text: 'In finishing order, 1st at the top. A leading rank number and a final record such as 5-0 are optional.' })),
    h('div', { class: 'stack' },
      h('label', { class: 'lbl', for: 'texburst', text: 'Exburst tournament link (optional)' }), exburst),
    formMsg,
    h('div', { class: 'row form-actions' }, submit, h('a', { class: 'btn', href: '#/dashboard' }, 'Cancel')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formMsg.replaceChildren();
    const r = drawPreview();
    const problems = [];
    if (!name.value.trim()) problems.push('Enter a tournament name.');
    if (!date.value) problems.push('Pick the date played.');
    const d = Number(days.value);
    if (!Number.isInteger(d) || d < 1 || d > 90) problems.push('Auto-delete must be a whole number of days from 1 to 90.');
    if (!r.players.length) problems.push('Paste at least one player.');
    problems.push(...r.errors);
    const linkErr = checkTournamentLink(exburst.value);
    if (linkErr) problems.push(linkErr);
    if (problems.length) {
      formMsg.replaceChildren(errorBanner({ message: problems[0] }));
      return;
    }
    setBusy(submit, true, 'Creating...');
    try {
      const res = await org('createEvent', {
        name: name.value, datePlayed: date.value, expireDays: d, resultsText: results.value, exburstUrl: exburst.value.trim()
      });
      const link = eventLink(res.eventId);
      form.querySelectorAll('input,textarea').forEach((el) => { el.disabled = true; });
      submit.hidden = true;
      formMsg.replaceChildren(h('div', { class: 'banner ok', text: 'Tournament created with ' + plural(res.playerCount, 'player', 'players') + '.' }));
      const linkInput = h('input', { class: 'input', type: 'text', readonly: true, value: link, 'aria-label': 'Public tournament link' });
      linkInput.addEventListener('focus', () => linkInput.select());
      sharePanel.hidden = false;
      sharePanel.replaceChildren(
        h('h2', { class: 'sec', text: 'Share link' }),
        h('div', { class: 'linkbox' }, linkInput,
          h('button', { class: 'btn', type: 'button', onclick: async () => toast((await copyText(link)) ? 'Link copied' : 'Select the link and copy it') }, 'Copy')),
        h('p', { class: 'hint', text: 'Post it in your group chat. Players pick their name and send their list.' }),
        h('div', { class: 'row' },
          h('a', { class: 'btn primary', style: 'font-size:16px', href: '#/edit/' + res.eventId }, 'Open tournament'),
          h('a', { class: 'btn', href: '#/dashboard' }, 'Back to tournaments')));
    } catch (err) {
      formMsg.replaceChildren(errorBanner(err));
      setBusy(submit, false);
    }
  });

  mount(organizerShell(
    h('div', null,
      h('h1', { class: 'title', text: 'Create tournament' }),
      h('p', { class: 'subtitle', text: 'Paste the final standings. Players will pick their name from this list.' })),
    h('div', { class: 'grid-2' },
      form,
      h('div', { class: 'stack', style: 'gap:24px' },
        h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', { class: 'sec', text: 'Preview' }), previewCount), preview),
        sharePanel))));
  drawPreview();
  name.focus();
}
