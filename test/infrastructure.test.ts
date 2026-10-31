import { afterEach, expect, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { rmSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { routes } from '@modo-playa/contracts/routes';
import { documentationPaths } from '@modo-playa/contracts/documentation';
import { stackFixture } from './infra-fixtures.ts';
import { backendForPath, MEDIA_PATHS } from '../packages/infrastructure/src/stack.ts';
import { FoundationStack } from '../packages/infrastructure/src/foundation.ts';
import {
  applicationPolicies,
  parametersSyncPolicy,
  CEILING,
  githubTrust,
} from '../packages/infrastructure/src/delivery-policies.ts';
import { deploymentConfiguration } from '../packages/infrastructure/src/config.ts';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const fixture = (overrides: NodeJS.ProcessEnv = {}) => {
  const result = stackFixture(overrides);
  directories.push(result.directory);
  return result;
};
it('routes every metadata operation to exactly one backend with bounded media patterns', () => {
  const { stack } = fixture();
  const template = Template.fromStack(stack);
  const media = Object.values(routes).filter((route) => route.group === 'media');
  expect(media).toHaveLength(16);
  for (const route of Object.values(routes))
    expect(backendForPath(route.path)).toBe(route.group === 'media' ? 'media' : 'json');
  for (const path of [
    '/api/admin/lodgings-other',
    '/api/admin/lodging-image-uploads-extra',
    '/api/auth/me',
  ])
    expect(backendForPath(path)).toBe('json');
  const declared = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
    (resource) => resource.Properties.RouteKey,
  );
  for (const route of Object.values(routes).filter((route) => route.group !== 'media')) {
    expect(declared).toContain(`${route.method} ${route.path}`);
    expect(declared).toContain(`OPTIONS ${route.path}`);
    if (route.method === 'GET') expect(declared).toContain(`HEAD ${route.path}`);
  }
  const gatewayRoutes = Object.values(template.findResources('AWS::ApiGatewayV2::Route'));
  const healthTarget = gatewayRoutes.find(
    (route) => route.Properties.RouteKey === 'GET /api/health',
  )!.Properties.Target;
  expect(declared.every((route) => !route.endsWith('/'))).toBe(true);
  for (const path of documentationPaths.filter((path) => !path.endsWith('/')))
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const route = gatewayRoutes.find(
        (route) => route.Properties.RouteKey === `${method} ${path}`,
      );
      expect(route?.Properties.Target).toEqual(healthTarget);
      expect(route?.Properties.AuthorizationType).toBe('NONE');
    }
  expect(declared.some((route) => route.includes('ANY') || route.includes('$default'))).toBe(false);
  const dist = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0]!.Properties
    .DistributionConfig;
  expect(dist.Enabled).toBe(false);
  expect(dist.CustomErrorResponses).toEqual(
    [400, 403, 404, 405, 414, 500, 501, 502, 503, 504].map((ErrorCode) => ({
      ErrorCode,
      ErrorCachingMinTTL: 0,
    })),
  );
  expect(
    dist.CacheBehaviors.map((behavior: { PathPattern: string }) => behavior.PathPattern),
  ).toEqual(MEDIA_PATHS);
  for (const behavior of [dist.DefaultCacheBehavior, ...dist.CacheBehaviors]) {
    expect(behavior.AllowedMethods).toContain('DELETE');
    expect(behavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    expect(behavior.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
  }
  expect(
    dist.Origins.every(
      (origin: { ConnectionAttempts: number; OriginPath?: string }) =>
        origin.ConnectionAttempts === 1 && !origin.OriginPath,
    ),
  ).toBe(true);
  template.hasResourceProperties('AWS::ApiGatewayV2::Api', { DisableExecuteApiEndpoint: false });
});
it('normalizes only the docs slash at the edge while preserving viewer access and requests', () => {
  for (const publicAccess of [false, true]) {
    const { stack } = fixture({
      DISTRIBUTION_ENABLED: 'true',
      CANDIDATE_IPS: '198.51.100.2',
      PUBLIC_ACCESS_ENABLED: String(publicAccess),
      PUBLIC_DOMAIN_NAME: 'api.example.test',
      PUBLIC_CERTIFICATE_ARN: 'arn:aws:acm:us-east-1:650387442642:certificate/1234-abcd',
    });
    const code = Object.values(
      Template.fromStack(stack).findResources('AWS::CloudFront::Function'),
    )[0]!.Properties.FunctionCode;
    for (const method of ['GET', 'HEAD', 'OPTIONS'])
      for (const uri of ['/docs/', '/docs', '/docs/extra', '/api/auth/me/', '/openapi.json']) {
        const request = {
          method,
          uri,
          querystring: { filter: { value: 'value' } },
          headers: {
            authorization: { value: 'Bearer existing-session' },
            'content-type': { value: 'multipart/form-data; boundary=fixture' },
          },
          body: { data: 'fixture', encoding: 'text' },
        };
        const expected = { ...structuredClone(request), uri: uri === '/docs/' ? '/docs' : uri };
        const event = { viewer: { ip: publicAccess ? '203.0.113.1' : '198.51.100.2' }, request };
        expect(runInNewContext(`${code}; handler(event);`, { event })).toBe(request);
        expect(request).toEqual(expected);
      }
    if (!publicAccess) {
      const event = { viewer: { ip: '203.0.113.1' }, request: { uri: '/docs/' } };
      expect(runInNewContext(`${code}; handler(event);`, { event }).statusCode).toBe(403);
      expect(event.request.uri).toBe('/docs/');
    }
  }
});
it('protects Web origin with one OAC policy while preserving Bearer and media budgets', () => {
  const { stack } = fixture();
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: {
      OriginAccessControlOriginType: 'lambda',
      SigningBehavior: 'always-amz-auth',
      SigningProtocol: 'sigv4',
    },
  });
  template.hasResourceProperties('AWS::Lambda::WebFunctionEndpoint', {
    AuthType: 'IamAuth',
    EndpointType: 'HomeRegion',
    ScalingConfig: { MaxEnvironments: 2 },
  });
  const revision = Object.values(template.findResources('AWS::Lambda::WebFunctionRevision'))[0]!;
  expect(revision.DeletionPolicy).toBe('Retain');
  expect(revision.UpdateReplacePolicy).toBe('Retain');
  expect(revision.Properties.ServiceConfig.MaxConcurrencyPerEnvironment).toBe(1);
  expect(revision.Properties.ServiceConfig.TimeoutSeconds).toBe(100);
  expect(revision.Properties.ServiceConfig.EnvironmentVariables.MEDIA_REQUEST_TIMEOUT_MS).toBe(
    '90000',
  );
  expect(revision.Properties.BuildConfig.RuntimeConfig.Runtime).toBe('nodejs24.x');
  const resourcePolicy = Object.values(template.findResources('AWS::Lambda::ResourcePolicy'))[0]!
    .Properties;
  const statement = resourcePolicy.PolicyDocument.Statement[0];
  expect(statement.Action).toBe('lambda:InvokeWebFunctionEndpoint');
  expect(statement.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
  expect(statement.Condition.StringEquals['AWS:SourceArn']).toBeTruthy();
  expect(Object.keys(template.findResources('AWS::Lambda::Permission'))).toHaveLength(4);
  const functions = Object.values(template.findResources('AWS::Lambda::Function'));
  expect(
    functions.find((resource) => resource.Properties.FunctionName.endsWith('-identity'))!.Properties
      .Architectures,
  ).toEqual(['x86_64']);
  for (const resource of functions)
    expect(resource.Properties.Environment.Variables.ORIGIN_PARAMETER_NAME).toBe(
      '/modo-playa/prod/ingress',
    );
  expect(template.toJSON().Parameters.OriginVerifyToken).toMatchObject({
    Type: 'String',
    NoEcho: true,
    MinLength: 32,
  });
  expect(JSON.stringify(template.toJSON())).not.toMatch(/resolve:|secretsmanager/);
  const parameterVariables = (suffix: string) =>
    Object.fromEntries(
      Object.entries(
        functions.find((resource) => resource.Properties.FunctionName.endsWith(suffix))!.Properties
          .Environment.Variables as Record<string, string>,
      ).filter(([name]) => name.endsWith('_PARAMETER_NAME') || name.endsWith('_SECRET_ARN')),
    );
  expect(parameterVariables('-health')).toEqual({
    ORIGIN_PARAMETER_NAME: '/modo-playa/prod/ingress',
  });
  expect(parameterVariables('-catalog')).toEqual({
    ORIGIN_PARAMETER_NAME: '/modo-playa/prod/ingress',
    DATABASE_PARAMETER_NAME: '/modo-playa/prod/database',
  });
  expect(parameterVariables('-identity')).toEqual({
    ORIGIN_PARAMETER_NAME: '/modo-playa/prod/ingress',
    APP_PARAMETER_NAME: '/modo-playa/prod/app-properties',
    EMAIL_PARAMETER_NAME: '/modo-playa/prod/email',
  });
  expect(parameterVariables('-management')).toEqual({
    ORIGIN_PARAMETER_NAME: '/modo-playa/prod/ingress',
    APP_PARAMETER_NAME: '/modo-playa/prod/app-properties',
  });
  const web = Object.values(template.findResources('AWS::Lambda::WebFunctionRevision'))[0]!;
  const mediaVariables = JSON.stringify(web.Properties);
  expect(mediaVariables).toContain('/modo-playa/prod/object-storage');
  expect(mediaVariables).not.toMatch(/\/modo-playa\/prod\/(email|database|ingress)/);
});
it('recycles every function when the configuration generation changes', () => {
  const revision = (stack: ReturnType<typeof fixture>['stack']) =>
    Object.keys(Template.fromStack(stack).findResources('AWS::Lambda::WebFunctionRevision'))[0];
  const base = fixture();
  const bumped = fixture({ CONFIGURATION_GENERATION: '2' });
  expect(revision(bumped.stack)).not.toBe(revision(base.stack));
  for (const resource of Object.values(
    Template.fromStack(bumped.stack).findResources('AWS::Lambda::Function'),
  ))
    expect(resource.Properties.Environment.Variables.CONFIGURATION_GENERATION).toBe('2');
});
it('scopes SSM parameters and the aws/ssm key per runtime group', () => {
  const policies = applicationPolicies();
  const arn = (name: string) =>
    `arn:aws:ssm:us-east-1:650387442642:parameter/modo-playa/prod/${name}`;
  const readable = (group: keyof typeof policies) =>
    policies[group].flatMap((statement) =>
      statement.Action.includes('ssm:GetParameter') ? statement.Resource : [],
    );
  const context = (group: keyof typeof policies, action: string) =>
    policies[group].find((statement) => statement.Action.includes(action))?.Condition;
  expect(readable('health')).toEqual([arn('ingress')]);
  expect(readable('catalog')).toEqual([arn('database'), arn('ingress')]);
  expect(readable('identity')).toEqual([arn('app-properties'), arn('email'), arn('ingress')]);
  expect(readable('management')).toEqual([arn('app-properties'), arn('ingress')]);
  expect(readable('prepare')).toEqual([arn('ingress')]);
  expect(readable('cloudformation')).toEqual([]);
  expect(readable('media')).toEqual([arn('app-properties'), arn('object-storage')]);
  expect(context('catalog', 'kms:Decrypt')).toEqual({
    StringEquals: {
      'kms:ViaService': 'ssm.us-east-1.amazonaws.com',
      'kms:EncryptionContext:PARAMETER_ARN': [arn('database'), arn('ingress')],
    },
  });
  const sync = parametersSyncPolicy().Statement;
  expect(sync.flatMap((statement) => statement.Action).sort()).toEqual([
    'kms:Encrypt',
    'kms:GenerateDataKey',
    'ssm:PutParameter',
  ]);
  expect(sync[0]!.Resource).toEqual(
    ['app-properties', 'database', 'email', 'object-storage', 'ingress'].map(arn),
  );
  for (const statements of Object.values(policies))
    expect(statements.flatMap((statement) => statement.Action)).not.toContain('ssm:PutParameter');
});
it('binds immutable media revisions to stable code and configuration', () => {
  const a = fixture();
  const b = fixture();
  const changed = fixture({ R2_BUCKET: 'changed-bucket' });
  const revision = (stack: typeof a.stack) =>
    Object.keys(Template.fromStack(stack).findResources('AWS::Lambda::WebFunctionRevision'))[0];
  expect(revision(a.stack)).toMatch(/^MediaRevision[a-f0-9]{64}$/);
  expect(revision(a.stack)).toBe(revision(b.stack));
  expect(revision(changed.stack)).not.toBe(revision(a.stack));
});
it('keeps secret domains and observed infrastructure permissions separate', () => {
  const policies = applicationPolicies('abc123', false, 'E123ABC', 'E456ABC', false);
  const secretResources = (group: keyof typeof policies) =>
    policies[group].flatMap((statement) =>
      statement.Action.includes('secretsmanager:GetSecretValue') ? statement.Resource : [],
    );
  expect(secretResources('catalog')).toEqual(
    expect.arrayContaining([
      expect.stringContaining('/database-'),
      expect.stringContaining('/ingress-'),
    ]),
  );
  expect(secretResources('catalog').join()).not.toMatch(/app-properties|email|object-storage/);
  expect(secretResources('media').join()).not.toMatch(/email|ingress/);
  expect(secretResources('health').join()).not.toMatch(
    /app-properties|database|email|object-storage/,
  );
  expect(secretResources('cloudformation').join()).toContain('/ingress-');
  expect(secretResources('cloudformation').join()).not.toMatch(
    /app-properties|database|email|object-storage/,
  );
  const createEdge = policies.cloudformation.find((item) =>
    item.Action.includes('cloudfront:CreateFunction'),
  )!;
  expect(createEdge.Resource).toEqual(['*']);
  expect(createEdge).toHaveProperty('Condition', {
    StringEquals: { 'aws:RequestTag/Project': 'modo-playa-api-cloud' },
    'ForAllValues:StringEquals': { 'aws:TagKeys': ['Project'] },
  });
  const gateway = policies.cloudformation.filter((item) =>
    item.Action.some((action) => action.startsWith('apigateway:')),
  );
  expect(
    gateway.flatMap((item) => item.Resource).every((resource) => resource.includes('abc123')),
  ).toBe(true);
  expect(gateway.some((item) => item.Action.includes('apigateway:TagResource'))).toBe(true);
  expect(policies.prepare.flatMap((item) => item.Action)).not.toContain(
    'cloudformation:ExecuteChangeSet',
  );
  expect(policies.execute.flatMap((item) => item.Action)).not.toContain('iam:PassRole');
  expect(
    policies.cloudformation.filter((item) => item.Action.includes('s3:GetObjectVersion')),
  ).toEqual([
    {
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:GetObjectVersion'],
      Resource: [
        'arn:aws:s3:::modo-playa-candidate-assets-650387442642-us-east-1/modo-playa-api-cloud-candidate/*',
      ],
    },
  ]);
  for (const [name, statements] of Object.entries(policies))
    if (name !== 'cloudformation')
      expect(statements.flatMap((item) => item.Action)).not.toContain('s3:GetObjectVersion');
  const template = Template.fromStack(new FoundationStack(new App(), 'Foundation'));
  expect(Buffer.byteLength(JSON.stringify(template.toJSON()))).toBeLessThanOrEqual(51200);
  expect(
    Object.values(template.findResources('AWS::S3::BucketPolicy'))[0]!.Properties.PolicyDocument,
  ).toEqual({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: [
          'arn:aws:s3:::modo-playa-candidate-assets-650387442642-us-east-1',
          'arn:aws:s3:::modo-playa-candidate-assets-650387442642-us-east-1/*',
        ],
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      },
      {
        Effect: 'Allow',
        Principal: { Service: 'lambda.amazonaws.com' },
        Action: ['s3:GetObject', 's3:GetObjectVersion'],
        Resource: [
          'arn:aws:s3:::modo-playa-candidate-assets-650387442642-us-east-1/modo-playa-api-cloud-candidate/*',
        ],
        Condition: {
          ArnLike: {
            'aws:SourceArn':
              'arn:aws:lambda:us-east-1:650387442642:web-function/modo-playa-api-cloud-candidate-media/revision/*',
          },
        },
      },
    ],
  });
  for (const role of Object.values(template.findResources('AWS::IAM::Role')))
    expect(role.Properties.PermissionsBoundary).toBe(CEILING);
  const trust = githubTrust('candidate').Statement[0]!;
  expect(trust.Condition.StringEquals).toEqual({
    'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
    'token.actions.githubusercontent.com:sub':
      'repo:matigaleanodev@99203645/modo-playa-api-cloud@1434510701:environment:candidate',
  });
});
it('rejects test secret naming and uncontrolled candidate access', () => {
  const env = JSON.parse(
    readFileSync(
      new URL('../packages/infrastructure/src/local-settings.json', import.meta.url),
      'utf8',
    ),
  );
  expect(() =>
    deploymentConfiguration({ ...env, CATALOG_ROLE_ARN: env.IDENTITY_ROLE_ARN }),
  ).toThrow('CATALOG_ROLE_ARN');
  expect(() =>
    deploymentConfiguration({
      ...env,
      DEPLOYMENT_BUCKET: env.DEPLOYMENT_BUCKET.replace('candidate', 'test'),
    }),
  ).toThrow('DEPLOYMENT_BUCKET');
  expect(() => deploymentConfiguration({ ...env, CONFIGURATION_GENERATION: '0' })).toThrow(
    'CONFIGURATION_GENERATION',
  );
  expect(() => deploymentConfiguration({ ...env, DISTRIBUTION_ENABLED: 'true' })).toThrow(
    'approved IPs',
  );
  expect(() =>
    deploymentConfiguration({
      ...env,
      CANDIDATE_IPS: '198.51.100.2,2001:db8::1',
      DISTRIBUTION_ENABLED: 'true',
    }),
  ).not.toThrow();
  expect(() => deploymentConfiguration({ ...env, CANDIDATE_IPS: '198.51.100.2/24' })).toThrow('IP');
});
