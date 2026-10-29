import { routesFor, type RouteGroup } from '@modo-playa/contracts/routes';

export function selectOperation(
  group: RouteGroup,
  event: { routeKey: string; rawPath: string; requestContext: { http: { method: string } } },
) {
  return routesFor(group).find((route) => {
    if (
      event.routeKey !== `${route.method} ${route.path}` ||
      event.requestContext.http.method !== route.method
    )
      return false;
    const expected = route.path.split('/');
    const actual = event.rawPath.split('/');
    return (
      expected.length === actual.length &&
      expected.every((part, index) =>
        part.startsWith('{') ? !!actual[index] : part === actual[index],
      )
    );
  });
}

export function pathParameters(path: string, rawPath: string): Record<string, string> {
  const actual = rawPath.split('/');
  return Object.fromEntries(
    path
      .split('/')
      .flatMap((part, index) =>
        part.startsWith('{') ? [[part.slice(1, -1), decodeURIComponent(actual[index]!)]] : [],
      ),
  );
}
