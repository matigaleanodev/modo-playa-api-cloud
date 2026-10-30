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
it('prepares size-bounded external roles and ceilings without granting self-administration', () => {
  for (const input of scenarios) {
    const access = deliveryAccess(input);
    for (const ceiling of [access.ceiling, access.foundationCeiling])
      expect(Buffer.byteLength(JSON.stringify(ceiling.document))).toBeLessThanOrEqual(6144);
    expect(CEILING).toBe(`arn:aws:iam::650387442642:policy/${access.ceiling.name}`);
    expect(access.roles.map((role: { name: string }) => role.name)).toEqual([
      'modo-playa-candidate-foundation-cloudformation',
      'modo-playa-candidate-foundation',
    ]);
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
    expect(foundation.trust.Statement[0]).toHaveProperty(
      ['Condition', 'StringEquals', 'token.actions.githubusercontent.com:sub'],
      'repo:matigaleanodev/modo-playa-api-cloud:environment:foundation',
    );
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
                JSON.stringify(bound.Condition) === JSON.stringify(statement.Condition) &&
                bound.Action.some((pattern) => wildcard(pattern, action)) &&
                bound.Resource.some((pattern) => wildcard(pattern, resource)),
            ),
            `${action} ${resource}`,
          ).toBe(true);
  }
});
