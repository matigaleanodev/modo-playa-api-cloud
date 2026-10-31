import { isIP } from 'node:net';
import { PARAMETER_NAMES, type ParameterDomain } from '@modo-playa/contracts/configuration';
export const ACCOUNT = '650387442642';
export const REGION = 'us-east-1';
export const STACK_NAME = 'modo-playa-api-cloud-candidate';
export const FOUNDATION_STACK_NAME = `${STACK_NAME}-foundation`;

/** Secretos anteriores: solo legibles para recuperar la revisión previa hasta retirarlos. */
export const SECRET_NAMES = {
  app: 'modo-playa/prod/app-properties',
  database: 'modo-playa/prod/database',
  email: 'modo-playa/prod/email',
  storage: 'modo-playa/prod/object-storage',
  ingress: 'modo-playa/prod/ingress',
} as const;

export { PARAMETER_NAMES };
export const parameterArn = (domain: ParameterDomain) =>
  `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter${PARAMETER_NAMES[domain]}`;

/** Public configuration and resource references only; no runtime clients or secret lookups. */
export function deploymentConfiguration(env: NodeJS.ProcessEnv) {
  const required = (name: string, pattern: RegExp) => {
    const value = env[name] ?? '';
    if (!pattern.test(value)) throw new Error(`Invalid or missing ${name}.`);
    return value;
  };
  const flag = (name: string) => {
    if (env[name] && !['true', 'false'].includes(env[name]!)) throw new Error(`Invalid ${name}.`);
    return env[name] === 'true';
  };
  const role = (name: string) =>
    required(
      name,
      new RegExp(
        `^arn:aws:iam::650387442642:role/modo-playa-candidate-${name.replace('_ROLE_ARN', '').toLowerCase()}$`,
      ),
    );
  const origins = required('CORS_ORIGIN', /\S+/)
    .split(',')
    .map((value) => value.trim());
  if (origins.some((origin) => origin !== '*' && !/^https?:\/\//.test(origin)))
    throw new Error('Invalid CORS origin.');
  const candidateIps = (env.CANDIDATE_IPS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (candidateIps.some((value) => !isIP(value))) throw new Error('Invalid candidate IP.');
  const publicAccess = flag('PUBLIC_ACCESS_ENABLED');
  const distributionEnabled = flag('DISTRIBUTION_ENABLED');
  if (distributionEnabled && !publicAccess && !candidateIps.length)
    throw new Error('Candidate distribution requires approved IPs.');
  if (publicAccess && !distributionEnabled) throw new Error('Public access requires distribution.');
  const publicDomain = publicAccess ? required('PUBLIC_DOMAIN_NAME', /^[a-z0-9.-]+$/) : undefined;
  const certificateArn = publicAccess
    ? required(
        'PUBLIC_CERTIFICATE_ARN',
        /^arn:aws:acm:us-east-1:650387442642:certificate\/[a-f0-9-]+$/,
      )
    : undefined;
  const commonEnvironment = {
    NODE_ENV: 'production',
    CORS_ORIGIN: origins.join(','),
    MEDIA_PUBLIC_BASE_URL: env.MEDIA_PUBLIC_BASE_URL ?? '',
    R2_ENDPOINT: required('R2_ENDPOINT', /^https:\/\/[^\s/]+\/?$/),
    R2_BUCKET: required('R2_BUCKET', /^[a-z0-9][a-z0-9-]+$/),
    R2_REGION: env.R2_REGION || 'auto',
    // Incrementarlo recicla Event y Web Functions en una entrega revisada (p. ej. tras rotar Mongo).
    ...(env.CONFIGURATION_GENERATION
      ? { CONFIGURATION_GENERATION: required('CONFIGURATION_GENERATION', /^[1-9]\d{0,9}$/) }
      : {}),
  };
  const publicOptions: Record<string, string> = {};
  for (const name of [
    'BCRYPT_ROUNDS',
    'SUPERADMIN_OWNER_ID',
    'IMAGE_ALLOWED_MIME',
    'PENDING_UPLOAD_TTL_SECONDS',
    'LODGING_IMAGE_MAX_BYTES',
    'LODGING_IMAGE_MAX_WIDTH',
    'LODGING_IMAGE_MAX_HEIGHT',
    'USER_PROFILE_IMAGE_MAX_BYTES',
    'USER_PROFILE_IMAGE_MAX_WIDTH',
    'USER_PROFILE_IMAGE_MAX_HEIGHT',
  ])
    if (env[name]) publicOptions[name] = env[name]!;
  return {
    publicAccess,
    distributionEnabled,
    publicDomain,
    certificateArn,
    candidateIps,
    roles: Object.fromEntries(
      ['health', 'identity', 'catalog', 'management', 'media'].map((group) => [
        group,
        role(`${group.toUpperCase()}_ROLE_ARN`),
      ]),
    ),
    deploymentBucket: required(
      'DEPLOYMENT_BUCKET',
      /^modo-playa-candidate-assets-650387442642-us-east-1$/,
    ),
    commonEnvironment,
    publicOptions,
    resendFromEmail: required('RESEND_FROM_EMAIL', /\S+@\S+/),
  };
}
export type DeploymentConfiguration = ReturnType<typeof deploymentConfiguration>;
