import type { FromSchema } from 'json-schema-to-ts';

// Se valida el sobre de Gateway; health no exige body ni valida query.
export const httpEventSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['version', 'routeKey', 'rawPath', 'requestContext'],
  properties: {
    version: { const: '2.0' },
    routeKey: { type: 'string' },
    rawPath: { type: 'string' },
    requestContext: {
      type: 'object',
      required: ['http'],
      properties: {
        http: {
          type: 'object',
          required: ['method'],
          properties: { method: { type: 'string' } },
        },
      },
    },
  },
} as const;

export type HttpEvent = FromSchema<typeof httpEventSchema>;
