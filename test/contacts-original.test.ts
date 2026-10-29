import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Types } from 'mongoose';
import { DomainException } from '../packages/runtime/src/identity/errors.ts';
import { ContactsRepository } from '../packages/runtime/src/business/contacts.repository.ts';

class FakeContactModel {
  static updateMany = vi.fn();
  static find = vi.fn();
  static findOne = vi.fn();
  static countDocuments = vi.fn();

  private readonly data: unknown;

  constructor(data: unknown) {
    this.data = data;
  }

  save(): Promise<unknown> {
    return Promise.resolve(this.data);
  }
}

type UpdateManyFilters = {
  ownerId: Types.ObjectId;
  isDefault: boolean;
};

type FindFilters = {
  ownerId: Types.ObjectId;
};

describe('ContactsRepository', () => {
  let service: ContactsRepository;

  beforeEach(async () => {
    service = new ContactsRepository(FakeContactModel as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('debe crear contacto sin default', async () => {
    const dto = { name: 'Test' };
    const ownerId = new Types.ObjectId().toString();

    const result = await service.create(dto, ownerId, 'OWNER');

    expect(result).toMatchObject(dto);
    expect((result as { ownerId: Types.ObjectId }).ownerId).toBeInstanceOf(Types.ObjectId);
    expect((result as { ownerId: Types.ObjectId }).ownerId.toString()).toBe(ownerId);
  });

  it('debe desactivar default anterior si dto.isDefault es true', async () => {
    const dto = { name: 'Test', isDefault: true };
    const ownerId = new Types.ObjectId().toString();

    await service.create(dto, ownerId, 'OWNER');

    expect(FakeContactModel.updateMany).toHaveBeenCalledTimes(1);
    const updateManyCalls = FakeContactModel.updateMany.mock.calls as unknown as Array<
      [UpdateManyFilters, { isDefault: boolean }]
    >;
    const [filters] = updateManyCalls[0];
    expect(filters.isDefault).toBe(true);
    expect(filters.ownerId.toString()).toBe(ownerId);
    expect(updateManyCalls[0][1]).toEqual({ isDefault: false });
  });

  it('OWNER debe filtrar por ownerId y devolver paginado', async () => {
    const ownerId = new Types.ObjectId().toString();
    const mockResult = [{ name: 'Contact' }];

    FakeContactModel.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(mockResult),
          }),
        }),
      }),
    });
    FakeContactModel.countDocuments.mockReturnValue({
      exec: vi.fn().mockResolvedValue(1),
    });

    const result = await service.findAll(
      { includeInactive: false, page: 1, limit: 10 },
      ownerId,
      'OWNER',
    );

    expect(result).toEqual({
      data: mockResult,
      total: 1,
      page: 1,
      limit: 10,
    });
    expect(FakeContactModel.find).toHaveBeenCalled();
    const findCalls = FakeContactModel.find.mock.calls as unknown as Array<[FindFilters]>;
    const [filters] = findCalls[0];
    expect(filters.ownerId.toString()).toBe(ownerId);
  });

  it('debe devolver codigo explicito si ownerId es invalido al listar', async () => {
    await expect(
      service.findAll({ includeInactive: false, page: 1, limit: 10 }, 'invalid-owner-id', 'OWNER'),
    ).rejects.toMatchObject({
      message: 'Invalid owner id',
      code: 'INVALID_OWNER_ID',
    });
  });

  it('debe lanzar error si id inválido', async () => {
    await expect(service.findOne('invalid-id', false, 'owner', 'OWNER')).rejects.toThrow(
      DomainException,
    );
  });

  it('debe devolver contacto si existe', async () => {
    const contact = { _id: new Types.ObjectId(), active: true };

    FakeContactModel.findOne.mockResolvedValue(contact);

    const result = await service.findOne(
      new Types.ObjectId().toString(),
      false,
      new Types.ObjectId().toString(),
      'OWNER',
    );

    expect(result).toEqual(contact);
  });

  it('debe lanzar error si contacto no existe', async () => {
    FakeContactModel.findOne.mockResolvedValue(null);

    await expect(
      service.update(new Types.ObjectId().toString(), {}, new Types.ObjectId().toString(), 'OWNER'),
    ).rejects.toThrow(DomainException);
  });

  it('debe bloquear eliminación si es default', async () => {
    const contact = {
      _id: new Types.ObjectId(),
      isDefault: true,
    };

    FakeContactModel.findOne.mockResolvedValue(contact);

    await expect(
      service.remove(new Types.ObjectId().toString(), new Types.ObjectId().toString(), 'OWNER'),
    ).rejects.toThrow(DomainException);
  });

  it('debe hacer soft delete correctamente', async () => {
    const saveMock = vi.fn().mockResolvedValue(true);

    const contact = {
      _id: new Types.ObjectId(),
      isDefault: false,
      active: true,
      save: saveMock,
    };

    FakeContactModel.findOne.mockResolvedValue(contact);

    const result = await service.remove(
      new Types.ObjectId().toString(),
      new Types.ObjectId().toString(),
      'OWNER',
    );

    expect(contact.active).toBe(false);
    expect(result).toEqual({ deleted: true });
  });
});
