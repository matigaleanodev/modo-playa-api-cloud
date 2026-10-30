import { Model, Types, type QueryFilter } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { UserRole } from '../identity/models.ts';
import { toObjectIdOrThrow } from '../business/object-id.ts';
import { DomainException } from '../identity/errors.ts';
import type { LodgingDocument, LodgingImage, Lodging } from '../business/models.ts';
import type { LodgingImageResponse as LodgingImageResponseDto } from '@modo-playa/contracts/business';
import type {
  ImageProcessorService,
  ObjectStorageService,
  UploadedImageFile,
  MediaSettings,
} from './ports.ts';
import type { MediaUrlBuilder } from '../identity/media-urls.ts';
import { LodgingImagesPolicyService } from './policy.ts';
import type {
  PendingLodgingDraftImageUploadDocument,
  PendingLodgingDraftImageUpload,
} from './models.ts';
import { normalizeAndStore, cleanupObjects } from './effects.ts';
type PendingLodgingImageUpload = Lodging['pendingImageUploads'][number];
type ConfirmLodgingImageResponseDto = { image: LodgingImageResponseDto };
type SetDefaultLodgingImageResponseDto = { images: LodgingImageResponseDto[] };
type DeleteLodgingImageResponseDto = { deleted: boolean; images: LodgingImageResponseDto[] };
type ConfirmDraftLodgingImageResponseDto = {
  imageId: string;
  uploadSessionId: string;
  confirmed: boolean;
};
export class LodgingImagesService {
  private readonly failedCreateKeys = new Map<string, string[]>();
  async compensateFailedCreate(lodgingId: string) {
    const keys = this.failedCreateKeys.get(lodgingId) ?? [];
    await cleanupObjects(this.storage, keys);
    this.failedCreateKeys.delete(lodgingId);
  }
  constructor(
    private readonly lodgingModel: Model<LodgingDocument>,

    private readonly pendingDraftUploadModel: Model<PendingLodgingDraftImageUpload>,

    private readonly storage: ObjectStorageService,

    private readonly imageProcessor: ImageProcessorService,

    private readonly mediaUrlBuilder: MediaUrlBuilder,
    private readonly configService: MediaSettings,
    private readonly policy: LodgingImagesPolicyService,
    private readonly signal?: AbortSignal,
  ) {}

  async uploadDraftImageFile(
    dto: { uploadSessionId: string },
    file: UploadedImageFile,
    ownerId: string,
  ): Promise<ConfirmDraftLodgingImageResponseDto> {
    this.assertImageFile(file, this.getLodgingMaxBytes());

    const ownerObjectId = toObjectIdOrThrow(ownerId, {
      message: 'Invalid owner id',
      errorCode: 'INVALID_OWNER_ID',
      httpStatus: 400,
    });

    await this.cleanupExpiredDraftUploads(ownerObjectId, dto.uploadSessionId);

    const pendingCount = await this.pendingDraftUploadModel.countDocuments({
      ownerId: ownerObjectId,
      uploadSessionId: dto.uploadSessionId,
    });
    this.policy.assertCanReserveSlot(0, pendingCount);

    const imageId = randomUUID();
    const ttlSeconds = this.getPendingUploadTtlSeconds();
    const stagingKey = this.buildDraftStagingKey(ownerId, dto.uploadSessionId, imageId);

    const pending = await this.pendingDraftUploadModel.create({
      ownerId: ownerObjectId,
      uploadSessionId: dto.uploadSessionId,
      imageId,
      stagingKey,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      status: 'PENDING',
    });

    try {
      await this.storage.putObject({
        key: stagingKey,
        body: Readable.from(file.buffer),
        contentType: file.mimetype,
      });
      pending.status = 'CONFIRMED';
      await pending.save();
    } catch (error) {
      await Promise.allSettled([
        this.pendingDraftUploadModel.deleteOne({ _id: pending._id }),
        ...[stagingKey].map((key) => this.storage.deleteObject(key)),
      ]);
      throw error;
    }

    return {
      imageId: pending.imageId,
      uploadSessionId: pending.uploadSessionId,
      confirmed: true,
    };
  }

  async uploadImageFile(
    lodgingId: string,
    file: UploadedImageFile,
    ownerId: string,
    role: UserRole,
  ): Promise<ConfirmLodgingImageResponseDto> {
    this.assertImageFile(file, this.getLodgingMaxBytes());

    const lodging = await this.findOwnedLodgingOrThrow(lodgingId, ownerId, role);
    await this.cleanupExpiredLodgingPendingUploads(lodging);

    const imageId = randomUUID();
    const finalKey = this.buildFinalKey(lodgingId, imageId);
    const metadata = await normalizeAndStore(this.storage, this.imageProcessor, {
      key: finalKey,
      source: Readable.from(file.buffer),
      maxBytes: this.getLodgingMaxBytes(),
      maxWidth: this.getLodgingMaxWidth(),
      maxHeight: this.getLodgingMaxHeight(),
      signal: this.signal,
    });
    const imageToPersist: LodgingImage = {
      imageId,
      key: finalKey,
      isDefault: false,
      width: metadata.width,
      height: metadata.height,
      bytes: metadata.bytes,
      mime: metadata.mime,
      createdAt: new Date(),
    };

    let updated: LodgingDocument | null;
    try {
      updated = await this.lodgingModel.findOneAndUpdate(
        {
          ...this.buildOwnershipFilters(lodgingId, ownerId, role),
          'mediaImages.4': { $exists: false },
        } as QueryFilter<LodgingDocument>,
        {
          $push: { mediaImages: imageToPersist },
        },
        { returnDocument: 'after' },
      );
    } catch (error) {
      // A database timeout may have committed: inspect before removing a possibly referenced key.
      const current = await Promise.resolve()
        .then(() => this.lodgingModel.findOne(this.buildOwnershipFilters(lodgingId, ownerId, role)))
        .catch(() => undefined);
      if (current !== undefined && !current?.mediaImages.some((image) => image.key === finalKey))
        await cleanupObjects(this.storage, [finalKey]);
      throw error;
    }

    if (!updated) {
      try {
        await this.storage.deleteObject(finalKey);
      } catch {
        // best effort cleanup
      }

      const current = await this.findOwnedLodgingOrThrow(lodgingId, ownerId, role);
      this.policy.assertCanReserveSlot(
        current.mediaImages.length,
        current.pendingImageUploads.length,
      );

      throw new DomainException(
        'No se pudo reservar el cupo para la imagen',
        'LODGING_IMAGE_INVALID_STATE',
        409,
      );
    }

    updated.mainImage =
      updated.mediaImages.find((image) => image.isDefault)?.key ??
      updated.mediaImages[0]?.key ??
      '';
    updated.images = updated.mediaImages.map((image) => image.key);
    await this.ensureLodgingDefaultInvariant(updated);

    const persisted = this.getLodgingImages(updated).find((image) => image.imageId === imageId);

    if (!persisted) {
      throw new DomainException(
        'Lodging image not found after upload',
        'LODGING_IMAGE_NOT_FOUND',
        500,
      );
    }

    return {
      image: this.toLodgingImageResponse(persisted),
    };
  }

  async setDefaultImage(
    lodgingId: string,
    imageId: string,
    ownerId: string,
    role: UserRole,
  ): Promise<SetDefaultLodgingImageResponseDto> {
    const lodging = await this.findOwnedLodgingOrThrow(lodgingId, ownerId, role);
    const images = this.getLodgingImages(lodging);
    const exists = images.some((image) => image.imageId === imageId);

    if (!exists) {
      throw new DomainException('Lodging image not found', 'LODGING_IMAGE_NOT_FOUND', 404);
    }

    for (const image of images) {
      image.isDefault = image.imageId === imageId;
    }

    const defaultImage = images.find((image) => image.isDefault);
    lodging.mainImage = defaultImage?.key ?? lodging.mainImage;
    lodging.images = images.map((image) => image.key);

    this.policy.assertValidImagesState(images);
    await lodging.save();

    return {
      images: images.map((image) => this.toLodgingImageResponse(image)),
    };
  }

  async deleteImage(
    lodgingId: string,
    imageId: string,
    ownerId: string,
    role: UserRole,
  ): Promise<DeleteLodgingImageResponseDto> {
    const lodging = await this.findOwnedLodgingOrThrow(lodgingId, ownerId, role);
    const images = this.getLodgingImages(lodging);
    const targetIndex = images.findIndex((image) => image.imageId === imageId);

    if (targetIndex === -1) {
      throw new DomainException('Lodging image not found', 'LODGING_IMAGE_NOT_FOUND', 404);
    }

    const [removed] = images.splice(targetIndex, 1);

    if (removed?.key) {
      try {
        await this.storage.deleteObject(removed.key);
      } catch {
        // best effort
      }
    }

    if (images.length > 0 && !images.some((image) => image.isDefault)) {
      images[0].isDefault = true;
    }

    lodging.mainImage = images.find((image) => image.isDefault)?.key ?? '';
    lodging.images = images.map((image) => image.key);

    this.policy.assertValidImagesState(images);
    await lodging.save();

    return {
      deleted: true,
      images: images.map((image) => this.toLodgingImageResponse(image)),
    };
  }

  async deleteAllForLodging(lodging: LodgingDocument): Promise<void> {
    const storageKeys = new Set<string>();

    for (const image of lodging.mediaImages ?? []) {
      if (image.key) {
        storageKeys.add(image.key);
      }
    }

    for (const pending of lodging.pendingImageUploads ?? []) {
      if (pending.stagingKey) {
        storageKeys.add(pending.stagingKey);
      }
    }

    for (const legacyKey of [lodging.mainImage, ...(lodging.images ?? [])]) {
      if (legacyKey && !/^https?:\/\//i.test(legacyKey)) {
        storageKeys.add(legacyKey);
      }
    }

    await Promise.all(Array.from(storageKeys).map((key) => this.storage.deleteObject(key)));
  }

  async attachDraftUploadsToLodging(
    lodgingId: string,
    ownerId: string,
    uploadSessionId: string,
    pendingImageIds: string[],
  ): Promise<void> {
    if (pendingImageIds.length === 0) {
      return;
    }

    const ownerObjectId = toObjectIdOrThrow(ownerId, {
      message: 'Invalid owner id',
      errorCode: 'INVALID_OWNER_ID',
      httpStatus: 400,
    });

    await this.cleanupExpiredDraftUploads(ownerObjectId, uploadSessionId);

    const pendingUploads = await this.pendingDraftUploadModel.find({
      ownerId: ownerObjectId,
      uploadSessionId,
      imageId: { $in: pendingImageIds },
    });

    if (pendingUploads.length !== pendingImageIds.length) {
      throw new DomainException(
        'Some pending lodging draft images were not found',
        'LODGING_IMAGE_PENDING_NOT_FOUND',
        404,
      );
    }

    const pendingById = new Map(pendingUploads.map((pending) => [pending.imageId, pending]));
    const orderedUploads = pendingImageIds.map((imageId) => {
      const pending = pendingById.get(imageId);
      if (!pending) {
        throw new DomainException(
          'Pending lodging draft image not found',
          'LODGING_IMAGE_PENDING_NOT_FOUND',
          404,
        );
      }
      return pending;
    });

    const lodging = await this.findOwnedLodgingOrThrow(lodgingId, ownerId, 'OWNER');
    const existingImages = this.getLodgingImages(lodging);

    if (existingImages.length + orderedUploads.length > this.policy.MAX_IMAGES) {
      throw new DomainException(
        'Lodging image limit exceeded',
        'LODGING_IMAGE_LIMIT_EXCEEDED',
        400,
      );
    }

    const uploadedKeys: string[] = [];
    const uploadedImages: LodgingImage[] = [];

    try {
      for (const pending of orderedUploads) {
        this.policy.assertPendingUploadValid(
          {
            imageId: pending.imageId,
            stagingKey: pending.stagingKey,
            createdAt: pending.createdAt,
            expiresAt: pending.expiresAt,
            status: 'PENDING',
          },
          pending.stagingKey,
          new Date(),
        );

        if (pending.status !== 'CONFIRMED') {
          throw new DomainException(
            'Pending lodging draft image upload must be confirmed before create',
            'LODGING_IMAGE_INVALID_STATE',
            400,
          );
        }

        const stagingHead = await this.storage.headObject(pending.stagingKey);
        if (!stagingHead.exists) {
          throw new DomainException(
            'Pending draft lodging image upload not found in storage',
            'STORAGE_OBJECT_NOT_FOUND',
            404,
          );
        }

        this.assertAllowedMime(stagingHead.mime ?? undefined);
        this.assertSizeWithinLimit(stagingHead.bytes, this.getLodgingMaxBytes());

        const finalKey = this.buildFinalKey(lodgingId, pending.imageId);
        const source = await this.storage.getObjectStream(pending.stagingKey);
        uploadedKeys.push(finalKey);
        const metadata = await normalizeAndStore(this.storage, this.imageProcessor, {
          key: finalKey,
          source: source.stream,
          maxBytes: this.getLodgingMaxBytes(),
          maxWidth: this.getLodgingMaxWidth(),
          maxHeight: this.getLodgingMaxHeight(),
          signal: this.signal,
        });
        uploadedImages.push({
          imageId: pending.imageId,
          key: finalKey,
          isDefault: false,
          width: metadata.width,
          height: metadata.height,
          bytes: metadata.bytes,
          mime: metadata.mime,
          createdAt: new Date(),
        });
      }
      lodging.mediaImages = [...existingImages, ...uploadedImages];

      if (lodging.mediaImages.length > 0) {
        for (const [index, image] of lodging.mediaImages.entries()) {
          image.isDefault = index === 0;
        }
        lodging.mainImage =
          lodging.mediaImages.find((image) => image.isDefault)?.key ?? lodging.mediaImages[0].key;
        lodging.images = lodging.mediaImages.map((image) => image.key);
      }

      this.policy.assertValidImagesState(lodging.mediaImages);
      await lodging.save();
    } catch (error) {
      this.failedCreateKeys.set(lodgingId, uploadedKeys);
      throw error;
    }

    try {
      await this.pendingDraftUploadModel.deleteMany({
        _id: { $in: orderedUploads.map((pending) => pending._id) },
      });
    } catch (error) {
      // The caller rolls the document back before compensating these referenced final objects.
      this.failedCreateKeys.set(lodgingId, uploadedKeys);
      throw error;
    }
    await cleanupObjects(
      this.storage,
      orderedUploads.map((pending) => pending.stagingKey),
    );
  }

  private async findOwnedLodgingOrThrow(
    lodgingId: string,
    ownerId: string,
    role: UserRole,
  ): Promise<LodgingDocument> {
    const filters: QueryFilter<LodgingDocument> = {
      _id: toObjectIdOrThrow(lodgingId, {
        message: 'Invalid lodging id',
        errorCode: 'INVALID_LODGING_ID',
        httpStatus: 400,
      }),
    };

    if (role !== 'SUPERADMIN') {
      filters.ownerId = toObjectIdOrThrow(ownerId, {
        message: 'Invalid owner id',
        errorCode: 'INVALID_OWNER_ID',
        httpStatus: 400,
      });
    }

    const lodging = await this.lodgingModel.findOne(filters);

    if (!lodging) {
      throw new DomainException('Lodging not found', 'LODGING_NOT_FOUND', 404);
    }

    return lodging;
  }

  buildStagingKey(lodgingId: string, imageId: string): string {
    return `lodgings/${lodgingId}/${imageId}/staging-upload`;
  }

  buildDraftStagingKey(ownerId: string, uploadSessionId: string, imageId: string): string {
    return `lodgings/drafts/${ownerId}/${uploadSessionId}/${imageId}/staging-upload`;
  }

  buildFinalKey(lodgingId: string, imageId: string): string {
    return `lodgings/${lodgingId}/${imageId}/original.webp`;
  }

  private buildOwnershipFilters(
    lodgingId: string,
    ownerId: string,
    role: UserRole,
  ): Record<string, unknown> {
    const filters: Record<string, unknown> = {
      _id: toObjectIdOrThrow(lodgingId, {
        message: 'Invalid lodging id',
        errorCode: 'INVALID_LODGING_ID',
        httpStatus: 400,
      }),
    };

    if (role !== 'SUPERADMIN') {
      filters.ownerId = toObjectIdOrThrow(ownerId, {
        message: 'Invalid owner id',
        errorCode: 'INVALID_OWNER_ID',
        httpStatus: 400,
      });
    }

    return filters;
  }

  private getLodgingImages(lodging: LodgingDocument): LodgingImage[] {
    return lodging.mediaImages ?? [];
  }

  private getPendingUploads(lodging: LodgingDocument): PendingLodgingImageUpload[] {
    return lodging.pendingImageUploads ?? [];
  }

  private async cleanupExpiredDraftUploads(
    ownerId: Types.ObjectId,
    uploadSessionId: string,
  ): Promise<void> {
    const expired = await this.pendingDraftUploadModel.find({
      ownerId,
      uploadSessionId,
      expiresAt: { $lt: new Date() },
    });

    await this.deleteDraftUploads(expired);
  }

  private async deleteDraftUploads(
    uploads: PendingLodgingDraftImageUploadDocument[],
  ): Promise<void> {
    if (uploads.length === 0) {
      return;
    }

    await this.pendingDraftUploadModel.deleteMany({
      _id: { $in: uploads.map((upload) => upload._id) },
    });

    await Promise.all(
      uploads.map(async (upload) => {
        try {
          await this.storage.deleteObject(upload.stagingKey);
        } catch {
          // best effort cleanup
        }
      }),
    );
  }

  private async cleanupExpiredLodgingPendingUploads(
    lodging: LodgingDocument,
  ): Promise<Set<string>> {
    const pendingUploads = this.getPendingUploads(lodging);
    if (pendingUploads.length === 0) {
      return new Set<string>();
    }

    const now = Date.now();
    const expired = pendingUploads.filter((pending) => new Date(pending.expiresAt).getTime() < now);

    if (expired.length === 0) {
      return new Set<string>();
    }

    lodging.pendingImageUploads = pendingUploads.filter(
      (pending) => !expired.some((candidate) => candidate.imageId === pending.imageId),
    );
    await lodging.save();

    await Promise.all(
      expired.map(async (pending) => {
        try {
          await this.storage.deleteObject(pending.stagingKey);
        } catch {
          // best effort cleanup
        }
      }),
    );

    return new Set(expired.map((pending) => pending.imageId));
  }

  private async ensureLodgingDefaultInvariant(lodging: LodgingDocument): Promise<void> {
    const images = this.getLodgingImages(lodging);

    if (images.length === 0) {
      return;
    }

    const defaultImages = images.filter((image) => image.isDefault);

    if (defaultImages.length !== 1) {
      for (const image of images) image.isDefault = false;
      images[0]!.isDefault = true;
    }
    lodging.mainImage = images.find((image) => image.isDefault)!.key;
    lodging.images = images.map((image) => image.key);

    this.policy.assertValidImagesState(images);
    await lodging.save();
  }

  private toLodgingImageResponse(image: LodgingImage): LodgingImageResponseDto {
    return {
      imageId: image.imageId,
      key: image.key,
      isDefault: image.isDefault,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      mime: image.mime,
      createdAt: new Date(image.createdAt).toISOString(),
      url: this.mediaUrlBuilder.buildPublicUrl(image.key),
      variants: this.mediaUrlBuilder.buildLodgingVariants(image.key),
    };
  }

  private getAllowedMimes(): string[] {
    const csv = this.configService.get('IMAGE_ALLOWED_MIME') ?? '';
    return csv
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }

  private assertAllowedMime(mime?: string): void {
    if (!mime) {
      return;
    }

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

  private getPendingUploadTtlSeconds(): number {
    return this.getNumberEnv('PENDING_UPLOAD_TTL_SECONDS', 1800);
  }

  private getLodgingMaxBytes(): number {
    return this.getNumberEnv('LODGING_IMAGE_MAX_BYTES', 10 * 1024 * 1024);
  }

  private getLodgingMaxWidth(): number {
    return this.getNumberEnv('LODGING_IMAGE_MAX_WIDTH', 2560);
  }

  private getLodgingMaxHeight(): number {
    return this.getNumberEnv('LODGING_IMAGE_MAX_HEIGHT', 2560);
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
