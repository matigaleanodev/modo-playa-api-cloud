import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as reservePort } from 'node:net';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { createConnection, Types, type Connection } from 'mongoose';
import sharp from 'sharp';
import { createMediaServer, selectMediaRoute } from '../packages/runtime/src/media/server.ts';
import { createMediaApplication } from '../packages/runtime/src/media/application.ts';
import { SharpImageProcessorService } from '../packages/runtime/src/media/sharp.ts';
import { TokenService } from '../packages/runtime/src/identity/tokens.ts';
import { userModel } from '../packages/runtime/src/identity/models.ts';
import { businessModels } from '../packages/runtime/src/business/models.ts';
import { pendingDraftModel } from '../packages/runtime/src/media/models.ts';
import { mediaConfiguration } from '../packages/runtime/src/media/configuration.ts';
import * as databaseModule from '../packages/runtime/src/identity/database.ts';
import * as applicationModule from '../packages/runtime/src/media/application.ts';
import { mediaRuntime } from '../packages/runtime/src/media/runtime.ts';
import { validateBusiness } from '../packages/runtime/src/business/validation.ts';
import { draftBodySchema } from '@modo-playa/contracts/media';
import { createLodgingSchema } from '@modo-playa/contracts/business';
import { MediaDependencyUnavailable } from '../packages/runtime/src/business/media.ts';
import { MemoryStorage } from './media-fixture.ts';
import { lodgingInput } from './business-fixture.ts';
const owner = '507f1f77bcf86cd799439011',
  otherOwner = '507f1f77bcf86cd799439012',
  user = '507f1f77bcf86cd799439013';
const key = 'explicit-local-media-test-key';
const tokens = new TokenService(key);
const access = (ownerId = owner, role: 'OWNER' | 'SUPERADMIN' = 'OWNER') =>
  tokens.sign({ sub: user, ownerId, role }, { expiresIn: 60 });
const small = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#173f85' } })
  .png()
  .toBuffer();
function padPng(source: Buffer, size: number) {
  const payload = Buffer.alloc(size - source.length - 12, 65);
  payload.write('padding\0');
  const type = Buffer.from('tEXt'),
    chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length);
  type.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, payload])), chunk.length - 4);
  return Buffer.concat([source.subarray(0, -12), chunk, source.subarray(-12)]);
}
it('rutas de media seleccionan una operación y configuración incompleta rechaza antes de Mongo', async () => {
  expect(selectMediaRoute('POST', '/api/admin/lodgings')).toMatchObject({
    operation: 'createLodging',
  });
  expect(selectMediaRoute('GET', '/api/admin/lodgings-else')).toBeUndefined();
  expect(selectMediaRoute('PUT', '/api/auth/me/profile-image')).toBeUndefined();
  const runtime = await mediaRuntime({ MONGO_URI: 'mongodb://127.0.0.1:1/never', SECRET_KEY: key })(
    AbortSignal.timeout(500),
  );
  await expect(runtime.services()).rejects.toBeInstanceOf(MediaDependencyUnavailable);
});
it('cancelación durante conexión no construye la aplicación ni permite escrituras', async () => {
  const controller = new AbortController();
  let resolveConnection!: (connection: Connection) => void;
  const connected = new Promise<Connection>((resolve) => {
    resolveConnection = resolve;
  });
  const started = Promise.withResolvers<void>();
  const create = vi.spyOn(applicationModule, 'createMediaApplication');
  const db = vi.spyOn(databaseModule, 'database').mockReturnValue({
    connect: async () => {
      started.resolve();
      return connected;
    },
    users: async () => {
      throw new Error('Not used');
    },
    close: async () => {},
  });
  try {
    const runtime = await mediaRuntime({
      MONGO_URI: 'explicit-local-only',
      SECRET_KEY: key,
      R2_ENDPOINT: 'https://storage.example.test',
      R2_BUCKET: 'local',
      R2_ACCESS_KEY_ID: 'local',
      R2_SECRET_ACCESS_KEY: 'local',
    })(controller.signal);
    const services = runtime.services(controller.signal);
    await started.promise;
    controller.abort(new Error('local-abort'));
    resolveConnection({} as Connection);
    await expect(services).rejects.toThrow('local-abort');
    expect(create).not.toHaveBeenCalled();
  } finally {
    db.mockRestore();
    create.mockRestore();
  }
});
it('UUID del draft acepta NIL/MAX y validación de alta conserva IsString', () => {
  for (const uploadSessionId of [
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    randomUUID(),
  ])
    expect(validateBusiness(draftBodySchema, { uploadSessionId })).toEqual({ uploadSessionId });
  expect(() => validateBusiness(draftBodySchema, { uploadSessionId: 'bad' })).toThrow(
    'uploadSessionId must be a UUID',
  );
  expect(() =>
    validateBusiness(createLodgingSchema, { ...lodgingInput, uploadSessionId: 5 }),
  ).toThrow('uploadSessionId must be a string');
});
describe.skipIf(!process.env.LOCAL_MONGOD)(
  'HTTP multipart real con Mongo descartable, Sharp real y storage sustituido',
  () => {
    let mongo: ChildProcess,
      dir: string,
      connection: Connection,
      server: ReturnType<typeof createMediaServer>,
      base: string;
    let config: Awaited<ReturnType<ReturnType<typeof mediaConfiguration>>>;
    let storage: MemoryStorage;
    let nearProfile: Buffer, nearLodging: Buffer;
    beforeAll(async () => {
      const reservation = reservePort();
      reservation.listen(0, '127.0.0.1');
      await once(reservation, 'listening');
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
      dir = await mkdtemp(join(tmpdir(), 'modo-playa-media-mongo-'));
      mongo = spawn(
        process.env.LOCAL_MONGOD!,
        [
          '--dbpath',
          dir,
          '--bind_ip',
          '127.0.0.1',
          '--port',
          String(port),
          '--noauth',
          '--quiet',
          '--nounixsocket',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Disposable Mongo did not start.')), 15000);
        mongo.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        mongo.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Disposable Mongo exited.'));
        });
        mongo.stdout!.on('data', (value: Buffer) => {
          if (value.toString().includes('Waiting for connections')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      connection = await createConnection(
        'mongodb://127.0.0.1:' + port + '/modo_playa_media_disposable',
        { autoCreate: false, autoIndex: false, maxPoolSize: 2 },
      ).asPromise();
      config = await mediaConfiguration({
        MONGO_URI: 'explicit-test-only',
        SECRET_KEY: key,
        MEDIA_PUBLIC_BASE_URL: 'https://media.example.test',
        IMAGE_ALLOWED_MIME: 'image/png,image/jpeg,image/webp',
      })();
      const started = performance.now();
      nearProfile = await sharp(randomBytes(1316 * 1316 * 3), {
        raw: { width: 1316, height: 1316, channels: 3 },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      nearLodging = await sharp(randomBytes(1860 * 1860 * 3), {
        raw: { width: 1860, height: 1860, channels: 3 },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      expect(nearProfile.length).toBeGreaterThan(0.98 * 5 * 1024 * 1024);
      expect(nearLodging.length).toBeGreaterThan(0.98 * 10 * 1024 * 1024);
      console.info({
        nearProfileBytes: nearProfile.length,
        nearLodgingBytes: nearLodging.length,
        fixtureMs: Math.round(performance.now() - started),
      });
    }, 30000);
    beforeEach(async () => {
      storage = new MemoryStorage();
      await Promise.all([
        userModel(connection).deleteMany({}),
        businessModels(connection).contacts.deleteMany({}),
        businessModels(connection).lodgings.deleteMany({}),
        pendingDraftModel(connection).deleteMany({}),
      ]);
      await userModel(connection).create({
        _id: new Types.ObjectId(user),
        ownerId: new Types.ObjectId(owner),
        email: 'one@example.test',
        username: 'one',
        isActive: true,
      });
      server = createMediaServer({
        logRequests: false,
        runtime: async (signal) => ({
          tokens,
          config,
          services: async (requestSignal = signal) =>
            createMediaApplication(
              connection,
              config,
              storage,
              new SharpImageProcessorService(sharp),
              requestSignal,
            ),
        }),
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    afterAll(async () => {
      await connection?.close();
      if (mongo && !mongo.killed) {
        mongo.kill();
        await once(mongo, 'exit');
      }
      if (dir) await rm(dir, { recursive: true, force: true });
    });
    async function request(path: string, method = 'GET', body?: unknown, token = access()) {
      return fetch(base + path, {
        method,
        headers: {
          authorization: 'Bearer ' + token,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    async function upload(
      path: string,
      file: Buffer = small,
      fields: Record<string, string> = {},
      token = access(),
      mime = 'image/png',
    ) {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(file)], { type: mime }), 'local.png');
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      return fetch(base + path, {
        method: 'POST',
        headers: { authorization: token ? 'Bearer ' + token : '' },
        body: form,
      });
    }
    async function draft(session: string, file: Buffer = small, token = access()) {
      const response = await upload(
        '/api/admin/lodging-image-uploads',
        file,
        { uploadSessionId: session },
        token,
      );
      expect(response.status).toBe(201);
      return ((await response.json()) as { imageId: string }).imageId;
    }
    async function create(imageIds: string[] = [], session?: string) {
      const response = await request('/api/admin/lodgings', 'POST', {
        ...lodgingInput,
        ...(imageIds.length ? { pendingImageIds: imageIds, uploadSessionId: session } : {}),
      });
      expect(response.status).toBe(201);
      return (await response.json()) as {
        id: string;
        mediaImages: { imageId: string; key: string; isDefault: boolean }[];
        mainImage: string;
        images: string[];
      };
    }
    it('auth y SUPERADMIN rechazan cuerpo grande sin efectos; faltante, MIME y exceso preservan códigos', async () => {
      expect((await upload('/api/auth/me/profile-image', nearProfile, {}, '')).status).toBe(401);
      expect(
        (await upload('/api/auth/me/profile-image', nearProfile, {}, access(owner, 'SUPERADMIN')))
          .status,
      ).toBe(403);
      const empty = new FormData();
      const missing = await fetch(base + '/api/auth/me/profile-image', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + access() },
        body: empty,
      });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({ code: 'REQUEST_VALIDATION_ERROR' });
      const mime = await upload('/api/auth/me/profile-image', small, {}, access(), 'text/plain');
      expect(await mime.json()).toMatchObject({ code: 'LODGING_IMAGE_INVALID_MIME' });
      const excess = await upload('/api/auth/me/profile-image', Buffer.alloc(5 * 1024 * 1024 + 1));
      expect(excess.status).toBe(400);
      expect(await excess.json()).toMatchObject({ code: 'LODGING_IMAGE_SIZE_EXCEEDED' });
      expect(storage.objects.size).toBe(0);
    });
    it('perfil acepta archivo válido al máximo de5MiB, normaliza y elimina propio; owner cruzado no escribe', async () => {
      const file = padPng(nearProfile, 5 * 1024 * 1024);
      const response = await upload('/api/auth/me/profile-image', file);
      expect(response.status).toBe(201);
      const result = (await response.json()) as {
        image: { key: string; width: number; height: number; mime: string };
      };
      expect(result.image).toMatchObject({ width: 1024, height: 1024, mime: 'image/webp' });
      expect(result.image.key).toMatch(new RegExp('^users/' + user + '/profile/.+/original.webp$'));
      const calls = storage.calls.length;
      expect(
        (await upload('/api/auth/me/profile-image', small, {}, access(otherOwner))).status,
      ).toBe(404);
      expect(storage.calls.length).toBe(calls);
      storage.failDelete = () => true;
      expect((await request('/api/auth/me/profile-image', 'DELETE')).status).toBe(200);
      expect((await userModel(connection).findById(user))?.profileImage).toBeNull();
    }, 15000);
    it('cinco drafts cercanos a10MiB crean en orden, default y límites; todas rutas JSON lodging conservadas', async () => {
      const started = performance.now(),
        session = randomUUID(),
        ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(await draft(session, nearLodging));
      const sixth = await upload('/api/admin/lodging-image-uploads', small, {
        uploadSessionId: session,
      });
      expect(sixth.status).toBe(400);
      expect(await sixth.json()).toMatchObject({ code: 'LODGING_IMAGE_LIMIT_EXCEEDED' });
      const lodging = await create(ids.toReversed(), session);
      expect(lodging.mediaImages.map((image) => image.imageId)).toEqual(ids.toReversed());
      expect(
        lodging.mediaImages.filter((image) => image.isDefault).map((image) => image.imageId),
      ).toEqual([ids[4]]);
      expect(await pendingDraftModel(connection).countDocuments()).toBe(0);
      expect([...storage.objects.keys()].some((key) => key.includes('staging-upload'))).toBe(false);
      const other = await upload(
        '/api/admin/lodgings/' + lodging.id + '/images',
        small,
        {},
        access(otherOwner),
      );
      expect(other.status).toBe(404);
      const full = await upload('/api/admin/lodgings/' + lodging.id + '/images');
      expect(full.status).toBe(400);
      expect(
        [...storage.objects.keys()].filter((key) => key.endsWith('original.webp')).length,
      ).toBe(5);
      expect((await request('/api/admin/lodgings')).status).toBe(200);
      expect((await request('/api/admin/lodgings/' + lodging.id)).status).toBe(200);
      expect(
        (await request('/api/admin/lodgings/' + lodging.id, 'PATCH', { title: 'Casa nueva' }))
          .status,
      ).toBe(200);
      expect(
        (
          await request('/api/admin/lodgings/' + lodging.id + '/public-visibility', 'PATCH', {
            isPubliclyVisible: false,
          })
        ).status,
      ).toBe(200);
      expect(
        (await request('/api/admin/lodgings/' + lodging.id + '/occupied-ranges', 'GET')).status,
      ).toBe(200);
      expect(
        (
          await request('/api/admin/lodgings/' + lodging.id + '/occupied-ranges', 'POST', {
            from: '2026-01-01',
            to: '2026-01-02',
          })
        ).status,
      ).toBe(201);
      const removed = await request(
        '/api/admin/lodgings/' + lodging.id + '/occupied-ranges',
        'DELETE',
        { from: '2026-01-01', to: '2026-01-02' },
      );
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual([]);
      expect(
        (
          await request(
            '/api/admin/lodgings/' + lodging.id + '/images/' + ids[0] + '/default',
            'PATCH',
          )
        ).status,
      ).toBe(200);
      const deletion = await request(
        '/api/admin/lodgings/' + lodging.id + '/images/' + ids[0],
        'DELETE',
      );
      expect(deletion.status).toBe(200);
      expect(((await deletion.json()) as { images: unknown[] }).images.length).toBe(4);
      console.info({
        fiveDraftsMs: Math.round(performance.now() - started),
        peakRss: process.resourceUsage().maxRSS * 1024,
      });
    }, 30000);
    it('upload a lodging existente persiste referencias legacy y default, SUPERADMIN amplía scope', async () => {
      const lodging = await create();
      const path = '/api/admin/lodgings/' + lodging.id + '/images';
      const first = await upload(path);
      expect(first.status).toBe(201);
      const second = await upload(path, small, {}, access(otherOwner, 'SUPERADMIN'));
      expect(second.status).toBe(201);
      const persisted = await businessModels(connection).lodgings.findById(lodging.id);
      expect(persisted?.images).toHaveLength(2);
      expect(persisted?.mainImage).toBe(
        persisted?.mediaImages.find((image) => image.isDefault)?.key,
      );
      expect(persisted?.mediaImages.filter((image) => image.isDefault)).toHaveLength(1);
    });
    it('draft exacto10MiB, expirado/no confirmado y scope se validan antes de asociar', async () => {
      const session = randomUUID(),
        id = await draft(session, padPng(nearLodging, 10 * 1024 * 1024));
      const model = pendingDraftModel(connection);
      await model.updateOne({ imageId: id }, { $set: { status: 'PENDING' } });
      const rejected = await request('/api/admin/lodgings', 'POST', {
        ...lodgingInput,
        pendingImageIds: [id],
        uploadSessionId: session,
      });
      expect(rejected.status).toBe(400);
      expect(await businessModels(connection).lodgings.countDocuments()).toBe(0);
      await model.updateOne(
        { imageId: id },
        { $set: { status: 'CONFIRMED', expiresAt: new Date(Date.now() - 1000) } },
      );
      expect(
        (
          await request('/api/admin/lodgings', 'POST', {
            ...lodgingInput,
            pendingImageIds: [id],
            uploadSessionId: session,
          })
        ).status,
      ).toBe(404);
      expect(storage.objects.size).toBe(0);
      const foreign = await draft(session, small, access(otherOwner));
      expect(
        (
          await request('/api/admin/lodgings', 'POST', {
            ...lodgingInput,
            pendingImageIds: [foreign],
            uploadSessionId: session,
          })
        ).status,
      ).toBe(404);
    });
    it('falla del segundo draft compensa actuales y anteriores después de eliminar documento', async () => {
      const session = randomUUID(),
        ids = [await draft(session), await draft(session)];
      storage.failPut = (key) => key.includes(ids[1]!) && key.endsWith('original.webp');
      const response = await request('/api/admin/lodgings', 'POST', {
        ...lodgingInput,
        pendingImageIds: ids,
        uploadSessionId: session,
      });
      expect(response.status).toBe(500);
      expect(await businessModels(connection).lodgings.countDocuments()).toBe(0);
      expect([...storage.objects.keys()].some((key) => key.endsWith('original.webp'))).toBe(false);
      expect(await pendingDraftModel(connection).countDocuments()).toBe(2);
    });
    it('falla posterior al commit Mongo conserva error; rollback confirmado precede limpieza finales', async () => {
      const session = randomUUID(),
        id = await draft(session),
        model = businessModels(connection).lodgings;
      vi.spyOn(pendingDraftModel(connection), 'deleteMany').mockRejectedValueOnce(
        new Error('draft-retirement-failed'),
      );
      const deletion = vi.spyOn(model, 'deleteOne');
      const response = await request('/api/admin/lodgings', 'POST', {
        ...lodgingInput,
        pendingImageIds: [id],
        uploadSessionId: session,
      });
      expect(response.status).toBe(500);
      expect(deletion).toHaveBeenCalled();
      expect(await model.countDocuments()).toBe(0);
      expect([...storage.objects.keys()].some((key) => key.endsWith('original.webp'))).toBe(false);
    });
    it('si falla rollback documento no borra finales referenciados; sin retry del alta', async () => {
      const session = randomUUID(),
        id = await draft(session),
        model = businessModels(connection).lodgings;
      vi.spyOn(pendingDraftModel(connection), 'deleteMany').mockRejectedValueOnce(
        new Error('draft-retirement-failed'),
      );
      const deletion = vi
        .spyOn(model, 'deleteOne')
        .mockRejectedValueOnce(new Error('document-rollback-failed'));
      expect(
        (
          await request('/api/admin/lodgings', 'POST', {
            ...lodgingInput,
            pendingImageIds: [id],
            uploadSessionId: session,
          })
        ).status,
      ).toBe(500);
      expect(deletion).toHaveBeenCalledTimes(1);
      const lodging = await model.findOne();
      expect(lodging?.mediaImages).toHaveLength(1);
      expect(storage.objects.has(lodging!.mediaImages[0]!.key)).toBe(true);
    });
    it('perfil compensa excepción Mongo después de put y conserva perfil anterior', async () => {
      const model = userModel(connection);
      vi.spyOn(model, 'findOneAndUpdate').mockRejectedValueOnce(new Error('mongo-write-failed'));
      expect((await upload('/api/auth/me/profile-image')).status).toBe(500);
      expect(storage.objects.size).toBe(0);
      expect((await model.findById(user))?.profileImage).toBeUndefined();
    });
    it('health solo HEAD; deleteAll limpia legacy/pending y fallo storage impide eliminar documento', async () => {
      const lodging = await create();
      const model = businessModels(connection).lodgings;
      const legacy = 'lodgings/legacy.webp',
        staging = 'lodgings/' + lodging.id + '/pending/staging-upload';
      storage.objects.set(legacy, { body: small, mime: 'image/webp' });
      storage.objects.set(staging, { body: small, mime: 'image/png' });
      await model.updateOne(
        { _id: lodging.id },
        {
          $set: {
            mainImage: legacy,
            images: [legacy, 'https://external.example.test/image'],
            pendingImageUploads: [
              {
                imageId: 'pending',
                stagingKey: staging,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 10000),
                status: 'PENDING',
              },
            ],
          },
        },
      );
      const count = storage.calls.length;
      expect(
        (await request('/api/admin/media/health', 'GET', undefined, access(owner, 'SUPERADMIN')))
          .status,
      ).toBe(200);
      expect(storage.calls.slice(count)).toEqual(['head-bucket']);
      storage.failDelete = (key) => key === legacy;
      expect((await request('/api/admin/lodgings/' + lodging.id, 'DELETE')).status).toBe(500);
      expect(await model.findById(lodging.id)).not.toBeNull();
      storage.failDelete = () => false;
      expect((await request('/api/admin/lodgings/' + lodging.id, 'DELETE')).status).toBe(200);
      expect(await model.findById(lodging.id)).toBeNull();
      expect(storage.objects.size).toBe(0);
    });
    it('HEAD y slash final preservan GET/JWT sin body y paths próximos no coinciden', async () => {
      const lodging = await create();
      const get = await request('/api/admin/lodgings/' + lodging.id + '/');
      expect(get.status).toBe(200);
      const head = await request('/api/admin/lodgings/' + lodging.id + '/', 'HEAD');
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
      expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
      const unauthenticated = await fetch(base + '/api/admin/media/health/', { method: 'HEAD' });
      expect(unauthenticated.status).toBe(401);
      expect(await unauthenticated.text()).toBe('');
      expect((await request('/api/admin/media/health/', 'HEAD')).status).toBe(200);
      expect((await request('/api/admin/lodgings-extra/')).status).toBe(404);
    });
    it('file stream truncado y desconexión no terminan el servidor ni escriben', async () => {
      const body =
        '--truncated\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\npartial';
      const truncated = await fetch(base + '/api/auth/me/profile-image', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + access(),
          'content-type': 'multipart/form-data; boundary=truncated',
        },
        body,
      });
      expect(truncated.status).toBe(400);
      await new Promise<void>((resolve) => {
        const request = httpRequest(base + '/api/auth/me/profile-image', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + access(),
            'content-type': 'multipart/form-data; boundary=truncated',
            'content-length': 100000,
          },
        });
        request.on('error', () => resolve());
        request.write(body);
        setTimeout(() => request.destroy(new Error('local-disconnect')), 20);
      });
      const health = await request('/api/admin/media/health');
      expect(health.status).toBe(200);
      expect(storage.objects.size).toBe(0);
    });
    it('preflight y métodos desconocidos no abren servicios; multipart inválido no escribe', async () => {
      expect((await fetch(base + '/api/auth/me/profile-image', { method: 'OPTIONS' })).status).toBe(
        204,
      );
      expect((await request('/api/admin/lodgings-else')).status).toBe(404);
      const response = await fetch(base + '/api/admin/lodging-image-uploads', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + access(),
          'content-type': 'multipart/form-data; boundary=broken',
        },
        body: '--wrong--',
      });
      expect(response.status).toBe(400);
      expect(storage.objects.size).toBe(0);
    });
  },
);
