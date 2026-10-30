import type { LodgingDocument } from './models.ts';
// La integración proporciona efectos reales; no admite implementaciones de éxito no-op.
export interface LodgingMedia {
  attachDraftUploadsToLodging(
    lodgingId: string,
    ownerId: string,
    uploadSessionId: string,
    pendingImageIds: string[],
  ): Promise<void>;
  deleteAllForLodging(lodging: LodgingDocument): Promise<void>;
  compensateFailedCreate?(lodgingId: string): Promise<void>;
}
export class MediaDependencyUnavailable extends Error {
  constructor() {
    super('Lodging media dependency unavailable.');
  }
}
export function requireLodgingMedia(): never {
  throw new MediaDependencyUnavailable();
}
