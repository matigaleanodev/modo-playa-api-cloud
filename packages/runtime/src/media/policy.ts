import { DomainException } from '../identity/errors.ts';
import type { LodgingImage, Lodging } from '../business/models.ts';
type PendingLodgingImageUpload = Lodging['pendingImageUploads'][number];
export class LodgingImagesPolicyService {
  readonly MAX_IMAGES = 5;

  assertCanReserveSlot(imagesCount: number, pendingCount: number): void {
    if (imagesCount + pendingCount >= this.MAX_IMAGES) {
      throw new DomainException(
        'Lodging image limit exceeded',
        'LODGING_IMAGE_LIMIT_EXCEEDED',
        400,
      );
    }
  }

  assertPendingUploadValid(
    pending: PendingLodgingImageUpload | undefined,
    expectedKey: string,
    now: Date,
  ): void {
    if (!pending) {
      throw new DomainException(
        'Pending lodging image upload not found',
        'LODGING_IMAGE_PENDING_NOT_FOUND',
        404,
      );
    }

    if (pending.stagingKey !== expectedKey) {
      throw new DomainException(
        'Invalid lodging image upload key',
        'LODGING_IMAGE_UPLOAD_INVALID_KEY',
        400,
      );
    }

    const expiresAt = new Date(pending.expiresAt);

    if (Number.isNaN(expiresAt.getTime())) {
      throw new DomainException(
        'Pending lodging image upload has invalid expiration date',
        'LODGING_IMAGE_INVALID_STATE',
        400,
      );
    }

    if (expiresAt.getTime() < now.getTime()) {
      throw new DomainException(
        'Pending lodging image upload expired',
        'LODGING_IMAGE_PENDING_EXPIRED',
        400,
      );
    }
  }

  assertValidImagesState(images: LodgingImage[]): void {
    if (images.length > this.MAX_IMAGES) {
      throw new DomainException(
        'Lodging image limit exceeded',
        'LODGING_IMAGE_LIMIT_EXCEEDED',
        400,
      );
    }

    if (images.length === 0) {
      return;
    }

    const defaultCount = images.filter((image) => image.isDefault).length;

    if (defaultCount !== 1) {
      throw new DomainException(
        'Invalid lodging images default state',
        'LODGING_IMAGE_INVALID_DEFAULT_STATE',
        400,
      );
    }
  }
}
