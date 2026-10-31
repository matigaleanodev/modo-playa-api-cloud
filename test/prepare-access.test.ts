import { expect, it } from 'vitest';
import { deliveryAccess } from '../scripts/prepare-access.mjs';
import { applicationPolicies, CEILING } from '../packages/infrastructure/src/delivery-policies.ts';

const scenarios = [
  { regionalBootstrap: true, cloudFrontBootstrap: true },
  { apiId: 'abc123', distributionId: 'E123ABC', oacId: 'E456ABC' },
];
const wildcard = (pattern: string, value: string) => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${escaped}$`).test(value);
};
// Una condición del ceiling contenida en la del rol deja al rol igual o más acotado.
const narrower = (role?: object, bound?: object): boolean =>
  JSON.stringify(role) === JSON.stringify(bound) ||
  (!!role &&
    !!bound &&
    Object.entries(bound).every(([operator, keys]) =>
      Object.entries(keys as object).every(
        ([key, value]) =>
          JSON.stringify((role as Record<string, Record<string, unknown>>)[operator]?.[key]) ===
          JSON.stringify(value),
      ),
    ));
it('prepares size-bounded external roles and ceilings without granting self-administration', () => {
  for (const input of scenarios) {
    const access = deliveryAccess(input);
    for (const ceiling of [access.ceiling, access.foundationCeiling, access.parametersCeiling])
      expect(Buffer.byteLength(JSON.stringify(ceiling.document))).toBeLessThanOrEqual(6144);
    expect(CEILING).toBe(`arn:aws:iam::650387442642:policy/${access.ceiling.name}`);
    expect(access.roles.map((role: { name: string }) => role.name)).toEqual([
      'modo-playa-candidate-foundation-cloudformation',
      'modo-playa-candidate-foundation',
      'modo-playa-candidate-parameters',
    ]);
    const sync = access.roles[2]!;
    expect(sync.boundary).toBe(
      'arn:aws:iam::650387442642:policy/modo-playa-candidate-parameters-ceiling',
    );
    expect(sync.trust.Statement[0]).toHaveProperty(
      ['Condition', 'StringEquals', 'token.actions.githubusercontent.com:sub'],
      'repo:matigaleanodev@99203645/modo-playa-api-cloud@1434510701:environment:parameters',
    );
    expect(JSON.stringify(sync.permissions)).not.toMatch(
      /GetParameter|Decrypt|secretsmanager|iam:/,
    );
    const executor = access.roles[0]!;
    expect(executor.boundary).toBe(
      'arn:aws:iam::650387442642:policy/modo-playa-candidate-foundation-ceiling',
    );
    const permissions = JSON.stringify(executor.permissions);
    expect(permissions).not.toMatch(
      /CreatePolicy|CreateOpenIDConnectProvider|UpdateOpenIDConnectProvider/,
    );
    for (const statement of executor.permissions.Statement.filter((item: { Action: string[] }) =>
      item.Action.some((action) => action.startsWith('iam:')),
    ))
      expect(
        statement.Resource.every(
          (resource: string) => !resource.includes('foundation') && !resource.includes('ceiling'),
        ),
      ).toBe(true);
    const foundation = access.roles[1]!;
    expect(foundation.trust.Statement[0]).toHaveProperty(['Condition', 'StringEquals'], {
      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub':
        'repo:matigaleanodev@99203645/modo-playa-api-cloud@1434510701:environment:foundation',
    });
  }
});
it('keeps every effective application permission inside the external ceiling', () => {
  for (const input of scenarios) {
    const ceiling = deliveryAccess(input).ceiling.document.Statement;
    const policies = applicationPolicies(
      input.apiId,
      input.regionalBootstrap,
      input.distributionId,
      input.oacId,
      input.cloudFrontBootstrap,
    );
    for (const statement of Object.values(policies).flat())
      for (const action of statement.Action)
        for (const resource of statement.Resource)
          expect(
            ceiling.some(
              (bound: { Action: string[]; Resource: string[]; Condition?: object }) =>
                narrower(statement.Condition, bound.Condition) &&
                bound.Action.some((pattern) => wildcard(pattern, action)) &&
                bound.Resource.some((pattern) => wildcard(pattern, resource)),
            ),
            `${action} ${resource}`,
          ).toBe(true);
  }
});
