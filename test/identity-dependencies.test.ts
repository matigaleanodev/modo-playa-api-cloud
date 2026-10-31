import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mongoose';
import { database } from '../packages/runtime/src/identity/database.ts';
import { runtimeConfiguration } from '../packages/runtime/src/identity/configuration.ts';
import { MailService, createResendMail } from '../packages/runtime/src/identity/mail.ts';
import { userSchema } from '../packages/runtime/src/identity/models.ts';
import { CloudflareMediaUrlBuilderService } from '../packages/runtime/src/identity/media-urls.ts';

describe('dependencias reales sustituibles', () => {
  it('carga JSON sensible + entorno público por referencias prod, recupera fallos y comparte lectura', async () => {
    const principal = '/modo-playa/prod/app-properties';
    const email = '/modo-playa/prod/email';
    const read = vi
      .fn(async (reference: string) =>
        JSON.stringify(
          reference === principal
            ? { MONGO_URI: 'mongodb://127.0.0.1:1/simulated', SECRET_KEY: 'simulated-key' }
            : { RESEND_API_KEY: 'simulated-mail-key' },
        ),
      )
      .mockRejectedValueOnce(new Error('simulated sensitive failure'));
    const configuration = runtimeConfiguration(
      {
        APP_PARAMETER_NAME: principal,
        EMAIL_PARAMETER_NAME: email,
        RESEND_FROM_EMAIL: 'test@example.test',
      },
      read,
    );
    expect(read).not.toHaveBeenCalled();
    await expect(configuration()).rejects.toThrow('Runtime configuration unavailable.');
    const [a, b] = await Promise.all([configuration(), configuration()]);
    expect(a).toBe(b);
    expect(a).toMatchObject({
      mongoUri: 'mongodb://127.0.0.1:1/simulated',
      secretKey: 'simulated-key',
      resendApiKey: 'simulated-mail-key',
      resendFromEmail: 'test@example.test',
    });
    expect(read.mock.calls.map(([reference]) => reference)).toEqual([principal, principal, email]);
    await expect(runtimeConfiguration({})()).rejects.toThrow('Runtime configuration unavailable.');
  });
  it('la conexión se difiere, comparte apertura y se recupera cerrando la apertura fallida', async () => {
    const close = vi.fn(async () => {});
    const ready = { asPromise: vi.fn(), close };
    ready.asPromise
      .mockRejectedValueOnce(new Error('simulated sensitive database error'))
      .mockResolvedValue(ready);
    const open = vi.fn((_uri: string, _options: object) => ready as unknown as Connection);
    const db = database(
      async () => 'mongodb://127.0.0.1:1/simulated',
      open as unknown as typeof import('mongoose').createConnection,
    );
    expect(open).not.toHaveBeenCalled();
    await expect(db.connect()).rejects.toThrow('Database unavailable.');
    expect(close).toHaveBeenCalledTimes(1);
    const [a, b] = await Promise.all([db.connect(), db.connect()]);
    expect(a).toBe(b);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]![1]).toMatchObject({
      autoIndex: false,
      autoCreate: false,
      bufferCommands: false,
      minPoolSize: 0,
      maxPoolSize: 4,
      serverSelectionTimeoutMS: 2000,
      timeoutMS: 3000,
    });
    expect(userSchema.get('collection')).toBe('users');
    expect(userSchema.get('timestamps')).toBe(true);
    await db.close();
  });
  it('correo mantiene los tres efectos mediante SDK/double y deadline sin red real', async () => {
    const send = vi.fn(
      async (
        _message: Parameters<import('../packages/runtime/src/identity/mail.ts').EmailSender>[0],
      ) => {},
    );
    const mail = new MailService(send, 'sender@example.test');
    await mail.sendActivationCode('user@example.test', '123456');
    await mail.sendResetCode('user@example.test', '654321');
    await mail.sendPasswordChanged('user@example.test');
    expect(send.mock.calls.map(([message]) => message.subject)).toEqual([
      'Activación de tu cuenta en Modo Playa',
      'Código de recuperación de contraseña',
      'Tu contraseña fue modificada',
    ]);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"data":{"id":"simulated"}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      const sdk = createResendMail(
        { resendApiKey: 'simulated-key', resendFromEmail: 'sender@example.test' },
        AbortSignal.timeout(1000),
      );
      await sdk.sendResetCode('user@example.test', '123456');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    } finally {
      fetch.mockRestore();
    }
  });
  it('el mapper puro conserva URLs firmadas/externas, encoding y variantes sin storage', () => {
    const urls = new CloudflareMediaUrlBuilderService({
      publicBaseUrl: 'https://media.example.test/',
      r2Bucket: 'bucket',
      r2Endpoint: 'https://storage.example.test',
    });
    expect(
      urls.buildPublicUrl(
        'https://storage.example.test/bucket/users/a b.webp?X-Amz-Signature=simulated',
      ),
    ).toBe('https://media.example.test/users/a%2520b.webp');
    expect(urls.buildPublicUrl('https://other.example.test/a.webp')).toBe(
      'https://other.example.test/a.webp',
    );
    expect(urls.buildLodgingVariants('https://other.example.test/a.webp').thumb).toBe(
      'https://other.example.test/a.webp',
    );
    const direct = new CloudflareMediaUrlBuilderService({
      publicBaseUrl: 'https://test.r2.dev',
      r2Bucket: '',
      r2Endpoint: '',
    });
    expect(direct.buildLodgingVariants('/users/a.webp')).toEqual({
      thumb: 'https://test.r2.dev/users/a.webp',
      card: 'https://test.r2.dev/users/a.webp',
      hero: 'https://test.r2.dev/users/a.webp',
    });
  });
});
