/**
 * Parámetros SSM SecureString estándar (clave administrada aws/ssm), uno por dominio de
 * credenciales. Conservan el contrato JSON de los secretos que reemplazan; ingress también
 * alimenta el header de origen de CloudFront mediante un parámetro NoEcho de la entrega.
 */
export const PARAMETER_NAMES = {
  app: '/modo-playa/prod/app-properties',
  database: '/modo-playa/prod/database',
  email: '/modo-playa/prod/email',
  storage: '/modo-playa/prod/object-storage',
  ingress: '/modo-playa/prod/ingress',
} as const;
export type ParameterDomain = keyof typeof PARAMETER_NAMES;
export type ParameterName = (typeof PARAMETER_NAMES)[ParameterDomain];

/** Claves requeridas en cada parámetro; MongoDB de lectura y escritura siguen separadas. */
export const PARAMETER_KEYS = {
  app: ['MONGO_URI', 'SECRET_KEY'],
  database: ['MONGO_URI'],
  email: ['RESEND_API_KEY'],
  storage: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
  ingress: ['ORIGIN_VERIFY_TOKEN'],
} as const satisfies Record<ParameterDomain, readonly string[]>;

/** Variable de entorno con la que cada función recibe el nombre del parámetro. */
export const PARAMETER_ENVIRONMENT = {
  app: 'APP_PARAMETER_NAME',
  database: 'DATABASE_PARAMETER_NAME',
  email: 'EMAIL_PARAMETER_NAME',
  storage: 'STORAGE_PARAMETER_NAME',
  ingress: 'ORIGIN_PARAMETER_NAME',
} as const satisfies Record<ParameterDomain, string>;

export function isParameterName(value: unknown): value is ParameterName {
  return Object.values(PARAMETER_NAMES).includes(value as ParameterName);
}
