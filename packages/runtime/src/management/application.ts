import type { Connection } from 'mongoose';
import { businessModels } from '../business/models.ts';
import { userModel } from '../identity/models.ts';
import { ContactsRepository } from '../business/contacts.repository.ts';
import { LodgingsRepository } from '../business/lodgings.repository.ts';
import { DashboardService } from '../business/dashboard.service.ts';
import { CloudflareMediaUrlBuilderService } from '../identity/media-urls.ts';
import type { BusinessConfiguration } from '../business/configuration.ts';
import type { LodgingMedia } from '../business/media.ts';
export function createManagementApplication(
  connection: Connection,
  config: BusinessConfiguration,
  media: LodgingMedia,
) {
  const models = businessModels(connection);
  return {
    contacts: new ContactsRepository(models.contacts),
    lodgings: new LodgingsRepository(models.lodgings, models.contacts, media),
    dashboard: new DashboardService(models.lodgings, models.contacts, userModel(connection)),
    mediaUrls: new CloudflareMediaUrlBuilderService(config),
  };
}
