import type { RouteMetadata } from './routes.ts';
import { deletedSchema } from './business.ts';
import { domainErrorSchema, httpErrorSchema } from './identity.ts';
import * as media from './media.ts';
import type { JSONSchema } from 'json-schema-to-ts';
function route(
  operation: string,
  method: RouteMetadata['method'],
  path: string,
  schema: JSONSchema,
  multipart?: 'lodging' | 'profile',
  parameters?: RouteMetadata['parameters'],
): RouteMetadata {
  return {
    operation,
    method,
    path: '/api' + path,
    group: 'media',
    bearer: true,
    ...(multipart ? { multipart } : {}),
    ...(parameters ? { parameters } : {}),
    ...(operation === 'uploadDraftImage' ? { body: media.draftBodySchema } : {}),
    responses: Object.fromEntries(
      [method === 'POST' ? 201 : 200, 400, 401, 403, 404, 409, 500, 503].map((status) => [
        status,
        {
          description:
            status < 300
              ? 'Respuesta de la operación.'
              : 'Validación, autorización o dependencia no disponible.',
          mediaType: 'application/json',
          schema:
            status < 300
              ? schema
              : status === 500 || status === 503
                ? httpErrorSchema
                : domainErrorSchema,
        },
      ]),
    ),
  };
}
const lodgingParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['lodgingId'],
  properties: { lodgingId: { type: 'string' } },
} as const;
const imageParameters = {
  ...lodgingParameters,
  required: ['lodgingId', 'imageId'],
  properties: { ...lodgingParameters.properties, imageId: { type: 'string' } },
} as const;
export const mediaRoutes = {
  uploadProfileImage: route(
    'uploadProfileImage',
    'POST',
    '/auth/me/profile-image',
    media.profileResponseSchema,
    'profile',
  ),
  deleteProfileImage: route(
    'deleteProfileImage',
    'DELETE',
    '/auth/me/profile-image',
    deletedSchema,
  ),
  uploadDraftImage: route(
    'uploadDraftImage',
    'POST',
    '/admin/lodging-image-uploads',
    media.draftResponseSchema,
    'lodging',
  ),
  uploadLodgingImage: route(
    'uploadLodgingImage',
    'POST',
    '/admin/lodgings/{lodgingId}/images',
    media.imageResponseSchema,
    'lodging',
    lodgingParameters,
  ),
  setDefaultLodgingImage: route(
    'setDefaultLodgingImage',
    'PATCH',
    '/admin/lodgings/{lodgingId}/images/{imageId}/default',
    media.imagesResponseSchema,
    undefined,
    imageParameters,
  ),
  deleteLodgingImage: route(
    'deleteLodgingImage',
    'DELETE',
    '/admin/lodgings/{lodgingId}/images/{imageId}',
    media.deleteImageResponseSchema,
    undefined,
    imageParameters,
  ),
  mediaHealth: route('mediaHealth', 'GET', '/admin/media/health', media.storageHealthSchema),
};
