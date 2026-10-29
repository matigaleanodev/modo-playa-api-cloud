import { describe, expect, it } from 'vitest';
import { routes, routesFor } from '@modo-playa/contracts/routes';
import {
  loginSchema,
  codeSchema,
  createUserSchema,
  updateUserSchema,
  updateMeSchema,
  usersQuerySchema,
  passwordSchema,
} from '@modo-playa/contracts/identity';
import {
  normalizeBody,
  normalizeUsersQuery,
  validate,
} from '../packages/runtime/src/identity/validation.ts';
import { selectOperation } from '../packages/runtime/src/http/operation.ts';
import { event } from './helpers.ts';
import { fixture } from './identity-fixture.ts';

describe('contratos y selección acotada de identidad', () => {
  it('selecciona parámetros sin aceptar rutas de gestión, métodos o segmentos ajenos', () => {
    const input = event('/api/admin/users/{id}', 'GET');
    input.rawPath = '/api/admin/users/507f1f77bcf86cd799439013';
    expect(selectOperation('identity', input)?.operation).toBe('getUser');
    for (const path of [
      '/api/admin/users/',
      '/api/admin/users/a/contacts',
      '/api/admin/contacts/a',
      '/api/health',
    ]) {
      input.rawPath = path;
      expect(selectOperation('identity', input)).toBeUndefined();
    }
    expect(routesFor('identity')).toHaveLength(15);
    expect(selectOperation('health', event(routes.me.path))).toBeUndefined();
  });
  it('mantiene validación exacta de email/URL de validator y campos optional/null', () => {
    expect(() => validate(createUserSchema, { email: 'a@localhost', username: 'abc' })).toThrow(
      'email must be an email',
    );
    expect(() =>
      validate(createUserSchema, {
        email: 'a@example.test',
        username: 'abc',
        targetOwnerId: 'wrong',
      }),
    ).toThrow('targetOwnerId must be a mongodb id');
    expect(
      validate(createUserSchema, { email: 'A@example.test', username: '   ', targetOwnerId: null }),
    ).toBeDefined();
    expect(validate(updateUserSchema, { firstName: null, avatarUrl: 'example.com' })).toBeDefined();
    expect(() => validate(updateUserSchema, { avatarUrl: 'localhost' })).toThrow(
      'avatarUrl must be a URL address',
    );
    expect(validate(updateMeSchema, { phone: null })).toEqual({ phone: null });
    expect(() => validate(updateMeSchema, { firstName: 'a'.repeat(81) })).toThrow(
      'firstName must be shorter',
    );
  });
  it('password conserva longitud de class-validator, incluidos secuencias Unicode y espacios', () => {
    expect(validate(passwordSchema, { password: 'a'.repeat(71) + '❤\uFE0F' })).toBeDefined();
    expect(() => validate(passwordSchema, { password: 'a'.repeat(72) + 'x' })).toThrow(
      'password must be shorter',
    );
    expect(() => validate(passwordSchema, { password: '❤\uFE0F'.repeat(7) })).toThrow(
      'password must be longer',
    );
    expect(validate(passwordSchema, { password: ' '.repeat(8) })).toBeDefined();
    expect(() => validate(loginSchema, normalizeBody([], 'login'))).toThrow(
      'password must be shorter',
    );
    expect(validate(updateMeSchema, normalizeBody([], 'updateMe'))).toEqual([]);
    expect(() => validate(loginSchema, { identifier: 'owner' })).toThrow(
      'password must be shorter',
    );
    expect(() => validate(codeSchema, { identifier: 'owner', code: '12345a' })).toThrow(
      'code must match',
    );
  });
  it('query conserva defaults, Number(page), clamp de enteros y rechazo de campos extra', () => {
    expect(validate(usersQuerySchema, normalizeUsersQuery({}))).toEqual({ page: 1, limit: 10 });
    expect(validate(usersQuerySchema, normalizeUsersQuery({ page: '2', limit: '100' }))).toEqual({
      page: 2,
      limit: 50,
    });
    expect(validate(usersQuerySchema, normalizeUsersQuery({ limit: ['5', '10'] }))).toEqual({
      page: 1,
      limit: 5,
    });
    expect(() => validate(usersQuerySchema, normalizeUsersQuery({ page: ['2'] }))).toThrow(
      'page must not be less than 1',
    );
    expect(() => validate(usersQuerySchema, normalizeUsersQuery({ limit: '1.5' }))).toThrow(
      'limit must be an integer number',
    );
    expect(() => validate(usersQuerySchema, normalizeUsersQuery({ page: '0' }))).toThrow(
      'page must not be less than 1',
    );
    expect(() => validate(usersQuerySchema, normalizeUsersQuery({ limit: '' }))).toThrow(
      'limit must not be less than 1',
    );
    expect(() => validate(usersQuerySchema, normalizeUsersQuery({ extra: 'x' }))).toThrow(
      'property extra should not exist',
    );
    expect(normalizeBody({ identifier: '  OWNER ', password: '  abcdefgh ' }, 'login')).toEqual({
      identifier: 'OWNER',
      password: '  abcdefgh ',
    });
  });
  it('el guard precede a la validación DTO y conserva diferencias de envelopes', async () => {
    const f = await fixture();
    expect(await f.request('/api/auth/set-password', 'POST', { extra: true })).toEqual({
      status: 401,
      body: { message: 'Unauthorized', statusCode: 401 },
    });
    expect(
      await f.request('/api/auth/login', 'POST', {
        identifier: 'abc',
        password: 'Password123',
        extra: true,
      }),
    ).toEqual({
      status: 400,
      body: { message: 'property extra should not exist', code: 'REQUEST_VALIDATION_ERROR' },
    });
    expect((await f.request('/api/admin/contacts', 'POST', {})).status).toBe(404);
  });
});
