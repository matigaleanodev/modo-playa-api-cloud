import axios from 'axios';
import { Readable } from 'node:stream';
export type Provider = 'weather' | 'sun';
export interface ProviderRequest {
  provider: Provider;
  params: Record<string, string | number | boolean>;
  signal: AbortSignal;
}
export type JsonHttpClient = (url: string, request: ProviderRequest) => Promise<unknown>;
export class ProviderHttpError extends Error {
  constructor(
    readonly code:
      'HTTP_STATUS' | 'NETWORK' | 'INVALID_JSON' | 'RESPONSE_SIZE' | 'CANCELLED' | 'TIMEOUT',
    readonly status?: number,
  ) {
    super('External HTTP request failed.');
  }
}
// Dos días de clima con tres variables caben ampliamente en 64 KiB; solar necesita menos de 16 KiB.
const responseLimits = { weather: 64 * 1024, sun: 16 * 1024 };
export function createJsonHttpClient(
  logger: (entry: { provider: Provider; code: string; status?: number }) => void = (entry) =>
    console.error(entry),
): JsonHttpClient {
  const client = axios.create({
    adapter: 'http',
    timeout: 10000,
    maxRedirects: 0,
    maxBodyLength: 0,
    responseType: 'stream',
    transformResponse: [],
    validateStatus: () => true,
    proxy: false,
    transitional: { clarifyTimeoutError: true },
  });
  return async (url, request) => {
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), 10000);
    timer.unref();
    let stream: Readable | undefined;
    let status: number | undefined;
    try {
      signal.throwIfAborted();
      const response = await client.get<Readable>(url, { params: request.params, signal });
      status = response.status;
      stream = response.data;
      if (!(stream instanceof Readable)) throw new ProviderHttpError('INVALID_JSON', status);
      stream.on('error', () => undefined);
      if (status < 200 || status >= 300) throw new ProviderHttpError('HTTP_STATUS', status);
      const max = responseLimits[request.provider];
      if (Number(response.headers['content-length']) > max)
        throw new ProviderHttpError('RESPONSE_SIZE', status);
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        signal.throwIfAborted();
        if (!Buffer.isBuffer(chunk)) throw new ProviderHttpError('INVALID_JSON', status);
        bytes += chunk.length;
        if (bytes > max) throw new ProviderHttpError('RESPONSE_SIZE', status);
        chunks.push(chunk);
      }
      signal.throwIfAborted();
      try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        throw new ProviderHttpError('INVALID_JSON', status);
      }
    } catch (cause) {
      const error =
        cause instanceof ProviderHttpError
          ? cause
          : new ProviderHttpError(
              signal.aborted
                ? controller.signal.aborted
                  ? 'TIMEOUT'
                  : 'CANCELLED'
                : axios.isAxiosError(cause) &&
                    ['ETIMEDOUT', 'ECONNABORTED'].includes(cause.code ?? '')
                  ? 'TIMEOUT'
                  : 'NETWORK',
              status,
            );
      try {
        logger({ provider: request.provider, code: error.code, status: error.status });
      } catch {
        /* El logger no modifica el contrato. */
      }
      throw error;
    } finally {
      clearTimeout(timer);
      stream?.destroy();
      controller.abort();
    }
  };
}
