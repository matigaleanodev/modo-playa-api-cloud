import { Ajv, type ErrorObject } from 'ajv';
import validator from 'validator';
import type { JSONSchema } from '@modo-playa/contracts/identity';
import { DomainException, HttpException } from '../identity/errors.ts';
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addFormat('original-email', { type: 'string', validate: validator.isEmail });
ajv.addFormat('original-url', { type: 'string', validate: validator.isURL });
ajv.addFormat('original-uuid', { type: 'string', validate: validator.isUUID });
ajv.addFormat('original-date', { type: 'string', validate: validator.isISO8601 });
ajv.addKeyword({
  keyword: 'x-original-max-length',
  type: 'string',
  schemaType: 'number',
  validate: (max: number, value: string) => validator.isLength(value, { max }),
});
const compiled = new Map<JSONSchema, ReturnType<typeof ajv.compile>>();
type Field = {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  format?: string;
  minimum?: number;
  pattern?: string;
  items?: Field;
  properties?: Record<string, Field>;
  'x-original-max-length'?: number;
};
function fail(schema: JSONSchema, errors: ErrorObject[], input: unknown): never {
  const root = schema as Field;
  const pathFor = (error: ErrorObject) =>
    [
      ...error.instancePath.split('/').slice(1),
      ...(error.keyword === 'required'
        ? [error.params.missingProperty]
        : error.keyword === 'additionalProperties'
          ? [error.params.additionalProperty]
          : []),
    ] as string[];
  function rank(error: ErrorObject) {
    let field = root;
    let rank = '';
    for (const part of pathFor(error)) {
      if (field.properties) {
        rank += String(
          error.keyword === 'additionalProperties' && part === error.params.additionalProperty
            ? 0
            : Object.keys(field.properties).indexOf(part) + 1,
        ).padStart(4, '0');
        field = field.properties[part] ?? {};
      } else {
        rank += part.padStart(4, '0');
        field = field.items ?? {};
      }
    }
    return rank;
  }
  errors.sort((a, b) => rank(a).localeCompare(rank(b)));
  const error = errors[0]!;
  const path = pathFor(error);
  let field = root;
  let value = input;
  let name = path[0] ?? '';
  let each = false;
  for (const part of path) {
    if (field.properties) {
      each = false;
      name = part;
      field = field.properties[part] ?? {};
    } else if (field.items) {
      field = field.items;
      each = true;
    }
    value =
      value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  }
  if (field.items) {
    const item = field.items;
    const invalidEach = item.enum
      ? !item.enum.includes(value)
      : item.format === 'original-url'
        ? typeof value !== 'string' || !validator.isURL(value)
        : item.type === 'string'
          ? typeof value !== 'string'
          : false;
    if (!Array.isArray(value) && !invalidEach && item.type !== 'object')
      throw new DomainException(`${name} must be an array`, 'REQUEST_VALIDATION_ERROR');
    field = item;
    each = true;
  }
  const subject = `${each ? 'each value in ' : ''}${name}`;
  let message: string;
  let code = 'REQUEST_VALIDATION_ERROR';
  if (error.keyword === 'additionalProperties') message = `property ${name} should not exist`;
  else if (field.enum && (error.keyword === 'enum' || !field.enum.includes(value))) {
    message = `${subject} must be one of the following values: ${field.enum.filter((v) => v !== null).join(', ')}`;
    if (name === 'id') code = 'INVALID_DESTINATION_ID';
  } else if (field['x-original-max-length'] !== undefined)
    message = `${name} must be shorter than or equal to ${field['x-original-max-length']} characters`;
  else if (field.pattern) {
    message = `${name} must be a mongodb id`;
    code = name === 'contactId' ? 'INVALID_CONTACT_ID' : 'INVALID_TARGET_OWNER_ID';
  } else if (field.format)
    message = `${subject} must be ${field.format === 'original-email' ? 'an email' : field.format === 'original-url' ? 'a URL address' : 'a valid ISO 8601 date string'}`;
  else if (
    field.minimum !== undefined &&
    (typeof value !== 'number' || value < field.minimum || Number.isNaN(value))
  )
    message = `${name} must not be less than ${field.minimum}`;
  else {
    const type = Array.isArray(field.type) ? field.type[0] : field.type;
    message =
      type === 'array'
        ? `${name} must be an array`
        : type === 'boolean'
          ? `${name} must be a boolean value`
          : type === 'integer'
            ? `${name} must be an integer number`
            : type === 'number'
              ? `${name} must be a number conforming to the specified constraints`
              : `${subject} must be a string`;
  }
  if (name === 'uploadSessionId' && error.keyword !== 'additionalProperties') {
    code = 'INVALID_UPLOAD_SESSION_ID';
    if (field.format === 'original-uuid') message = 'uploadSessionId must be a UUID';
  }
  // ValidateNested rechaza valores primitivos con su mensaje propio.
  if (name === 'occupiedRanges' && error.keyword === 'type' && !Array.isArray(value))
    message =
      path.length === 1
        ? 'occupiedRanges must be an array'
        : 'each value in nested property occupiedRanges must be either object or array';
  throw new DomainException(message, code);
}
export function validateBusiness<T>(schema: JSONSchema, input: unknown): T {
  let check = compiled.get(schema);
  if (!check) {
    check = ajv.compile(schema);
    compiled.set(schema, check);
  }
  const value = Array.isArray(input) ? { ...input } : input;
  if (!check(value)) fail(schema, [...check.errors!], value);
  return input as T;
}
export function normalizeBusinessBody(input: unknown): unknown {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) return input;
  return clean(input as Record<string, unknown>);
}
function clean(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== '__proto__' && key !== 'constructor'),
  );
}
export function normalizeBusinessQuery(query: Record<string, unknown>, operation: string) {
  if (operation === 'getContact') {
    const raw = query.includeInactive;
    const value = raw == null || (typeof raw === 'number' && Number.isNaN(raw)) ? false : raw;
    if (value !== true && value !== false && value !== 'true' && value !== 'false')
      throw new HttpException(400, {
        message: 'Validation failed (boolean string is expected)',
        error: 'Bad Request',
        statusCode: 400,
      });
    return { ...query, includeInactive: value === true || value === 'true' };
  }
  const result: Record<string, unknown> = {
    page: 1,
    limit: 10,
    ...(operation === 'listContacts'
      ? { includeInactive: false }
      : operation === 'listAdminLodgings'
        ? { includeInactive: true }
        : {}),
    ...clean(query),
  };
  const number = (value: unknown): unknown =>
    value == null ? value : Array.isArray(value) ? value.map(number) : Number(value);
  for (const key of ['page', 'minGuests', 'minPrice', 'maxPrice'])
    if (key in result) result[key] = number(result[key]);
  let limit = Array.isArray(result.limit) ? result.limit[0] : result.limit;
  if (typeof limit === 'string' && limit.trim()) limit = Number(limit.trim());
  result.limit = typeof limit === 'number' && Number.isInteger(limit) && limit > 50 ? 50 : limit;
  if ('includeInactive' in result) {
    const value = result.includeInactive;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') result.includeInactive = true;
      if (normalized === 'false' || normalized === '0') result.includeInactive = false;
    }
  }
  for (const key of ['search', 'city'])
    if (typeof result[key] === 'string') result[key] = result[key].trim();
  for (const key of ['tag', 'amenities'])
    if (result[key] != null) {
      const value = result[key];
      result[key] = Array.isArray(value)
        ? value.map((item) => (item == null ? item : String(item).trim()))
        : String(value);
    }
  return result;
}
