import { vi } from 'vitest';
import { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import type { User, RequestUser } from '../packages/runtime/src/identity/models.ts';
import type { Users } from '../packages/runtime/src/identity/users.repository.ts';
import { DomainException } from '../packages/runtime/src/identity/errors.ts';
import { createIdentityApplication } from '../packages/runtime/src/identity/application.ts';
import { createIdentityHandler } from '../packages/runtime/src/identity/handler.ts';
import { event, context } from './helpers.ts';

export const ownerId = '507f1f77bcf86cd799439011';
export const otherOwnerId = '507f1f77bcf86cd799439012';
export const userId = '507f1f77bcf86cd799439013';
export const testConfiguration = {
  secretKey: 'simulated-only-identity-test-key',
  bcryptRounds: 4,
  superadminOwnerId: otherOwnerId,
  publicBaseUrl: 'https://media.example.test',
  r2Endpoint: 'https://storage.example.test',
  r2Bucket: 'simulated',
};
export async function fixture() {
  const record: User = {
    _id: new Types.ObjectId(userId),
    ownerId: new Types.ObjectId(ownerId),
    email: 'owner@example.test',
    username: 'owner',
    passwordHash: await bcrypt.hash('Password123', 4),
    isPasswordSet: true,
    isActive: true,
    resetPasswordAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const find = () => Promise.resolve({ ...record });
  const users: Users = {
    findByEmail: vi.fn(find),
    findByUsername: vi.fn(find),
    findById: vi.fn(async (owner, id) => {
      if (owner !== record.ownerId.toString() || id !== record._id.toString())
        throw new DomainException('User not found', 'USER_NOT_FOUND', 404);
      return { ...record };
    }),
    setPassword: vi.fn(async (_owner, _id, passwordHash) => {
      Object.assign(record, { passwordHash, isPasswordSet: true });
    }),
    setResetPasswordData: vi.fn(async (_id, hash, expires) => {
      Object.assign(record, {
        resetPasswordCodeHash: hash,
        resetPasswordExpiresAt: expires,
        resetPasswordAttempts: 0,
      });
    }),
    incrementResetAttempts: vi.fn(async () => {
      record.resetPasswordAttempts++;
    }),
    clearResetData: vi.fn(async () => {
      Object.assign(record, {
        resetPasswordCodeHash: null,
        resetPasswordExpiresAt: null,
        resetPasswordAttempts: 0,
      });
    }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    findAllByScope: vi.fn(),
  };
  const mail = {
    sendActivationCode: vi.fn(async (_email: string, _code: string) => {}),
    sendResetCode: vi.fn(async (_email: string, _code: string) => {}),
    sendPasswordChanged: vi.fn(async (_email: string) => {}),
  };
  const app = createIdentityApplication(testConfiguration, { users, mail });
  const runtime = vi.fn(async () => ({ tokens: app.tokens, services: async () => app }));
  const handler = createIdentityHandler({ logRequests: false, runtime });
  const current: RequestUser = { ownerId, userId, role: 'OWNER', purpose: 'ACCESS' };
  async function request(
    path: string,
    method = 'POST',
    body?: unknown,
    token?: string,
    rawPath = path,
    query = '',
  ) {
    const input = event(path, method);
    input.rawPath = rawPath;
    input.rawQueryString = query;
    if (body !== undefined) input.body = JSON.stringify(body);
    if (token) input.headers.authorization = 'Bearer ' + token;
    const response = await handler(input, context);
    return { status: response.statusCode, body: JSON.parse(response.body as string) };
  }
  const token = (purpose: RequestUser['purpose'] = 'ACCESS') =>
    app.tokens.sign({ sub: userId, ownerId, purpose }, { expiresIn: '15m' });
  return { ...app, record, mail, current, handler, runtime, request, token };
}
