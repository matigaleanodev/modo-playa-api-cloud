import { afterEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { fixture, ownerId, userId, testConfiguration } from './identity-fixture.ts';
import { UsersMapper } from '../packages/runtime/src/identity/users.mapper.ts';

afterEach(() => vi.restoreAllMocks());
describe('identidad trasladada del servicio original', () => {
  it('login normaliza el identificador y devuelve sesión sin hashes ni efectos inventados', async () => {
    const f = await fixture();
    const result = await f.request('/api/auth/login', 'POST', {
      identifier: '  OwNeR  ',
      password: 'Password123',
    });
    expect(result.status).toBe(201);
    expect(f.users.findByUsername).toHaveBeenCalledWith('owner');
    const access = jwt.verify(
      result.body.accessToken,
      testConfiguration.secretKey,
    ) as jwt.JwtPayload;
    const refresh = jwt.verify(
      result.body.refreshToken,
      testConfiguration.secretKey,
    ) as jwt.JwtPayload;
    expect(access).toMatchObject({ sub: userId, ownerId, role: 'OWNER', purpose: 'ACCESS' });
    expect(access.exp! - access.iat!).toBe(900);
    expect(refresh.exp! - refresh.iat!).toBe(259200);
    expect(refresh.purpose).toBe('REFRESH');
    expect(result.body.user).not.toHaveProperty('passwordHash');
    expect(result.body.user).not.toHaveProperty('resetPasswordCodeHash');
    expect(f.record.lastLoginAt).toBeUndefined();
    expect(f.mail.sendPasswordChanged).not.toHaveBeenCalled();
  });
  it('rechaza credenciales, usuario inexistente, deshabilitado y sin password', async () => {
    const f = await fixture();
    expect(
      (await f.request('/api/auth/login', 'POST', { identifier: 'owner', password: 'incorrecta' }))
        .body,
    ).toEqual({ message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    vi.mocked(f.users.findByUsername).mockResolvedValueOnce(null);
    expect(
      (await f.auth.login({ identifier: 'missing', password: 'Password123' }).catch((e) => e)).code,
    ).toBe('INVALID_CREDENTIALS');
    f.record.isActive = false;
    await expect(
      f.auth.login({ identifier: 'owner', password: 'Password123' }),
    ).rejects.toMatchObject({ code: 'USER_DISABLED' });
    f.record.isActive = true;
    f.record.isPasswordSet = false;
    await expect(
      f.auth.login({ identifier: 'owner', password: 'Password123' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });
  it('refresh exige propósito REFRESH y rechaza expiración/firma sin cambiar el error Passport', async () => {
    const f = await fixture();
    const result = await f.request(
      '/api/auth/refresh',
      'POST',
      { ignored: true },
      f.token('REFRESH'),
    );
    expect(result.status).toBe(201);
    expect(result.body.refreshToken).toBeDefined();
    expect((await f.request('/api/auth/refresh', 'POST', {}, f.token())).body).toEqual({
      message: 'Invalid token purpose',
      code: 'INVALID_CREDENTIALS',
    });
    const expired = jwt.sign(
      { sub: userId, ownerId, purpose: 'REFRESH' },
      testConfiguration.secretKey,
      { expiresIn: -1 },
    );
    expect(await f.request('/api/auth/refresh', 'POST', {}, expired)).toEqual({
      status: 401,
      body: { message: 'Unauthorized', statusCode: 401 },
    });
    f.record.isActive = false;
    expect((await f.request('/api/auth/refresh', 'POST', {}, f.token('REFRESH'))).body.code).toBe(
      'USER_DISABLED',
    );
  });
  it('solicita activación solo para activo sin password, guarda código y consume el setup de 30 minutos', async () => {
    const f = await fixture();
    f.record.isPasswordSet = false;
    f.record.resetPasswordAttempts = 4;
    vi.spyOn(Math, 'random').mockReturnValue(0.123456);
    const requested = await f.request('/api/auth/request-activation', 'POST', {
      identifier: ' OWNER ',
    });
    expect(requested).toEqual({
      status: 201,
      body: { message: 'Si el usuario existe, se envio un codigo de activacion' },
    });
    expect(f.record.resetPasswordAttempts).toBe(0);
    const code = f.mail.sendActivationCode.mock.calls[0]![1];
    expect(code).toMatch(/^\d{6}$/);
    expect(await bcrypt.compare(code, f.record.resetPasswordCodeHash!)).toBe(true);
    expect(f.record.resetPasswordExpiresAt!.getTime() - Date.now()).toBeGreaterThan(890000);
    const activated = await f.request('/api/auth/activate', 'POST', { identifier: 'OWNER', code });
    expect(activated.status).toBe(201);
    const payload = jwt.decode(activated.body.accessToken) as jwt.JwtPayload;
    expect(payload.purpose).toBe('PASSWORD_SETUP');
    expect(payload.exp! - payload.iat!).toBe(1800);
    expect(f.record.resetPasswordCodeHash).toBeNull();
    const setup = await f.request(
      '/api/auth/set-password',
      'POST',
      { password: 'NuevaClave123' },
      activated.body.accessToken,
    );
    expect(setup.status).toBe(201);
    expect(f.record.isPasswordSet).toBe(true);
    // El original responde con el documento leído antes de actualizar los flags.
    expect(await bcrypt.compare('NuevaClave123', f.record.passwordHash!)).toBe(true);
    expect(
      (
        await f.request(
          '/api/auth/set-password',
          'POST',
          { password: 'NuevaClave123' },
          activated.body.accessToken,
        )
      ).body.code,
    ).toBe('PASSWORD_ALREADY_SET');
    expect(f.mail.sendPasswordChanged).not.toHaveBeenCalled();
  });
  it('conserva expiración, máximo de intentos y orden de controles en activación', async () => {
    const f = await fixture();
    f.record.isPasswordSet = false;
    await f.auth.requestActivation('owner');
    const code = f.mail.sendActivationCode.mock.calls[0]![1];
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(f.auth.activate({ identifier: 'owner', code: '000000' })).rejects.toMatchObject({
        message: 'Invalid code',
      });
    expect(f.record.resetPasswordAttempts).toBe(5);
    await expect(f.auth.activate({ identifier: 'owner', code })).rejects.toMatchObject({
      message: 'Too many attempts',
    });
    await f.auth.requestActivation('owner');
    expect(f.record.resetPasswordAttempts).toBe(0);
    f.record.resetPasswordExpiresAt = new Date(Date.now() - 1);
    await expect(f.auth.activate({ identifier: 'owner', code })).rejects.toMatchObject({
      message: 'Code expired',
    });
    f.record.isActive = false;
    await expect(f.auth.activate({ identifier: 'owner', code })).rejects.toMatchObject({
      code: 'USER_DISABLED',
    });
    const calls = f.mail.sendActivationCode.mock.calls.length;
    await f.auth.requestActivation('owner');
    expect(f.mail.sendActivationCode).toHaveBeenCalledTimes(calls);
  });
  it('recuperación conserva respuesta genérica y best effort, setup de 15 minutos y aviso al resetear', async () => {
    const f = await fixture();
    f.mail.sendResetCode.mockRejectedValueOnce(new Error('simulated email failure'));
    expect(
      (await f.request('/api/auth/forgot-password', 'POST', { identifier: 'owner' })).body,
    ).toEqual({ message: 'If the user exists, a verification code has been sent.' });
    const code = f.mail.sendResetCode.mock.calls[0]![1];
    const result = await f.request('/api/auth/verify-reset-code', 'POST', {
      identifier: 'owner',
      code,
    });
    const payload = jwt.decode(result.body.accessToken) as jwt.JwtPayload;
    expect(payload.exp! - payload.iat!).toBe(900);
    expect(f.record.resetPasswordExpiresAt).toBeNull();
    f.mail.sendPasswordChanged.mockRejectedValueOnce(new Error('simulated email failure'));
    expect(
      await f.request(
        '/api/auth/reset-password',
        'POST',
        { password: 'Recuperada123' },
        result.body.accessToken,
      ),
    ).toEqual({ status: 201, body: { message: 'Password updated successfully. Please login.' } });
    expect(f.mail.sendPasswordChanged).toHaveBeenCalledWith(f.record.email);
    expect(await bcrypt.compare('Recuperada123', f.record.passwordHash!)).toBe(true);
    vi.mocked(f.users.findByUsername).mockResolvedValueOnce(null);
    await expect(f.auth.forgotPassword({ identifier: 'missing' })).resolves.toEqual({
      message: 'If the user exists, a verification code has been sent.',
    });
  });
  it('recuperación admite pedir/verificar código deshabilitado pero reset rechaza al usuario', async () => {
    const f = await fixture();
    f.record.isActive = false;
    await f.auth.forgotPassword({ identifier: 'owner' });
    const code = f.mail.sendResetCode.mock.calls[0]![1];
    const setup = await f.auth.verifyResetCode({ identifier: 'owner', code });
    const result = await f.request(
      '/api/auth/reset-password',
      'POST',
      { password: 'Recuperada123' },
      setup.accessToken,
    );
    expect(result).toEqual({
      status: 401,
      body: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
    });
  });
  it('verificar recuperación preserva intentos/expiración y no consume códigos fallidos', async () => {
    const f = await fixture();
    await expect(
      f.auth.verifyResetCode({ identifier: 'owner', code: '123456' }),
    ).rejects.toMatchObject({ message: 'Invalid code' });
    await f.auth.forgotPassword({ identifier: 'owner' });
    const hash = f.record.resetPasswordCodeHash;
    await expect(
      f.auth.verifyResetCode({ identifier: 'owner', code: '000000' }),
    ).rejects.toMatchObject({ message: 'Invalid code' });
    expect(f.record.resetPasswordAttempts).toBe(1);
    expect(f.record.resetPasswordCodeHash).toBe(hash);
    f.record.resetPasswordAttempts = 5;
    await expect(
      f.auth.verifyResetCode({ identifier: 'owner', code: '000000' }),
    ).rejects.toMatchObject({ message: 'Too many attempts' });
    f.record.resetPasswordExpiresAt = new Date(Date.now() - 1);
    await expect(
      f.auth.verifyResetCode({ identifier: 'owner', code: '000000' }),
    ).rejects.toMatchObject({ message: 'Code expired' });
  });
  it('cambio de contraseña exige ACCESS/clave actual y no agrega correos o lastLoginAt', async () => {
    const f = await fixture();
    const body = { currentPassword: 'incorrecta', newPassword: 'NuevaClave123' };
    expect((await f.request('/api/auth/change-password', 'POST', body, f.token())).body.code).toBe(
      'INVALID_CREDENTIALS',
    );
    body.currentPassword = 'Password123';
    expect(
      (await f.request('/api/auth/change-password', 'POST', body, f.token('REFRESH'))).body.message,
    ).toBe('Invalid token purpose');
    expect((await f.request('/api/auth/change-password', 'POST', body, f.token())).status).toBe(
      201,
    );
    expect(await bcrypt.compare('NuevaClave123', f.record.passwordHash!)).toBe(true);
    expect(f.record.lastLoginAt).toBeUndefined();
    expect(f.mail.sendPasswordChanged).not.toHaveBeenCalled();
  });
  it('me conserva metadata de imagen distinta de users y no impone propósito/activo nuevos', async () => {
    const f = await fixture();
    f.record.isActive = false;
    f.record.profileImage = {
      imageId: 'image-1',
      key: 'users/u/profile/i/original.webp',
      width: 100,
      height: 80,
      bytes: 1024,
      mime: 'image/webp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const result = await f.request('/api/auth/me', 'GET', undefined, f.token('REFRESH'));
    expect(result.status).toBe(200);
    expect(result.body.avatarUrl).toBe(
      'https://media.example.test/users/u/profile/i/original.webp',
    );
    expect(result.body.profileImage.variants.thumb).toContain('/cdn-cgi/image/');
    const mapped = UsersMapper.toResponse(f.record);
    expect(mapped.avatarUrl).toBe(f.record.profileImage.key);
    expect(mapped.profileImage!.variants).toBeUndefined();
    expect(result.body).not.toHaveProperty('isActive');
    expect(mapped).not.toHaveProperty('ownerId');
    expect(JSON.stringify([mapped, result.body])).not.toMatch(/passwordHash|resetPassword/);
  });
  it('PATCH me valida y transforma sin ampliar campos; exige ACCESS y delega solo al perfil propio', async () => {
    const f = await fixture();
    vi.mocked(f.users.updateUser).mockResolvedValue(f.record);
    expect(
      (await f.request('/api/auth/me', 'PATCH', { firstName: '  Ana  ', phone: null }, f.token()))
        .status,
    ).toBe(200);
    expect(f.users.updateUser).toHaveBeenCalledWith(ownerId, userId, {
      firstName: 'Ana',
      phone: null,
    });
    expect((await f.request('/api/auth/me', 'PATCH', {}, f.token('REFRESH'))).body.message).toBe(
      'Invalid token purpose',
    );
    expect(
      (await f.request('/api/auth/me', 'PATCH', { avatarUrl: 'https://example.test' }, f.token()))
        .body,
    ).toEqual({ message: 'property avatarUrl should not exist', code: 'REQUEST_VALIDATION_ERROR' });
  });
  it('deriva SUPERADMIN del owner configurado y conserva controles de deshabilitado/purpose de setup y cambio', async () => {
    const f = await fixture();
    f.record.ownerId = new Types.ObjectId(testConfiguration.superadminOwnerId);
    const session = await f.auth.login({ identifier: 'owner', password: 'Password123' });
    expect(session.user.role).toBe('SUPERADMIN');
    expect((jwt.decode(session.accessToken) as jwt.JwtPayload).role).toBe('SUPERADMIN');
    f.record.ownerId = new Types.ObjectId(ownerId);
    await expect(
      f.auth.setPassword(f.current, { password: 'NuevaClave123' }),
    ).rejects.toMatchObject({ message: 'Invalid token purpose' });
    f.record.isActive = false;
    await expect(
      f.auth.setPassword(
        { ...f.current, purpose: 'PASSWORD_SETUP' },
        { password: 'NuevaClave123' },
      ),
    ).rejects.toMatchObject({ code: 'USER_DISABLED' });
    await expect(
      f.auth.changePassword(f.current, {
        currentPassword: 'Password123',
        newPassword: 'NuevaClave123',
      }),
    ).rejects.toMatchObject({ code: 'USER_DISABLED' });
  });
});
