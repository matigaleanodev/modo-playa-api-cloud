import type { ContactResponse as ContactResponseDto } from '@modo-playa/contracts/business';
import type { ContactDocument } from './models.ts';

export class ContactMapper {
  static toResponse(contact: ContactDocument): ContactResponseDto {
    return {
      id: contact._id.toString(),
      name: contact.name,
      email: contact.email,
      whatsapp: contact.whatsapp,
      isDefault: contact.isDefault,
      active: contact.active,
      notes: contact.notes,
    };
  }
}
