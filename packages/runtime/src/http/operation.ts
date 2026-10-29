import { routesFor, type RouteGroup } from '@modo-playa/contracts/routes';

export function selectOperation(
  group: RouteGroup,
  event: { routeKey: string; rawPath: string; requestContext: { http: { method: string } } },
) {
  return routesFor(group).find(
    (route) =>
      event.routeKey === `${route.method} ${route.path}` &&
      event.requestContext.http.method === route.method &&
      event.rawPath === route.path,
  );
}
