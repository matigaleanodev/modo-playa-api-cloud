import { TokenService } from '../packages/runtime/src/identity/tokens.ts';
import { businessModels } from '../packages/runtime/src/business/models.ts';
import { createManagementApplication } from '../packages/runtime/src/management/application.ts';
import { createManagementHandler } from '../packages/runtime/src/management/handler.ts';
import { createCatalogHandler } from '../packages/runtime/src/catalog/handler.ts';
import { routes } from '@modo-playa/contracts/routes';
import { lodgingInput } from './business-fixture.ts';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createConnection, Types, type Connection } from 'mongoose';
import bcrypt from 'bcrypt';
import { userModel, type UserModel } from '../packages/runtime/src/identity/models.ts';
import { UsersRepository } from '../packages/runtime/src/identity/users.repository.ts';
import { database } from '../packages/runtime/src/identity/database.ts';
import { createIdentityApplication } from '../packages/runtime/src/identity/application.ts';
import { createIdentityHandler } from '../packages/runtime/src/identity/handler.ts';
import { event, context } from './helpers.ts';
import { ownerId, otherOwnerId, testConfiguration } from './identity-fixture.ts';

describe.skipIf(!process.env.LOCAL_MONGOD)(
  'persistencia real en Mongo descartable y exclusivo de este proceso',
  () => {
    let process: ChildProcess;
    let directory: string;
    let connection: Connection;
    let model: UserModel;
    let users: UsersRepository;
    let db: ReturnType<typeof database>;
    let handler: ReturnType<typeof createIdentityHandler>;
    const appTokens = new TokenService(testConfiguration.secretKey);
    let business: ReturnType<typeof businessModels>;
    let managementApp: ReturnType<typeof createManagementApplication>;
    let management: ReturnType<typeof createManagementHandler>;
    let catalog: ReturnType<typeof createCatalogHandler>;
    let access: string;
    let superadmin: string;
    beforeAll(async () => {
      const server = createServer();
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = (server.address() as { port: number }).port;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      directory = await mkdtemp(join(tmpdir(), 'modo-playa-mongo-'));
      process = spawn(
        globalThis.process.env.LOCAL_MONGOD!,
        [
          '--dbpath',
          directory,
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
        const timer = setTimeout(() => reject(new Error('Mongo local no inició.')), 15000);
        process.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        process.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Mongo local terminó durante el inicio.'));
        });
        process.stdout!.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('Waiting for connections')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const uri = `mongodb://127.0.0.1:${port}/modo_playa_identity_disposable`;
      connection = await createConnection(uri, { autoCreate: false, autoIndex: false }).asPromise();
      model = userModel(connection);
      business = businessModels(connection);
      for (const model of [business.contacts, business.lodgings]) {
        await model.createCollection();
        await model.createIndexes();
      }
      managementApp = createManagementApplication(
        connection,
        { ...testConfiguration, mongoUri: 'unused-explicit-local' },
        { attachDraftUploadsToLodging: async () => {}, deleteAllForLodging: async () => {} },
      );
      management = createManagementHandler({
        logRequests: false,
        runtime: async () => ({ tokens: appTokens, services: async () => managementApp }),
      });
      catalog = createCatalogHandler({
        logRequests: false,
        runtime: async () => ({
          destinations: {
            getAll: () => [],
            getContext: async () => {
              throw new Error('Not used');
            },
          },
          catalog: async () => ({
            lodgings: managementApp.lodgings,
            mediaUrls: managementApp.mediaUrls,
          }),
        }),
      });
      // Colección e índices solo en esta base local nueva; nunca forman parte del cold start.
      await model.createCollection();
      await model.createIndexes();
      db = database(async () => uri);
      users = await db.users(AbortSignal.timeout(60000));
      const app = createIdentityApplication(testConfiguration, {
        users,
        mail: {
          sendActivationCode: async () => {},
          sendResetCode: async () => {},
          sendPasswordChanged: async () => {},
        },
      });
      handler = createIdentityHandler({
        logRequests: false,
        runtime: async () => ({ tokens: app.tokens, services: async () => app }),
      });
      access = app.tokens.sign(
        { sub: new Types.ObjectId().toString(), ownerId, purpose: 'REFRESH' },
        { expiresIn: '15m' },
      );
      superadmin = app.tokens.sign(
        {
          sub: new Types.ObjectId().toString(),
          ownerId,
          role: 'SUPERADMIN',
          purpose: 'PASSWORD_SETUP',
        },
        { expiresIn: '15m' },
      );
    }, 20000);
    beforeEach(async () => {
      await model.deleteMany({});
      await business.contacts.deleteMany({});
      await business.lodgings.deleteMany({});
    });
    afterAll(async () => {
      await db?.close();
      await connection?.close();
      if (process && process.exitCode === null) {
        const stopped = once(process, 'exit');
        process.kill('SIGTERM');
        await stopped;
      }
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    async function request(
      path: string,
      method: string,
      body: unknown,
      token = access,
      rawPath = path,
      query = '',
    ) {
      const input = event(path, method);
      input.rawPath = rawPath;
      input.rawQueryString = query;
      input.headers.authorization = 'Bearer ' + token;
      if (body !== undefined) input.body = JSON.stringify(body);
      const response = await handler(input, context);
      return { status: response.statusCode, body: JSON.parse(response.body as string) };
    }
    it('OWNER ignora targetOwnerId válido, conserva defaults, ObjectId, timestamps y límite de tres', async () => {
      for (let n = 1; n <= 3; n++) {
        const response = await request('/api/admin/users', 'POST', {
          email: `User${n}@example.test`,
          username: `USER${n}`,
          targetOwnerId: otherOwnerId,
        });
        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
          email: `user${n}@example.test`,
          username: `user${n}`,
          isActive: true,
          isPasswordSet: false,
        });
      }
      const stored = await model.findOne();
      expect(stored!.ownerId).toEqual(new Types.ObjectId(ownerId));
      expect(stored!.createdAt).toBeInstanceOf(Date);
      expect(stored!.updatedAt).toBeInstanceOf(Date);
      expect(stored!.resetPasswordAttempts).toBe(0);
      expect(
        (
          await request('/api/admin/users', 'POST', {
            email: 'four@example.test',
            username: 'four',
          })
        ).body,
      ).toEqual({ message: 'User limit reached for this owner', code: 'USER_ALREADY_EXISTS' });
    });
    it('SUPERADMIN crea en tenant objetivo y conserva fallback sin límite de OWNER', async () => {
      const created = await request(
        '/api/admin/users',
        'POST',
        {
          email: 'target@example.test',
          username: 'target',
          targetOwnerId: otherOwnerId,
        },
        superadmin,
      );
      expect(created.status).toBe(201);
      expect((await model.findById(created.body.id))!.ownerId.toString()).toBe(otherOwnerId);
      for (let n = 0; n < 4; n++)
        expect(
          (
            await request(
              '/api/admin/users',
              'POST',
              {
                email: `support${n}@example.test`,
                username: `support${n}`,
              },
              superadmin,
            )
          ).status,
        ).toBe(201);
      expect(await model.countDocuments({ ownerId })).toBe(4);
    });
    it('unicidad por owner y carreras 11000 conservan el conflicto', async () => {
      const dto = { email: 'same@example.test', username: 'same' };
      const results = await Promise.all(
        [
          users.createUser(ownerId, 'SUPERADMIN', dto),
          users.createUser(ownerId, 'SUPERADMIN', dto),
        ].map((task) => task.catch((error: unknown) => error)),
      );
      expect(results.filter((value) => value instanceof Error)).toHaveLength(1);
      expect(results.find((value) => value instanceof Error)).toMatchObject({
        status: 409,
        code: 'USER_ALREADY_EXISTS',
      });
      await expect(users.createUser(otherOwnerId, 'SUPERADMIN', dto)).resolves.toMatchObject({
        username: 'same',
      });
      await expect(users.createUser(ownerId, 'SUPERADMIN', dto)).rejects.toMatchObject({
        message: 'Ya existe un usuario con ese email o username',
        status: 409,
      });
    });
    it('GET/PATCH parametrizados aíslan owners y SUPERADMIN amplía el scope sin restricción nueva de propósito', async () => {
      const other = await users.createUser(otherOwnerId, 'SUPERADMIN', {
        email: 'other@example.test',
        username: 'other',
      });
      const id = other._id.toString();
      expect(
        (await request('/api/admin/users/{id}', 'GET', undefined, access, '/api/admin/users/' + id))
          .status,
      ).toBe(404);
      expect(
        (
          await request(
            '/api/admin/users/{id}',
            'PATCH',
            { firstName: 'Ana' },
            access,
            '/api/admin/users/' + id,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            '/api/admin/users/{id}',
            'GET',
            undefined,
            superadmin,
            '/api/admin/users/' + id,
          )
        ).status,
      ).toBe(200);
      const updated = await request(
        '/api/admin/users/{id}',
        'PATCH',
        { firstName: '  Ana  ', avatarUrl: null },
        superadmin,
        '/api/admin/users/' + id,
      );
      expect(updated.body.firstName).toBe('  Ana  ');
      expect(updated.body.avatarUrl).toBeNull();
      expect(
        (await request('/api/admin/users/{id}', 'GET', undefined, access, '/api/admin/users/bad'))
          .body,
      ).toEqual({ message: 'Invalid user id', code: 'INVALID_USER_ID' });
    });
    it('listado conserva orden ascendente, defaults/clamp y scope', async () => {
      for (let n = 0; n < 3; n++) {
        const row = await users.createUser(ownerId, 'SUPERADMIN', {
          email: `u${n}@example.test`,
          username: `usr${n}`,
        });
        await model.updateOne(
          { _id: row._id },
          { createdAt: new Date(2020, 0, n + 1) },
          { timestamps: false },
        );
      }
      await users.createUser(otherOwnerId, 'SUPERADMIN', {
        email: 'foreign@example.test',
        username: 'foreign',
      });
      const listed = await request(
        '/api/admin/users',
        'GET',
        undefined,
        access,
        '/api/admin/users',
        'page=2&limit=1',
      );
      expect(listed.body).toMatchObject({ total: 3, page: 2, limit: 1 });
      expect(listed.body.data[0].username).toBe('usr1');
      expect(
        (
          await request(
            '/api/admin/users',
            'GET',
            undefined,
            superadmin,
            '/api/admin/users',
            'limit=200',
          )
        ).body,
      ).toMatchObject({ total: 4, page: 1, limit: 50 });
    });
    it('persistencia de hashes/códigos no resetea estado al reconstruir repositorios ni actualiza lastLoginAt', async () => {
      const row = await users.createUser(ownerId, 'OWNER', {
        email: 'login@example.test',
        username: 'login',
      });
      const hash = await bcrypt.hash('Password123', 4);
      await users.setPassword(ownerId, row._id.toString(), hash);
      await users.setResetPasswordData(row._id.toString(), hash, new Date(Date.now() + 900000));
      await users.incrementResetAttempts(row._id.toString());
      await db.close();
      users = await db.users(AbortSignal.timeout(60000));
      const stored = await users.findById(ownerId, row._id.toString());
      expect(stored).toMatchObject({
        passwordHash: hash,
        resetPasswordCodeHash: hash,
        resetPasswordAttempts: 1,
        isPasswordSet: true,
      });
      expect(stored.lastLoginAt).toBeUndefined();
      await users.clearResetData(row._id.toString());
      expect(await users.findById(ownerId, row._id.toString())).toMatchObject({
        resetPasswordCodeHash: null,
        resetPasswordExpiresAt: null,
        resetPasswordAttempts: 0,
      });
    });
    async function businessRequest(
      operation: keyof typeof routes,
      body?: unknown,
      token = access,
      id = '',
      query = '',
    ) {
      const route = routes[operation];
      const input = event(route.path, route.method);
      input.rawPath = route.path.replace('{id}', id);
      input.rawQueryString = query;
      input.headers.authorization = 'Bearer ' + token;
      if (body !== undefined) input.body = JSON.stringify(body);
      const response = await (route.group === 'catalog' ? catalog : management)(input, context);
      return { status: response.statusCode, body: JSON.parse(response.body as string) };
    }
    it('contactos persisten default parcial, soft delete y scope; SUPERADMIN conserva target/fallback', async () => {
      const own = await businessRequest('createContact', {
        name: '  Ana  ',
        isDefault: true,
        targetOwnerId: otherOwnerId,
      });
      expect(own.status).toBe(201);
      expect(own.body.name).toBe('Ana');
      expect((await business.contacts.findById(own.body.id))!.ownerId.toString()).toBe(ownerId);
      const next = await businessRequest('createContact', { name: 'Next', isDefault: true });
      expect((await business.contacts.findById(own.body.id))!.isDefault).toBe(false);
      expect((await businessRequest('deleteContact', undefined, access, next.body.id)).status).toBe(
        409,
      );
      expect((await businessRequest('deleteContact', undefined, access, own.body.id)).body).toEqual(
        { deleted: true },
      );
      expect(await business.contacts.countDocuments()).toBe(2);
      expect((await businessRequest('getContact', undefined, access, own.body.id)).status).toBe(
        404,
      );
      expect(
        (
          await businessRequest(
            'getContact',
            undefined,
            access,
            own.body.id,
            'includeInactive=true',
          )
        ).status,
      ).toBe(200);
      expect(
        (await businessRequest('updateContact', { isDefault: true }, access, own.body.id)).status,
      ).toBe(409);
      expect((await businessRequest('listContacts')).body.total).toBe(1);
      expect(
        (await businessRequest('listContacts', undefined, access, '', 'includeInactive=1')).body
          .total,
      ).toBe(2);
      const foreign = await businessRequest(
        'createContact',
        { name: 'Other', targetOwnerId: otherOwnerId },
        superadmin,
      );
      expect((await business.contacts.findById(foreign.body.id))!.ownerId.toString()).toBe(
        otherOwnerId,
      );
      const fallback = await businessRequest('createContact', { name: 'Fallback' }, superadmin);
      expect((await business.contacts.findById(fallback.body.id))!.ownerId.toString()).toBe(
        ownerId,
      );
      for (const op of ['getContact', 'updateContact', 'deleteContact'] as const)
        expect(
          (
            await businessRequest(
              op,
              op === 'updateContact' ? { name: 'blocked' } : undefined,
              access,
              foreign.body.id,
            )
          ).status,
        ).toBe(404);
      expect(
        (await businessRequest('getContact', undefined, superadmin, foreign.body.id)).status,
      ).toBe(200);
      expect((await businessRequest('listContacts', undefined, superadmin)).body.total).toBe(3);
      await expect(
        business.contacts.create({
          name: 'Race',
          ownerId: new Types.ObjectId(ownerId),
          isDefault: true,
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
    it('asociación conserva owner efectivo, default/inactivo y asimetría de PATCH SUPERADMIN', async () => {
      const own = await managementApp.contacts.create(
        { name: 'Own', isDefault: true },
        ownerId,
        'OWNER',
      );
      const foreign = await managementApp.contacts.create(
        { name: 'Foreign', isDefault: true, targetOwnerId: otherOwnerId },
        ownerId,
        'SUPERADMIN',
      );
      expect(
        (
          await businessRequest('createLodging', {
            ...lodgingInput,
            contactId: foreign._id.toString(),
          })
        ).body.code,
      ).toBe('CONTACT_NOT_ALLOWED');
      const created = await businessRequest('createLodging', lodgingInput);
      expect(created.body.contactId).toBe(own._id.toString());
      const other = await businessRequest(
        'createLodging',
        { ...lodgingInput, targetOwnerId: otherOwnerId, contactId: foreign._id.toString() },
        superadmin,
      );
      expect(other.status).toBe(201);
      expect((await business.lodgings.findById(other.body.id))!.ownerId.toString()).toBe(
        otherOwnerId,
      );
      expect(
        (
          await businessRequest(
            'updateLodging',
            { contactId: foreign._id.toString() },
            superadmin,
            other.body.id,
          )
        ).body.code,
      ).toBe('CONTACT_NOT_ALLOWED');
      await business.contacts.updateOne({ _id: own._id }, { active: false });
      expect(
        (await businessRequest('createLodging', { ...lodgingInput, contactId: own._id.toString() }))
          .body.code,
      ).toBe('CONTACT_NOT_ALLOWED');
      for (const op of [
        'getAdminLodging',
        'updateLodging',
        'deleteLodging',
        'getOccupiedRanges',
        'addOccupiedRange',
        'removeOccupiedRange',
        'setPublicVisibility',
      ] as const) {
        const body =
          op === 'updateLodging'
            ? { title: 'blocked' }
            : op === 'setPublicVisibility'
              ? { isPubliclyVisible: true }
              : ['addOccupiedRange', 'removeOccupiedRange'].includes(op)
                ? { from: '2026-01-01', to: '2026-01-02' }
                : undefined;
        expect((await businessRequest(op, body, access, other.body.id)).status).toBe(404);
      }
    });
    it('catálogo incluye legacy, excluye ocultos y conserva filtros públicos, búsqueda escapada y filtros admin efectivos', async () => {
      const first = await businessRequest('createLodging', {
        ...lodgingInput,
        title: 'Casa.*',
        price: 200,
      });
      const legacy = await businessRequest('createLodging', {
        ...lodgingInput,
        title: 'Legacy',
        price: 100,
      });
      const hidden = await businessRequest('createLodging', {
        ...lodgingInput,
        isPubliclyVisible: false,
      });
      await business.lodgings.collection.updateOne(
        { _id: new Types.ObjectId(legacy.body.id) },
        { $unset: { isPubliclyVisible: '' }, $set: { tags: ['familia'] } },
      );
      await business.lodgings.collection.updateOne(
        { _id: new Types.ObjectId(first.body.id) },
        { $set: { createdAt: new Date('2020-01-01') } },
      );
      expect(
        (await businessRequest('getPublicLodging', undefined, access, legacy.body.id)).status,
      ).toBe(200);
      expect(
        (await businessRequest('getPublicLodging', undefined, access, hidden.body.id)).status,
      ).toBe(404);
      const page = await businessRequest(
        'listPublicLodgings',
        undefined,
        access,
        '',
        'page=2&limit=1',
      );
      expect(page.body).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(page.body.data[0].id).toBe(first.body.id);
      const search = await businessRequest(
        'listPublicLodgings',
        undefined,
        access,
        '',
        'search=.*',
      );
      expect(search.body.data.map((v: { id: string }) => v.id)).toEqual([first.body.id]);
      expect(
        (
          await businessRequest(
            'listPublicLodgings',
            undefined,
            access,
            '',
            'city=Mar%20Azul&minGuests=4&minPrice=90&maxPrice=150&amenities=wifi&amenities=wifi&tag=familia&tag=familia',
          )
        ).body.total,
      ).toBe(1);
      expect(
        (
          await businessRequest(
            'listPublicLodgings',
            undefined,
            access,
            '',
            'minPrice=200&maxPrice=100',
          )
        ).body.code,
      ).toBe('INVALID_PRICE_RANGE');
      expect(
        (
          await businessRequest(
            'listAdminLodgings',
            undefined,
            access,
            '',
            'search=nonexistent&city=Other&minPrice=500',
          )
        ).body.total,
      ).toBe(3);
      expect(
        (await businessRequest('listAdminLodgings', undefined, access, '', 'includeInactive=false'))
          .body.total,
      ).toBe(1);
      expect(
        (
          await businessRequest(
            'setPublicVisibility',
            { isPubliclyVisible: false },
            access,
            first.body.id,
          )
        ).status,
      ).toBe(200);
      expect(
        (await businessRequest('getPublicLodging', undefined, access, first.body.id)).status,
      ).toBe(404);
    });
    it('disponibilidad HTTP preserva UTC, orden, solapamiento inclusivo y DELETE con body exacto', async () => {
      const created = await businessRequest('createLodging', lodgingInput);
      const id = created.body.id;
      expect(
        (await businessRequest('updateLodging', { occupiedRanges: [] }, access, id)).body.message,
      ).toBe('property occupiedRanges should not exist');
      expect(
        (
          await businessRequest(
            'addOccupiedRange',
            { from: '2026-01-01T23:30:00-03:00', to: '2026-01-04' },
            access,
            id,
          )
        ).body,
      ).toEqual([{ from: '2026-01-02', to: '2026-01-04' }]);
      expect(
        (
          await businessRequest(
            'addOccupiedRange',
            { from: '2026-01-04', to: '2026-01-05' },
            access,
            id,
          )
        ).body.code,
      ).toBe('OCCUPIED_RANGE_CONFLICT');
      expect(
        (
          await businessRequest(
            'removeOccupiedRange',
            { from: '2026-01-02', to: '2026-01-03' },
            access,
            id,
          )
        ).body.code,
      ).toBe('INVALID_AVAILABILITY_RANGE');
      expect(
        (
          await businessRequest(
            'removeOccupiedRange',
            { from: '2026-01-02', to: '2026-01-04' },
            access,
            id,
          )
        ).body,
      ).toEqual([]);
      expect(
        (
          await businessRequest(
            'addOccupiedRange',
            { from: '2026-01-06', to: '2026-01-05' },
            access,
            id,
          )
        ).body.code,
      ).toBe('INVALID_AVAILABILITY_RANGE');
    });
    it('dashboard usa agregaciones reales con active legacy, users compartido y scope global/owner', async () => {
      await users.createUser(ownerId, 'SUPERADMIN', {
        email: 'owner@example.test',
        username: 'owner',
      });
      await users.createUser(otherOwnerId, 'SUPERADMIN', {
        email: 'other@example.test',
        username: 'other',
      });
      await businessRequest('createContact', { name: 'Incomplete' });
      const first = await businessRequest('createLodging', lodgingInput);
      await businessRequest(
        'createLodging',
        { ...lodgingInput, targetOwnerId: otherOwnerId },
        superadmin,
      );
      // active es legacy y deliberadamente distinto de isPubliclyVisible.
      await business.lodgings.collection.updateOne(
        { _id: new Types.ObjectId(first.body.id) },
        { $set: { active: true, isPubliclyVisible: false } },
      );
      const own = (await businessRequest('dashboardSummary')).body;
      expect(own.ownerScope).toEqual({ ownerId, role: 'OWNER' });
      expect(own.metrics.lodgings).toMatchObject({
        total: 1,
        active: 1,
        inactive: 0,
        withoutContact: 1,
      });
      expect(own.metrics.users.total).toBe(1);
      expect(own.recentActivity.source).toBe('timestamps');
      expect(own.alerts.map((v: { code: string }) => v.code)).toEqual(
        expect.arrayContaining([
          'LODGING_WITHOUT_CONTACT',
          'CONTACT_INCOMPLETE',
          'USER_PENDING_ACTIVATION',
        ]),
      );
      const global = (await businessRequest('dashboardSummary', undefined, superadmin)).body;
      expect(global.metrics.lodgings).toMatchObject({ total: 2, active: 1, inactive: 1 });
      expect(global.metrics.users.total).toBe(2);
      expect(global.distributions.lodgingsByCity).toEqual([
        { city: 'Mar Azul', total: 2, active: 1, inactive: 1 },
      ]);
    });
  },
);
