import type { FromSchema } from 'json-schema-to-ts';

export const healthResponseSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { const: 'ok' } },
} as const;

export type HealthResponse = FromSchema<typeof healthResponseSchema>;
