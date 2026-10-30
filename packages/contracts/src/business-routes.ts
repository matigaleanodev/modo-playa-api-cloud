import type { RouteMetadata } from './routes.ts';
import * as business from './business.ts';
import { dashboardSchema } from './dashboard.ts';
import {
  destinationsSchema,
  destinationContextSchema,
  destinationPathSchema,
} from './destinations.ts';
import { domainErrorSchema, httpErrorSchema } from './identity.ts';
import type { JSONSchema } from 'json-schema-to-ts';
const response = (schema: JSONSchema, description = 'Respuesta de la operación.') => ({
  schema,
  description,
  mediaType: 'application/json',
});
function route(
  group: 'catalog' | 'management',
  operation: string,
  method: RouteMetadata['method'],
  path: string,
  schema: JSONSchema,
  options: Pick<RouteMetadata, 'body' | 'query' | 'parameters' | 'mediaDependency'> = {},
): RouteMetadata {
  const responses: RouteMetadata['responses'] = {
    [method === 'POST' ? 201 : 200]: response(schema),
    400: response(domainErrorSchema, 'Validación o regla de negocio.'),
    404: response(domainErrorSchema, 'Recurso no encontrado.'),
    500: response(httpErrorSchema, 'Error interno saneado.'),
  };
  if (group === 'management') {
    responses[401] = response(httpErrorSchema, 'Autenticación requerida.');
    responses[409] = response(domainErrorSchema, 'Conflicto de contacto default.');
  }
  if (options.mediaDependency || operation === 'destinationContext')
    responses[503] = response(httpErrorSchema, 'Dependencia no disponible.');
  return {
    group: path.startsWith('/admin/lodgings') ? 'media' : group,
    operation,
    method,
    path: '/api' + path,
    ...(group === 'management' ? { bearer: true } : {}),
    ...options,
    responses,
  };
}
const id = business.idPathSchema;
export const businessRoutes = {
  createContact: route(
    'management',
    'createContact',
    'POST',
    '/admin/contacts',
    business.contactResponseSchema,
    { body: business.createContactSchema },
  ),
  listContacts: route(
    'management',
    'listContacts',
    'GET',
    '/admin/contacts',
    business.pageSchema(business.contactResponseSchema),
    { query: business.contactsQuerySchema },
  ),
  getContact: route(
    'management',
    'getContact',
    'GET',
    '/admin/contacts/{id}',
    business.contactResponseSchema,
    { parameters: id, query: business.contactDetailQuerySchema },
  ),
  updateContact: route(
    'management',
    'updateContact',
    'PATCH',
    '/admin/contacts/{id}',
    business.contactResponseSchema,
    { parameters: id, body: business.updateContactSchema },
  ),
  deleteContact: route(
    'management',
    'deleteContact',
    'DELETE',
    '/admin/contacts/{id}',
    business.deletedSchema,
    { parameters: id },
  ),
  createLodging: route(
    'management',
    'createLodging',
    'POST',
    '/admin/lodgings',
    business.adminLodgingSchema,
    { body: business.createLodgingSchema, mediaDependency: 'draft-attachment' },
  ),
  listAdminLodgings: route(
    'management',
    'listAdminLodgings',
    'GET',
    '/admin/lodgings',
    business.pageSchema(business.adminLodgingSchema),
    { query: business.adminLodgingsQuerySchema },
  ),
  getAdminLodging: route(
    'management',
    'getAdminLodging',
    'GET',
    '/admin/lodgings/{id}',
    business.adminLodgingSchema,
    { parameters: id },
  ),
  updateLodging: route(
    'management',
    'updateLodging',
    'PATCH',
    '/admin/lodgings/{id}',
    business.adminLodgingSchema,
    { parameters: id, body: business.updateLodgingSchema },
  ),
  deleteLodging: route(
    'management',
    'deleteLodging',
    'DELETE',
    '/admin/lodgings/{id}',
    business.deletedSchema,
    { parameters: id, mediaDependency: 'object-cleanup' },
  ),
  setPublicVisibility: route(
    'management',
    'setPublicVisibility',
    'PATCH',
    '/admin/lodgings/{id}/public-visibility',
    business.adminLodgingSchema,
    { parameters: id, body: business.visibilitySchema },
  ),
  getOccupiedRanges: route(
    'management',
    'getOccupiedRanges',
    'GET',
    '/admin/lodgings/{id}/occupied-ranges',
    business.availabilityResponseSchema,
    { parameters: id },
  ),
  addOccupiedRange: route(
    'management',
    'addOccupiedRange',
    'POST',
    '/admin/lodgings/{id}/occupied-ranges',
    business.availabilityResponseSchema,
    { parameters: id, body: business.availabilityRangeSchema },
  ),
  removeOccupiedRange: route(
    'management',
    'removeOccupiedRange',
    'DELETE',
    '/admin/lodgings/{id}/occupied-ranges',
    business.availabilityResponseSchema,
    { parameters: id, body: business.availabilityRangeSchema },
  ),
  listPublicLodgings: route(
    'catalog',
    'listPublicLodgings',
    'GET',
    '/lodgings',
    business.pageSchema(business.publicLodgingSchema),
    { query: business.publicLodgingsQuerySchema },
  ),
  getPublicLodging: route(
    'catalog',
    'getPublicLodging',
    'GET',
    '/lodgings/{id}',
    business.publicLodgingSchema,
    { parameters: id },
  ),
  listDestinations: route(
    'catalog',
    'listDestinations',
    'GET',
    '/destinations',
    destinationsSchema,
  ),
  destinationContext: route(
    'catalog',
    'destinationContext',
    'GET',
    '/destinations/{id}/context',
    destinationContextSchema,
    { parameters: destinationPathSchema },
  ),
  dashboardSummary: route(
    'management',
    'dashboardSummary',
    'GET',
    '/admin/dashboard/summary',
    dashboardSchema,
  ),
};
