import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { event, context } from '../test/helpers.ts';

const directory = await mkdtemp(join(tmpdir(), 'modo-playa-artifact-'));
try {
  for (const group of ['health', 'identity', 'catalog', 'management', 'media'])
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
import { createHealthHandler, handler as deployedHealth } from './health.mjs';
import { createIdentityHandler, createIdentityApplication } from './identity.mjs';
import { createCatalogHandler, DestinationsService, WeatherService, SunService, CloudflareMediaUrlBuilderService } from './catalog.mjs';
import { createManagementHandler, LodgingsRepository } from './management.mjs';
import { selectMediaRoute } from './media.mjs';
import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
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
http.request = https.request = net.connect = net.createConnection = () => { throw new Error('Network forbidden in smoke.'); };

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
assert.equal((await deployedHealth({ ...event, headers: { 'x-modo-playa-origin': process.env.ORIGIN_VERIFY_TOKEN } }, context)).statusCode, 200);
assert.equal((await deployedHealth(event, context)).statusCode, 403);
for (const path of ['/docs', '/docs/', '/openapi.json']) {
  const request = { ...event, rawPath: path, routeKey: 'GET ' + path };
  const response = await health(request, context);
  assert.equal(response.statusCode, 200);
  if (path === '/openapi.json') {
    const document = JSON.parse(response.body);
    assert.ok(document.paths['/api/auth/login']);
    assert.ok(document.paths['/api/auth/me/profile-image'].post.requestBody.content['multipart/form-data']);
  } else assert.ok(response.body.includes('Swagger UI') && response.body.includes("url:'/openapi.json'"));
  assert.equal((await deployedHealth(request, context)).statusCode, 403);
}
event.rawPath = '/api/admin/contacts'; event.routeKey = 'GET /api/admin/contacts';

assert.equal((await identity(event, context)).statusCode, 404);
event.rawPath = '/api/auth/login'; event.routeKey = 'POST /api/auth/login';
event.requestContext.http.method = 'POST';
event.body = JSON.stringify({ identifier: 'simulated', password: 'simulated-password' });
const login = await identity(event, context);
assert.equal(login.statusCode, 201);
assert.equal(JSON.parse(login.body).user.username, 'simulated');
const mediaUrls = new CloudflareMediaUrlBuilderService({publicBaseUrl:'https://media.example.test',r2Endpoint:'',r2Bucket:''});
const provider = async (_url,request) => request.provider === 'weather' ? {current_weather:{temperature:25,windspeed:10,weathercode:3},daily:{temperature_2m_max:[28,29],temperature_2m_min:[15,16]}} : {status:'OK',results:{sunrise:'2026-01-01T09:00:00Z',sunset:'2026-01-01T23:00:00Z'}};
const destinations = new DestinationsService(new WeatherService(provider),new SunService(provider));
const lodging = {_id:'simulated-lodging',title:'Casa',mainImage:'legacy.webp',images:[],occupiedRanges:[]};
const catalog = createCatalogHandler({logRequests:false,runtime:async()=>({destinations,catalog:async()=>({mediaUrls,lodgings:{findPublicPaginated:async()=>({data:[lodging],total:1,page:1,limit:10})}})})});
event.rawPath='/api/lodgings';event.routeKey='GET /api/lodgings';event.requestContext.http.method='GET';delete event.body;
const listing=await catalog(event,context);assert.equal(listing.statusCode,200);assert.equal(JSON.parse(listing.body).data[0].title,'Casa');
event.rawPath='/api/destinations/gesell/context';event.routeKey='GET /api/destinations/{id}/context';
const destination=await catalog(event,context);assert.equal(destination.statusCode,200);assert.equal(JSON.parse(destination.body).sun.sunrise,'06:00');assert.ok(JSON.parse(destination.body).pointsOfInterest.length>0);
const management=createManagementHandler({logRequests:false,runtime:async()=>({tokens:{authenticate:()=>({ownerId:'simulated-owner',role:'OWNER'})},services:async()=>({lodgings:{removeOccupiedRange:async(id,range,owner)=>{assert.equal(id,'simulated-lodging');assert.equal(owner,'simulated-owner');assert.equal(range.from,'2026-01-01');return [];}},mediaUrls})})},'media');
event.rawPath='/api/admin/lodgings/simulated-lodging/occupied-ranges';event.routeKey='DELETE /api/admin/lodgings/{id}/occupied-ranges';event.requestContext.http.method='DELETE';event.body=JSON.stringify({from:'2026-01-01',to:'2026-01-02'});
assert.deepEqual(JSON.parse((await management(event,context)).body),[]);
assert.equal(selectMediaRoute('POST','/api/auth/me/profile-image').operation,'uploadProfileImage');
assert.equal(selectMediaRoute('GET','/api/admin/lodgings').operation,'listAdminLodgings');
const order=[]; const id={toString:()=> '507f1f77bcf86cd799439013'};
class LodgingModel {async save(){order.push('save');return {_id:id};} static async deleteOne(){order.push('compensate');} }
const repository=new LodgingsRepository(LodgingModel,{findOne:async()=>null},{attachDraftUploadsToLodging:async()=>{order.push('attach');throw new Error('simulated-media-failure');}});
await assert.rejects(repository.create({pendingImageIds:['image-1'],uploadSessionId:'draft'},'507f1f77bcf86cd799439011'),/simulated-media-failure/);
assert.deepEqual(order,['save','attach','compensate']);

`,
  );
  execFileSync(process.execPath, [helper], {
    cwd: directory,
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH,
      ORIGIN_VERIFY_TOKEN: 'simulated-artifact-origin-token-at-least-32-characters',
    },
  });
  const { createHealthHandler } = await import(pathToFileURL(join(directory, 'health.mjs')).href);
  const response = await createHealthHandler({ logRequests: false })(event(), context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, '{"status":"ok"}');
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.info(
  'Smoke aislado de ZIP extraídos: health, identidad/bcrypt, catálogo/destinos y gestión/media con doubles explícitos.',
);
