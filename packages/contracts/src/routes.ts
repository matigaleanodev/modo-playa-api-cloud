import { healthResponseSchema } from './health.ts';
import {
  identifierSchema,
  loginSchema,
  codeSchema,
  passwordSchema,
  changePasswordSchema,
  updateMeSchema,
  createUserSchema,
  updateUserSchema,
  usersQuerySchema,
  userPathSchema,
  authResponseSchema,
  authUserSchema,
  accessTokenSchema,
  messageSchema,
  userResponseSchema,
  usersResponseSchema,
  domainErrorSchema,
  httpErrorSchema,
} from './identity.ts';
import type { JSONSchema } from 'json-schema-to-ts';

interface ResponseMetadata {
  description: string;
  mediaType: string;
  schema: JSONSchema;
}
export interface RouteMetadata {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  group: 'health' | 'identity';
  operation: string;
  bearer?: boolean;
  body?: JSONSchema;
  query?: typeof usersQuerySchema;
  parameters?: typeof userPathSchema;
  responses: Record<number, ResponseMetadata>;
}
const response = (
  schema: JSONSchema,
  description = 'Respuesta de la operación.',
): ResponseMetadata => ({ description, mediaType: 'application/json', schema });
function identity(
  operation: string,
  method: RouteMetadata['method'],
  path: string,
  schema: JSONSchema,
  options: Pick<RouteMetadata, 'body' | 'query' | 'parameters' | 'bearer'> = {},
): RouteMetadata {
  const responses: Record<number, ResponseMetadata> = {
    [method === 'POST' ? 201 : 200]: response(schema),
    400: response(domainErrorSchema, 'Validación o identificador inválido.'),
    401: response(
      { oneOf: [domainErrorSchema, httpErrorSchema] },
      'Autenticación o propósito inválido.',
    ),
    404: response(domainErrorSchema, 'Usuario no encontrado.'),
    500: response(httpErrorSchema, 'Error interno saneado.'),
  };
  if (operation === 'createUser')
    responses[409] = response(domainErrorSchema, 'Duplicado o límite del owner.');
  return { group: 'identity', operation, method, path: '/api' + path, ...options, responses };
}
export const routes = {
  health: {
    method: 'GET',
    path: '/api/health',
    group: 'health',
    operation: 'getHealth',
    responses: { 200: response(healthResponseSchema, 'API disponible.') },
  } satisfies RouteMetadata,
  requestActivation: identity(
    'requestActivation',
    'POST',
    '/auth/request-activation',
    messageSchema,
    { body: identifierSchema },
  ),
  activate: identity('activate', 'POST', '/auth/activate', accessTokenSchema, { body: codeSchema }),
  setPassword: identity('setPassword', 'POST', '/auth/set-password', authResponseSchema, {
    body: passwordSchema,
    bearer: true,
  }),
  login: identity('login', 'POST', '/auth/login', authResponseSchema, { body: loginSchema }),
  refresh: identity('refresh', 'POST', '/auth/refresh', authResponseSchema, { bearer: true }),
  changePassword: identity('changePassword', 'POST', '/auth/change-password', authResponseSchema, {
    body: changePasswordSchema,
    bearer: true,
  }),
  forgotPassword: identity('forgotPassword', 'POST', '/auth/forgot-password', messageSchema, {
    body: identifierSchema,
  }),
  verifyResetCode: identity(
    'verifyResetCode',
    'POST',
    '/auth/verify-reset-code',
    accessTokenSchema,
    { body: codeSchema },
  ),
  resetPassword: identity('resetPassword', 'POST', '/auth/reset-password', messageSchema, {
    body: passwordSchema,
    bearer: true,
  }),
  me: identity('me', 'GET', '/auth/me', authUserSchema, { bearer: true }),
  updateMe: identity('updateMe', 'PATCH', '/auth/me', authUserSchema, {
    body: updateMeSchema,
    bearer: true,
  }),
  createUser: identity('createUser', 'POST', '/admin/users', userResponseSchema, {
    body: createUserSchema,
    bearer: true,
  }),
  listUsers: identity('listUsers', 'GET', '/admin/users', usersResponseSchema, {
    query: usersQuerySchema,
    bearer: true,
  }),
  getUser: identity('getUser', 'GET', '/admin/users/{id}', userResponseSchema, {
    parameters: userPathSchema,
    bearer: true,
  }),
  updateUser: identity('updateUser', 'PATCH', '/admin/users/{id}', userResponseSchema, {
    body: updateUserSchema,
    parameters: userPathSchema,
    bearer: true,
  }),
};
export type Route = RouteMetadata;
export type RouteGroup = RouteMetadata['group'];
export function routesFor(group: RouteGroup): Route[] {
  return Object.values(routes).filter((route) => route.group === group);
}
