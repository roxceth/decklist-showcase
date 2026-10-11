import { createGas } from './mock-gas.mjs';

export const PW = 'correct horse battery';

export function freshBackend() {
  const gas = createGas();
  gas.setupAll();
  gas.run('addOrganizer', 'Hector D.', PW);
  gas.run('addOrganizer', 'Organizer 2', 'another-long-pass');
  return gas;
}

export function login(gas, name = 'Hector D.', password = PW) {
  const r = gas.post({ action: 'login', name, password });
  return r.ok ? r.data.token : null;
}

export const RESULTS = '1  Kenji  5-0\n2  Mara  4-1\n3  Dante  4-1\n4  Iris  3-2';

export function newEvent(gas, token, extra = {}) {
  const r = gas.post({
    action: 'createEvent', token, name: 'Hotkei Weekly', datePlayed: '2026-10-11',
    expireDays: 14, resultsText: RESULTS, exburstUrl: '', ...extra
  });
  if (!r.ok) throw new Error('createEvent failed: ' + JSON.stringify(r));
  return r.data.eventId;
}

export const secretA = 'A'.repeat(32);
export const secretB = 'B'.repeat(32);

export const TXT = '// Main deck\n' +
  Array.from({ length: 12 }, (_, i) => `4 x UE24BT/REZ-1-${String(i + 1).padStart(3, '0')}`).join('\n') +
  '\n2 x UE24BT/REZ-1-099';

// Smallest valid files with correct magic bytes.
export const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]).toString('base64');
export const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]).toString('base64');
export const WEBP_B64 = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(40, 3)]).toString('base64');
