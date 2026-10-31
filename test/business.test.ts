import { ContactsRepository } from '../packages/runtime/src/business/contacts.repository.ts';
import { it, expect, vi } from 'vitest';
import { Types, type Model } from 'mongoose';
import { routes, type RouteMetadata } from '@modo-playa/contracts/routes';
import { createOpenApiDocument } from '@modo-playa/contracts/openapi';
import * as schemas from '@modo-playa/contracts/business';
import { LodgingsRepository } from '../packages/runtime/src/business/lodgings.repository.ts';
import type { LodgingDocument, ContactDocument } from '../packages/runtime/src/business/models.ts';
import { MediaDependencyUnavailable } from '../packages/runtime/src/business/media.ts';
import { LodgingMapper } from '../packages/runtime/src/business/lodgings.mapper.ts';
import { createManagementHandler } from '../packages/runtime/src/management/handler.ts';
import { managementRuntime } from '../packages/runtime/src/management/runtime.ts';
import { createCatalogHandler } from '../packages/runtime/src/catalog/handler.ts';
import { catalogRuntime } from '../packages/runtime/src/catalog/runtime.ts';
import { businessConfiguration } from '../packages/runtime/src/business/configuration.ts';
import { CloudflareMediaUrlBuilderService } from '../packages/runtime/src/identity/media-urls.ts';
import {
  normalizeBusinessQuery,
  validateBusiness,
} from '../packages/runtime/src/business/validation.ts';
import { selectOperation } from '../packages/runtime/src/http/operation.ts';
import { lodgingInput } from './business-fixture.ts';
import { ownerId, otherOwnerId } from './identity-fixture.ts';
import { event, context } from './helpers.ts';

it('alta asocia drafts al owner efectivo después de guardar; compensa cualquier falla antes de devolver éxito', async () => {
  const order: string[] = [];
  const id = new Types.ObjectId();
  const save = vi.fn(async () => {
    order.push('save');
    return { _id: id };
  });
  const deleteOne = vi.fn(async () => {
    order.push('delete');
  });
  const findOne = vi.fn(() => ({ populate: async () => ({ _id: id }) }));
  const contactFind = vi.fn(async (_filter: unknown) => null);
  class FakeModel {
    constructor(readonly data: unknown) {}
    save = save;
    static deleteOne = deleteOne;
    static findOne = findOne;
  }
  const attach = vi.fn(async () => {
    order.push('attach');
  });
  const media = { attachDraftUploadsToLodging: attach, deleteAllForLodging: vi.fn() };
  const repository = new LodgingsRepository(
    FakeModel as unknown as Model<LodgingDocument>,
    { findOne: contactFind } as unknown as Model<ContactDocument>,
    media,
  );
  await repository.create(
    {
      ...lodgingInput,
      targetOwnerId: otherOwnerId,
      pendingImageIds: ['image-1'],
      uploadSessionId: 'draft-1',
    },
    ownerId,
    'SUPERADMIN',
  );
  expect(order).toEqual(['save', 'attach']);
  expect(attach).toHaveBeenCalledWith(id.toString(), otherOwnerId, 'draft-1', ['image-1']);
  expect(contactFind.mock.calls[0]![0]).toMatchObject({
    ownerId: new Types.ObjectId(otherOwnerId),
    isDefault: true,
    active: true,
  });
  order.length = 0;
  attach.mockRejectedValueOnce(new Error('media-failed'));
  await expect(
    repository.create(
      { ...lodgingInput, pendingImageIds: ['image-1'], uploadSessionId: 'draft-1' },
      ownerId,
    ),
  ).rejects.toThrow('media-failed');
  expect(order).toEqual(['save', 'delete']);
  expect(deleteOne).toHaveBeenCalledWith({ _id: id });
  order.length = 0;
  await expect(
    repository.create({ ...lodgingInput, pendingImageIds: ['image-1'] }, ownerId),
  ).rejects.toMatchObject({ code: 'LODGING_IMAGE_INVALID_STATE' });
  expect(order).toEqual(['save', 'delete']);
});

it('borrado limpia objetos antes del documento y conserva el documento si falla cleanup', async () => {
  const order: string[] = [];
  const row = { _id: new Types.ObjectId() };
  const deleteOne = vi.fn(async () => {
    order.push('delete');
  });
  const cleanup = vi.fn(async () => {
    order.push('cleanup');
  });
  const repository = new LodgingsRepository(
    { findOne: async () => row, deleteOne } as unknown as Model<LodgingDocument>,
    {} as Model<ContactDocument>,
    { attachDraftUploadsToLodging: vi.fn(), deleteAllForLodging: cleanup },
  );
  expect(await repository.remove(row._id.toString(), ownerId, 'OWNER')).toEqual({ deleted: true });
  expect(order).toEqual(['cleanup', 'delete']);
  expect(cleanup).toHaveBeenCalledWith(row);
  order.length = 0;
  cleanup.mockRejectedValueOnce(new Error('cleanup-failed'));
  await expect(repository.remove(row._id.toString(), ownerId, 'OWNER')).rejects.toThrow(
    'cleanup-failed',
  );
  expect(deleteOne).toHaveBeenCalledTimes(1);
});

it('mapper público preserva legacy, imágenes/variantes y contacto sin exponer datos internos', () => {
  const media = new CloudflareMediaUrlBuilderService({
    publicBaseUrl: 'https://media.example.test',
    r2Bucket: '',
    r2Endpoint: '',
  });
  const row = {
    ...lodgingInput,
    _id: new Types.ObjectId(),
    ownerId,
    mainImage: 'lodgings/legacy.webp',
    images: ['lodgings/legacy.webp', 'lodgings/legacy.webp'],
    occupiedRanges: [],
    contactId: { _id: 'contact', name: 'Ana', notes: 'private', ownerId },
    notes: 'private',
    pendingImageUploads: [{ stagingKey: 'private' }],
    mediaImages: [
      {
        imageId: 'image',
        key: 'lodgings/original.webp',
        isDefault: true,
        bytes: 100,
        mime: 'image/webp',
        createdAt: new Date(),
      },
    ],
  } as unknown as LodgingDocument;
  const result = JSON.parse(JSON.stringify(LodgingMapper.toPublicResponse(row, media)));
  expect(result.mainImage).toBe('https://media.example.test/lodgings/original.webp');
  expect(result.contact).toEqual({ name: 'Ana' });
  expect(result.mediaImages[0].variants.thumb).toContain('/cdn-cgi/image/');
  for (const name of ['ownerId', 'notes', 'contactId', 'isPubliclyVisible', 'pendingImageUploads'])
    expect(result).not.toHaveProperty(name);
  for (const name of ['key', 'bytes', 'mime'])
    expect(result.mediaImages[0]).not.toHaveProperty(name);
  row.mediaImages = [];
  expect(LodgingMapper.toPublicResponse(row, media).images).toEqual([
    'https://media.example.test/lodgings/legacy.webp',
  ]);
});

it('normaliza filtros por operación y conserva mensajes específicos, arrays y validación anidada', () => {
  expect(normalizeBusinessQuery({}, 'listContacts')).toEqual({
    page: 1,
    limit: 10,
    includeInactive: false,
  });
  expect(normalizeBusinessQuery({}, 'listAdminLodgings')).toEqual({
    page: 1,
    limit: 10,
    includeInactive: true,
  });
  expect(
    normalizeBusinessQuery(
      {
        page: '2',
        limit: ['100', '2'],
        amenities: [' wifi ', 'pool'],
        tag: [' x ', ' x '],
        includeInactive: ['0', '1'],
      },
      'listAdminLodgings',
    ),
  ).toMatchObject({
    page: 2,
    limit: 50,
    amenities: ['wifi', 'pool'],
    tag: ['x', 'x'],
    includeInactive: false,
  });
  expect(() =>
    validateBusiness(schemas.createLodgingSchema, { ...lodgingInput, contactId: 'bad' }),
  ).toThrow(expect.objectContaining({ code: 'INVALID_CONTACT_ID' }));
  expect(() =>
    validateBusiness(schemas.createLodgingSchema, {
      ...lodgingInput,
      occupiedRanges: [{ from: 'bad', to: '2026-01-02' }],
    }),
  ).toThrow('from must be a valid ISO 8601 date string');
  expect(() => validateBusiness(schemas.updateLodgingSchema, { occupiedRanges: [] })).toThrow(
    'property occupiedRanges should not exist',
  );
  expect(() =>
    validateBusiness(schemas.createLodgingSchema, { ...lodgingInput, price: -1 }),
  ).toThrow('price must not be less than 0');
  expect(() => validateBusiness(schemas.publicLodgingsQuerySchema, { amenities: 'wifi' })).toThrow(
    'amenities must be an array',
  );
  expect(() => normalizeBusinessQuery({ includeInactive: '1' }, 'getContact')).toThrow(
    expect.objectContaining({
      body: expect.objectContaining({ message: 'Validation failed (boolean string is expected)' }),
    }),
  );
});

it('DELETE de disponibilidad conserva body y Bearer precede al DTO; público no requiere identidad ni Mongo para destinos', async () => {
  const remove = vi.fn(async () => []);
  const auth = vi.fn(() => ({
    ownerId,
    userId: 'user',
    role: 'SUPERADMIN' as const,
    purpose: 'REFRESH' as const,
  }));
  const management = createManagementHandler(
    {
      logRequests: false,
      runtime: async () => ({
        tokens: { authenticate: auth },
        services: async () => ({ lodgings: { removeOccupiedRange: remove } }) as never,
      }),
    },
    'media',
  );
  const input = event('/api/admin/lodgings/{id}/occupied-ranges', 'DELETE');
  input.rawPath = '/api/admin/lodgings/507f1f77bcf86cd799439013/occupied-ranges';
  input.body = JSON.stringify({ from: '2026-01-01', to: '2026-01-02' });
  input.headers.authorization = 'Bearer simulated';
  expect((await management(input, context)).statusCode).toBe(200);
  expect(remove).toHaveBeenCalledWith(
    '507f1f77bcf86cd799439013',
    { from: '2026-01-01', to: '2026-01-02' },
    ownerId,
    'SUPERADMIN',
  );
  const catalog = createCatalogHandler({ logRequests: false, runtime: catalogRuntime({}) });
  expect((await catalog(event('/api/destinations'), context)).statusCode).toBe(200);
  const invalid = event('/api/destinations/{id}/context');
  invalid.rawPath = '/api/destinations/invalid/context';
  expect(JSON.parse((await catalog(invalid, context)).body as string).code).toBe(
    'INVALID_DESTINATION_ID',
  );
});

it('runtime real bloquea alta y borrado sin media antes de abrir Mongo; catálogo no necesita correo/JWT', async () => {
  const runtime = await managementRuntime({
    MONGO_URI: 'mongodb://127.0.0.1:1/never',
    SECRET_KEY: 'simulated',
  })(AbortSignal.timeout(2000));
  await expect(runtime.services(true)).rejects.toBeInstanceOf(MediaDependencyUnavailable);
  const read = vi.fn(async () => JSON.stringify({ MONGO_URI: 'mongodb://127.0.0.1:1/never' }));
  expect(
    await businessConfiguration(
      'catalog',
      { DATABASE_PARAMETER_NAME: '/modo-playa/prod/database' },
      read,
    )(),
  ).toMatchObject({ mongoUri: 'mongodb://127.0.0.1:1/never' });
  expect(read).toHaveBeenCalledTimes(1);
});

it('metadata selecciona exclusivamente el grupo y OpenAPI conserva DELETE body, varios métodos y dependencia media', () => {
  const document = createOpenApiDocument();
  for (const route of Object.values(routes) as RouteMetadata[]) {
    const input = event(route.path, route.method);
    input.rawPath = route.path.replace('{id}', '507f1f77bcf86cd799439013');
    expect(selectOperation(route.group, input)?.operation).toBe(route.operation);
    if (route.group === 'catalog') expect(route.bearer).toBeUndefined();
  }
  expect(
    document.paths['/api/admin/lodgings/{id}/occupied-ranges']!.delete!.requestBody!.content[
      'application/json'
    ].schema,
  ).toEqual(schemas.availabilityRangeSchema);
  expect(Object.keys(document.paths['/api/admin/lodgings/{id}']!)).toEqual([
    'get',
    'patch',
    'delete',
  ]);
  expect(document.paths['/api/admin/lodgings']!.post!['x-required-media-dependency']).toBe(
    'draft-attachment',
  );
  expect(document.paths).not.toHaveProperty('/docs');
});

it('contactos traducen duplicados 11000 y cambian default usando el owner del contacto existente', async () => {
  const save = vi.fn().mockRejectedValue({ code: 11000 });
  const updates = vi.fn(async (_filter: unknown, _update: unknown) => undefined);
  const existing = { ownerId: new Types.ObjectId(otherOwnerId), active: true, set: vi.fn(), save };
  class ContactModel {
    save = save;
    static updateMany = updates;
    static findOne = vi.fn(async () => existing);
  }
  const repository = new ContactsRepository(ContactModel as never);
  await expect(
    repository.create({ name: 'Race', isDefault: true }, ownerId, 'OWNER'),
  ).rejects.toMatchObject({
    status: 409,
    code: 'CONTACT_NOT_ALLOWED',
    message: 'Another default contact already exists for this owner',
  });
  await expect(
    repository.update(new Types.ObjectId().toString(), { isDefault: true }, ownerId, 'SUPERADMIN'),
  ).rejects.toMatchObject({ status: 409, code: 'CONTACT_NOT_ALLOWED' });
  expect(updates.mock.calls[1]![0]).toEqual({ ownerId: existing.ownerId, isDefault: true });
});
