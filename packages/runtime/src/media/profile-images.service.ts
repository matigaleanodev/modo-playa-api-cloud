import { Model, type HydratedDocument } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { User } from '../identity/models.ts';
import { toObjectIdOrThrow } from '../business/object-id.ts';
import { DomainException } from '../identity/errors.ts';
import type { ProfileImageResponse as UserProfileImageResponseDto } from '@modo-playa/contracts/media';
import type {
  ImageProcessorService,
  ObjectStorageService,
  UploadedImageFile,
  MediaSettings,
} from './ports.ts';
import type { MediaUrlBuilder } from '../identity/media-urls.ts';
import { normalizeAndStore, cleanupObjects } from './effects.ts';
type UserDocument = HydratedDocument<User>;
type UserProfileImage = NonNullable<User['profileImage']>;
type ConfirmUserProfileImageResponseDto = { image: UserProfileImageResponseDto };
type DeleteUserProfileImageResponseDto = { deleted: boolean };
export class UserProfileImagesService {
  constructor(
    private readonly userModel: Model<User>,

    private readonly storage: ObjectStorageService,

    private readonly imageProcessor: ImageProcessorService,

    private readonly mediaUrlBuilder: MediaUrlBuilder,
    private readonly configService: MediaSettings,
    private readonly signal?: AbortSignal,
  ) {}

  async uploadOwnProfileImageFile(
    ownerId: string,
    userId: string,
    file: UploadedImageFile,
  ): Promise<ConfirmUserProfileImageResponseDto> {
    this.assertImageFile(file, this.getUserProfileMaxBytes());

    const user = await this.findOwnedUserOrThrow(ownerId, userId);
    const currentProfileImage = user.profileImage;
    const imageId = randomUUID();
    const finalKey = this.buildFinalKey(userId, imageId);
    const metadata = await normalizeAndStore(this.storage, this.imageProcessor, {
      key: finalKey,
      source: Readable.from(file.buffer),
      maxBytes: this.getUserProfileMaxBytes(),
      maxWidth: this.getUserProfileMaxWidth(),
      maxHeight: this.getUserProfileMaxHeight(),
      quality: 84,
      signal: this.signal,
    });
    const profileImage = {
      imageId,
      key: finalKey,
      width: metadata.width,
      height: metadata.height,
      bytes: metadata.bytes,
      mime: metadata.mime,
      createdAt: new Date(),
    };

    let updated: UserDocument | null;
    try {
      updated = await this.userModel.findOneAndUpdate(
        {
          _id: toObjectIdOrThrow(userId, {
            message: 'Invalid user id',
            errorCode: 'INVALID_USER_ID',
            httpStatus: 400,
          }),
          ownerId: toObjectIdOrThrow(ownerId, {
            message: 'Invalid owner id',
            errorCode: 'INVALID_OWNER_ID',
            httpStatus: 400,
          }),
        },
        {
          $set: {
            profileImage,
            avatarUrl: this.mediaUrlBuilder.buildPublicUrl(finalKey),
          },
        },
        { returnDocument: 'after' },
      );
    } catch (error) {
      const persisted = await Promise.resolve()
        .then(() => this.userModel.findOne({ _id: user._id, ownerId: user.ownerId }))
        .catch(() => undefined);
      if (persisted !== undefined && persisted?.profileImage?.key !== finalKey)
        await cleanupObjects(this.storage, [finalKey]);
      throw error;
    }

    if (!updated?.profileImage) {
      try {
        await this.storage.deleteObject(finalKey);
      } catch {
        // best effort cleanup
      }

      throw new DomainException(
        'No se pudo guardar la imagen de perfil',
        'LODGING_IMAGE_INVALID_STATE',
        409,
      );
    }

    if (currentProfileImage?.key && currentProfileImage.key !== finalKey) {
      try {
        await this.storage.deleteObject(currentProfileImage.key);
      } catch {
        // best effort
      }
    }

    return {
      image: this.toProfileImageResponse(updated.profileImage),
    };
  }

  async deleteProfileImage(
    ownerId: string,
    userId: string,
  ): Promise<DeleteUserProfileImageResponseDto> {
    const user = await this.findOwnedUserOrThrow(ownerId, userId);
    const profileImage = user.profileImage;

    if (profileImage?.key) {
      try {
        await this.storage.deleteObject(profileImage.key);
      } catch {
        // best effort
      }
    }

    await this.userModel.updateOne(
      {
        _id: toObjectIdOrThrow(userId, {
          message: 'Invalid user id',
          errorCode: 'INVALID_USER_ID',
          httpStatus: 400,
        }),
        ownerId: toObjectIdOrThrow(ownerId, {
          message: 'Invalid owner id',
          errorCode: 'INVALID_OWNER_ID',
          httpStatus: 400,
        }),
      },
      {
        $set: {
          profileImage: null,
          avatarUrl: null,
        },
      },
    );

    return { deleted: true };
  }

  private async findOwnedUserOrThrow(ownerId: string, userId: string): Promise<UserDocument> {
    const user = await this.userModel.findOne({
      _id: toObjectIdOrThrow(userId, {
        message: 'Invalid user id',
        errorCode: 'INVALID_USER_ID',
        httpStatus: 400,
      }),
      ownerId: toObjectIdOrThrow(ownerId, {
        message: 'Invalid owner id',
        errorCode: 'INVALID_OWNER_ID',
        httpStatus: 400,
      }),
    });

    if (!user) {
      throw new DomainException('User not found', 'USER_NOT_FOUND', 404);
    }

    return user;
  }

  buildFinalKey(userId: string, imageId: string): string {
    return `users/${userId}/profile/${imageId}/original.webp`;
  }

  private toProfileImageResponse(
    image: Pick<
      UserProfileImage,
      'imageId' | 'key' | 'width' | 'height' | 'bytes' | 'mime' | 'createdAt'
    >,
  ): UserProfileImageResponseDto {
    return {
      imageId: image.imageId,
      key: image.key,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      mime: image.mime,
      createdAt: new Date(image.createdAt).toISOString(),
      url: this.mediaUrlBuilder.buildPublicUrl(image.key),
      variants: this.mediaUrlBuilder.buildLodgingVariants(image.key),
    };
  }

  private getUserProfileMaxBytes(): number {
    return this.getNumberEnv('USER_PROFILE_IMAGE_MAX_BYTES', 5 * 1024 * 1024);
  }

  private getUserProfileMaxWidth(): number {
    return this.getNumberEnv('USER_PROFILE_IMAGE_MAX_WIDTH', 1024);
  }

  private getUserProfileMaxHeight(): number {
    return this.getNumberEnv('USER_PROFILE_IMAGE_MAX_HEIGHT', 1024);
  }

  private getAllowedMimes(): string[] {
    const csv = this.configService.get('IMAGE_ALLOWED_MIME') ?? '';
    return csv
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }

  private assertAllowedMime(mime?: string): void {
    if (!mime) return;

    const allowed = this.getAllowedMimes();
    if (allowed.length > 0 && !allowed.includes(mime.toLowerCase())) {
      throw new DomainException('Invalid image mime type', 'LODGING_IMAGE_INVALID_MIME', 400);
    }
  }

  private assertImageFile(
    file: UploadedImageFile | undefined,
    maxBytes: number,
  ): asserts file is UploadedImageFile {
    if (!file) {
      throw new DomainException('Image file is required', 'REQUEST_VALIDATION_ERROR', 400);
    }

    this.assertAllowedMime(file.mimetype);
    this.assertSizeWithinLimit(file.size, maxBytes);
  }

  private assertSizeWithinLimit(size: number | undefined, maxBytes: number): void {
    if (size !== undefined && size > maxBytes) {
      throw new DomainException('Image size exceeded', 'LODGING_IMAGE_SIZE_EXCEEDED', 400);
    }
  }

  private getNumberEnv(name: string, fallback: number): number {
    const raw = this.configService.get(name);
    if (!raw || raw.startsWith('"descripcion')) {
      return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
