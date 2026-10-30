import type { FromSchema } from 'json-schema-to-ts';
import { adminImageSchema } from './business.ts';
export const profileImageSchema = {
  ...adminImageSchema,
  required: ['imageId', 'key', 'createdAt', 'url'],
  properties: Object.fromEntries(
    Object.entries(adminImageSchema.properties).filter(([name]) => name !== 'isDefault'),
  ),
} as const;
export type ProfileImageResponse = Omit<FromSchema<typeof adminImageSchema>, 'isDefault'>;
export const draftBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['uploadSessionId'],
  properties: { uploadSessionId: { type: 'string', format: 'original-uuid' } },
} as const;
export const draftResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['imageId', 'uploadSessionId', 'confirmed'],
  properties: {
    imageId: { type: 'string' },
    uploadSessionId: { type: 'string' },
    confirmed: { type: 'boolean' },
  },
} as const;
export const imageResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['image'],
  properties: { image: adminImageSchema },
} as const;
export const profileResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['image'],
  properties: { image: profileImageSchema },
} as const;
export const imagesResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['images'],
  properties: { images: { type: 'array', items: adminImageSchema } },
} as const;
export const deleteImageResponseSchema = {
  ...imagesResponseSchema,
  required: ['deleted', 'images'],
  properties: { ...imagesResponseSchema.properties, deleted: { type: 'boolean' } },
} as const;
export const storageHealthSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'message'],
  properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
} as const;
