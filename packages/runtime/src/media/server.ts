import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { routesFor } from '@modo-playa/contracts/routes';
import { pathParameters } from '../http/operation.ts';
import { errorResponse, json } from '../http/request.ts';
import {
  validateBusiness,
  normalizeBusinessBody,
  normalizeBusinessQuery,
} from '../business/validation.ts';
import { DomainException } from '../identity/errors.ts';
import { executeManagementOperation } from '../management/operations.ts';
import type { createMediaApplication } from './application.ts';
import type { TokenService } from '../identity/tokens.ts';
import type { MediaConfiguration } from './configuration.ts';
import { parseMultipart, parseJson, drain } from './multipart.ts';
import { mediaRuntime } from './runtime.ts';
export interface MediaDependencies {
  logRequests: boolean;
  runtime(signal: AbortSignal): Promise<{
    tokens: Pick<TokenService, 'authenticate'>;
    config: Pick<MediaConfiguration, 'lodgingMaxBytes' | 'profileMaxBytes' | 'requestTimeoutMs'>;
    services(signal?: AbortSignal): Promise<ReturnType<typeof createMediaApplication>>;
  }>;
}
export function selectMediaRoute(method: string, path: string) {
  if (method === 'HEAD') method = 'GET';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return routesFor('media').find((route) => {
    const expected = route.path.split('/'),
      actual = path.split('/');
    return (
      route.method === method &&
      expected.length === actual.length &&
      expected.every((part, index) =>
        part.startsWith('{')
          ? !!actual[index]
          : part.toLowerCase() === actual[index]?.toLowerCase(),
      )
    );
  });
}
function send(response: ServerResponse, value: ReturnType<typeof json>) {
  response.statusCode = value.statusCode!;
  for (const [name, header] of Object.entries(value.headers ?? {}))
    response.setHeader(name, String(header));
  response.setHeader('content-length', Buffer.byteLength(value.body ?? ''));
  response.end(value.body);
}
export function createMediaHandler(dependencies: MediaDependencies) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const disconnect = new AbortController();
    const disconnected = () => {
      if (!response.writableFinished) disconnect.abort(new Error('Client disconnected.'));
    };
    request.once('aborted', disconnected);
    response.once('close', disconnected);
    const started = Date.now();
    let signal: AbortSignal = AbortSignal.any([disconnect.signal, AbortSignal.timeout(10000)]);
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'GET,HEAD,POST,PATCH,DELETE,OPTIONS');
    response.setHeader('access-control-allow-headers', 'Authorization,Content-Type');
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'OPTIONS') {
        await drain(request, signal);
        response.statusCode = 204;
        response.end();
        return;
      }
      const route = selectMediaRoute(request.method ?? 'GET', url.pathname);
      if (!route) {
        await drain(request, signal);
        send(
          response,
          json(404, {
            message: 'Cannot ' + request.method + ' ' + url.pathname,
            error: 'Not Found',
            statusCode: 404,
          }),
        );
        return;
      }
      const runtime = await dependencies.runtime(signal);
      signal = AbortSignal.any([
        disconnect.signal,
        AbortSignal.timeout(Math.max(1, runtime.config.requestTimeoutMs - (Date.now() - started))),
      ]);
      const user = runtime.tokens.authenticate(request.headers.authorization);
      if (route.path === '/api/auth/me/profile-image' && user.role === 'SUPERADMIN')
        throw new DomainException(
          'SUPERADMIN cannot manage profile images',
          'PROFILE_IMAGE_FORBIDDEN_FOR_SUPERADMIN',
          403,
        );
      let rawBody: unknown, file;
      if (route.multipart) {
        const multipart = await parseMultipart(
          request,
          route.multipart === 'profile'
            ? runtime.config.profileMaxBytes
            : runtime.config.lodgingMaxBytes,
          signal,
        );
        rawBody = multipart.fields;
        file = multipart.file;
      } else rawBody = await parseJson(request, signal);
      const body = route.body
        ? validateBusiness(route.body, normalizeBusinessBody(rawBody))
        : undefined;
      if (route.multipart && !route.body && Object.keys(rawBody as object).length)
        validateBusiness({ type: 'object', additionalProperties: false, properties: {} }, rawBody);
      const query: Record<string, string | string[]> = {};
      for (const [key, value] of url.searchParams) {
        const current = query[key];
        query[key] =
          current === undefined
            ? value
            : [...(Array.isArray(current) ? current : [current]), value];
      }
      const parameters = pathParameters(route.path, url.pathname);
      if (route.parameters) validateBusiness(route.parameters, parameters);
      const normalizedQuery = route.query
        ? validateBusiness(route.query, normalizeBusinessQuery(query, route.operation))
        : undefined;
      // A missing file must reject before a configuration opens Mongo or any write.
      if (route.multipart && !file)
        throw new DomainException('Image file is required', 'REQUEST_VALIDATION_ERROR', 400);
      const services = await runtime.services(signal);
      let result: unknown;
      switch (route.operation) {
        case 'uploadProfileImage':
          result = await services.profiles.uploadOwnProfileImageFile(
            user.ownerId,
            user.userId,
            file!,
          );
          break;
        case 'deleteProfileImage':
          result = await services.profiles.deleteProfileImage(user.ownerId, user.userId);
          break;
        case 'uploadDraftImage':
          result = await services.images.uploadDraftImageFile(
            body as { uploadSessionId: string },
            file!,
            user.ownerId,
          );
          break;
        case 'uploadLodgingImage':
          result = await services.images.uploadImageFile(
            parameters.lodgingId!,
            file!,
            user.ownerId,
            user.role,
          );
          break;
        case 'setDefaultLodgingImage':
          result = await services.images.setDefaultImage(
            parameters.lodgingId!,
            parameters.imageId!,
            user.ownerId,
            user.role,
          );
          break;
        case 'deleteLodgingImage':
          result = await services.images.deleteImage(
            parameters.lodgingId!,
            parameters.imageId!,
            user.ownerId,
            user.role,
          );
          break;
        case 'mediaHealth':
          result = await services.health();
          break;
        default:
          result = await executeManagementOperation(
            route,
            parameters,
            body,
            normalizedQuery,
            user,
            services,
          );
      }
      send(response, json(route.method === 'POST' ? 201 : 200, result));
    } catch (error) {
      try {
        await drain(request, signal);
      } catch {}
      if (!response.destroyed && !response.writableEnded) send(response, errorResponse(error));
    } finally {
      request.removeListener('aborted', disconnected);
      response.removeListener('close', disconnected);
      if (dependencies.logRequests) console.info({ statusCode: response.statusCode });
    }
  };
}
export function createMediaServer(dependencies: MediaDependencies) {
  const server = createServer(createMediaHandler(dependencies));
  // The per-request deadline governs uploads; a fixed server ceiling must not override configuration.
  server.requestTimeout = 0;
  server.headersTimeout = 10000;
  return server;
}
export function startMediaServer(env: NodeJS.ProcessEnv = process.env) {
  const endpoint = env.AWS_LAMBDA_HTTP_ENDPOINT;
  if (!endpoint) throw new Error('AWS_LAMBDA_HTTP_ENDPOINT required.');
  const address = new URL(endpoint.includes('://') ? endpoint : 'http://' + endpoint);
  const server = createMediaServer({ logRequests: true, runtime: mediaRuntime(env) });
  server.listen(Number(address.port), address.hostname);
  return server;
}
export { createMediaApplication } from './application.ts';
export { R2ObjectStorageService } from './storage.ts';
export { LodgingImagesService } from './lodging-images.service.ts';
export { UserProfileImagesService } from './profile-images.service.ts';
