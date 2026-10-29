import { Resend } from 'resend';
import type { IdentityConfiguration } from './configuration.ts';

export type EmailSender = (message: {
  from: string;
  to: string;
  subject: string;
  html: string;
}) => Promise<unknown>;
export class MailService {
  constructor(
    private readonly send: EmailSender,
    private readonly emailFrom: string,
  ) {}
  async sendActivationCode(email: string, code: string): Promise<void> {
    await this.send({
      from: `Modo Playa <${this.emailFrom}>`,
      to: email,
      subject: 'Activación de tu cuenta en Modo Playa',
      html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Activación de cuenta</h2>
        <p>Tu código de activación es:</p>
        <h1 style="letter-spacing: 4px;">${code}</h1>
        <p>Este código vence en 15 minutos.</p>
        <p>Si no solicitaste esta activación, podés ignorar este mensaje.</p>
      </div>
    `,
    });
  }

  async sendResetCode(email: string, code: string): Promise<void> {
    await this.send({
      from: `Modo Playa <${this.emailFrom}>`,
      to: email,
      subject: 'Código de recuperación de contraseña',
      html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Recuperación de contraseña</h2>
        <p>Tu código de verificación es:</p>
        <h1>${code}</h1>
        <p>Este código vence en 15 minutos.</p>
        <p>Si no solicitaste este cambio, podés ignorar este mensaje.</p>
      </div>
    `,
    });
  }

  async sendPasswordChanged(email: string): Promise<void> {
    await this.send({
      from: `Modo Playa <${this.emailFrom}>`,
      to: email,
      subject: 'Tu contraseña fue modificada',
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Contraseña actualizada</h2>
          <p>Tu contraseña fue cambiada correctamente.</p>
          <p>Si no fuiste vos, contactate inmediatamente.</p>
        </div>
      `,
    });
  }
}

export type Mail = Pick<
  MailService,
  'sendActivationCode' | 'sendResetCode' | 'sendPasswordChanged'
>;
export function createResendMail(
  config: Pick<IdentityConfiguration, 'resendApiKey' | 'resendFromEmail'>,
  signal: AbortSignal,
) {
  const client = new Resend(config.resendApiKey);
  const request = client.fetchRequest.bind(client);
  client.fetchRequest = (path, options = {}) =>
    request(path, {
      ...options,
      signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
    });
  return new MailService((message) => client.emails.send(message), config.resendFromEmail);
}
