import type { FromSchema } from 'json-schema-to-ts';
const number = { type: 'number' } as const;
const text = { type: 'string' } as const;
export const dashboardSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['generatedAt', 'ownerScope', 'metrics', 'distributions', 'recentActivity', 'alerts'],
  properties: {
    generatedAt: text,
    ownerScope: {
      type: 'object',
      additionalProperties: false,
      required: ['ownerId', 'role'],
      properties: { ownerId: text, role: text },
    },
    metrics: {
      type: 'object',
      additionalProperties: false,
      required: ['lodgings', 'contacts', 'users'],
      properties: {
        lodgings: {
          type: 'object',
          additionalProperties: false,
          required: ['total', 'active', 'inactive', 'withAvailability', 'withoutContact'],
          properties: {
            total: number,
            active: number,
            inactive: number,
            withAvailability: number,
            withoutContact: number,
          },
        },
        contacts: {
          type: 'object',
          additionalProperties: false,
          required: [
            'total',
            'active',
            'inactive',
            'defaults',
            'withEmail',
            'withWhatsapp',
            'incomplete',
          ],
          properties: {
            total: number,
            active: number,
            inactive: number,
            defaults: number,
            withEmail: number,
            withWhatsapp: number,
            incomplete: number,
          },
        },
        users: {
          type: 'object',
          additionalProperties: false,
          required: [
            'total',
            'active',
            'inactive',
            'passwordSet',
            'pendingActivation',
            'neverLoggedIn',
          ],
          properties: {
            total: number,
            active: number,
            inactive: number,
            passwordSet: number,
            pendingActivation: number,
            neverLoggedIn: number,
          },
        },
      },
    },
    distributions: {
      type: 'object',
      additionalProperties: false,
      required: ['lodgingsByCity', 'lodgingsByType'],
      properties: {
        lodgingsByCity: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['city', 'total', 'active', 'inactive'],
            properties: { city: text, total: number, active: number, inactive: number },
          },
        },
        lodgingsByType: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'total'],
            properties: { type: text, total: number },
          },
        },
      },
    },
    recentActivity: {
      type: 'object',
      additionalProperties: false,
      required: ['source', 'items'],
      properties: {
        source: { enum: ['timestamps', 'none'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'action', 'entityId', 'title', 'timestamp'],
            properties: {
              kind: { enum: ['lodging', 'contact', 'user'] },
              action: { enum: ['created', 'updated'] },
              entityId: text,
              title: text,
              timestamp: text,
            },
          },
        },
      },
    },
    alerts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'severity', 'count', 'message'],
        properties: {
          code: {
            enum: [
              'CONTACTS_NOT_CREATED',
              'LODGING_WITHOUT_CONTACT',
              'USER_PENDING_ACTIVATION',
              'CONTACT_INCOMPLETE',
              'INACTIVE_LODGINGS_PRESENT',
            ],
          },
          severity: { enum: ['info', 'warning'] },
          count: number,
          message: text,
        },
      },
    },
  },
} as const;
export type DashboardSummary = FromSchema<typeof dashboardSchema>;
export type DashboardAlertCode = DashboardSummary['alerts'][number]['code'];
export type DashboardAlertSeverity = DashboardSummary['alerts'][number]['severity'];
