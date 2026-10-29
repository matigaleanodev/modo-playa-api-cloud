import { Model, Types, type QueryFilter } from 'mongoose';
import { toObjectIdOrThrow } from './object-id.ts';
import type { UserRole } from '../identity/models.ts';
import { DomainException } from '../identity/errors.ts';
import type { ContactDocument } from './models.ts';
import type {
  CreateContactInput as CreateContactDto,
  UpdateContactInput as UpdateContactDto,
  ContactsQuery as ContactsQueryDto,
  Page as PaginatedResponse,
} from '@modo-playa/contracts/business';

export class ContactsRepository {
  constructor(private readonly contactModel: Model<ContactDocument>) {}

  async create(dto: CreateContactDto, ownerId: string, role: UserRole): Promise<ContactDocument> {
    const ownerObjectId = this.resolveTargetOwnerId(ownerId, role, dto.targetOwnerId);
    if (dto.isDefault) {
      await this.contactModel.updateMany(
        { ownerId: ownerObjectId, isDefault: true },
        { isDefault: false },
      );
    }

    const contact = new this.contactModel({
      ...dto,
      ownerId: ownerObjectId,
    });
    try {
      return await contact.save();
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        throw new DomainException(
          'Another default contact already exists for this owner',
          'CONTACT_NOT_ALLOWED',
          409,
        );
      }
      throw error;
    }
  }

  async findAll(
    query: ContactsQueryDto,
    ownerId: string,
    role: UserRole,
  ): Promise<PaginatedResponse<ContactDocument>> {
    const { includeInactive = false, page = 1, limit = 10 } = query;
    const filters: QueryFilter<ContactDocument> = {};

    if (!includeInactive) {
      filters.active = true;
    }

    if (role !== 'SUPERADMIN') {
      filters.ownerId = toObjectIdOrThrow(ownerId, {
        message: 'Invalid owner id',
        errorCode: 'INVALID_OWNER_ID',
        httpStatus: 400,
      });
    }

    const [data, total] = await Promise.all([
      this.contactModel
        .find(filters)
        .sort({ createdAt: -1 })
        .skip(((page ?? 0) - 1) * (limit ?? 0))
        .limit(limit ?? 0)
        .exec(),
      this.contactModel.countDocuments(filters).exec(),
    ]);

    return { data, total, page, limit };
  }

  async findOne(
    id: string,
    includeInactive: boolean,
    ownerId: string,
    role: UserRole,
  ): Promise<ContactDocument> {
    const filters: QueryFilter<ContactDocument> = {
      _id: toObjectIdOrThrow(id, {
        message: 'Contact not found',
        errorCode: 'CONTACT_NOT_FOUND',
        httpStatus: 404,
      }),
    };

    if (!includeInactive) {
      filters.active = true;
    }

    if (role !== 'SUPERADMIN') {
      filters.ownerId = toObjectIdOrThrow(ownerId, {
        message: 'Invalid owner id',
        errorCode: 'INVALID_OWNER_ID',
        httpStatus: 400,
      });
    }

    const contact = await this.contactModel.findOne(filters);

    if (!contact) {
      throw new DomainException('Contact not found', 'CONTACT_NOT_FOUND', 404);
    }

    return contact;
  }

  async update(
    id: string,
    dto: UpdateContactDto,
    ownerId: string,
    role: UserRole,
  ): Promise<ContactDocument> {
    const filters: QueryFilter<ContactDocument> = {
      _id: toObjectIdOrThrow(id, {
        message: 'Contact not found',
        errorCode: 'CONTACT_NOT_FOUND',
        httpStatus: 404,
      }),
    };

    if (role !== 'SUPERADMIN') {
      filters.ownerId = toObjectIdOrThrow(ownerId, {
        message: 'Invalid owner id',
        errorCode: 'INVALID_OWNER_ID',
        httpStatus: 400,
      });
    }

    const existing = await this.contactModel.findOne(filters);

    if (!existing) {
      throw new DomainException('Contact not found', 'CONTACT_NOT_FOUND', 404);
    }

    if (dto.isDefault === true && existing.active === false) {
      throw new DomainException('Inactive contact cannot be default', 'CONTACT_NOT_ALLOWED', 409);
    }

    if (dto.isDefault === true) {
      await this.contactModel.updateMany(
        {
          ownerId: existing.ownerId,
          isDefault: true,
        },
        { isDefault: false },
      );
    }

    existing.set(dto);

    try {
      return await existing.save();
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        throw new DomainException(
          'Another default contact already exists for this owner',
          'CONTACT_NOT_ALLOWED',
          409,
        );
      }
      throw error;
    }
  }

  async remove(id: string, ownerId: string, role: UserRole): Promise<{ deleted: boolean }> {
    const filters: QueryFilter<ContactDocument> = {
      _id: toObjectIdOrThrow(id, {
        message: 'Contact not found',
        errorCode: 'CONTACT_NOT_FOUND',
        httpStatus: 404,
      }),
    };

    if (role !== 'SUPERADMIN') {
      filters.ownerId = toObjectIdOrThrow(ownerId, {
        message: 'Invalid owner id',
        errorCode: 'INVALID_OWNER_ID',
        httpStatus: 400,
      });
    }

    const contact = await this.contactModel.findOne(filters);

    if (!contact) {
      throw new DomainException('Contact not found', 'CONTACT_NOT_FOUND', 404);
    }

    if (contact.isDefault) {
      throw new DomainException(
        'Cannot remove default contact. Set another contact as default first.',
        'CONTACT_DEFAULT_DELETE_FORBIDDEN',
        409,
      );
    }

    contact.active = false;
    await contact.save();

    return { deleted: true };
  }

  private resolveTargetOwnerId(
    requesterOwnerId: string,
    role: UserRole,
    targetOwnerId?: string | null,
  ): Types.ObjectId {
    const effectiveOwnerId =
      role === 'SUPERADMIN' && targetOwnerId ? targetOwnerId : requesterOwnerId;

    return toObjectIdOrThrow(effectiveOwnerId, {
      message: 'Invalid owner id',
      errorCode: 'INVALID_OWNER_ID',
      httpStatus: 400,
    });
  }
}
