import jwt, { type SignOptions } from 'jsonwebtoken';
import type { JwtPayload, RequestUser } from './models.ts';
import { HttpException } from './errors.ts';

export class TokenService {
  constructor(private readonly key: string) {
    if (!key.trim()) throw new Error('JWT configuration required.');
  }
  sign(payload: JwtPayload, options: Pick<SignOptions, 'expiresIn'>) {
    return jwt.sign(payload, this.key, { algorithm: 'HS256', ...options });
  }
  authenticate(authorization: string | undefined): RequestUser {
    try {
      // Passport extrae el primer par esquema/token y no exige un propósito global.
      const parts = authorization?.match(/(\S+)\s+(\S+)/);
      if (!parts || parts[1]!.toLowerCase() !== 'bearer') throw new Error('Missing bearer.');
      const payload = jwt.verify(parts[2]!, this.key, {
        algorithms: ['HS256', 'HS384', 'HS512'],
      }) as JwtPayload;
      return {
        userId: payload.sub,
        ownerId: payload.ownerId,
        role: payload.role ?? 'OWNER',
        purpose: payload.purpose ?? 'ACCESS',
      };
    } catch {
      throw new HttpException(401, { message: 'Unauthorized', statusCode: 401 });
    }
  }
}
