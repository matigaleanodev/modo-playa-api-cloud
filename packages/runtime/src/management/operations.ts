import type {
  CreateContactInput,
  UpdateContactInput,
  ContactsQuery,
  AdminLodgingsQuery,
  CreateLodgingInput,
  UpdateLodgingInput,
  AvailabilityRange,
  VisibilityInput,
} from '@modo-playa/contracts/business';
import { ContactMapper } from '../business/contacts.mapper.ts';
import { LodgingMapper } from '../business/lodgings.mapper.ts';
import type { ManagementServices } from './handler.ts';
import type { RequestUser } from '../identity/models.ts';
export async function executeManagementOperation(
  route: { operation: string },
  parameters: Record<string, string>,
  body: unknown,
  query: unknown,
  user: RequestUser,
  services: ManagementServices,
) {
  const { contacts, lodgings, dashboard, mediaUrls } = services;
  const id = parameters.id!;
  const owner = user.ownerId;
  const role = user.role;
  let result: unknown;
  switch (route.operation) {
    case 'createContact':
      result = ContactMapper.toResponse(
        await contacts.create(body as CreateContactInput, owner, role),
      );
      break;
    case 'listContacts': {
      const page = await contacts.findAll(query as ContactsQuery, owner, role);
      result = { ...page, data: page.data.map((value) => ContactMapper.toResponse(value)) };
      break;
    }
    case 'getContact':
      result = ContactMapper.toResponse(
        await contacts.findOne(
          id,
          (query as { includeInactive: boolean }).includeInactive,
          owner,
          role,
        ),
      );
      break;
    case 'updateContact':
      result = ContactMapper.toResponse(
        await contacts.update(id, body as UpdateContactInput, owner, role),
      );
      break;
    case 'deleteContact':
      result = await contacts.remove(id, owner, role);
      break;
    case 'createLodging':
      result = LodgingMapper.toResponse(
        await lodgings.create(body as CreateLodgingInput, owner, role),
        mediaUrls,
      );
      break;
    case 'listAdminLodgings': {
      const page = await lodgings.findAdminPaginated(query as AdminLodgingsQuery, owner, role);
      result = {
        ...page,
        data: page.data.map((value) => LodgingMapper.toResponse(value, mediaUrls)),
      };
      break;
    }
    case 'getAdminLodging':
      result = LodgingMapper.toResponse(await lodgings.findAdminById(id, owner, role), mediaUrls);
      break;
    case 'updateLodging':
      result = LodgingMapper.toResponse(
        await lodgings.update(id, body as UpdateLodgingInput, owner, role),
        mediaUrls,
      );
      break;
    case 'deleteLodging':
      result = await lodgings.remove(id, owner, role);
      break;
    case 'setPublicVisibility':
      result = LodgingMapper.toResponse(
        await lodgings.setPublicVisibility(id, body as VisibilityInput, owner, role),
        mediaUrls,
      );
      break;
    case 'getOccupiedRanges':
      result = await lodgings.getOccupiedRanges(id, owner, role);
      break;
    case 'addOccupiedRange':
      result = await lodgings.addOccupiedRange(id, body as AvailabilityRange, owner, role);
      break;
    case 'removeOccupiedRange':
      result = await lodgings.removeOccupiedRange(id, body as AvailabilityRange, owner, role);
      break;
    case 'dashboardSummary':
      result = await dashboard.getSummary(owner, role);
      break;
    default:
      throw new Error('Unknown management operation.');
  }

  return result;
}
