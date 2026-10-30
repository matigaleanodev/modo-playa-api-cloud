import { protectEventOrigin } from '../http/origin.ts';
import middy from '@middy/core';
import { Ajv } from 'ajv';
import { httpEventSchema } from '@modo-playa/contracts/http-input';
import type {
  IdentifierInput,
  LoginInput,
  CodeInput,
  PasswordInput,
  ChangePasswordInput,
  UpdateMeInput,
  CreateUserInput,
  UpdateUserInput,
  UsersQueryInput,
} from '@modo-playa/contracts/identity';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { selectOperation, pathParameters } from '../http/operation.ts';
import { DomainException, HttpException } from './errors.ts';
import { validate, normalizeBody, normalizeUsersQuery } from './validation.ts';
import { UsersMapper } from './users.mapper.ts';
import type { AuthService } from './auth.service.ts';
import type { Users } from './users.repository.ts';
import type { TokenService } from './tokens.ts';
import type { RequestUser } from './models.ts';
import { identityRuntime } from './runtime.ts';

interface Services {
  auth: AuthService;
  users: Users;
}
export interface IdentityDependencies {
  logRequests: boolean;
  runtime: (
    signal: AbortSignal,
  ) => Promise<{ tokens: TokenService; services: () => Promise<Services> }>;
}
const validateEvent = new Ajv({ strict: true }).compile<APIGatewayProxyEventV2>(httpEventSchema);
const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

function queryParameters(event: APIGatewayProxyEventV2) {
  if (!event.rawQueryString) return event.queryStringParameters ?? {};
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(event.rawQueryString)) {
    const current = result[key];
    result[key] =
      current === undefined ? value : [...(Array.isArray(current) ? current : [current]), value];
  }
  return result;
}
function parseBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  try {
    return JSON.parse(
      event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body,
    );
  } catch {
    throw new HttpException(400, {
      message: 'Unexpected token in JSON',
      error: 'Bad Request',
      statusCode: 400,
    });
  }
}
export function createIdentityHandler(dependencies: IdentityDependencies) {
  return middy<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>({
    timeoutEarlyInMillis: 0,
  })
    .use({
      after({ context, response }) {
        if (dependencies.logRequests)
          console.info({ requestId: context.awsRequestId, statusCode: response.statusCode });
      },
    })
    .handler<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>(async (event, context) => {
      try {
        if (!validateEvent(event))
          return json(400, { statusCode: 400, message: 'Bad Request', error: 'Bad Request' });
        const route = selectOperation('identity', event);
        if (!route)
          return json(404, {
            message: `Cannot ${event.requestContext.http.method} ${event.rawPath}`,
            error: 'Not Found',
            statusCode: 404,
          });
        const rawBody = parseBody(event);
        const signal = AbortSignal.timeout(
          Math.max(1, Math.min(18000, context.getRemainingTimeInMillis() - 250)),
        );
        const runtime = await dependencies.runtime(signal);
        const authorization = Object.entries(event.headers).find(
          ([name]) => name.toLowerCase() === 'authorization',
        )?.[1];
        const user = route.bearer ? runtime.tokens.authenticate(authorization) : undefined;
        const body = route.body
          ? validate(route.body, normalizeBody(rawBody, route.operation))
          : undefined;
        const query = route.query
          ? validate<UsersQueryInput>(route.query, normalizeUsersQuery(queryParameters(event)))
          : undefined;
        const parameters = pathParameters(route.path, event.rawPath);
        if (route.parameters) validate(route.parameters, parameters);
        const { auth, users } = await runtime.services();
        const current = user as RequestUser;
        let result: unknown;
        switch (route.operation) {
          case 'requestActivation':
            await auth.requestActivation((body as IdentifierInput).identifier);
            result = { message: 'Si el usuario existe, se envio un codigo de activacion' };
            break;
          case 'activate':
            result = await auth.activate(body as CodeInput);
            break;
          case 'setPassword':
            result = await auth.setPassword(current, body as PasswordInput);
            break;
          case 'login':
            result = await auth.login(body as LoginInput);
            break;
          case 'refresh':
            result = await auth.refresh(current);
            break;
          case 'changePassword':
            result = await auth.changePassword(current, body as ChangePasswordInput);
            break;
          case 'forgotPassword':
            result = await auth.forgotPassword(body as IdentifierInput);
            break;
          case 'verifyResetCode':
            result = await auth.verifyResetCode(body as CodeInput);
            break;
          case 'resetPassword':
            result = await auth.resetPassword(current, body as PasswordInput);
            break;
          case 'me':
            result = await auth.me(current);
            break;
          case 'updateMe':
            result = await auth.updateMe(current, body as UpdateMeInput);
            break;
          case 'createUser':
            result = UsersMapper.toResponse(
              await users.createUser(current.ownerId, current.role, body as CreateUserInput),
            );
            break;
          case 'listUsers': {
            const page = await users.findAllByScope(current.ownerId, current.role, query!);
            result = { ...page, data: page.data.map((value) => UsersMapper.toResponse(value)) };
            break;
          }
          case 'getUser':
            result = UsersMapper.toResponse(
              await users.findById(current.ownerId, parameters.id!, current.role),
            );
            break;
          case 'updateUser':
            result = UsersMapper.toResponse(
              await users.updateUser(
                current.ownerId,
                parameters.id!,
                body as UpdateUserInput,
                current.role,
              ),
            );
            break;
          default:
            throw new Error('Unknown identity operation.');
        }
        return json(route.method === 'POST' ? 201 : 200, result);
      } catch (error) {
        if (error instanceof DomainException)
          return json(error.status, { message: error.message, code: error.code });
        if (error instanceof HttpException) return json(error.status, error.body);
        return json(500, { statusCode: 500, message: 'Internal server error' });
      }
    });
}
export const handler = protectEventOrigin(
  createIdentityHandler({
    logRequests: true,
    runtime: identityRuntime(process.env),
  }),
  process.env,
);

export { createIdentityApplication } from './application.ts';
