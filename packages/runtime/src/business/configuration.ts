import {
  applyParameter,
  readParameter,
  refreshing,
  type ParameterReader,
} from '../http/parameter-reader.ts';
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
  read: ParameterReader = readParameter,
) {
  return refreshing<BusinessConfiguration>(
    async () => {
      const values = { ...env };
      // Catalog solo recibe la URI de lectura; management la de escritura y la clave JWT.
      await applyParameter(values, group === 'catalog' ? 'database' : 'app', read);
      if (!values.MONGO_URI?.trim() || (group === 'management' && !values.SECRET_KEY?.trim()))
        throw new Error('Missing configuration.');
      return {
        mongoUri: values.MONGO_URI,
        secretKey: group === 'management' ? values.SECRET_KEY : undefined,
        publicBaseUrl: values.MEDIA_PUBLIC_BASE_URL ?? '',
        r2Endpoint: values.R2_ENDPOINT ?? '',
        r2Bucket: values.R2_BUCKET ?? '',
      };
    },
    () => new Error('Runtime configuration unavailable.'),
  );
}
