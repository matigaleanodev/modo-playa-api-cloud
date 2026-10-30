import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  applicationPolicies,
  allow,
  CEILING,
  foundationPolicy,
  githubTrust,
  policy,
  PREFIX,
  roleArn,
  serviceTrust,
  STACK,
} from '../packages/infrastructure/src/delivery-policies.ts';

/** Foodly's review-only access material, compacted by identical action/condition sets. */
export function deliveryAccess({
  apiId = 'unassigned',
  distributionId = 'unassigned',
  oacId = 'unassigned',
  regionalBootstrap = false,
  cloudFrontBootstrap = false,
} = {}) {
  if (
    !/^(unassigned|[a-z0-9]{1,20})$/.test(apiId) ||
    !/^(unassigned|[A-Z0-9]{1,32})$/.test(distributionId) ||
    !/^(unassigned|[A-Z0-9]{1,32})$/.test(oacId)
  )
    throw new Error('Invalid observed IDs.');
  const foundationStack = `arn:aws:cloudformation:us-east-1:650387442642:stack/${STACK}-foundation/*`;
  const executor = roleArn('foundation-cloudformation');
  const statements = new Map();
  for (const original of Object.values(
    applicationPolicies(apiId, regionalBootstrap, distributionId, oacId, cloudFrontBootstrap),
  ).flat()) {
    const statement = {
      ...original,
      Resource: original.Resource.map((resource) =>
        resource
          .replace(
            new RegExp(`function:${STACK}-(health|identity|catalog|management)$`),
            `function:${STACK}-*`,
          )
          .replace(
            new RegExp(
              `log-group:/aws/lambda/${STACK}-(health|identity|catalog|management|media)(:\\*)?$`,
            ),
            `log-group:/aws/lambda/${STACK}-*`,
          ),
      ),
    };
    const key = JSON.stringify({ Action: statement.Action, Condition: statement.Condition });
    const existing = statements.get(key);
    if (existing) existing.Resource = [...new Set([...existing.Resource, ...statement.Resource])];
    else statements.set(key, { ...statement, Resource: [...new Set(statement.Resource)] });
  }
  // The ceiling bounds the project; each effective inline policy retains its exact readers/resources.
  const compact = new Map();
  for (const statement of statements.values()) {
    const actions = [
      ...new Set(
        statement.Action.map((action) => {
          if (/^cloudfront:GetDistribution/.test(action)) return 'cloudfront:GetDistribution*';
          if (/^cloudfront:GetOriginAccessControl/.test(action))
            return 'cloudfront:GetOriginAccessControl*';
          if (/^lambda:GetFunction/.test(action)) return 'lambda:GetFunction*';
          if (/^cloudformation:Describe/.test(action)) return 'cloudformation:Describe*';
          if (/^cloudformation:GetTemplate/.test(action)) return 'cloudformation:GetTemplate*';
          if (/^logs:Describe/.test(action)) return 'logs:Describe*';
          return action;
        }),
      ),
    ];
    const bounded = {
      ...statement,
      Action: actions,
      Resource: [
        ...new Set(
          statement.Resource.map((resource) => {
            if (
              resource.startsWith(
                'arn:aws:secretsmanager:us-east-1:650387442642:secret:modo-playa/prod/',
              )
            )
              return 'arn:aws:secretsmanager:us-east-1:650387442642:secret:modo-playa/prod/*';
            if (resource.startsWith('arn:aws:logs:us-east-1:650387442642:log-group:/aws/'))
              return `arn:aws:logs:us-east-1:650387442642:log-group:/aws/*/${STACK}*`;
            return resource;
          }),
        ),
      ].sort(),
    };
    const key = JSON.stringify({ Resource: bounded.Resource, Condition: bounded.Condition });
    const existing = compact.get(key);
    if (existing) existing.Action = [...new Set([...existing.Action, ...bounded.Action])];
    else compact.set(key, bounded);
  }
  const foundationPermissions = foundationPolicy();
  const foundationDelivery = policy([
    allow(['cloudformation:CreateChangeSet'], [foundationStack], {
      StringEquals: { 'cloudformation:RoleArn': executor },
      StringLike: { 'cloudformation:ChangeSetName': `${STACK}-foundation-*` },
    }),
    allow(
      [
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:DescribeChangeSet',
        'cloudformation:GetTemplate',
        'cloudformation:GetTemplateSummary',
        'cloudformation:DeleteChangeSet',
        'cloudformation:ExecuteChangeSet',
      ],
      [foundationStack],
    ),
    allow(['iam:PassRole'], [executor], {
      StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' },
    }),
  ]);
  const ceiling = { name: `${PREFIX}ceiling`, document: policy([...compact.values()]) };
  const foundationCeiling = {
    name: `${PREFIX}foundation-ceiling`,
    document: policy([...foundationPermissions.Statement, ...foundationDelivery.Statement]),
  };
  const access = {
    ceiling,
    foundationCeiling,
    roles: [
      {
        name: `${PREFIX}foundation-cloudformation`,
        trust: serviceTrust('cloudformation.amazonaws.com'),
        boundary: `arn:aws:iam::650387442642:policy/${foundationCeiling.name}`,
        permissions: foundationPermissions,
      },
      {
        name: `${PREFIX}foundation`,
        trust: githubTrust('foundation'),
        boundary: `arn:aws:iam::650387442642:policy/${foundationCeiling.name}`,
        permissions: foundationDelivery,
      },
    ],
  };
  if (!CEILING.endsWith(ceiling.name)) throw new Error('Invalid ceiling.');
  for (const item of [ceiling, foundationCeiling])
    if (Buffer.byteLength(JSON.stringify(item.document)) > 6144)
      throw new Error(
        `${item.name} exceeds IAM policy size: ${Buffer.byteLength(JSON.stringify(item.document))}`,
      );
  return access;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const ids = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const access = deliveryAccess({
    apiId: ids[0],
    distributionId: ids[1],
    oacId: ids[2],
    regionalBootstrap: process.argv.includes('--regional-bootstrap'),
    cloudFrontBootstrap: process.argv.includes('--cloudfront-bootstrap'),
  });
  await mkdir('dist', { recursive: true });
  await writeFile('dist/delivery-access.json', JSON.stringify(access, null, 2) + '\n');
  console.info('Initial permissions generated for review; no AWS operations.');
}
