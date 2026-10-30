import { Schema, Types, type Connection } from 'mongoose';

export interface User {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  email: string;
  username: string;
  passwordHash?: string;
  isPasswordSet: boolean;
  isActive: boolean;
  resetPasswordCodeHash?: string | null;
  resetPasswordExpiresAt?: Date | null;
  resetPasswordAttempts: number;
  lastLoginAt?: Date | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
  profileImage?: {
    imageId: string;
    key: string;
    width?: number;
    height?: number;
    bytes?: number;
    mime?: string;
    createdAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}
const profileImage = new Schema(
  {
    imageId: { type: String, required: true },
    key: { type: String, required: true },
    width: Number,
    height: Number,
    bytes: Number,
    mime: String,
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);
export const userSchema = new Schema<User>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true, default: () => new Types.ObjectId() },
    email: { type: String, required: true, lowercase: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: String,
    isPasswordSet: { type: Boolean, default: false },
    resetPasswordCodeHash: String,
    resetPasswordExpiresAt: Date,
    resetPasswordAttempts: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    firstName: String,
    lastName: String,
    displayName: String,
    avatarUrl: String,
    profileImage,
    phone: String,
  },
  {
    collection: 'users',
    timestamps: true,
    autoCreate: false,
    autoIndex: false,
    bufferCommands: false,
  },
);
userSchema.index({ ownerId: 1 });
userSchema.index({ ownerId: 1, email: 1 }, { unique: true });
userSchema.index({ ownerId: 1, username: 1 }, { unique: true });

export type UserRole = 'OWNER' | 'SUPERADMIN';
export type TokenPurpose = 'ACCESS' | 'PASSWORD_SETUP' | 'REFRESH';
export interface JwtPayload {
  sub: string;
  ownerId: string;
  role?: UserRole;
  purpose?: TokenPurpose;
}
export interface RequestUser {
  userId: string;
  ownerId: string;
  role: UserRole;
  purpose: TokenPurpose;
}

export function userModel(connection: Connection) {
  return connection.model('User', userSchema);
}
export type UserModel = ReturnType<typeof userModel>;
