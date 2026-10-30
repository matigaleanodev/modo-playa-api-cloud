import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';
import { CachePolicy, OriginRequestPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { routes as definitions } from '@modo-playa/contracts/routes';
import { documentationPaths } from '@modo-playa/contracts/documentation';

const directory = await realpath(resolve(process.argv[2] ?? 'cdk.out'));
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
const stacks = Object.values(manifest.artifacts).filter(
  (artifact) => artifact.type === 'aws:cloudformation:stack',
);
assert.equal(stacks.length, 1);
const stack = stacks[0];
assert.equal(stack.environment, 'aws://650387442642/us-east-1');
assert.equal(stack.properties.stackName, 'modo-playa-api-cloud-candidate');
assert.equal(stack.properties.assumeRoleArn, undefined);
const safeFile = async (name) => {
  const path = resolve(directory, name);
  const local = relative(directory, path);
  assert.ok(local && !local.startsWith('..') && !isAbsolute(local), 'Asset outside assembly.');
  assert.equal(await realpath(path), path, 'Symlink in asset path.');
  const info = await lstat(path);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Invalid asset.');
  return path;
};
const contents = await readFile(await safeFile(stack.properties.templateFile), 'utf8');
const template = JSON.parse(contents);
const assets = Object.values(manifest.artifacts).filter(
  (artifact) => artifact.type === 'cdk:asset-manifest',
);
assert.equal(assets.length, 1);
const assetManifest = JSON.parse(await readFile(await safeFile(assets[0].properties.file), 'utf8'));
assert.equal(Object.keys(assetManifest.dockerImages ?? {}).length, 0);
const files = Object.values(assetManifest.files);
assert.equal(files.length, 6);
assert.equal(files.filter((file) => file.source.path.endsWith('.zip')).length, 5);
for (const file of files) {
  await safeFile(file.source.path);
  for (const destination of Object.values(file.destinations)) {
    assert.match(destination.bucketName, /^modo-playa-candidate-[a-z0-9-]+$/);
    assert.ok(destination.objectKey.startsWith('modo-playa-api-cloud-candidate/'));
    assert.equal(destination.assumeRoleArn, undefined);
  }
}
const resources = Object.values(template.Resources);
const entries = Object.entries(template.Resources);
const ofType = (type) => resources.filter((resource) => resource.Type === type);
const events = ['health', 'identity', 'catalog', 'management'];
const mediaPatterns = [
  '/api/admin/lodgings',
  '/api/admin/lodgings/*',
  '/api/admin/lodging-image-uploads',
  '/api/auth/me/profile-image',
  '/api/admin/media/health',
];
assert.equal(ofType('AWS::Lambda::Function').length, 4);
assert.equal(ofType('AWS::Lambda::WebFunction').length, 1);
assert.equal(ofType('AWS::Lambda::WebFunctionRevision').length, 1);
assert.equal(ofType('AWS::Lambda::WebFunctionEndpoint').length, 1);
assert.equal(ofType('AWS::Lambda::ResourcePolicy').length, 1);
assert.equal(ofType('AWS::ApiGatewayV2::Integration').length, 4);
const gatewayDocumentationPaths = documentationPaths.filter((path) => !path.endsWith('/'));
const expectedRoutes = new Set(
  gatewayDocumentationPaths.flatMap((path) =>
    ['GET', 'HEAD', 'OPTIONS'].map((method) => `${method} ${path}`),
  ),
);
for (const path of gatewayDocumentationPaths) {
  const route = ofType('AWS::ApiGatewayV2::Route').find(
    (route) => route.Properties.RouteKey === `GET ${path}`,
  );
  assert.deepEqual(
    route?.Properties.Target,
    ofType('AWS::ApiGatewayV2::Route').find(
      (route) => route.Properties.RouteKey === 'GET /api/health',
    )?.Properties.Target,
    'Documentation must use the protected health origin.',
  );
}
for (const definition of Object.values(definitions).filter((route) => route.group !== 'media')) {
  expectedRoutes.add(`${definition.method} ${definition.path}`);
  expectedRoutes.add(`OPTIONS ${definition.path}`);
  if (definition.method === 'GET') expectedRoutes.add(`HEAD ${definition.path}`);
  const fn = entries.find(
    ([, value]) =>
      value.Type === 'AWS::Lambda::Function' &&
      value.Properties.FunctionName === `modo-playa-api-cloud-candidate-${definition.group}`,
  );
  assert.ok(fn, 'Missing Event function.');
  const integration = entries.find(
    ([, value]) =>
      value.Type === 'AWS::ApiGatewayV2::Integration' &&
      JSON.stringify(value.Properties.IntegrationUri).includes(JSON.stringify(fn[0])),
  );
  assert.ok(integration, 'Missing group integration.');
  const route = ofType('AWS::ApiGatewayV2::Route').find(
    (route) => route.Properties.RouteKey === `${definition.method} ${definition.path}`,
  );
  assert.ok(
    route && JSON.stringify(route.Properties.Target).includes(JSON.stringify(integration[0])),
    'Wrong Gateway integration.',
  );
}
const routes = ofType('AWS::ApiGatewayV2::Route');
assert.deepEqual(
  routes.map((route) => route.Properties.RouteKey).sort(),
  [...expectedRoutes].sort(),
);
for (const route of routes) {
  assert.equal(route.Properties.AuthorizationType, 'NONE');
  assert.doesNotMatch(route.Properties.RouteKey, /ANY|\$default|proxy\+|\/$/);
}
for (const fn of ofType('AWS::Lambda::Function')) {
  const name = events.find(
    (name) => fn.Properties.FunctionName === `modo-playa-api-cloud-candidate-${name}`,
  );
  assert.ok(name);
  assert.equal(fn.Properties.Handler, `${name}.handler`);
  assert.equal(fn.Properties.Runtime, 'nodejs24.x');
  assert.ok(fn.Properties.Environment.Variables.ORIGIN_SECRET_ARN);
  assert.equal(fn.Properties.Architectures[0], 'x86_64');
  assert.ok(fn.Properties.Timeout <= 29);
  assert.equal(fn.Properties.Role, `arn:aws:iam::650387442642:role/modo-playa-candidate-${name}`);
}
const web = ofType('AWS::Lambda::WebFunctionRevision')[0].Properties;
assert.ok(web.BuildConfig.CodeConfig.S3Object, 'Web ZIP must use native BuildConfig.');
const distribution = ofType('AWS::CloudFront::Distribution')[0].Properties.DistributionConfig;
assert.deepEqual(
  distribution.CacheBehaviors.map((behavior) => behavior.PathPattern).sort(),
  mediaPatterns.sort(),
);
for (const behavior of [distribution.DefaultCacheBehavior, ...distribution.CacheBehaviors]) {
  assert.deepEqual([...behavior.AllowedMethods].sort(), [
    'DELETE',
    'GET',
    'HEAD',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
  ]);
  assert.equal(behavior.CachePolicyId, CachePolicy.CACHING_DISABLED.cachePolicyId);
  assert.equal(
    behavior.OriginRequestPolicyId,
    OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
  );
  assert.equal(
    behavior.FunctionAssociations.length,
    1,
    'Candidate gate required on every behavior.',
  );
}
assert.equal(distribution.OriginGroups, undefined, 'No failover/replay.');
for (const origin of distribution.Origins) {
  assert.ok(!origin.OriginPath, 'Keep /api without rewriting.');
  assert.equal(origin.ConnectionAttempts, 1);
}
const oac = ofType('AWS::CloudFront::OriginAccessControl')[0].Properties.OriginAccessControlConfig;
assert.equal(oac.OriginAccessControlOriginType, 'lambda');
assert.equal(oac.SigningBehavior, 'always-amz-auth');
assert.equal(oac.SigningProtocol, 'sigv4');
const endpointEntry = entries.find(
  ([, value]) => value.Type === 'AWS::Lambda::WebFunctionEndpoint',
);
const webEntry = entries.find(([, value]) => value.Type === 'AWS::Lambda::WebFunction');
const distEntry = entries.find(([, value]) => value.Type === 'AWS::CloudFront::Distribution');
assert.equal(endpointEntry[1].Properties.AuthType, 'IamAuth');
assert.equal(endpointEntry[1].Properties.EndpointType, 'HomeRegion');
assert.equal(
  web.ServiceConfig.ExecutionRoleArn,
  'arn:aws:iam::650387442642:role/modo-playa-candidate-media',
);
const policy = ofType('AWS::Lambda::ResourcePolicy')[0].Properties;
assert.deepEqual(policy.ResourceArn, { 'Fn::GetAtt': [webEntry[0], 'FunctionArn'] });
assert.deepEqual(policy.PolicyDocument.Statement, [
  {
    Effect: 'Allow',
    Principal: { Service: 'cloudfront.amazonaws.com' },
    Action: 'lambda:InvokeWebFunctionEndpoint',
    Resource: { 'Fn::GetAtt': [endpointEntry[0], 'EndpointArn'] },
    Condition: {
      StringEquals: {
        'AWS:SourceArn': {
          'Fn::Join': [
            '',
            ['arn:aws:cloudfront::650387442642:distribution/', { Ref: distEntry[0] }],
          ],
        },
      },
    },
  },
]);
assert.equal(ofType('AWS::ApiGatewayV2::Api')[0].Properties.DisableExecuteApiEndpoint, false);
assert.equal(
  ofType('AWS::ApiGatewayV2::Api')[0].Properties.CorsConfiguration,
  undefined,
  'OPTIONS must pass origin guard.',
);
const publicNames = ['RESEND_FROM_EMAIL', 'R2_ENDPOINT', 'R2_BUCKET'];
assert.ok(
  ofType('AWS::Lambda::Function').some((fn) => fn.Properties.Environment.Variables[publicNames[0]]),
);
for (const resource of resources) {
  const variables = resource.Properties?.Environment?.Variables ?? {};
  for (const [name, value] of Object.entries(variables)) {
    assert.ok(
      ![
        'SECRET_KEY',
        'RESEND_API_KEY',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'ORIGIN_VERIFY_TOKEN',
        'MONGO_URI',
      ].includes(name),
      'Sensitive literal in environment.',
    );
    if (name.endsWith('_SECRET_ARN')) assert.match(value, /:secret:modo-playa\/prod\//);
  }
}
const allowed = new Set([
  'AWS::Lambda::Function',
  'AWS::Lambda::Permission',
  'AWS::Lambda::WebFunction',
  'AWS::Lambda::WebFunctionRevision',
  'AWS::Lambda::WebFunctionEndpoint',
  'AWS::Lambda::ResourcePolicy',
  'AWS::Logs::LogGroup',
  'AWS::ApiGatewayV2::Api',
  'AWS::ApiGatewayV2::Stage',
  'AWS::ApiGatewayV2::Integration',
  'AWS::ApiGatewayV2::Route',
  'AWS::CloudFront::Distribution',
  'AWS::CloudFront::OriginAccessControl',
  'AWS::CloudFront::Function',
]);
for (const resource of resources)
  assert.ok(allowed.has(resource.Type), `Unexpected resource: ${resource.Type}`);
assert.doesNotMatch(contents, /mongodb(?:\+srv)?:\/\/|AKIA[0-9A-Z]{16}|modo-playa\/test\//);
// Only CloudFront's ingress header may contain a dynamic secret reference.
const withoutIngress = structuredClone(template);
for (const resource of Object.values(withoutIngress.Resources))
  if (resource.Type === 'AWS::CloudFront::Distribution')
    for (const origin of resource.Properties.DistributionConfig.Origins)
      delete origin.OriginCustomHeaders;
assert.doesNotMatch(JSON.stringify(withoutIngress), /resolve:secretsmanager/);
console.info(
  'Assembly revisada: Event + Web ZIPs, routing explícito, OAC, referencias prod e ingreso sin caché.',
);
