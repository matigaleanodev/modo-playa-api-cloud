import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { TokenService } from '../packages/runtime/src/identity/tokens.ts';
import { ownerId, userId, testConfiguration } from './identity-fixture.ts';

it('mantiene formato JWT HS256, claims y defaults sin imponer ACCESS global', () => {
  const tokens = new TokenService(testConfiguration.secretKey);
  // Firma independiente con el formato emitido por JwtService/jsonwebtoken del original.
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      ownerId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    }),
  ).toString('base64url');
  const unsigned = header + '.' + payload;
  const signature = createHmac('sha256', testConfiguration.secretKey)
    .update(unsigned)
    .digest('base64url');
  expect(tokens.authenticate('Bearer ' + unsigned + '.' + signature)).toEqual({
    userId,
    ownerId,
    role: 'OWNER',
    purpose: 'ACCESS',
  });
  const cloud = tokens.sign(
    { sub: userId, ownerId, role: 'SUPERADMIN', purpose: 'REFRESH' },
    { expiresIn: '3d' },
  );
  const [cloudHeader, cloudPayload, cloudSignature] = cloud.split('.');
  expect(JSON.parse(Buffer.from(cloudHeader!, 'base64url').toString())).toEqual({
    alg: 'HS256',
    typ: 'JWT',
  });
  expect(cloudSignature).toBe(
    createHmac('sha256', testConfiguration.secretKey)
      .update(cloudHeader + '.' + cloudPayload)
      .digest('base64url'),
  );
  expect(tokens.authenticate('bearer ' + cloud).purpose).toBe('REFRESH');
  expect(() => tokens.authenticate('Bearer ' + cloud + 'x')).toThrow();
  expect(() => new TokenService('')).toThrow('JWT configuration required.');
});
