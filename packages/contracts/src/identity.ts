import type { FromSchema } from 'json-schema-to-ts';

const nullableString = { type: ['string', 'null'] } as const;
const profileFields = {
  firstName: nullableString,
  lastName: nullableString,
  displayName: nullableString,
  phone: nullableString,
  avatarUrl: nullableString,
} as const;
const imageFields = {
  imageId: { type: 'string' },
  key: { type: 'string' },
  width: { type: ['number', 'null'] },
  height: { type: ['number', 'null'] },
  bytes: { type: ['number', 'null'] },
  mime: nullableString,
  createdAt: { type: 'string' },
  url: { type: 'string' },
} as const;
const imageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['imageId', 'key', 'createdAt', 'url'],
  properties: imageFields,
} as const;
const authImageSchema = {
  ...imageSchema,
  properties: {
    ...imageFields,
    variants: {
      type: 'object',
      additionalProperties: false,
      required: ['thumb', 'card', 'hero'],
      properties: { thumb: { type: 'string' }, card: { type: 'string' }, hero: { type: 'string' } },
    },
  },
} as const;
const userFields = {
  id: { type: 'string' },
  email: { type: 'string' },
  username: { type: 'string' },
  ...profileFields,
} as const;
export const authUserSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'username', 'role'],
  properties: {
    ...userFields,
    profileImage: authImageSchema,
    role: { enum: ['OWNER', 'SUPERADMIN'] },
  },
} as const;
export const userResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'username', 'isPasswordSet', 'isActive'],
  properties: {
    ...userFields,
    profileImage: imageSchema,
    isPasswordSet: { type: 'boolean' },
    isActive: { type: 'boolean' },
    lastLoginAt: nullableString,
  },
} as const;
export const authResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accessToken', 'refreshToken', 'user'],
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    user: authUserSchema,
  },
} as const;
export const accessTokenSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accessToken'],
  properties: { accessToken: { type: 'string' } },
} as const;
export const messageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' } },
} as const;
export const domainErrorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'code'],
  properties: { message: { type: 'string' }, code: { type: 'string' } },
} as const;
export const httpErrorSchema = {
  type: 'object',
  required: ['statusCode', 'message'],
  properties: {
    statusCode: { type: 'integer' },
    message: { type: 'string' },
    error: { type: 'string' },
  },
  additionalProperties: false,
} as const;
export const usersResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data', 'total', 'page', 'limit'],
  properties: {
    data: { type: 'array', items: userResponseSchema },
    total: { type: 'integer' },
    page: { type: ['integer', 'null'] },
    limit: { type: ['integer', 'null'] },
  },
} as const;

const identifier = {
  type: 'string',
  'x-original-min-length': 3,
  'x-original-max-length': 120,
} as const;
const password = {
  type: 'string',
  'x-original-min-length': 8,
  'x-original-max-length': 72,
} as const;
export const identifierSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['identifier'],
  properties: { identifier },
} as const;
export const loginSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['password', 'identifier'],
  properties: { password, identifier },
} as const;
export const codeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['identifier', 'code'],
  properties: { identifier, code: { type: 'string', pattern: '^\\d{6}$' } },
} as const;
export const passwordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['password'],
  properties: { password },
} as const;
export const changePasswordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['currentPassword', 'newPassword'],
  properties: { currentPassword: password, newPassword: password },
} as const;
export const updateMeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    firstName: { ...nullableString, 'x-original-max-length': 80 },
    lastName: { ...nullableString, 'x-original-max-length': 80 },
    displayName: { ...nullableString, 'x-original-max-length': 120 },
    phone: { ...nullableString, 'x-original-max-length': 30 },
  },
} as const;
export const createUserSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'username'],
  properties: {
    email: { type: 'string', format: 'original-email' },
    username: { type: 'string', 'x-original-min-length': 3 },
    targetOwnerId: { type: ['string', 'null'], pattern: '^[a-fA-F0-9]{24}$' },
  },
} as const;
export const updateUserSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    firstName: nullableString,
    lastName: nullableString,
    displayName: nullableString,
    avatarUrl: { ...nullableString, format: 'original-url' },
    phone: nullableString,
  },
} as const;
export const usersQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: ['integer', 'null'], minimum: 1, default: 1 },
    limit: { type: ['integer', 'null'], minimum: 1, maximum: 50, default: 10 },
  },
} as const;
// El formato del id se controla en el repositorio para conservar INVALID_USER_ID.
export const userPathSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;
export type IdentifierInput = FromSchema<typeof identifierSchema>;
export type LoginInput = FromSchema<typeof loginSchema>;
export type CodeInput = FromSchema<typeof codeSchema>;
export type PasswordInput = FromSchema<typeof passwordSchema>;
export type ChangePasswordInput = FromSchema<typeof changePasswordSchema>;
export type UpdateMeInput = FromSchema<typeof updateMeSchema>;
export type CreateUserInput = FromSchema<typeof createUserSchema>;
export type UpdateUserInput = FromSchema<typeof updateUserSchema>;
export type UsersQueryInput = FromSchema<typeof usersQuerySchema>;
export type AuthUserResponse = FromSchema<typeof authUserSchema>;
export type AuthResponse = FromSchema<typeof authResponseSchema>;

export type { JSONSchema } from 'json-schema-to-ts';
