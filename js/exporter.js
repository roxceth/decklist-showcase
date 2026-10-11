import { zipFiles } from './zip.js';

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

export function safeName(s, max = 60) {
  const cleaned = String(s || '').replace(FORBIDDEN, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (cleaned || 'untitled').slice(0, max).trim();
}

export function deckFileName(entry) {
  const deck = entry.deck && entry.deck.deckName ? entry.deck.deckName : entry.deck ? entry.deck.deckColor : '';
  return `${entry.rank} - ${safeName(entry.name, 40)}${deck ? ' - ' + safeName(deck, 40) : ''}.txt`;
}

function csvCell(v) {
  let s = String(v == null ? '' : v);
  // Spreadsheet programs run cells that start with these as formulas.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function summaryCsv(entries, linkFor) {
  const rows = [['Rank', 'Player', 'Record', 'Deck', 'Color', 'Type', 'Link']];
  for (const e of entries) {
    const d = e.deck;
    rows.push([
      e.rank, e.name, e.record, d ? d.deckName : '', d ? d.deckColor : '',
      d ? (d.type === 'txt' ? 'text' : d.type === 'photo' ? 'image' : 'link') : 'no list',
      d && d.type === 'link' ? d.content : ''
    ]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Text lists go in as .txt exactly as submitted. Images and links are only listed in summary.csv.
export function buildExport(entries) {
  const files = [];
  const used = new Set();
  for (const e of entries) {
    if (!e.deck || e.deck.type !== 'txt') continue;
    let name = deckFileName(e);
    while (used.has(name.toLowerCase())) name = name.replace(/\.txt$/, ' (2).txt');
    used.add(name.toLowerCase());
    files.push({ name, data: e.deck.content });
  }
  files.push({ name: 'summary.csv', data: summaryCsv(entries) });
  return files;
}

export function downloadBytes(name, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function downloadTxt(entry) {
  downloadBytes(deckFileName(entry), new TextEncoder().encode(entry.deck.content), 'text/plain;charset=utf-8');
}

export function downloadZip(eventName, entries) {
  const bytes = zipFiles(buildExport(entries));
  downloadBytes(safeName(eventName) + ' - decklists.zip', bytes, 'application/zip');
}
