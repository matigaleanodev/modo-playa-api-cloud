import { Ajv, type ErrorObject } from 'ajv';
import validator from 'validator';
const { isEmail, isURL, isLength } = validator;
import type { JSONSchema } from '@modo-playa/contracts/identity';
import { DomainException } from './errors.ts';

const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addFormat('original-email', { type: 'string', validate: isEmail });
ajv.addFormat('original-url', { type: 'string', validate: isURL });
// validator cuenta secuencias de presentación como un carácter; minLength de AJV cuenta distinto.
for (const [keyword, option] of [
  ['x-original-min-length', 'min'],
  ['x-original-max-length', 'max'],
] as const) {
  ajv.addKeyword({
    keyword,
    type: 'string',
    schemaType: 'number',
    validate: (length: number, value: string) => isLength(value, { [option]: length }),
  });
}
type PropertySchema = {
  type?: unknown;
  format?: string;
  pattern?: string;
  minimum?: number;
  'x-original-min-length'?: number;
  'x-original-max-length'?: number;
};
type ObjectSchema = { properties?: Record<string, PropertySchema>; required?: readonly string[] };
const compiled = new Map<JSONSchema, ReturnType<typeof ajv.compile>>();
const priority = [
  'additionalProperties',
  'x-original-max-length',
  'x-original-min-length',
  'pattern',
  'format',
  'minimum',
  'type',
  'required',
];

function validationError(schema: JSONSchema, errors: ErrorObject[], input: unknown): never {
  const object = schema as ObjectSchema;
  const properties = Object.keys(object.properties ?? {});
  const property = (error: ErrorObject): string =>
    error.keyword === 'required'
      ? error.params.missingProperty
      : error.keyword === 'additionalProperties'
        ? error.params.additionalProperty
        : error.instancePath.slice(1);
  errors.sort((a, b) => {
    if (a.keyword === 'additionalProperties' || b.keyword === 'additionalProperties')
      return (
        Number(b.keyword === 'additionalProperties') - Number(a.keyword === 'additionalProperties')
      );
    return (
      properties.indexOf(property(a)) - properties.indexOf(property(b)) ||
      priority.indexOf(a.keyword) - priority.indexOf(b.keyword)
    );
  });
  const error = errors[0]!;
  const name = property(error);
  const field = object.properties?.[name] ?? {};
  let keyword = error.keyword;
  // class-validator informa la primera restricción del decorador aun para campos ausentes/no string.
  if (keyword === 'required' || keyword === 'type') {
    keyword =
      field['x-original-max-length'] !== undefined
        ? 'x-original-max-length'
        : field['x-original-min-length'] !== undefined
          ? 'x-original-min-length'
          : field.pattern
            ? 'pattern'
            : field.format
              ? 'format'
              : field.minimum &&
                  (typeof (input as Record<string, unknown>)?.[name] !== 'number' ||
                    Number.isNaN((input as Record<string, number>)[name]) ||
                    (input as Record<string, number>)[name]! < field.minimum)
                ? 'minimum'
                : keyword;
  }
  let message: string;
  switch (keyword) {
    case 'additionalProperties':
      message = `property ${name} should not exist`;
      break;
    case 'x-original-max-length':
      message = `${name} must be shorter than or equal to ${field['x-original-max-length']} characters`;
      break;
    case 'x-original-min-length':
      message = `${name} must be longer than or equal to ${field['x-original-min-length']} characters`;
      break;
    case 'minimum':
      message = `${name} must not be less than 1`;
      break;
    case 'pattern':
      message =
        name === 'targetOwnerId'
          ? 'targetOwnerId must be a mongodb id'
          : 'code must match /^\\d{6}$/ regular expression';
      break;
    case 'format':
      message = `${name} must be ${field.format === 'original-email' ? 'an email' : 'a URL address'}`;
      break;
    default:
      message = ['page', 'limit'].includes(name)
        ? `${name} must be an integer number`
        : `${name} must be a string`;
  }
  throw new DomainException(
    message,
    name === 'targetOwnerId' && error.keyword !== 'additionalProperties'
      ? 'INVALID_TARGET_OWNER_ID'
      : 'REQUEST_VALIDATION_ERROR',
  );
}
export function validate<T>(schema: JSONSchema, input: unknown): T {
  let check = compiled.get(schema);
  if (!check) {
    check = ajv.compile(schema);
    compiled.set(schema, check);
  }
  if (!check(Array.isArray(input) ? { ...input } : input))
    validationError(schema, [...check.errors!], input);
  return input as T;
}
export function normalizeBody(input: unknown, operation: string): unknown {
  if (input === null || input === undefined) return {};
  if (typeof input !== 'object' || Array.isArray(input)) return input;
  const result = cleanProperties(input as Record<string, unknown>);
  if (typeof result.identifier === 'string') result.identifier = result.identifier.trim();
  if (operation === 'updateMe')
    for (const name of ['firstName', 'lastName', 'displayName', 'phone'])
      if (typeof result[name] === 'string') result[name] = result[name].trim();
  return result;
}
export function normalizeUsersQuery(query: Record<string, unknown>) {
  const result: Record<string, unknown> = { page: 1, limit: 10, ...cleanProperties(query) };
  const transformNumber = (value: unknown): unknown =>
    value === null || value === undefined
      ? value
      : Array.isArray(value)
        ? value.map(transformNumber)
        : Number(value);
  result.page = transformNumber(result.page);
  let raw = Array.isArray(result.limit) ? result.limit[0] : result.limit;
  if (typeof raw === 'string' && raw.trim().length > 0) raw = Number(raw.trim());
  if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw) && raw > 50)
    raw = 50;
  result.limit = raw;
  return result;
}

function cleanProperties(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== '__proto__' && key !== 'constructor'),
  );
}
