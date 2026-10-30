import {
  CliCredentialsStackSynthesizer,
  CfnOutput,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { CfnApi, CfnIntegration, CfnRoute, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import {
  CfnFunction,
  CfnPermission,
  CfnWebFunction,
  CfnWebFunctionRevision,
  CfnWebFunctionEndpoint,
  CfnResourcePolicy,
} from 'aws-cdk-lib/aws-lambda';
import {
  CfnDistribution,
  CfnOriginAccessControl,
  OriginRequestPolicy,
  CachePolicy,
  CfnFunction as CfnEdgeFunction,
} from 'aws-cdk-lib/aws-cloudfront';
import { CfnLogGroup } from 'aws-cdk-lib/aws-logs';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import type { Construct } from 'constructs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { routes, type RouteGroup } from '@modo-playa/contracts/routes';
import { documentationPaths } from '@modo-playa/contracts/documentation';
import { ACCOUNT, REGION, STACK_NAME, type DeploymentConfiguration } from './config.ts';

export const MEDIA_PATHS = [
  '/api/admin/lodgings',
  '/api/admin/lodgings/*',
  '/api/admin/lodging-image-uploads',
  '/api/auth/me/profile-image',
  '/api/admin/media/health',
];
export function backendForPath(path: string) {
  return MEDIA_PATHS.some((pattern) =>
    pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
  )
    ? 'media'
    : 'json';
}
interface ModoPlayaStackProps extends StackProps {
  configuration: DeploymentConfiguration;
  assetDirectory?: string;
}

/** Adapted from Foodly delivery: explicit resources, no runtime imports or lookups. */
export class ModoPlayaStack extends Stack {
  constructor(scope: Construct, id: string, props: ModoPlayaStackProps) {
    const config = props.configuration;
    super(scope, id, {
      ...props,
      env: { account: ACCOUNT, region: REGION },
      stackName: STACK_NAME,
      synthesizer: new CliCredentialsStackSynthesizer({
        fileAssetsBucketName: config.deploymentBucket,
        bucketPrefix: `${STACK_NAME}/`,
      }),
    });
    const assets = Object.fromEntries(
      ['health', 'identity', 'catalog', 'management', 'media'].map((name) => [
        name,
        new Asset(this, `${name}Asset`, {
          path: resolve(props.assetDirectory ?? 'dist', `${name}.zip`),
        }),
      ]),
    );
    const accessLogs = new CfnLogGroup(this, 'AccessLogs', {
      logGroupName: `/aws/apigateway/${STACK_NAME}`,
      retentionInDays: 14,
    });
    // Every request, including OPTIONS, reaches the runtime ingress guard.
    const api = new CfnApi(this, 'Api', {
      name: STACK_NAME,
      protocolType: 'HTTP',
      disableExecuteApiEndpoint: false,
    });
    new CfnStage(this, 'Stage', {
      apiId: api.ref,
      stageName: '$default',
      autoDeploy: true,
      defaultRouteSettings: { throttlingBurstLimit: 10, throttlingRateLimit: 5 },
      accessLogSettings: {
        destinationArn: accessLogs.attrArn,
        format:
          '{"requestId":"$context.requestId","route":"$context.routeKey","status":"$context.status","durationMs":"$context.responseLatency"}',
      },
    });
    const integrations: Partial<Record<RouteGroup, CfnIntegration>> = {};
    for (const name of ['health', 'identity', 'catalog', 'management'] as const) {
      const file = assets[name]!;
      const logs = new CfnLogGroup(this, `${name}Logs`, {
        logGroupName: `/aws/lambda/${STACK_NAME}-${name}`,
        retentionInDays: 14,
      });
      const vars: Record<string, string> = {
        ...config.commonEnvironment,
        ORIGIN_SECRET_ARN: config.originSecretArn,
        ...(name === 'identity'
          ? {
              IDENTITY_SECRET_ARN: config.appSecretArn,
              EMAIL_SECRET_ARN: config.emailSecretArn,
              RESEND_FROM_EMAIL: config.resendFromEmail,
              ...config.publicOptions,
            }
          : {}),
        ...(name === 'catalog' ? { CATALOG_SECRET_ARN: config.databaseSecretArn } : {}),
        ...(name === 'management' ? { MANAGEMENT_SECRET_ARN: config.appSecretArn } : {}),
      };
      const fn = new CfnFunction(this, `${name}Function`, {
        functionName: `${STACK_NAME}-${name}`,
        handler: `${name}.handler`,
        runtime: 'nodejs24.x',
        architectures: ['x86_64'],
        memorySize: name === 'health' ? 128 : 512,
        timeout: name === 'health' ? 5 : 29,
        role: config.roles[name]!,
        code: { s3Bucket: file.s3BucketName, s3Key: file.s3ObjectKey },
        loggingConfig: { logGroup: logs.ref },
        environment: { variables: vars },
      });
      integrations[name] = new CfnIntegration(this, `${name}Integration`, {
        apiId: api.ref,
        integrationType: 'AWS_PROXY',
        integrationUri: fn.attrArn,
        payloadFormatVersion: '2.0',
        timeoutInMillis: 30000,
      });
      new CfnPermission(this, `${name}GatewayPermission`, {
        action: 'lambda:InvokeFunction',
        functionName: fn.attrArn,
        principal: 'apigateway.amazonaws.com',
        sourceAccount: ACCOUNT,
        sourceArn: `arn:aws:execute-api:${REGION}:${ACCOUNT}:${api.ref}/*/*`,
      });
    }
    for (const [index, path] of documentationPaths.entries()) {
      if (path.endsWith('/')) continue;
      for (const method of ['GET', 'HEAD', 'OPTIONS'])
        new CfnRoute(this, `Documentation${index}${method}Route`, {
          apiId: api.ref,
          routeKey: `${method} ${path}`,
          target: `integrations/${integrations.health!.ref}`,
          authorizationType: 'NONE',
        });
    }
    const preflights = new Set<string>();
    for (const route of Object.values(routes)) {
      if (route.group === 'media') continue;
      if (backendForPath(route.path) !== 'json') throw new Error('Ambiguous routing.');
      for (const method of route.method === 'GET' ? ['GET', 'HEAD'] : [route.method]) {
        new CfnRoute(this, `${route.operation}${method}Route`, {
          apiId: api.ref,
          routeKey: `${method} ${route.path}`,
          target: `integrations/${integrations[route.group]!.ref}`,
          authorizationType: 'NONE',
        });
      }
      if (!preflights.has(route.path)) {
        preflights.add(route.path);
        new CfnRoute(this, `${route.operation}OPTIONSRoute`, {
          apiId: api.ref,
          routeKey: `OPTIONS ${route.path}`,
          target: `integrations/${integrations[route.group]!.ref}`,
          authorizationType: 'NONE',
        });
      }
    }
    for (const route of Object.values(routes).filter((route) => route.group === 'media'))
      if (backendForPath(route.path) !== 'media') throw new Error('Missing media ingress.');

    const mediaLogs = new CfnLogGroup(this, 'mediaLogs', {
      logGroupName: `/aws/lambda/${STACK_NAME}-media`,
      retentionInDays: 14,
    });
    const media = new CfnWebFunction(this, 'MediaWebFunction', {
      functionName: `${STACK_NAME}-media`,
    });
    const mediaEnvironment = {
      ...config.commonEnvironment,
      ...config.publicOptions,
      MEDIA_SECRET_ARN: config.appSecretArn,
      STORAGE_SECRET_ARN: config.storageSecretArn,
      MEDIA_REQUEST_TIMEOUT_MS: '90000',
    };
    const serviceConfig = {
      executionRoleArn: config.roles.media!,
      environmentVariables: mediaEnvironment,
      // Sequential Sharp/attach work was measured locally; avoid the default 64 requests per VM.
      maxConcurrencyPerEnvironment: 1,
      timeoutSeconds: 100,
      telemetryConfig: { loggingConfig: { logGroup: mediaLogs.ref } },
    };
    // Configuration changes also require a new immutable revision.
    const revisionDigest = createHash('sha256')
      .update(
        JSON.stringify({
          asset: assets.media!.assetHash,
          environment: mediaEnvironment,
          role: config.roles.media,
          runtime: 'nodejs24.x',
          concurrency: 1,
          timeout: 100,
        }),
      )
      .digest('hex');
    const revision = new CfnWebFunctionRevision(
      this,
      `MediaRevision${revisionDigest.slice(0, 32)}`,
      {
        functionName: media.ref,
        buildConfig: {
          codeConfig: {
            s3Object: { bucket: assets.media!.s3BucketName, key: assets.media!.s3ObjectKey },
          },
          runtimeConfig: { runtime: 'nodejs24.x' },
        },
        serviceConfig,
        description: `sha256:${revisionDigest}`,
      },
    );
    revision.overrideLogicalId(`MediaRevision${revisionDigest}`);
    revision.applyRemovalPolicy(RemovalPolicy.RETAIN);
    const endpoint = new CfnWebFunctionEndpoint(this, 'MediaEndpoint', {
      functionName: media.ref,
      endpointName: 'candidate',
      endpointType: 'HomeRegion',
      authType: 'IamAuth',
      revisionWeights: [{ revisionId: revision.attrRevisionId, weight: 100 }],
      scalingConfig: { maxEnvironments: 2 },
      throttleConfig: { rateLimit: 100 },
    });
    const oac = new CfnOriginAccessControl(this, 'MediaOac', {
      originAccessControlConfig: {
        name: `${STACK_NAME}-media`,
        originAccessControlOriginType: 'lambda',
        signingBehavior: 'always-amz-auth',
        signingProtocol: 'sigv4',
      },
    });
    const candidateGate = new CfnEdgeFunction(this, 'CandidateGate', {
      name: `${STACK_NAME}-candidate-access`,
      autoPublish: true,
      tags: [{ key: 'Project', value: 'modo-playa-api-cloud' }],
      functionConfig: {
        comment: 'Candidate allowlist uses authenticated CloudFront viewer IP.',
        runtime: 'cloudfront-js-2.0',
      },
      functionCode: `function handler(event) { var allowed = ${JSON.stringify(config.candidateIps)}; if (${String(config.publicAccess)} || allowed.indexOf(event.viewer.ip) !== -1) { if (event.request.uri === '/docs/') event.request.uri = '/docs'; return event.request; } return {statusCode:403,statusDescription:'Forbidden',headers:{'cache-control':{value:'no-store'}}}; }`,
    });
    const behavior = (targetOriginId: string) => ({
      targetOriginId,
      viewerProtocolPolicy: 'https-only',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
      cachedMethods: ['GET', 'HEAD'],
      cachePolicyId: CachePolicy.CACHING_DISABLED.cachePolicyId,
      originRequestPolicyId:
        OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId,
      compress: false,
      functionAssociations: [
        { eventType: 'viewer-request', functionArn: candidateGate.attrFunctionArn },
      ],
    });
    const distribution = new CfnDistribution(this, 'Distribution', {
      distributionConfig: {
        enabled: config.distributionEnabled,
        httpVersion: 'http2',
        priceClass: 'PriceClass_100',
        aliases: config.publicDomain ? [config.publicDomain] : [],
        viewerCertificate: config.certificateArn
          ? {
              acmCertificateArn: config.certificateArn,
              sslSupportMethod: 'sni-only',
              minimumProtocolVersion: 'TLSv1.2_2021',
            }
          : { cloudFrontDefaultCertificate: true },
        origins: [
          {
            id: 'json',
            domainName: Fn.select(2, Fn.split('/', api.attrApiEndpoint)),
            connectionAttempts: 1,
            originCustomHeaders: [
              {
                headerName: 'x-modo-playa-origin',
                headerValue: `{{resolve:secretsmanager:${config.originSecretArn}:SecretString:ORIGIN_VERIFY_TOKEN}}`,
              },
            ],
            customOriginConfig: {
              originProtocolPolicy: 'https-only',
              originSslProtocols: ['TLSv1.2'],
              originReadTimeout: 35,
            },
          },
          {
            id: 'media',
            domainName: endpoint.attrDomainName,
            originAccessControlId: oac.ref,
            connectionAttempts: 1,
            responseCompletionTimeout: 120,
            customOriginConfig: {
              originProtocolPolicy: 'https-only',
              originSslProtocols: ['TLSv1.2'],
              originReadTimeout: 110,
            },
          },
        ],
        customErrorResponses: [400, 403, 404, 405, 414, 500, 501, 502, 503, 504].map(
          (errorCode) => ({ errorCode, errorCachingMinTtl: 0 }),
        ),
        defaultCacheBehavior: behavior('json'),
        cacheBehaviors: MEDIA_PATHS.map((pathPattern) => ({ pathPattern, ...behavior('media') })),
      },
    });
    new CfnResourcePolicy(this, 'MediaOriginPolicy', {
      resourceArn: media.attrFunctionArn,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Action: 'lambda:InvokeWebFunctionEndpoint',
            Resource: endpoint.attrEndpointArn,
            Condition: {
              StringEquals: {
                'AWS:SourceArn': `arn:aws:cloudfront::${ACCOUNT}:distribution/${distribution.ref}`,
              },
            },
          },
        ],
      },
    });
    new CfnOutput(this, 'ApiId', { value: api.ref });
    new CfnOutput(this, 'DistributionId', { value: distribution.ref });
    new CfnOutput(this, 'OriginAccessControlId', { value: oac.ref });
    new CfnOutput(this, 'CloudFrontDomain', { value: distribution.attrDomainName });
    new CfnOutput(this, 'MediaRevisionId', { value: revision.attrRevisionId });
  }
}
