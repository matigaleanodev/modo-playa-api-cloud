import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { routes } from '@modo-playa/contracts/routes';

export function event(
  path: string = routes.health.path,
  method: string = routes.health.method,
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '000000000000',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'local' },
      requestId: 'local-request',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '',
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  };
}

export const context: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'local-health',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:local-health',
  memoryLimitInMB: '128',
  awsRequestId: 'local-request',
  logGroupName: 'local',
  logStreamName: 'local',
  getRemainingTimeInMillis: () => 4000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};
