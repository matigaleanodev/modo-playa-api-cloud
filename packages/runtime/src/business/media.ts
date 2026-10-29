import type { LodgingDocument } from './models.ts';
// Fase 4 debe proporcionar los efectos reales; esta interfaz no tiene implementación no-op.
export interface LodgingMedia {
  attachDraftUploadsToLodging(
    lodgingId: string,
    ownerId: string,
    uploadSessionId: string,
    pendingImageIds: string[],
  ): Promise<void>;
  deleteAllForLodging(lodging: LodgingDocument): Promise<void>;
}
export class MediaDependencyUnavailable extends Error {
  constructor() {
    super('Lodging media dependency unavailable.');
  }
}
export function requireLodgingMedia(): never {
  throw new MediaDependencyUnavailable();
}
