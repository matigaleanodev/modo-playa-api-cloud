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
  },
);
