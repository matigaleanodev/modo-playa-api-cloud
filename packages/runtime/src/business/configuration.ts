import { readSecret, type SecretReader } from '../http/secret-reader.ts';
export interface BusinessConfiguration {
  mongoUri: string;
  secretKey?: string;
  publicBaseUrl: string;
  r2Endpoint: string;
  r2Bucket: string;
}
export function businessConfiguration(
  group: 'catalog' | 'management',
  env: NodeJS.ProcessEnv,
  read: SecretReader = readSecret,
) {
  let pending: Promise<BusinessConfiguration> | undefined;
  return () => {
    pending ??= (async () => {
      const values = { ...env };
      const reference = group === 'catalog' ? env.CATALOG_SECRET_ARN : env.MANAGEMENT_SECRET_ARN;
      if (reference) {
        const secret: unknown = JSON.parse(await read(reference, AbortSignal.timeout(2000)));
        if (!secret || typeof secret !== 'object' || Array.isArray(secret))
          throw new Error('Invalid configuration.');
        for (const key of group === 'catalog' ? ['MONGO_URI'] : ['MONGO_URI', 'SECRET_KEY']) {
          const value = (secret as Record<string, unknown>)[key];
          if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid configuration.');
          values[key] = value;
        }
      }
      if (!values.MONGO_URI?.trim() || (group === 'management' && !values.SECRET_KEY?.trim()))
        throw new Error('Missing configuration.');
      return {
        mongoUri: values.MONGO_URI,
        secretKey: group === 'management' ? values.SECRET_KEY : undefined,
        publicBaseUrl: values.MEDIA_PUBLIC_BASE_URL ?? '',
        r2Endpoint: values.R2_ENDPOINT ?? '',
        r2Bucket: values.R2_BUCKET ?? '',
      };
    })().catch(() => {
      pending = undefined;
      throw new Error('Runtime configuration unavailable.');
    });
    return pending;
  };
}
