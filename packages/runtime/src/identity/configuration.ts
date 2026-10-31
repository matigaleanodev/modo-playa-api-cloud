import {
  applyParameter,
  readParameter,
  refreshing,
  type ParameterReader,
} from '../http/parameter-reader.ts';
export type { ParameterReader } from '../http/parameter-reader.ts';
export interface IdentityConfiguration {
  mongoUri: string;
  secretKey: string;
  bcryptRounds: number;
  resendApiKey: string;
  resendFromEmail: string;
  superadminOwnerId?: string;
  publicBaseUrl: string;
  r2Endpoint: string;
  r2Bucket: string;
}
export function runtimeConfiguration(
  env: NodeJS.ProcessEnv,
  read: ParameterReader = readParameter,
) {
  return refreshing<IdentityConfiguration>(
    async () => {
      const values = { ...env };
      await applyParameter(values, 'app', read);
      await applyParameter(values, 'email', read);
      for (const name of ['MONGO_URI', 'SECRET_KEY', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL'])
        if (!values[name]?.trim()) throw new Error('Missing configuration.');
      const bcryptRounds = Number(values.BCRYPT_ROUNDS ?? 12);
      if (!Number.isInteger(bcryptRounds) || bcryptRounds < 4 || bcryptRounds > 31)
        throw new Error('Invalid configuration.');
      return {
        mongoUri: values.MONGO_URI!,
        secretKey: values.SECRET_KEY!,
        bcryptRounds,
        resendApiKey: values.RESEND_API_KEY!,
        resendFromEmail: values.RESEND_FROM_EMAIL!,
        superadminOwnerId: values.SUPERADMIN_OWNER_ID,
        publicBaseUrl: values.MEDIA_PUBLIC_BASE_URL ?? '',
        r2Endpoint: values.R2_ENDPOINT ?? '',
        r2Bucket: values.R2_BUCKET ?? '',
      };
    },
    () => new Error('Runtime configuration unavailable.'),
  );
}
