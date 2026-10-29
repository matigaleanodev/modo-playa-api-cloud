import { Types } from 'mongoose';
import type {
  CreateUserInput,
  UpdateUserInput,
  UsersQueryInput,
} from '@modo-playa/contracts/identity';
import { DomainException } from './errors.ts';
import type { User, UserRole, UserModel } from './models.ts';

function objectId(value: string, kind: 'user' | 'owner') {
  if (!Types.ObjectId.isValid(value)) {
    throw new DomainException(
      `Invalid ${kind} id`,
      kind === 'user' ? 'INVALID_USER_ID' : 'INVALID_OWNER_ID',
    );
  }
  return new Types.ObjectId(value);
}
function filters(ownerId: string, userId: string, role: UserRole) {
  return {
    _id: objectId(userId, 'user'),
    ...(role === 'SUPERADMIN' ? {} : { ownerId: objectId(ownerId, 'owner') }),
  };
}
function duplicate(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 11000;
}
function duplicateUser() {
  return new DomainException(
    'Ya existe un usuario con ese email o username',
    'USER_ALREADY_EXISTS',
    409,
  );
}

export class UsersRepository {
  private readonly options;
  constructor(
    private readonly model: UserModel,
    signal: AbortSignal,
  ) {
    this.options = { signal, maxTimeMS: 2000 };
  }
  async createUser(ownerId: string, role: UserRole, dto: CreateUserInput): Promise<User> {
    const target = objectId(
      role === 'SUPERADMIN' && dto.targetOwnerId ? dto.targetOwnerId : ownerId,
      'owner',
    );
    if (
      role !== 'SUPERADMIN' &&
      (await this.model.countDocuments({ ownerId: target }).setOptions(this.options)) >= 3
    ) {
      throw new DomainException('User limit reached for this owner', 'USER_ALREADY_EXISTS', 409);
    }
    if (
      await this.model
        .findOne({
          ownerId: target,
          $or: [{ email: dto.email.toLowerCase() }, { username: dto.username.toLowerCase() }],
        })
        .setOptions(this.options)
    )
      throw duplicateUser();
    const user = new this.model({
      ownerId: target,
      email: dto.email.toLowerCase(),
      username: dto.username.toLowerCase(),
      isPasswordSet: false,
      isActive: true,
    });
    try {
      return await user.save({ ...this.options, validateBeforeSave: true });
    } catch (error) {
      if (duplicate(error)) throw duplicateUser();
      throw error;
    }
  }
  async findAllByScope(ownerId: string, role: UserRole, query: UsersQueryInput) {
    const { page = 1, limit = 10 } = query;
    const filter = role === 'SUPERADMIN' ? {} : { ownerId: objectId(ownerId, 'owner') };
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: 1 })
        .skip(((page ?? 0) - 1) * (limit ?? 0))
        .limit(limit ?? 0)
        .setOptions(this.options)
        .exec(),
      this.model.countDocuments(filter).setOptions(this.options).exec(),
    ]);
    return { data, total, page, limit };
  }
  async findById(ownerId: string, userId: string, role: UserRole = 'OWNER'): Promise<User> {
    const user = await this.model.findOne(filters(ownerId, userId, role)).setOptions(this.options);
    if (!user) throw new DomainException('User not found', 'USER_NOT_FOUND', 404);
    return user;
  }
  async updateUser(
    ownerId: string,
    userId: string,
    dto: UpdateUserInput,
    role: UserRole = 'OWNER',
  ): Promise<User> {
    const user = await this.model.findOneAndUpdate(
      filters(ownerId, userId, role),
      { $set: dto },
      { ...this.options, returnDocument: 'after', runValidators: true },
    );
    if (!user) throw new DomainException('User not found', 'USER_NOT_FOUND', 404);
    return user;
  }
  async findByEmail(email: string): Promise<User | null> {
    return this.model.findOne({ email }).setOptions(this.options);
  }
  async findByUsername(username: string): Promise<User | null> {
    return this.model.findOne({ username }).setOptions(this.options);
  }
  async setPassword(ownerId: string, userId: string, passwordHash: string) {
    await this.model.updateOne(
      filters(ownerId, userId, 'OWNER'),
      { passwordHash, isPasswordSet: true },
      this.options,
    );
  }
  async setResetPasswordData(userId: string, codeHash: string, expiresAt: Date) {
    await this.model.updateOne(
      { _id: objectId(userId, 'user') },
      {
        resetPasswordCodeHash: codeHash,
        resetPasswordExpiresAt: expiresAt,
        resetPasswordAttempts: 0,
      },
      this.options,
    );
  }
  async incrementResetAttempts(userId: string) {
    await this.model.updateOne(
      { _id: objectId(userId, 'user') },
      { $inc: { resetPasswordAttempts: 1 } },
      this.options,
    );
  }
  async clearResetData(userId: string) {
    await this.model.updateOne(
      { _id: objectId(userId, 'user') },
      {
        resetPasswordCodeHash: null,
        resetPasswordExpiresAt: null,
        resetPasswordAttempts: 0,
      },
      this.options,
    );
  }
}
export type Users = Pick<UsersRepository, keyof UsersRepository>;
