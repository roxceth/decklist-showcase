import { h, mount, spinner, errorBanner, icon, onLeave, runLeave, ordinal, appName } from '../ui.js';
import { org } from '../api.js';
import { parseDeckText } from '../../shared/parsers.js';

function b64ToUrl(mime, b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export function columnsFor(n) {
  return n <= 18 ? 2 : n <= 39 ? 3 : 4;
}

// startIndex < 0 opens the standings list; >= 0 opens that player's slide directly.
export async function presentView(eventId, startIndex = -1) {
  let alive = true;
  onLeave(() => { alive = false; document.body.classList.remove('presenting'); });
  const shell = h('div', { class: 'shell' }, h('main', { class: 'page' }, spinner('Loading lists...')));
  mount(shell);
  let data;
  try {
    data = await org('getDecklists', { eventId });
  } catch (err) {
    if (err.code !== 'unauthorized' && alive) {
      shell.replaceChildren(h('main', { class: 'page' }, errorBanner(err), h('a', { class: 'btn', href: '#/dashboard' }, 'Back to tournaments')));
    }
    return;
  }
  if (!alive) return;

  const slides = data.entries.filter((e) => e.deck);
  const missing = data.entries.length - slides.length;
  const evName = data.event.name;
  const evDate = data.event.datePlayed;
  document.body.classList.add('presenting');

  if (!slides.length) {
    mount(h('div', { class: 'pres' },
      h('div', { class: 'pres-empty' },
        h('h2', { class: 'sec', text: 'No lists yet' }),
        h('p', { text: 'Nobody has submitted a decklist for this tournament.' }),
        h('a', { class: 'btn', href: '#/edit/' + eventId }, 'Back to tournament'))));
    return;
  }

  let view = startIndex >= 0 ? 'slide' : 'list';
  let i = Math.min(Math.max(0, startIndex), slides.length - 1);
  let zoom = null;
  const photos = new Map(); // deckId -> {state:'loading'|'ready'|'error', url, promise}

  function onSlide(deckId) { return view === 'slide' && slides[i] && slides[i].deck.deckId === deckId; }

  function ensurePhoto(deckId) {
    let p = photos.get(deckId);
    if (p && p.state !== 'error') return p;
    p = { state: 'loading', url: null };
    photos.set(deckId, p);
    p.promise = org('getPhoto', { eventId, deckId }, { timeoutMs: 90000 }).then(
      (r) => {
        if (!/^image\/(jpeg|png|webp)$/.test(r.mime)) throw new Error('Unexpected image type');
        p.url = b64ToUrl(r.mime, r.base64);
        p.state = 'ready';
        if (alive && onSlide(deckId)) render();
      },
      () => {
        p.state = 'error';
        if (alive && onSlide(deckId)) render();
      }
    );
    return p;
  }
  function prefetch() {
    let found = 0;
    for (let k = view === 'slide' ? i : 0; k < slides.length && found < 3; k++) {
      if (slides[k].deck.type === 'photo') {
        ensurePhoto(slides[k].deck.deckId);
        found++;
      }
    }
  }

  const root = h('div', { class: 'pres', tabindex: '-1' });
  mount(root);

  function textPanel(e) {
    const parsed = parseDeckText(e.deck.content);
    const rows = [];
    for (const it of parsed.entries) {
      rows.push(h('div', { class: 'cardrow' + (it.main ? '' : ' other') },
        h('span', { class: 'q', text: String(it.qty) }),
        h('span', { class: 'c', title: it.code, text: it.code + (it.main || !it.section ? '' : '  (' + it.section + ')') })));
    }
    for (const u of parsed.unrecognized) rows.push(h('div', { class: 'cardrow other' }, h('span', { class: 'q', text: '–' }), h('span', { class: 'c', text: u })));
    const cols = columnsFor(rows.length);
    const list = h('div', { class: 'cardlist', style: '--cols:' + cols + ';grid-template-columns:repeat(' + cols + ',minmax(0,1fr));grid-template-rows:repeat(' + Math.ceil(rows.length / cols) + ',minmax(0,1fr))' }, rows);
    return {
      meta: parsed.total + ' cards',
      body: rows.length ? list : h('pre', { text: e.deck.content })
    };
  }

  function photoPanel(e) {
    const p = ensurePhoto(e.deck.deckId);
    let body;
    if (p.state === 'ready') {
      body = h('div', { class: 'pres-photo' },
        h('img', { src: p.url, alt: 'Decklist image from ' + e.name, onclick: () => toggleZoom() }));
    } else if (p.state === 'error') {
      body = h('div', { class: 'pres-linkbox' }, h('p', { text: 'The photo could not be loaded.' }),
        h('button', { class: 'btn', type: 'button', onclick: () => { photos.delete(e.deck.deckId); render(); } }, 'Try again'));
    } else {
      body = h('div', { class: 'pres-photo' }, spinner('Loading photo...'));
    }
    return { meta: 'Submitted as image · Z to zoom', body };
  }

  function linkPanel(e) {
    return {
      meta: 'Submitted as Exburst link',
      body: h('div', { class: 'pres-linkbox' },
        icon('link'),
        h('h3', { text: 'This list was sent as a link' }),
        h('p', { class: 'hint', text: 'The list opens on Exburst, outside this page.' }),
        h('a', { class: 'btn primary', href: e.deck.content, target: '_blank', rel: 'noopener noreferrer' }, 'Open on Exburst ', icon('ext')))
    };
  }

  function renderList() {
    const n = data.entries.length;
    const cols = n <= 8 ? 1 : n <= 16 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const items = data.entries.map((e) => {
      const d = e.deck;
      const inner = [
        h('span', { class: 'sl-rank', text: String(e.rank) }),
        h('span', { class: 'sl-who' },
          h('span', { class: 'sl-name', text: e.name }),
          e.record ? h('span', { class: 'sl-rec', text: e.record }) : null),
        h('span', { class: 'sl-deck' },
          d ? [h('span', { class: 'dot ' + d.deckColor }), h('span', { text: d.deckName || d.deckColor })] : h('span', { class: 'sl-none', text: 'No list yet' }))
      ];
      if (!d) return h('div', { class: 'sl-row none' }, inner);
      const idx = slides.indexOf(e);
      return h('button', { class: 'sl-row', type: 'button', 'aria-label': 'Show the decklist of ' + e.name, onclick: () => { view = 'slide'; i = idx; render(); } }, inner);
    });
    root.replaceChildren(
      h('div', { class: 'pres-top' },
        h('span', { class: 'ev', text: evName + ' · ' + shortDate(evDate) }),
        h('span', { class: 'app', text: 'Standings' })),
      h('div', { class: 'standings' + (cols > 1 ? ' multi' : ''), style: '--rows:' + rows + ';--scols:' + cols }, items),
      h('div', { class: 'pres-bottom' },
        h('div', { class: 'stack pres-dots' }, h('span', { class: 'hint', text: 'Click a player to show their decklist' + (missing ? ' · ' + missing + (missing === 1 ? ' player has' : ' players have') + ' no list' : '') })),
        h('div', { class: 'nav' },
          h('div', { class: 'pres-tools tools' },
            h('button', { class: 'btn small', type: 'button', onclick: exit }, 'Exit'),
            h('button', { class: 'btn small', type: 'button', onclick: reload }, 'Reload (R)'),
            h('button', { class: 'btn small fs-btn', type: 'button', onclick: toggleFullscreen }, 'Fullscreen (F)')))));
  }

  function render() {
    if (view === 'list') { renderList(); return; }
    const e = slides[i];
    const d = e.deck;
    const panel = d.type === 'txt' ? textPanel(e) : d.type === 'photo' ? photoPanel(e) : linkPanel(e);
    const dots = slides.length <= 24
      ? h('div', { class: 'dots', 'aria-hidden': 'true' }, slides.map((_, k) => h('i', { class: k === i ? 'on' : '' })))
      : h('div', { class: 'progress', style: 'width:200px', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.round(((i + 1) / slides.length) * 100) + '%' }));
    root.replaceChildren(
      h('div', { class: 'pres-top' },
        h('span', { class: 'ev', text: evName + ' · ' + shortDate(evDate) }),
        h('span', { class: 'app', text: appName() })),
      h('div', { class: 'pres-main' },
        h('div', { class: 'pres-info' },
          h('div', { class: 'pres-place' },
            h('div', { class: 'pres-rank', text: String(e.rank) }),
            h('div', null, h('small', { text: 'PLACE' }), e.record ? h('b', { text: e.record + ' record' }) : h('b', { text: ordinal(e.rank) }))),
          h('h1', { class: 'pres-name', text: e.name }),
          h('div', { class: 'pres-deck' }, h('span', { class: 'dot ' + d.deckColor }), (d.deckName ? d.deckName + ' · ' : '') + d.deckColor)),
        h('section', { class: 'pres-panel', 'aria-label': 'Decklist' },
          h('div', { class: 'pres-panel-head' }, h('h2', { text: 'DECKLIST' }), h('span', { text: panel.meta })),
          panel.body)),
      h('div', { class: 'pres-bottom' },
        h('div', { class: 'stack pres-dots' }, dots, missing ? h('span', { class: 'hint', text: missing + (missing === 1 ? ' player has' : ' players have') + ' no list' }) : null),
        h('div', { class: 'nav' },
          h('div', { class: 'pres-tools tools' },
            h('button', { class: 'btn small', type: 'button', onclick: exit }, 'Exit'),
            h('button', { class: 'btn small', type: 'button', onclick: showList }, 'List (L)'),
            h('button', { class: 'btn small', type: 'button', onclick: reload }, 'Reload (R)'),
            h('button', { class: 'btn small fs-btn', type: 'button', onclick: toggleFullscreen }, 'Fullscreen (F)')),
          h('div', { class: 'pres-arrows' },
            h('button', { class: 'round', type: 'button', 'aria-label': 'Previous player', onclick: () => go(-1) }, icon('left')),
            h('span', { class: 'count', text: (i + 1) + ' / ' + slides.length }),
            h('button', { class: 'round next', type: 'button', 'aria-label': 'Next player', onclick: () => go(1) }, icon('right'))))));
    if (zoom) showZoom();
    prefetch();
  }

  function shortDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + Number(m[3]);
  }

  function showList() {
    zoom = null;
    document.querySelector('.pres-zoom')?.remove();
    view = 'list';
    render();
  }

  function go(delta) {
    if (view !== 'slide') return;
    const n = Math.min(slides.length - 1, Math.max(0, i + delta));
    if (n === i) return;
    i = n;
    zoom = null;
    document.querySelector('.pres-zoom')?.remove();
    render();
  }

  function showZoom() {
    document.querySelector('.pres-zoom')?.remove();
    const e = slides[i];
    const p = e.deck.type === 'photo' ? photos.get(e.deck.deckId) : null;
    if (!p || p.state !== 'ready') { zoom = null; return; }
    const z = h('div', { class: 'pres-zoom', onclick: () => toggleZoom() }, h('img', { src: p.url, alt: 'Decklist image, full size' }));
    document.body.append(z);
  }
  function toggleZoom() {
    zoom = zoom ? null : true;
    if (zoom) showZoom();
    else document.querySelector('.pres-zoom')?.remove();
  }
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch (e) { /* not supported */ }
  }
  // Fetches the lists again (players may have sent more while presenting) and keeps the current slide.
  function reload() {
    const keep = view === 'list' ? -1 : i;
    runLeave();
    presentView(eventId, keep);
  }
  function exit() {
    location.hash = '#/dashboard';
  }

  function onKey(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    switch (ev.key) {
      case 'ArrowRight': case 'PageDown': case ' ': ev.preventDefault(); go(1); break;
      case 'ArrowLeft': case 'PageUp': ev.preventDefault(); go(-1); break;
      case 'Home': if (view === 'slide') { i = 0; render(); } break;
      case 'End': if (view === 'slide') { i = slides.length - 1; render(); } break;
      case 'l': case 'L': if (view === 'slide') showList(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'z': case 'Z': if (view === 'slide') toggleZoom(); break;
      case 'r': case 'R': reload(); break;
      case 'Escape': if (zoom) toggleZoom(); else if (view === 'slide') showList(); else if (!document.fullscreenElement) exit(); break;
      default: return;
    }
  }
  document.addEventListener('keydown', onKey);
  // Swipe left/right on touch screens.
  let t0 = null;
  root.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; t0 = { x: t.clientX, y: t.clientY }; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (!t0) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - t0.x;
    const dy = t.clientY - t0.y;
    t0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });
  let idle;
  const onMove = () => {
    root.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(() => { if (document.fullscreenElement) root.classList.add('idle'); }, 2500);
  };
  document.addEventListener('mousemove', onMove);
  onLeave(() => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousemove', onMove);
    clearTimeout(idle);
    document.querySelector('.pres-zoom')?.remove();
    for (const p of photos.values()) if (p.url) URL.revokeObjectURL(p.url);
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* ignore */ } }
  });
  render();
  root.focus();
}
