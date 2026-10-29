import type { FromSchema } from 'json-schema-to-ts';
const text = { type: 'string' } as const;
const number = { type: 'number' } as const;
export const destinationIds = ['gesell', 'pampas', 'marazul'] as const;
export const destinationPathSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', enum: destinationIds } },
} as const;
export const destinationsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name'],
    properties: { id: { enum: destinationIds }, name: text },
  },
} as const;
export const destinationContextSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'destinationId',
    'destination',
    'timezone',
    'weather',
    'forecast',
    'sun',
    'pointsOfInterest',
  ],
  properties: {
    destinationId: { enum: destinationIds },
    destination: text,
    timezone: text,
    weather: {
      type: 'object',
      additionalProperties: false,
      required: ['temperature', 'windSpeed', 'weatherCode'],
      properties: { temperature: number, windSpeed: number, weatherCode: number },
    },
    forecast: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'max', 'min'],
        properties: { day: { enum: ['today', 'tomorrow'] }, max: number, min: number },
      },
    },
    sun: {
      type: 'object',
      additionalProperties: false,
      required: ['sunrise', 'sunset'],
      properties: { sunrise: text, sunset: text },
    },
    pointsOfInterest: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'title',
          'category',
          'summary',
          'googleMapsUrl',
          'highlight',
          'displayOrder',
        ],
        properties: {
          id: text,
          title: text,
          category: { enum: ['healthcare', 'safety', 'downtown', 'pharmacy', 'beach', 'landmark'] },
          summary: text,
          googleMapsUrl: text,
          highlight: text,
          displayOrder: number,
        },
      },
    },
  },
} as const;
export type DestinationContext = FromSchema<typeof destinationContextSchema>;
