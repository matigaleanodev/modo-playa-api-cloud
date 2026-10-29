import type { FromSchema, JSONSchema } from 'json-schema-to-ts';

export const amenities = [
  'sea_view',
  'pool',
  'parrilla',
  'wifi',
  'air_conditioning',
  'heating',
  'cable_tv',
  'pets_allowed',
  'garage',
] as const;
export const lodgingTypes = ['cabin', 'apartment', 'house'] as const;
export const priceUnits = ['night', 'week', 'fortnight'] as const;
const text = { type: 'string' } as const;
const optionalText = { type: ['string', 'null'] } as const;
const optionalBoolean = { type: ['boolean', 'null'] } as const;
const mongoId = { ...optionalText, pattern: '^[a-fA-F0-9]{24}$' } as const;
export const idPathSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: text },
} as const;
const pagination = {
  page: { type: ['integer', 'null'], minimum: 1, default: 1 },
  limit: { type: ['integer', 'null'], minimum: 1, maximum: 50, default: 10 },
} as const;
export const contactsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { ...pagination, includeInactive: { ...optionalBoolean, default: false } },
} as const;
// El detalle usa DefaultValuePipe/ParseBoolPipe, sin whitelist del DTO de listado.
export const contactDetailQuerySchema = {
  type: 'object',
  additionalProperties: true,
  properties: { includeInactive: { type: 'boolean', default: false } },
} as const;
export const createContactSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: text,
    email: { ...optionalText, format: 'original-email' },
    whatsapp: optionalText,
    isDefault: optionalBoolean,
    notes: optionalText,
    targetOwnerId: mongoId,
  },
} as const;
export const updateContactSchema = {
  ...createContactSchema,
  required: [],
  properties: { ...createContactSchema.properties, name: optionalText },
} as const;
export const availabilityRangeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', format: 'original-date' },
    to: { type: 'string', format: 'original-date' },
  },
} as const;
export const availabilityResponseSchema = {
  type: 'array',
  items: availabilityRangeSchema,
} as const;
const lodgingFields = {
  title: text,
  description: text,
  location: text,
  city: text,
  type: { type: 'string', enum: lodgingTypes },
  price: { type: 'number', minimum: 0 },
  priceUnit: { type: 'string', enum: priceUnits },
  maxGuests: { type: 'number', minimum: 1 },
  bedrooms: { type: 'number', minimum: 0 },
  bathrooms: { type: 'number', minimum: 0 },
  minNights: { type: 'number', minimum: 1 },
  distanceToBeach: { type: ['number', 'null'], minimum: 0 },
  amenities: { type: ['array', 'null'], items: { type: 'string', enum: amenities } },
  mainImage: { ...optionalText, format: 'original-url' },
  images: { type: ['array', 'null'], items: { type: 'string', format: 'original-url' } },
  occupiedRanges: { type: ['array', 'null'], items: availabilityRangeSchema },
  contactId: mongoId,
  isPubliclyVisible: optionalBoolean,
  pendingImageIds: { type: ['array', 'null'], items: text },
  uploadSessionId: optionalText,
  targetOwnerId: mongoId,
} as const;
export const createLodgingSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'description',
    'location',
    'city',
    'type',
    'price',
    'priceUnit',
    'maxGuests',
    'bedrooms',
    'bathrooms',
    'minNights',
  ],
  properties: lodgingFields,
} as const;
// PartialType permite null en campos opcionales; occupiedRanges queda fuera del PATCH.
const { occupiedRanges: _ranges, ...patchFields } = lodgingFields;
export const updateLodgingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...patchFields,
    title: optionalText,
    description: optionalText,
    location: optionalText,
    city: optionalText,
    type: { enum: [...lodgingTypes, null] },
    price: { type: ['number', 'null'], minimum: 0 },
    priceUnit: { enum: [...priceUnits, null] },
    maxGuests: { type: ['number', 'null'], minimum: 1 },
    bedrooms: { type: ['number', 'null'], minimum: 0 },
    bathrooms: { type: ['number', 'null'], minimum: 0 },
    minNights: { type: ['number', 'null'], minimum: 1 },
  },
} as const;
export const visibilitySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['isPubliclyVisible'],
  properties: { isPubliclyVisible: { type: 'boolean' } },
} as const;
export const publicLodgingsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...pagination,
    search: { ...optionalText, 'x-original-max-length': 120 },
    tag: { type: ['array', 'null'], items: text },
    city: { ...optionalText, 'x-original-max-length': 80 },
    minGuests: { type: ['integer', 'null'], minimum: 1 },
    minPrice: { type: ['number', 'null'], minimum: 0 },
    maxPrice: { type: ['number', 'null'], minimum: 0 },
    amenities: { type: ['array', 'null'], items: { type: 'string', enum: amenities } },
  },
} as const;
export const adminLodgingsQuerySchema = {
  ...publicLodgingsQuerySchema,
  properties: {
    includeInactive: { ...optionalBoolean, default: true },
    ...publicLodgingsQuerySchema.properties,
  },
} as const;
export const contactResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'isDefault', 'active'],
  properties: {
    id: text,
    name: optionalText,
    email: optionalText,
    whatsapp: optionalText,
    isDefault: optionalBoolean,
    active: optionalBoolean,
    notes: optionalText,
  },
} as const;
export const publicContactSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: text, email: optionalText, whatsapp: optionalText },
} as const;
const variants = {
  type: 'object',
  additionalProperties: false,
  required: ['thumb', 'card', 'hero'],
  properties: { thumb: text, card: text, hero: text },
} as const;
export const publicImageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['imageId', 'isDefault', 'createdAt', 'url'],
  properties: {
    imageId: text,
    isDefault: { type: 'boolean' },
    width: { type: ['number', 'null'] },
    height: { type: ['number', 'null'] },
    createdAt: text,
    url: text,
    variants,
  },
} as const;
export const adminImageSchema = {
  ...publicImageSchema,
  required: [...publicImageSchema.required, 'key'],
  properties: {
    ...publicImageSchema.properties,
    key: text,
    bytes: { type: ['number', 'null'] },
    mime: optionalText,
  },
} as const;
const readFields = {
  id: text,
  title: optionalText,
  description: optionalText,
  location: optionalText,
  city: optionalText,
  type: { enum: [...lodgingTypes, null] },
  price: { type: ['number', 'null'] },
  priceUnit: { enum: [...priceUnits, null] },
  maxGuests: { type: ['number', 'null'] },
  bedrooms: { type: ['number', 'null'] },
  bathrooms: { type: ['number', 'null'] },
  minNights: { type: ['number', 'null'] },
  distanceToBeach: { type: ['number', 'null'] },
  amenities: { type: ['array', 'null'], items: { enum: amenities } },
  mainImage: text,
  images: { type: 'array', items: text },
  occupiedRanges: availabilityResponseSchema,
} as const;
export const publicLodgingSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'title',
    'description',
    'location',
    'city',
    'type',
    'price',
    'priceUnit',
    'maxGuests',
    'bedrooms',
    'bathrooms',
    'minNights',
    'amenities',
    'mainImage',
    'images',
  ],
  properties: {
    ...readFields,
    mediaImages: { type: 'array', items: publicImageSchema },
    contact: publicContactSchema,
  },
} as const;
export const adminLodgingSchema = {
  ...publicLodgingSchema,
  properties: {
    ...readFields,
    isPubliclyVisible: optionalBoolean,
    mediaImages: { type: 'array', items: adminImageSchema },
    contactId: text,
    contact: contactResponseSchema,
  },
} as const;
export const deletedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['deleted'],
  properties: { deleted: { type: 'boolean' } },
} as const;
export function pageSchema<T extends JSONSchema>(items: T) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'total', 'page', 'limit'],
    properties: { data: { type: 'array', items }, total: { type: 'integer' }, ...pagination },
  } as const;
}
export type Page<T> = { data: T[]; total: number; page: number | null; limit: number | null };
export type CreateContactInput = FromSchema<typeof createContactSchema>;
export type UpdateContactInput = FromSchema<typeof updateContactSchema>;
export type ContactsQuery = FromSchema<typeof contactsQuerySchema>;
export type CreateLodgingInput = FromSchema<typeof createLodgingSchema>;
export type UpdateLodgingInput = FromSchema<typeof updateLodgingSchema>;
export type AvailabilityRange = FromSchema<typeof availabilityRangeSchema>;
export type VisibilityInput = FromSchema<typeof visibilitySchema>;
export type PublicLodgingsQuery = FromSchema<typeof publicLodgingsQuerySchema>;
export type AdminLodgingsQuery = FromSchema<typeof adminLodgingsQuerySchema>;
export type ContactResponse = FromSchema<typeof contactResponseSchema>;
export type PublicContactResponse = FromSchema<typeof publicContactSchema>;
export type LodgingResponse = FromSchema<typeof adminLodgingSchema>;
export type PublicLodgingResponse = FromSchema<typeof publicLodgingSchema>;
export type LodgingImageResponse = FromSchema<typeof adminImageSchema>;
export type PublicLodgingImageResponse = FromSchema<typeof publicImageSchema>;
