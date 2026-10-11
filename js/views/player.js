import { h, mount, spinner, errorBanner, toast, formatDate, plural, ordinal, icon, COLORS, setBusy } from '../ui.js';
import { call } from '../api.js';
import { getSecret } from '../session.js';
import { parseDeckText, checkDeckLink, LIMITS } from '../../shared/parsers.js';
import { prepareImage } from '../image.js';
import { playerShell } from './layout.js';

const STATE_LABEL = {
  submitted: ['List sent', 'good'],
  released: ['Updating list', ''],
  claimed: ['Claimed\nno list yet', '']
};

export async function playerView(eventId) {
  const root = h('div', { class: 'stack', style: 'gap:24px' });
  mount(playerShell(root));
  root.append(spinner('Loading tournament...'));

  let data;
  async function load() {
    const secret = getSecret(eventId, false);
    data = await call('getEvent', Object.assign({ eventId }, secret ? { secret } : {}));
  }
  try {
    await load();
  } catch (err) {
    root.replaceChildren(errorBanner(err), h('p', { class: 'hint', text: 'Check that you opened the full link from the organizer.' }));
    return;
  }

  function header() {
    const ev = data.event;
    return h('div', null,
      h('div', { class: 'eyebrow', text: 'Union Arena tournament' }),
      h('h1', { class: 'title', style: 'margin-top:6px', text: ev.name }),
      h('p', { class: 'subtitle', text: formatDate(ev.datePlayed) + ' · ' + plural(data.players.length, 'player', 'players') }));
  }

  function footer() {
    return h('div', { class: 'stack' },
      h('p', { class: 'hint', text: 'Someone took your name by mistake? Ask the organizer to release it.' }),
      h('p', { class: 'hint', text: 'This page and all lists are deleted on ' + formatDate(data.event.expiresAt.slice(0, 10)) + '.' }));
  }

  function draw() {
    if (data.me) return drawMine();
    return drawPicker();
  }

  // ---------------------------------------------------------------- name picker
  function drawPicker(picked) {
    const ev = data.event;
    if (picked) return drawConfirm(picked);
    const rows = data.players.map((p) => {
      let right;
      if (p.state === 'open' && ev.status === 'open') {
        right = h('button', { class: 'btn primary', style: 'font-size:16px;min-height:44px;padding:0 16px', type: 'button', onclick: () => root.replaceChildren(...drawPicker(p)) }, "That's me");
      } else if (p.state === 'open') {
        right = h('span', { class: 'claim-state', text: 'Not claimed' });
      } else {
        const [txt, cls] = STATE_LABEL[p.state];
        right = h('span', { class: 'claim-state ' + cls }, p.state === 'submitted' ? icon('check') : null, ' ', txt.split('\n').flatMap((t, i) => (i ? [h('br'), t] : [t])));
      }
      return h('div', { class: 'claim-row' },
        h('span', { class: 'rank', text: String(p.rank) }),
        h('div', { class: 'nm' }, p.name, p.record ? h('small', { text: p.record + ' record' }) : null),
        right);
    });
    return [
      header(),
      ev.status === 'closed' ? h('div', { class: 'banner info', role: 'status', text: 'This tournament is no longer accepting lists.' }) : null,
      h('div', null,
        h('h2', { class: 'sec', text: 'Find your name' }),
        h('p', { class: 'subtitle', style: 'margin-top:4px', text: 'Tap "That\'s me" next to your name, then send the decklist you played.' })),
      h('div', { class: 'claim-list' }, rows),
      footer()
    ];
  }

  function drawConfirm(p) {
    const msg = h('div');
    const yes = h('button', { class: 'btn primary block', style: 'min-height:52px', type: 'button' }, "Yes, that's me");
    yes.addEventListener('click', async () => {
      msg.replaceChildren();
      setBusy(yes, true, 'Claiming...');
      try {
        await call('claimPlayer', { eventId, playerId: p.playerId, secret: getSecret(eventId, true) });
        await load();
        root.replaceChildren(...draw());
      } catch (err) {
        msg.replaceChildren(errorBanner(err));
        setBusy(yes, false);
        if (err.code === 'taken') {
          try { await load(); } catch (e) { /* keep the message */ }
        }
      }
    });
    return [
      header(),
      h('div', { class: 'card' },
        h('h2', { class: 'sec', text: 'Is this you?' }),
        h('div', { class: 'claim-row' },
          h('span', { class: 'rank', text: String(p.rank) }),
          h('div', { class: 'nm' }, p.name, h('small', { text: ordinal(p.rank) + ' place' + (p.record ? ' · ' + p.record + ' record' : '') }))),
        h('p', { class: 'hint', text: 'You can only claim one name on this device. If you pick the wrong one, the organizer can release it.' }),
        msg, yes,
        h('button', { class: 'btn block', type: 'button', onclick: () => root.replaceChildren(...drawPicker()) }, 'Not me, go back'))
    ];
  }

  // ---------------------------------------------------------------- my list
  function drawMine() {
    const me = data.me;
    const p = data.players.find((x) => x.playerId === me.playerId);
    const top = [
      h('div', null,
        h('div', { class: 'eyebrow', text: data.event.name + ' · ' + formatDate(data.event.datePlayed) }),
        h('h1', { class: 'title', style: 'margin-top:6px', text: p.name }),
        h('p', { class: 'subtitle', text: ordinal(p.rank) + ' place' + (p.record ? ' · ' + p.record + ' record' : '') }))
    ];
    if (me.deck && me.locked) {
      return top.concat([
        h('div', { class: 'card' },
          h('div', { class: 'row' }, icon('check'), h('h2', { class: 'sec', text: 'Your list is in' })),
          h('div', { class: 'row' },
            h('span', { class: 'dot ' + me.deck.deckColor }),
            h('strong', { text: (me.deck.deckName ? me.deck.deckName + ' · ' : '') + me.deck.deckColor }),
            h('span', { class: 'hint', text: ({ txt: 'Sent as text', photo: 'Sent as image', link: 'Sent as Exburst link' })[me.deck.type] })),
          h('p', { class: 'hint', text: 'Need to change it? Ask the organizer to reopen your list, then come back to this page on this device.' }))
      ]);
    }
    return top.concat(drawForm(me));
  }

  function drawForm(me) {
    let tab = 'txt';
    let color = '';
    let img = null;
    const closed = data.event.status === 'closed';
    const deckName = h('input', { class: 'input', id: 'deck-name', maxlength: String(LIMITS.MAX_DECK_NAME), placeholder: 'e.g. Ram + Rem', autocomplete: 'off' });
    const colorBtns = COLORS.map((c) => h('button', {
      class: 'chip', type: 'button', role: 'radio', 'aria-checked': 'false',
      onclick: () => { msg.replaceChildren(); color = c; colorBtns.forEach((b, i) => b.setAttribute('aria-checked', String(COLORS[i] === c))); }
    }, h('span', { class: 'dot ' + c }), c));
    const text = h('textarea', { class: 'textarea', id: 'deck-text', rows: '10', spellcheck: 'false', placeholder: 'Paste the list you copied from Exburst (Export > Copy the list)' });
    const textInfo = h('div', { class: 'hint' });
    const fileTxt = h('input', { type: 'file', accept: '.txt,text/plain', hidden: true });
    const fileImg = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const imgInfo = h('div', { class: 'hint' });
    const imgBox = h('div', { class: 'stack' });
    const link = h('input', { class: 'input', id: 'deck-link', type: 'url', placeholder: 'https://exburst.dev/ua/en/deck/...', autocomplete: 'off' });
    const linkInfo = h('div', { class: 'hint' });
    const msg = h('div');
    const send = h('button', { class: 'btn primary block', style: 'min-height:52px', type: 'submit' }, 'Submit decklist');

    text.addEventListener('input', () => {
      if (!text.value.trim()) return textInfo.replaceChildren();
      const r = parseDeckText(text.value);
      textInfo.textContent = r.entries.length
        ? r.total + ' cards · ' + plural(r.entries.length, 'different card', 'different cards') + (r.warnings.length ? ' · ' + r.warnings.join(' ') : '')
        : 'No cards found yet. Use Export > Copy the list in Exburst.';
    });
    fileTxt.addEventListener('change', async () => {
      const f = fileTxt.files[0];
      if (!f) return;
      if (f.size > 100000) { toast('That file is too big for a decklist.', 'error'); return; }
      text.value = await f.text();
      text.dispatchEvent(new Event('input'));
      fileTxt.value = '';
    });
    fileImg.addEventListener('change', async () => {
      const f = fileImg.files[0];
      if (!f) return;
      imgInfo.textContent = 'Preparing image...';
      img = null;
      try {
        img = await prepareImage(f);
        imgBox.replaceChildren(h('img', { class: 'imgprev', src: img.previewUrl, alt: 'Preview of your decklist image' }));
        imgInfo.textContent = img.width + ' × ' + img.height + ' px · ' + Math.round(img.bytes / 1024) + ' KB after shrinking';
      } catch (err) {
        imgBox.replaceChildren();
        imgInfo.textContent = '';
        msg.replaceChildren(errorBanner(err));
      }
      fileImg.value = '';
    });
    link.addEventListener('input', () => {
      linkInfo.textContent = link.value.trim() ? checkDeckLink(link.value) : '';
      linkInfo.className = linkInfo.textContent ? 'err' : 'hint';
    });

    const panels = {
      txt: h('div', { class: 'stack', role: 'tabpanel' },
        h('label', { class: 'lbl', for: 'deck-text', text: 'Paste the text from Exburst or upload a .txt' }),
        text, textInfo,
        h('button', { class: 'btn block', type: 'button', onclick: () => fileTxt.click() }, 'Choose .txt file'), fileTxt),
      photo: h('div', { class: 'stack', role: 'tabpanel', hidden: true },
        h('p', { class: 'hint', text: 'Best: the PNG from Exburst (Export > Image). A clear screenshot or photo also works. It is shrunk on your device before sending.' }),
        h('button', { class: 'btn block', type: 'button', onclick: () => fileImg.click() }, 'Choose image or take photo'), fileImg,
        imgBox, imgInfo),
      link: h('div', { class: 'stack', role: 'tabpanel', hidden: true },
        h('label', { class: 'lbl', for: 'deck-link', text: 'Exburst deck link' }), link, linkInfo,
        h('p', { class: 'hint', text: 'Only exburst.dev deck links are accepted.' }))
    };
    const tabDefs = [['txt', 'Text'], ['photo', 'Image'], ['link', 'Exburst link']];
    const tabBtns = tabDefs.map(([key, label]) => h('button', {
      class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(key === tab),
      onclick: () => {
        tab = key;
        tabBtns.forEach((b, i) => b.setAttribute('aria-selected', String(tabDefs[i][0] === key)));
        Object.entries(panels).forEach(([k, el]) => { el.hidden = k !== key; });
        msg.replaceChildren();
      }
    }, label));

    const form = h('form', { class: 'card', novalidate: true, oninput: () => msg.replaceChildren() },
      h('div', null, h('h2', { class: 'sec', text: 'Send your decklist' }),
        h('p', { class: 'subtitle', style: 'margin-top:4px', text: 'Choose how you want to send the list you played in this tournament.' })),
      me.deck ? h('div', { class: 'banner info', text: 'The organizer reopened your list. Send the new one; your previous list stays until then.' }) : null,
      closed ? h('div', { class: 'banner info', text: 'This tournament is no longer accepting lists.' }) : null,
      h('div', { class: 'stack' }, h('label', { class: 'lbl', for: 'deck-name', text: 'Deck name (optional)' }), deckName),
      h('div', { class: 'stack' }, h('span', { class: 'lbl', id: 'color-lbl', text: 'Deck color' }), h('div', { class: 'colors', role: 'radiogroup', 'aria-labelledby': 'color-lbl' }, colorBtns)),
      h('div', { class: 'tabs', role: 'tablist' }, tabBtns),
      panels.txt, panels.photo, panels.link,
      msg, send,
      h('p', { class: 'hint', text: 'After you submit, your list is locked. The organizer can reopen it if you need to fix something.' }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.replaceChildren();
      const body = { eventId, playerId: me.playerId, secret: getSecret(eventId, true), type: tab, deckName: deckName.value, deckColor: color };
      let problem = '';
      if (!color) problem = 'Pick your deck color.';
      else if (tab === 'txt') {
        const r = parseDeckText(text.value);
        if (!text.value.trim()) problem = 'Paste your list first.';
        else if (!r.entries.length) problem = 'No cards found. Use Export > Copy the list in Exburst.';
        else if (text.value.length > LIMITS.MAX_TXT_CHARS) problem = 'The list is too long.';
        body.content = text.value;
      } else if (tab === 'photo') {
        if (!img) problem = 'Choose an image first.';
        else body.content = img.base64;
      } else {
        problem = checkDeckLink(link.value);
        body.content = link.value.trim();
      }
      if (problem) return msg.replaceChildren(errorBanner({ message: problem }));
      setBusy(send, true, 'Sending...');
      try {
        await call('submitDeck', body, { timeoutMs: 90000 });
        await load();
        root.replaceChildren(...draw());
        toast('List sent');
      } catch (err) {
        msg.replaceChildren(errorBanner(err));
        setBusy(send, false);
        if (err.code === 'locked_list' || err.code === 'forbidden') {
          try { await load(); root.replaceChildren(...draw()); } catch (e2) { /* keep message */ }
        }
      }
    });
    return [form, footer()];
  }

  root.replaceChildren(...draw());
}
