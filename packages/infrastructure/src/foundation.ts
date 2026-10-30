import {
  BootstraplessSynthesizer,
  CfnCondition,
  CfnOutput,
  CfnParameter,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { CfnRole } from 'aws-cdk-lib/aws-iam';
import { CfnBucket, CfnBucketPolicy } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { ACCOUNT, REGION, STACK_NAME, FOUNDATION_STACK_NAME } from './config.ts';
import {
  applicationPolicies,
  BUCKET,
  CEILING,
  githubTrust,
  policy,
  PREFIX,
  serviceTrust,
} from './delivery-policies.ts';

/** Asset-free foundation; ceilings and the OIDC provider are external reviewed prerequisites. */
export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, {
      ...props,
      env: { account: ACCOUNT, region: REGION },
      stackName: FOUNDATION_STACK_NAME,
      synthesizer: new BootstraplessSynthesizer(),
    });
    const apiId = new CfnParameter(this, 'CandidateApiId', {
      type: 'String',
      default: 'unassigned',
      allowedPattern: 'unassigned|[a-z0-9]{1,20}',
    });
    const distributionId = new CfnParameter(this, 'DistributionId', {
      type: 'String',
      default: 'unassigned',
      allowedPattern: 'unassigned|[A-Z0-9]{1,32}',
    });
    const oacId = new CfnParameter(this, 'OriginAccessControlId', {
      type: 'String',
      default: 'unassigned',
      allowedPattern: 'unassigned|[A-Z0-9]{1,32}',
    });
    const regionalBootstrap = new CfnParameter(this, 'AllowRegionalApiBootstrap', {
      type: 'String',
      default: 'false',
      allowedValues: ['false', 'true'],
    });
    const cloudfrontBootstrap = new CfnParameter(this, 'AllowCloudFrontBootstrap', {
      type: 'String',
      default: 'false',
      allowedValues: ['false', 'true'],
    });
    const initialApi = new CfnCondition(this, 'RegionalApiBootstrap', {
      expression: Fn.conditionEquals(regionalBootstrap.valueAsString, 'true'),
    });
    const initialCloudFront = new CfnCondition(this, 'CloudFrontBootstrap', {
      expression: Fn.conditionEquals(cloudfrontBootstrap.valueAsString, 'true'),
    });
    const bucket = new CfnBucket(this, 'Assets', {
      bucketName: BUCKET,
      publicAccessBlockConfiguration: {
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: true,
        restrictPublicBuckets: true,
      },
      ownershipControls: { rules: [{ objectOwnership: 'BucketOwnerEnforced' }] },
      bucketEncryption: {
        serverSideEncryptionConfiguration: [
          { serverSideEncryptionByDefault: { sseAlgorithm: 'AES256' } },
        ],
      },
      versioningConfiguration: { status: 'Enabled' },
      lifecycleConfiguration: {
        rules: [
          {
            id: 'BoundPreviousVersions',
            status: 'Enabled',
            noncurrentVersionExpiration: { noncurrentDays: 30 },
            abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
          },
        ],
      },
    });
    bucket.applyRemovalPolicy(RemovalPolicy.RETAIN);
    new CfnBucketPolicy(this, 'AssetsPolicy', {
      bucket: bucket.ref,
      policyDocument: policy([
        {
          Effect: 'Deny',
          Principal: '*',
          Action: 's3:*',
          Resource: [`arn:aws:s3:::${BUCKET}`, `arn:aws:s3:::${BUCKET}/*`],
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        },
        {
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: ['s3:GetObject', 's3:GetObjectVersion'],
          Resource: [`arn:aws:s3:::${BUCKET}/${STACK_NAME}/*`],
          Condition: {
            ArnLike: {
              'aws:SourceArn': `arn:aws:lambda:${REGION}:${ACCOUNT}:web-function/${STACK_NAME}-media/revision/*`,
            },
          },
        },
      ]),
    });
    const permissions = (regional: boolean, cloudfront: boolean) =>
      policy(
        applicationPolicies(
          apiId.valueAsString,
          regional,
          distributionId.valueAsString,
          oacId.valueAsString,
          cloudfront,
        ).cloudformation,
      );
    for (const [name, statements] of Object.entries(applicationPolicies())) {
      const role = new CfnRole(this, `${name}Role`, {
        roleName: `${PREFIX}${name}`,
        permissionsBoundary: CEILING,
        assumeRolePolicyDocument:
          name === 'prepare' || name === 'execute'
            ? githubTrust('candidate')
            : serviceTrust(
                name === 'cloudformation' ? 'cloudformation.amazonaws.com' : 'lambda.amazonaws.com',
              ),
        policies: [
          {
            policyName: 'project',
            policyDocument:
              name === 'cloudformation'
                ? Fn.conditionIf(
                    initialApi.logicalId,
                    Fn.conditionIf(
                      initialCloudFront.logicalId,
                      permissions(true, true),
                      permissions(true, false),
                    ),
                    Fn.conditionIf(
                      initialCloudFront.logicalId,
                      permissions(false, true),
                      permissions(false, false),
                    ),
                  )
                : policy(statements),
          },
        ],
      });
      new CfnOutput(this, `${name}RoleArn`, { value: role.attrArn });
    }
    new CfnOutput(this, 'DeploymentBucket', { value: bucket.ref });
  }
}
