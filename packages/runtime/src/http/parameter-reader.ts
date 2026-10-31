import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  isParameterName,
  PARAMETER_ENVIRONMENT,
  PARAMETER_KEYS,
  type ParameterDomain,
} from '@modo-playa/contracts/configuration';

export type ParameterReader = (name: string, signal: AbortSignal) => Promise<string>;

/** Las claves rotadas se toman sin desplegar; MONGO_URI requiere reciclar instancias. */
export const CONFIGURATION_TTL_MS = 300_000;

let client: SSMClient | undefined;
/** Lector SSM sin reintentos; un nombre fuera del contrato se rechaza sin consultar SSM. */
export const readParameter: ParameterReader = async (name, signal) => {
  if (!isParameterName(name)) throw new Error('Configuration unavailable.');
  client ??= new SSMClient({ maxAttempts: 1 });
  const { Parameter } = await client.send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
    { abortSignal: signal },
  );
  if (
    typeof Parameter?.Value !== 'string' ||
    (Parameter.Type !== undefined && Parameter.Type !== 'SecureString')
  )
    throw new Error('Configuration unavailable.');
  return Parameter.Value;
};

/**
 * Copia en `values` las claves del dominio si la función recibió su parámetro. Sin variable
 * (desarrollo local) se conservan los valores del entorno.
 */
export async function applyParameter(
  values: NodeJS.ProcessEnv,
  domain: ParameterDomain,
  read: ParameterReader,
): Promise<void> {
  const name = values[PARAMETER_ENVIRONMENT[domain]];
  if (!name) return;
  const parsed: unknown = JSON.parse(await read(name, AbortSignal.timeout(2000)));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid configuration.');
  for (const key of PARAMETER_KEYS[domain]) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid configuration.');
    values[key] = value;
  }
}

/** Carga compartida con vencimiento; un fallo no reutiliza el valor anterior. */
export function refreshing<T>(load: () => Promise<T>, failure: () => Error) {
  let pending: Promise<T> | undefined;
  let expiresAt = 0;
  return () => {
    if (!pending || Date.now() >= expiresAt) {
      expiresAt = Date.now() + CONFIGURATION_TTL_MS;
      pending = load().catch(() => {
        pending = undefined;
        throw failure();
      });
    }
    return pending;
  };
}
