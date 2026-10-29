import { CliCredentialsStackSynthesizer, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnApi, CfnIntegration, CfnRoute, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { CfnFunction, CfnPermission } from 'aws-cdk-lib/aws-lambda';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import type { Construct } from 'constructs';
import { routesFor } from '@modo-playa/contracts/routes';

interface HealthStackProps extends StackProps {
  assetPath: string;
  deploymentBucket: string;
  healthRoleArn: string;
}

// Stack de síntesis local: referencias ficticias, sin crear roles ni resolver secretos.
export class HealthStack extends Stack {
  constructor(scope: Construct, id: string, props: HealthStackProps) {
    super(scope, id, {
      ...props,
      synthesizer: new CliCredentialsStackSynthesizer({
        fileAssetsBucketName: props.deploymentBucket,
      }),
    });
    const asset = new Asset(this, 'HealthAsset', { path: props.assetPath });
    const fn = new CfnFunction(this, 'HealthFunction', {
      runtime: 'nodejs24.x',
      architectures: ['x86_64'],
      handler: 'health.handler',
      memorySize: 128,
      timeout: 4,
      role: props.healthRoleArn,
      code: { s3Bucket: asset.s3BucketName, s3Key: asset.s3ObjectKey },
    });
    const api = new CfnApi(this, 'Api', {
      protocolType: 'HTTP',
      corsConfiguration: { allowOrigins: ['*'], allowMethods: ['GET', 'OPTIONS'] },
    });
    const integration = new CfnIntegration(this, 'HealthIntegration', {
      apiId: api.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: fn.attrArn,
      payloadFormatVersion: '2.0',
    });
    new CfnStage(this, 'Stage', { apiId: api.ref, stageName: '$default', autoDeploy: true });
    for (const route of routesFor('health')) {
      new CfnRoute(this, `${route.operation}Route`, {
        apiId: api.ref,
        routeKey: `${route.method} ${route.path}`,
        target: `integrations/${integration.ref}`,
        authorizationType: 'NONE',
      });
      new CfnPermission(this, `${route.operation}Permission`, {
        action: 'lambda:InvokeFunction',
        functionName: fn.attrArn,
        principal: 'apigateway.amazonaws.com',
        sourceAccount: this.account,
        sourceArn: this.formatArn({
          service: 'execute-api',
          resource: api.ref,
          resourceName: `*/${route.method}${route.path}`,
        }),
      });
    }
  }
}
