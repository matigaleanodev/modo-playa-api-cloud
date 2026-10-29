import { HttpException } from '../identity/errors.ts';
export class ProviderUnavailable extends HttpException {
  constructor(message: string) {
    super(503, { message, error: 'Service Unavailable', statusCode: 503 });
  }
}
