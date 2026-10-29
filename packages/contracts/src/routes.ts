import { healthResponseSchema } from './health.ts';

export const routes = {
  health: {
    method: 'GET',
    path: '/api/health',
    group: 'health',
    operation: 'getHealth',
    responses: {
      200: {
        description: 'API disponible.',
        mediaType: 'application/json',
        schema: healthResponseSchema,
      },
    },
  },
} as const;

export type Route = (typeof routes)[keyof typeof routes];
export type RouteGroup = Route['group'];

export function routesFor(group: RouteGroup): Route[] {
  return Object.values(routes).filter((route) => route.group === group);
}
