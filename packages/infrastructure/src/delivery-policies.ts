import type { ParameterDomain } from '@modo-playa/contracts/configuration';
import { PARAMETER_NAMES, parameterArn, STACK_NAME, SECRET_NAMES } from './config.ts';

/** Adapted from Foodly; the externally installed ceiling is never editable by these stacks. */
export const BUCKET = 'modo-playa-candidate-assets-650387442642-us-east-1';
export const STACK = STACK_NAME;
export const PREFIX = 'modo-playa-candidate-';
export const roleArn = (name: string) => `arn:aws:iam::650387442642:role/${PREFIX}${name}`;
export const CEILING = `arn:aws:iam::650387442642:policy/${PREFIX}ceiling`;
const stackArn = `arn:aws:cloudformation:us-east-1:650387442642:stack/${STACK}/*`;
const assetArn = `arn:aws:s3:::${BUCKET}/${STACK}/*`;
export const allow = (Action: string[], Resource: string[], Condition?: object) => ({
  Effect: 'Allow',
  Action,
  Resource,
  ...(Condition ? { Condition } : {}),
});
export const policy = <T extends object>(Statement: T[]) => ({ Version: '2012-10-17', Statement });
export const serviceTrust = (service: string) =>
  policy([{ Effect: 'Allow', Principal: { Service: service }, Action: 'sts:AssumeRole' }]);
export const githubTrust = (environment: string) =>
  policy([
    {
      Effect: 'Allow',
      Principal: {
        Federated: 'arn:aws:iam::650387442642:oidc-provider/token.actions.githubusercontent.com',
      },
      Action: 'sts:AssumeRoleWithWebIdentity',
      Condition: {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:matigaleanodev@99203645/modo-playa-api-cloud@1434510701:environment:${environment}`,
        },
      },
    },
  ]);
const readStack = allow(
  [
    'cloudformation:DescribeStacks',
    'cloudformation:DescribeStackEvents',
    'cloudformation:DescribeStackResources',
    'cloudformation:ListStackResources',
    'cloudformation:DescribeChangeSet',
    'cloudformation:GetTemplate',
    'cloudformation:GetTemplateSummary',
  ],
  [stackArn],
);
const readAssets = allow(['s3:GetObject'], [assetArn]);
const secretResources = (names: string[]) =>
  names.map((name) => `arn:aws:secretsmanager:us-east-1:650387442642:secret:${name}-??????`);
const secrets = (names: string[]) =>
  allow(['secretsmanager:GetSecretValue'], secretResources(names));
/**
 * Secretos anteriores, legibles solo para recuperar la revisión previa. Se quitan, junto con
 * los secretos, después de validar la entrega con Parameter Store.
 */
const RETAINED_SECRETS = {
  health: [SECRET_NAMES.ingress],
  identity: [SECRET_NAMES.app, SECRET_NAMES.email, SECRET_NAMES.ingress],
  catalog: [SECRET_NAMES.database, SECRET_NAMES.ingress],
  management: [SECRET_NAMES.app, SECRET_NAMES.ingress],
  media: [SECRET_NAMES.app, SECRET_NAMES.storage],
  cloudformation: [SECRET_NAMES.ingress],
};
/** Clave administrada aws/ssm sin KeyId fijo: el contexto acota cada rol a sus parámetros. */
const ssmKms = (Action: string[], domains: ParameterDomain[]) => {
  const arns = domains.map(parameterArn);
  return allow(Action, ['arn:aws:kms:us-east-1:650387442642:key/*'], {
    StringEquals: {
      'kms:ViaService': 'ssm.us-east-1.amazonaws.com',
      'kms:EncryptionContext:PARAMETER_ARN': arns,
    },
  });
};
const parameters = (domains: ParameterDomain[]) => [
  allow(['ssm:GetParameter'], domains.map(parameterArn)),
  ssmKms(['kms:Decrypt'], domains),
];
export const PARAMETER_DOMAINS = Object.keys(PARAMETER_NAMES) as ParameterDomain[];
const logs = (names: string[]) =>
  allow(
    ['logs:CreateLogStream', 'logs:PutLogEvents'],
    names.map(
      (name) => `arn:aws:logs:us-east-1:650387442642:log-group:/aws/lambda/${STACK}-${name}:*`,
    ),
  );
const eventNames = ['health', 'identity', 'catalog', 'management'];
const runtimeNames = [...eventNames, 'media'];
const webArn = `arn:aws:lambda:us-east-1:650387442642:web-function/${STACK}-media`;

export function applicationPolicies(
  apiId = 'unassigned',
  regionalBootstrap = false,
  distributionId = 'unassigned',
  oacId = 'unassigned',
  cloudFrontBootstrap = false,
) {
  const ownApi =
    apiId === 'unassigned'
      ? []
      : [
          `arn:aws:apigateway:us-east-1::/apis/${apiId}`,
          `arn:aws:apigateway:us-east-1::/apis/${apiId}/*`,
          `arn:aws:apigateway:us-east-1::/tags/arn%3Aaws%3Aapigateway%3Aus-east-1%3A%3A%2Fapis%2F${apiId}`,
          `arn:aws:apigateway:us-east-1::/tags/arn%3Aaws%3Aapigateway%3Aus-east-1%3A%3A%2Fapis%2F${apiId}%2F*`,
        ];
  return {
    health: [logs(['health']), secrets(RETAINED_SECRETS.health), ...parameters(['ingress'])],
    identity: [
      logs(['identity']),
      secrets(RETAINED_SECRETS.identity),
      ...parameters(['app', 'email', 'ingress']),
    ],
    catalog: [
      logs(['catalog']),
      secrets(RETAINED_SECRETS.catalog),
      ...parameters(['database', 'ingress']),
    ],
    management: [
      logs(['management']),
      secrets(RETAINED_SECRETS.management),
      ...parameters(['app', 'ingress']),
    ],
    media: [logs(['media']), secrets(RETAINED_SECRETS.media), ...parameters(['app', 'storage'])],
    prepare: [
      readStack,
      readAssets,
      // Lee el token de origen para el parámetro NoEcho de CloudFront.
      ...parameters(['ingress']),
      allow(
        ['s3:ListBucket', 's3:GetBucketLocation', 's3:GetEncryptionConfiguration'],
        [`arn:aws:s3:::${BUCKET}`],
      ),
      allow(['s3:PutObject'], [assetArn]),
      allow(['cloudformation:CreateChangeSet'], [stackArn], {
        StringEquals: { 'cloudformation:RoleArn': roleArn('cloudformation') },
        StringLike: { 'cloudformation:ChangeSetName': `${STACK}-*` },
      }),
      allow(['cloudformation:DeleteChangeSet'], [stackArn]),
      allow(['cloudformation:DeleteStack'], [stackArn], {
        StringEquals: { 'cloudformation:RoleArn': roleArn('cloudformation') },
      }),
      allow(['iam:PassRole'], [roleArn('cloudformation')], {
        StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' },
      }),
    ],
    execute: [
      readStack,
      readAssets,
      allow(['cloudformation:ExecuteChangeSet'], [stackArn], {
        StringLike: {
          'cloudformation:ChangeSetName': [
            `arn:aws:cloudformation:us-east-1:650387442642:changeSet/${STACK}-*/*`,
            `${STACK}-*`,
          ],
        },
      }),
    ],
    cloudformation: [
      allow(
        [
          'lambda:CreateFunction',
          'lambda:GetFunction',
          'lambda:GetFunctionConfiguration',
          'lambda:GetFunctionCodeSigningConfig',
          'lambda:GetFunctionRecursionConfig',
          'lambda:GetRuntimeManagementConfig',
          'lambda:GetFunctionScalingConfig',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:DeleteFunction',
          'lambda:AddPermission',
          'lambda:RemovePermission',
          'lambda:GetPolicy',
          'lambda:TagResource',
          'lambda:UntagResource',
          'lambda:ListTags',
        ],
        eventNames.map((name) => `arn:aws:lambda:us-east-1:650387442642:function:${STACK}-${name}`),
      ),
      allow(
        [
          'lambda:CreateWebFunction',
          'lambda:GetWebFunction',
          'lambda:DeleteWebFunction',
          'lambda:CreateWebFunctionRevision',
          'lambda:CreateWebFunctionEndpoint',
          'lambda:ListWebFunctionEndpoints',
          'lambda:ListWebFunctionRevisions',
          'lambda:GetResourcePolicy',
          'lambda:PutResourcePolicy',
          'lambda:DeleteResourcePolicy',
          'lambda:TagResource',
          'lambda:UntagResource',
          'lambda:ListTags',
        ],
        [webArn],
      ),
      allow(
        ['lambda:GetWebFunctionRevision', 'lambda:DeleteWebFunctionRevision'],
        [`${webArn}/revision/*`],
      ),
      allow(
        [
          'lambda:GetWebFunctionEndpoint',
          'lambda:UpdateWebFunctionEndpoint',
          'lambda:DeleteWebFunctionEndpoint',
        ],
        [`${webArn}/endpoint/candidate`],
      ),
      allow(['iam:PassRole'], runtimeNames.map(roleArn), {
        StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' },
      }),
      allow(['s3:GetObject', 's3:GetObjectVersion'], [assetArn]),
      // Solo para recuperar una plantilla anterior que resolvía el ingreso desde Secrets Manager.
      secrets(RETAINED_SECRETS.cloudformation),
      allow(
        [
          'logs:CreateLogGroup',
          'logs:DeleteLogGroup',
          'logs:PutRetentionPolicy',
          'logs:DeleteRetentionPolicy',
          'logs:TagResource',
          'logs:UntagResource',
          'logs:ListTagsForResource',
          'logs:GetDataProtectionPolicy',
        ],
        runtimeNames
          .flatMap((name) => [
            `arn:aws:logs:us-east-1:650387442642:log-group:/aws/lambda/${STACK}-${name}`,
            `arn:aws:logs:us-east-1:650387442642:log-group:/aws/lambda/${STACK}-${name}:*`,
          ])
          .concat([
            `arn:aws:logs:us-east-1:650387442642:log-group:/aws/apigateway/${STACK}`,
            `arn:aws:logs:us-east-1:650387442642:log-group:/aws/apigateway/${STACK}:*`,
          ]),
      ),
      allow(
        [
          'logs:DescribeLogGroups',
          'logs:DescribeResourcePolicies',
          'logs:DescribeIndexPolicies',
          'logs:CreateLogDelivery',
          'logs:GetLogDelivery',
          'logs:UpdateLogDelivery',
          'logs:DeleteLogDelivery',
          'logs:ListLogDeliveries',
          'logs:PutResourcePolicy',
        ],
        ['*'],
        { StringEquals: { 'aws:RequestedRegion': 'us-east-1' } },
      ),
      ...(regionalBootstrap
        ? [
            allow(['apigateway:POST'], ['arn:aws:apigateway:us-east-1::/apis'], {
              StringEquals: { 'apigateway:Request/ApiName': STACK },
            }),
          ]
        : []),
      ...(regionalBootstrap || ownApi.length
        ? [
            allow(
              [
                'apigateway:GET',
                'apigateway:POST',
                'apigateway:PATCH',
                'apigateway:PUT',
                'apigateway:DELETE',
                // CloudFormation stage provider uses this action in addition to API tag paths.
                'apigateway:TagResource',
              ],
              regionalBootstrap
                ? ['arn:aws:apigateway:us-east-1::/apis/*', 'arn:aws:apigateway:us-east-1::/tags/*']
                : ownApi,
            ),
          ]
        : []),
      ...(cloudFrontBootstrap
        ? [allow(['cloudfront:CreateDistribution', 'cloudfront:CreateOriginAccessControl'], ['*'])]
        : []),
      ...(cloudFrontBootstrap || distributionId !== 'unassigned'
        ? [
            allow(
              [
                'cloudfront:GetDistribution',
                'cloudfront:GetDistributionConfig',
                'cloudfront:UpdateDistribution',
                'cloudfront:DeleteDistribution',
                'cloudfront:TagResource',
                'cloudfront:UntagResource',
                'cloudfront:ListTagsForResource',
              ],
              [
                `arn:aws:cloudfront::650387442642:distribution/${cloudFrontBootstrap ? '*' : distributionId}`,
              ],
            ),
          ]
        : []),
      ...(cloudFrontBootstrap || oacId !== 'unassigned'
        ? [
            allow(
              [
                'cloudfront:GetOriginAccessControl',
                'cloudfront:GetOriginAccessControlConfig',
                'cloudfront:UpdateOriginAccessControl',
                'cloudfront:DeleteOriginAccessControl',
              ],
              [
                `arn:aws:cloudfront::650387442642:origin-access-control/${cloudFrontBootstrap ? '*' : oacId}`,
              ],
            ),
          ]
        : []),
      allow(['cloudfront:CreateFunction'], ['*'], {
        StringEquals: { 'aws:RequestTag/Project': 'modo-playa-api-cloud' },
        'ForAllValues:StringEquals': { 'aws:TagKeys': ['Project'] },
      }),
      allow(
        [
          'cloudfront:UpdateFunction',
          'cloudfront:DescribeFunction',
          'cloudfront:GetFunction',
          'cloudfront:PublishFunction',
          'cloudfront:DeleteFunction',
          'cloudfront:TagResource',
          'cloudfront:UntagResource',
          'cloudfront:ListTagsForResource',
        ],
        [`arn:aws:cloudfront::650387442642:function/${STACK}-candidate-access`],
      ),
    ],
  };
}

/** Rol OIDC externo de sincronización: escribe sin leer ni descifrar, solo estos parámetros. */
export function parametersSyncPolicy() {
  return policy([
    allow(['ssm:PutParameter'], PARAMETER_DOMAINS.map(parameterArn)),
    ssmKms(['kms:Encrypt', 'kms:GenerateDataKey'], PARAMETER_DOMAINS),
  ]);
}

export function foundationPolicy() {
  const roles = Object.keys(applicationPolicies()).map(roleArn);
  return policy([
    allow(['iam:CreateRole', 'iam:PutRolePermissionsBoundary'], roles, {
      StringEquals: { 'iam:PermissionsBoundary': CEILING },
    }),
    allow(
      [
        'iam:GetRole',
        'iam:DeleteRole',
        'iam:PutRolePolicy',
        'iam:GetRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:ListRolePolicies',
        'iam:ListAttachedRolePolicies',
        'iam:UpdateAssumeRolePolicy',
        'iam:TagRole',
        'iam:UntagRole',
      ],
      roles,
    ),
    allow(
      [
        's3:CreateBucket',
        's3:DeleteBucket',
        's3:GetBucketPolicy',
        's3:PutBucketPolicy',
        's3:DeleteBucketPolicy',
        's3:GetBucketPublicAccessBlock',
        's3:PutBucketPublicAccessBlock',
        's3:GetBucketOwnershipControls',
        's3:PutBucketOwnershipControls',
        's3:GetEncryptionConfiguration',
        's3:PutEncryptionConfiguration',
        's3:GetBucketVersioning',
        's3:PutBucketVersioning',
        's3:GetBucketTagging',
        's3:PutBucketTagging',
        's3:GetBucketLocation',
        's3:ListBucket',
        's3:GetLifecycleConfiguration',
        's3:PutLifecycleConfiguration',
      ],
      [`arn:aws:s3:::${BUCKET}`],
    ),
  ]);
}
