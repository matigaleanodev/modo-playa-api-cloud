import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { event, context } from '../test/helpers.ts';

const directory = await mkdtemp(join(tmpdir(), 'modo-playa-artifact-'));
try {
  for (const group of ['health', 'identity'])
    execFileSync('python3', [
      '-c',
      'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
      fileURLToPath(new URL(`../dist/${group}.zip`, import.meta.url)),
      directory,
    ]);
  const helper = join(directory, 'smoke.mjs');
  await writeFile(
    helper,
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHealthHandler } from './health.mjs';
import { createIdentityHandler, createIdentityApplication } from './identity.mjs';
const require = createRequire(import.meta.url);
const bcrypt = require('bcrypt');
const native = Object.keys(require.cache).filter((name) => name.endsWith('.node'));
assert.equal(native.length, 1);
assert.ok(native[0].startsWith(${JSON.stringify(directory + '/')}));
assert.ok(native[0].endsWith('/linux-x64/bcrypt.glibc.node'));
const hash = await bcrypt.hash('simulated-password', 4);
assert.ok(await bcrypt.compare('simulated-password', hash));
assert.equal(await bcrypt.compare('wrong-password', hash), false);
// Cualquier efecto externo durante el smoke falla inmediatamente.
globalThis.fetch = () => { throw new Error('Network forbidden in smoke.'); };

const simulatedUser = { _id: '507f1f77bcf86cd799439013', ownerId: '507f1f77bcf86cd799439011',
  email: 'simulated@example.test', username: 'simulated', passwordHash: hash, isActive: true, isPasswordSet: true };
const users = { findByUsername: async () => simulatedUser };
const forbiddenMail = async () => { throw new Error('Email forbidden in smoke.'); };
const app = createIdentityApplication({
  secretKey: 'simulated-artifact-key', bcryptRounds: 4, publicBaseUrl: '', r2Endpoint: '', r2Bucket: '',
}, { users, mail: { sendActivationCode: forbiddenMail, sendResetCode: forbiddenMail, sendPasswordChanged: forbiddenMail } });
const runtime = async () => ({ tokens: app.tokens, services: async () => app });

const health = createHealthHandler({ logRequests: false });
const identity = createIdentityHandler({ logRequests: false, runtime });
const context = { getRemainingTimeInMillis: () => 4000, awsRequestId: 'local-artifact' };
const event = ${JSON.stringify(event())};
assert.deepEqual(JSON.parse((await health(event, context)).body), { status: 'ok' });
event.rawPath = '/api/admin/contacts'; event.routeKey = 'GET /api/admin/contacts';

assert.equal((await identity(event, context)).statusCode, 404);
event.rawPath = '/api/auth/login'; event.routeKey = 'POST /api/auth/login';
event.requestContext.http.method = 'POST';
event.body = JSON.stringify({ identifier: 'simulated', password: 'simulated-password' });
const login = await identity(event, context);
assert.equal(login.statusCode, 201);
assert.equal(JSON.parse(login.body).user.username, 'simulated');

`,
  );
  execFileSync(process.execPath, [helper], {
    cwd: directory,
    stdio: 'inherit',
    env: { PATH: process.env.PATH },
  });
  const { createHealthHandler } = await import(pathToFileURL(join(directory, 'health.mjs')).href);
  const response = await createHealthHandler({ logRequests: false })(event(), context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '{"status":"ok"}');
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.info(
  'Smoke aislado del ZIP extraído: health y bcrypt con configuración simulada explícita.',
);
