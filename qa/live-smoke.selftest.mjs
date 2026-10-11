// Runs live-smoke.mjs against the local mock server, to make sure the script itself works before pointing it at Google.
import { startDevServer } from './dev-server.mjs';
import { PW } from './helpers.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const s = await startDevServer();
s.gas.run('addOrganizer', 'Smoke Org', PW);
const child = spawn('node', [fileURLToPath(new URL('./live-smoke.mjs', import.meta.url))], {
  env: { ...process.env, API_URL: s.base + '/api', ORG_NAME: 'Smoke Org', ORG_PASSWORD: PW }, stdio: 'inherit'
});
const code = await new Promise((r) => child.on('close', r));
await s.close();
process.exit(code);
