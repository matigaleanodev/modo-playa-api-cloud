import type { Connection } from 'mongoose';
import { businessModels } from '../business/models.ts';
import { userModel } from '../identity/models.ts';
import { createManagementApplication } from '../management/application.ts';
import { CloudflareMediaUrlBuilderService } from '../identity/media-urls.ts';
import { pendingDraftModel } from './models.ts';
import { LodgingImagesService } from './lodging-images.service.ts';
import { UserProfileImagesService } from './profile-images.service.ts';
import { LodgingImagesPolicyService } from './policy.ts';
import type { ImageProcessorService, ObjectStorageService } from './ports.ts';
import type { MediaConfiguration } from './configuration.ts';
export function createMediaApplication(
  connection: Connection,
  config: MediaConfiguration,
  storage: ObjectStorageService,
  processor: ImageProcessorService,
  signal?: AbortSignal,
) {
  const models = businessModels(connection);
  const urls = new CloudflareMediaUrlBuilderService(config);
  const images = new LodgingImagesService(
    models.lodgings,
    pendingDraftModel(connection),
    storage,
    processor,
    urls,
    config.settings,
    new LodgingImagesPolicyService(),
    signal,
  );
  return {
    ...createManagementApplication(connection, config, images),
    images,
    profiles: new UserProfileImagesService(
      userModel(connection),
      storage,
      processor,
      urls,
      config.settings,
      signal,
    ),
    health: () =>
      storage.testConnection
        ? storage.testConnection()
        : Promise.reject(new Error('Storage health unavailable.')),
  };
}
