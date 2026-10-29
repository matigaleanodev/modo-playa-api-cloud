import * as bcrypt from 'bcrypt';
import type {
  IdentifierInput as AuthIdentifierDto,
  LoginInput as LoginDto,
  CodeInput as ActivateDto,
  CodeInput as VerifyResetCodeDto,
  PasswordInput as SetInitialPasswordDto,
  PasswordInput as ResetPasswordDto,
  ChangePasswordInput as ChangePasswordDto,
  UpdateMeInput as UpdateMyProfileDto,
  AuthResponse,
  AuthUserResponse,
} from '@modo-playa/contracts/identity';
import type { Users } from './users.repository.ts';
import type { JwtPayload, RequestUser, User } from './models.ts';
import { AuthException, ERROR_CODES } from './errors.ts';
import type { TokenService } from './tokens.ts';
import type { Mail } from './mail.ts';
import type { MediaUrlBuilder } from './media-urls.ts';

export interface AuthConfiguration {
  bcryptRounds: number;
  superadminOwnerId?: string;
}

export class AuthService {
  constructor(
    private readonly usersService: Users,
    private readonly jwtService: TokenService,
    private readonly config: AuthConfiguration,
    private readonly mailService: Mail,
    private readonly mediaUrlBuilder: MediaUrlBuilder,
  ) {}
  async requestActivation(identifier: string): Promise<void> {
    const normalized = identifier.toLowerCase();

    const user = normalized.includes('@')
      ? await this.usersService.findByEmail(normalized)
      : await this.usersService.findByUsername(normalized);

    if (user && user.isActive && !user.isPasswordSet) {
      const code = this.generateSixDigitCode();

      const saltRounds = this.config.bcryptRounds;
      const codeHash = await bcrypt.hash(code, saltRounds);

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await this.usersService.setResetPasswordData(user._id.toString(), codeHash, expiresAt);

      try {
        await this.mailService.sendActivationCode(user.email, code);
      } catch (error) {
        void error;
      }
    }
  }

  async activate(dto: ActivateDto): Promise<{ accessToken: string }> {
    const identifier = dto.identifier.toLowerCase();

    const user = identifier.includes('@')
      ? await this.usersService.findByEmail(identifier)
      : await this.usersService.findByUsername(identifier);

    if (!user || !user.resetPasswordCodeHash || !user.resetPasswordExpiresAt) {
      throw new AuthException('Invalid code', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      throw new AuthException('User disabled', ERROR_CODES.USER_DISABLED);
    }

    if (user.isPasswordSet) {
      throw new AuthException('Password already set', ERROR_CODES.PASSWORD_ALREADY_SET);
    }

    if (user.resetPasswordExpiresAt.getTime() < Date.now()) {
      throw new AuthException('Code expired', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (user.resetPasswordAttempts >= 5) {
      throw new AuthException('Too many attempts', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const isCodeValid = await bcrypt.compare(dto.code, user.resetPasswordCodeHash);

    if (!isCodeValid) {
      await this.usersService.incrementResetAttempts(user._id.toString());

      throw new AuthException('Invalid code', ERROR_CODES.INVALID_CREDENTIALS);
    }

    await this.usersService.clearResetData(user._id.toString());

    const role = this.resolveUserRole(user);

    const payload: JwtPayload = {
      sub: user._id.toString(),
      ownerId: user.ownerId.toString(),
      role,
      purpose: 'PASSWORD_SETUP',
    };

    const token = this.jwtService.sign(payload, {
      expiresIn: '30m',
    });

    return {
      accessToken: token,
    };
  }

  async setPassword(user: RequestUser, dto: SetInitialPasswordDto): Promise<AuthResponse> {
    if (user.purpose !== 'PASSWORD_SETUP') {
      throw new AuthException('Invalid token purpose', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const dbUser = await this.usersService.findById(user.ownerId, user.userId);

    if (!dbUser) {
      throw new AuthException('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    if (!dbUser.isActive) {
      throw new AuthException('User disabled', ERROR_CODES.USER_DISABLED);
    }

    if (dbUser.isPasswordSet) {
      throw new AuthException('Password already set', ERROR_CODES.PASSWORD_ALREADY_SET);
    }

    const saltRounds = this.config.bcryptRounds;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    await this.usersService.setPassword(user.ownerId, user.userId, passwordHash);

    const role = this.resolveUserRole(dbUser);

    const payload: JwtPayload = {
      sub: dbUser._id.toString(),
      ownerId: dbUser.ownerId.toString(),
      role,
      purpose: 'ACCESS',
    };

    const refreshPayload: JwtPayload = {
      ...payload,
      purpose: 'REFRESH',
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '3d',
    });

    return this.buildAuthResponse(dbUser, accessToken, refreshToken);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const identifier = dto.identifier.toLowerCase();

    const user = identifier.includes('@')
      ? await this.usersService.findByEmail(identifier)
      : await this.usersService.findByUsername(identifier);

    if (!user) {
      throw new AuthException('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      throw new AuthException('User disabled', ERROR_CODES.USER_DISABLED);
    }

    if (!user.isPasswordSet || !user.passwordHash) {
      throw new AuthException('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      throw new AuthException('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const role = this.resolveUserRole(user);

    const payload: JwtPayload = {
      sub: user._id.toString(),
      ownerId: user.ownerId.toString(),
      role,
      purpose: 'ACCESS',
    };

    const refreshPayload: JwtPayload = {
      ...payload,
      purpose: 'REFRESH',
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '3d',
    });

    return this.buildAuthResponse(user, accessToken, refreshToken);
  }

  async refresh(user: RequestUser): Promise<AuthResponse> {
    if (user.purpose !== 'REFRESH') {
      throw new AuthException('Invalid token purpose', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const dbUser = await this.usersService.findById(user.ownerId, user.userId);

    if (!dbUser) {
      throw new AuthException('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (!dbUser.isActive) {
      throw new AuthException('User disabled', ERROR_CODES.USER_DISABLED);
    }

    const role = this.resolveUserRole(dbUser);

    const accessPayload: JwtPayload = {
      sub: dbUser._id.toString(),
      ownerId: dbUser.ownerId.toString(),
      role,
      purpose: 'ACCESS',
    };

    const refreshPayload: JwtPayload = {
      sub: dbUser._id.toString(),
      ownerId: dbUser.ownerId.toString(),
      role,
      purpose: 'REFRESH',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '3d',
    });

    return this.buildAuthResponse(dbUser, accessToken, refreshToken);
  }

  async changePassword(user: RequestUser, dto: ChangePasswordDto): Promise<AuthResponse> {
    if (user.purpose !== 'ACCESS') {
      throw new AuthException('Invalid token purpose', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const dbUser = await this.usersService.findById(user.ownerId, user.userId);

    if (!dbUser) {
      throw new AuthException('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (!dbUser.isActive) {
      throw new AuthException('User disabled', ERROR_CODES.USER_DISABLED);
    }

    if (!dbUser.passwordHash) {
      throw new AuthException('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await bcrypt.compare(dto.currentPassword, dbUser.passwordHash);

    if (!isPasswordValid) {
      throw new AuthException('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const saltRounds = this.config.bcryptRounds;
    const newPasswordHash = await bcrypt.hash(dto.newPassword, saltRounds);

    await this.usersService.setPassword(user.ownerId, user.userId, newPasswordHash);

    const role = this.resolveUserRole(dbUser);

    const accessPayload: JwtPayload = {
      sub: dbUser._id.toString(),
      ownerId: dbUser.ownerId.toString(),
      role,
      purpose: 'ACCESS',
    };

    const refreshPayload: JwtPayload = {
      ...accessPayload,
      purpose: 'REFRESH',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: '3d',
    });

    return this.buildAuthResponse(dbUser, accessToken, refreshToken);
  }

  async forgotPassword(dto: AuthIdentifierDto): Promise<{ message: string }> {
    const identifier = dto.identifier.toLowerCase();

    const user = identifier.includes('@')
      ? await this.usersService.findByEmail(identifier)
      : await this.usersService.findByUsername(identifier);

    if (user) {
      const code = this.generateSixDigitCode();

      const saltRounds = this.config.bcryptRounds;
      const codeHash = await bcrypt.hash(code, saltRounds);

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await this.usersService.setResetPasswordData(user._id.toString(), codeHash, expiresAt);
      try {
        await this.mailService.sendResetCode(user.email, code);
      } catch (error) {
        void error;
      }
    }

    return {
      message: 'If the user exists, a verification code has been sent.',
    };
  }

  async verifyResetCode(dto: VerifyResetCodeDto): Promise<{ accessToken: string }> {
    const identifier = dto.identifier.toLowerCase();

    const user = identifier.includes('@')
      ? await this.usersService.findByEmail(identifier)
      : await this.usersService.findByUsername(identifier);

    if (!user || !user.resetPasswordCodeHash || !user.resetPasswordExpiresAt) {
      throw new AuthException('Invalid code', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (user.resetPasswordExpiresAt.getTime() < Date.now()) {
      throw new AuthException('Code expired', ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (user.resetPasswordAttempts >= 5) {
      throw new AuthException('Too many attempts', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const isCodeValid = await bcrypt.compare(dto.code, user.resetPasswordCodeHash);

    if (!isCodeValid) {
      await this.usersService.incrementResetAttempts(user._id.toString());

      throw new AuthException('Invalid code', ERROR_CODES.INVALID_CREDENTIALS);
    }

    await this.usersService.clearResetData(user._id.toString());

    const role = this.resolveUserRole(user);

    const payload: JwtPayload = {
      sub: user._id.toString(),
      ownerId: user.ownerId.toString(),
      role,
      purpose: 'PASSWORD_SETUP',
    };

    const token = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    return {
      accessToken: token,
    };
  }

  async resetPassword(user: RequestUser, dto: ResetPasswordDto): Promise<{ message: string }> {
    if (user.purpose !== 'PASSWORD_SETUP') {
      throw new AuthException('Invalid token purpose', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const dbUser = await this.usersService.findById(user.ownerId, user.userId);

    if (!dbUser || !dbUser.isActive) {
      throw new AuthException('Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const saltRounds = this.config.bcryptRounds;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    await this.usersService.setPassword(user.ownerId, user.userId, passwordHash);

    try {
      await this.mailService.sendPasswordChanged(dbUser.email);
    } catch (error) {
      void error;
    }

    return {
      message: 'Password updated successfully. Please login.',
    };
  }

  private buildAuthResponse(user: User, accessToken: string, refreshToken: string): AuthResponse {
    return {
      accessToken,
      refreshToken,
      user: this.toAuthUserResponse(user),
    };
  }

  async me(user: RequestUser): Promise<AuthUserResponse> {
    const dbUser = await this.usersService.findById(user.ownerId, user.userId);

    return this.toAuthUserResponse(dbUser);
  }

  async updateMe(user: RequestUser, dto: UpdateMyProfileDto): Promise<AuthUserResponse> {
    if (user.purpose !== 'ACCESS') {
      throw new AuthException('Invalid token purpose', ERROR_CODES.INVALID_CREDENTIALS);
    }

    const updated = await this.usersService.updateUser(user.ownerId, user.userId, dto);
    return this.toAuthUserResponse(updated);
  }

  private resolveUserRole(user: User): 'OWNER' | 'SUPERADMIN' {
    const superadminOwnerId = this.config.superadminOwnerId;

    if (superadminOwnerId && user.ownerId.toString() === superadminOwnerId) {
      return 'SUPERADMIN';
    }

    return 'OWNER';
  }

  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private toAuthUserResponse(user: User): AuthUserResponse {
    const role = this.resolveUserRole(user);
    const profileImage = user.profileImage
      ? {
          imageId: user.profileImage.imageId,
          key: user.profileImage.key,
          width: user.profileImage.width,
          height: user.profileImage.height,
          bytes: user.profileImage.bytes,
          mime: user.profileImage.mime,
          createdAt: new Date(user.profileImage.createdAt).toISOString(),
          url: this.mediaUrlBuilder.buildPublicUrl(user.profileImage.key),
          variants: this.mediaUrlBuilder.buildLodgingVariants(user.profileImage.key),
        }
      : undefined;

    return {
      id: user._id.toString(),
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      avatarUrl: profileImage?.url ?? user.avatarUrl,
      profileImage,
      phone: user.phone,
      role,
    };
  }
}
