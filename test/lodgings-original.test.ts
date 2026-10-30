import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Types } from 'mongoose';
import { DomainException } from '../packages/runtime/src/identity/errors.ts';
import { LodgingsRepository } from '../packages/runtime/src/business/lodgings.repository.ts';
import type { UpdateLodgingInput } from '@modo-playa/contracts/business';

describe('LodgingsRepository', () => {
  let service: LodgingsRepository;
  let ownerId: string;
  let lodgingId: string;

  const mockLodgingModel = {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
    deleteOne: vi.fn(),
    countDocuments: vi.fn(),
  };

  const mockContactModel = {
    findOne: vi.fn(),
  };

  const mockLodgingImagesService = {
    attachDraftUploadsToLodging: vi.fn(),
    deleteAllForLodging: vi.fn(),
  };

  beforeEach(async () => {
    ownerId = new Types.ObjectId().toString();
    lodgingId = new Types.ObjectId().toString();
    service = new LodgingsRepository(
      mockLodgingModel as never,
      mockContactModel as never,
      mockLodgingImagesService,
    );
    mockLodgingImagesService.attachDraftUploadsToLodging.mockResolvedValue(undefined);
    mockLodgingImagesService.deleteAllForLodging.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const withPopulate = <T>(result: T) => ({
    populate: vi.fn().mockResolvedValue(result),
  });

  describe('findPublicPaginated', () => {
    it('debe rechazar rangos de precio publicos invalidos con codigo semantico', async () => {
      await expect(
        service.findPublicPaginated({ page: 1, limit: 10, minPrice: 200, maxPrice: 100 }),
      ).rejects.toMatchObject({
        message: 'minPrice cannot be greater than maxPrice',
        code: 'INVALID_PRICE_RANGE',
      });
    });

    it('debe incluir lodgings legacy sin isPubliclyVisible en el filtro publico', async () => {
      const findChain = {
        populate: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        sort: vi.fn().mockResolvedValue([]),
      };
      mockLodgingModel.find.mockReturnValue(findChain);
      mockLodgingModel.countDocuments.mockResolvedValue(0);

      await service.findPublicPaginated({ page: 1, limit: 10 });

      expect(mockLodgingModel.find).toHaveBeenCalledWith({
        $or: [{ isPubliclyVisible: true }, { isPubliclyVisible: { $exists: false } }],
      });
      expect(mockLodgingModel.countDocuments).toHaveBeenCalledWith({
        $or: [{ isPubliclyVisible: true }, { isPubliclyVisible: { $exists: false } }],
      });
    });
  });

  describe('findPublicById', () => {
    it('debe devolver lodging si existe y está visible publicamente', async () => {
      const lodging = { _id: '1', isPubliclyVisible: true };
      mockLodgingModel.findOne.mockReturnValue(withPopulate(lodging));

      const result = await service.findPublicById(lodgingId);

      expect(result).toEqual(lodging);
      const [findOneFilters] = mockLodgingModel.findOne.mock.calls[0] as [Record<string, unknown>];
      expect(findOneFilters.$or).toEqual([
        { isPubliclyVisible: true },
        { isPubliclyVisible: { $exists: false } },
      ]);
      expect(findOneFilters._id).toBeInstanceOf(Types.ObjectId);
    });

    it('debe lanzar DomainException si no existe', async () => {
      mockLodgingModel.findOne.mockReturnValue(withPopulate(null));

      await expect(service.findPublicById(lodgingId)).rejects.toThrow(DomainException);
    });
  });

  describe('findAdminById', () => {
    it('OWNER solo puede ver su lodging', async () => {
      const lodging = { _id: '1', ownerId: 'owner1' };
      mockLodgingModel.findOne.mockReturnValue(withPopulate(lodging));

      const result = await service.findAdminById(lodgingId, ownerId, 'OWNER');

      expect(result).toEqual(lodging);
    });

    it('lanza error si no existe', async () => {
      mockLodgingModel.findOne.mockReturnValue(withPopulate(null));

      await expect(service.findAdminById(lodgingId, ownerId, 'OWNER')).rejects.toThrow(
        DomainException,
      );
    });
  });

  describe('update', () => {
    it('debe actualizar correctamente', async () => {
      const updated = { _id: '1', title: 'Nuevo título' };
      mockLodgingModel.findOneAndUpdate.mockReturnValue(withPopulate(updated));

      const result = await service.update(
        '507f1f77bcf86cd799439011',
        { title: 'Nuevo título' },
        ownerId,
        'OWNER',
      );

      expect(result).toEqual(updated);
    });

    it('debe lanzar error si id inválido', async () => {
      await expect(service.update('invalid-id', {}, ownerId, 'OWNER')).rejects.toMatchObject({
        message: 'Invalid lodging id',
        code: 'INVALID_LODGING_ID',
      });
    });

    it('debe rechazar occupiedRanges en patch general', async () => {
      const invalidUpdateDto = {
        occupiedRanges: [{ from: '2026-01-10', to: '2026-01-11' }],
      } as unknown as UpdateLodgingInput;

      await expect(service.update(lodgingId, invalidUpdateDto, ownerId, 'OWNER')).rejects.toThrow(
        DomainException,
      );
    });
  });

  describe('setPublicVisibility', () => {
    it('debe actualizar la visibilidad publica correctamente', async () => {
      const updated = { _id: '1', isPubliclyVisible: false };
      mockLodgingModel.findOneAndUpdate.mockReturnValue(withPopulate(updated));

      const result = await service.setPublicVisibility(
        lodgingId,
        { isPubliclyVisible: false },
        ownerId,
        'OWNER',
      );

      expect(result).toEqual(updated);
      expect(mockLodgingModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('debe lanzar error si el lodging no existe', async () => {
      mockLodgingModel.findOneAndUpdate.mockReturnValue(withPopulate(null));

      await expect(
        service.setPublicVisibility(lodgingId, { isPubliclyVisible: true }, ownerId, 'OWNER'),
      ).rejects.toThrow(DomainException);
    });
  });

  describe('occupiedRanges availability', () => {
    it('debe devolver occupiedRanges normalizados', async () => {
      mockLodgingModel.findOne.mockReturnValue(
        withPopulate({
          occupiedRanges: [
            {
              from: new Date('2026-01-10T15:30:00.000Z'),
              to: new Date('2026-01-15T23:59:00.000Z'),
            },
          ],
        }),
      );

      const result = await service.getOccupiedRanges(lodgingId, ownerId, 'OWNER');

      expect(result).toEqual([{ from: '2026-01-10', to: '2026-01-15' }]);
    });

    it('debe agregar occupiedRange sin conflicto', async () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const lodging = {
        occupiedRanges: [{ from: new Date('2026-01-01'), to: new Date('2026-01-03') }],
        save: mockSave,
      };
      mockLodgingModel.findOne.mockReturnValue(withPopulate(lodging));

      const result = await service.addOccupiedRange(
        lodgingId,
        { from: '2026-01-10', to: '2026-01-15' },
        ownerId,
        'OWNER',
      );

      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual([
        { from: '2026-01-01', to: '2026-01-03' },
        { from: '2026-01-10', to: '2026-01-15' },
      ]);
    });

    it('debe normalizar fechas al agregar occupiedRange', async () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const lodging = {
        occupiedRanges: [],
        save: mockSave,
      };
      mockLodgingModel.findOne.mockReturnValue(withPopulate(lodging));

      const result = await service.addOccupiedRange(
        lodgingId,
        {
          from: '2026-01-10T22:20:00.000Z',
          to: '2026-01-11T05:10:00.000Z',
        },
        ownerId,
        'OWNER',
      );

      expect(mockSave).toHaveBeenCalled();
      expect(lodging.occupiedRanges).toEqual([
        {
          from: new Date('2026-01-10T00:00:00.000Z'),
          to: new Date('2026-01-11T00:00:00.000Z'),
        },
      ]);
      expect(result).toEqual([{ from: '2026-01-10', to: '2026-01-11' }]);
    });

    it('debe rechazar occupiedRange con conflicto', async () => {
      mockLodgingModel.findOne.mockReturnValue(
        withPopulate({
          occupiedRanges: [{ from: new Date('2026-01-10'), to: new Date('2026-01-15') }],
        }),
      );

      await expect(
        service.addOccupiedRange(
          lodgingId,
          { from: '2026-01-14', to: '2026-01-20' },
          ownerId,
          'OWNER',
        ),
      ).rejects.toThrow(DomainException);
    });

    it('debe rechazar occupiedRange con conflicto en bordes inclusivos', async () => {
      mockLodgingModel.findOne.mockReturnValue(
        withPopulate({
          occupiedRanges: [{ from: new Date('2026-01-10'), to: new Date('2026-01-15') }],
        }),
      );

      await expect(
        service.addOccupiedRange(
          lodgingId,
          { from: '2026-01-15', to: '2026-01-20' },
          ownerId,
          'OWNER',
        ),
      ).rejects.toThrow(DomainException);
    });

    it('debe rechazar occupiedRange con from mayor que to', async () => {
      mockLodgingModel.findOne.mockReturnValue(
        withPopulate({
          occupiedRanges: [],
        }),
      );

      await expect(
        service.addOccupiedRange(
          lodgingId,
          { from: '2026-01-20', to: '2026-01-10' },
          ownerId,
          'OWNER',
        ),
      ).rejects.toThrow(DomainException);
    });

    it('debe eliminar occupiedRange existente', async () => {
      const mockSave = vi.fn().mockResolvedValue(true);
      const lodging = {
        occupiedRanges: [
          { from: new Date('2026-01-10'), to: new Date('2026-01-15') },
          { from: new Date('2026-01-20'), to: new Date('2026-01-22') },
        ],
        save: mockSave,
      };
      mockLodgingModel.findOne.mockReturnValue(withPopulate(lodging));

      const result = await service.removeOccupiedRange(
        lodgingId,
        { from: '2026-01-10', to: '2026-01-15' },
        ownerId,
        'OWNER',
      );

      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual([{ from: '2026-01-20', to: '2026-01-22' }]);
    });

    it('debe rechazar eliminación de occupiedRange inexistente', async () => {
      mockLodgingModel.findOne.mockReturnValue(
        withPopulate({
          occupiedRanges: [{ from: new Date('2026-01-20'), to: new Date('2026-01-22') }],
          save: vi.fn(),
        }),
      );

      await expect(
        service.removeOccupiedRange(
          lodgingId,
          { from: '2026-01-10', to: '2026-01-15' },
          ownerId,
          'OWNER',
        ),
      ).rejects.toThrow(DomainException);
    });
  });

  describe('remove', () => {
    it('debe buscar el lodging antes de eliminarlo', async () => {
      const lodging = {
        _id: '1',
        isPubliclyVisible: true,
      };
      mockLodgingModel.findOne.mockResolvedValue(lodging);
      mockLodgingModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.remove('507f1f77bcf86cd799439011', ownerId, 'OWNER');

      expect(mockLodgingModel.findOne).toHaveBeenCalled();
      expect(mockLodgingImagesService.deleteAllForLodging).toHaveBeenCalledWith(lodging);
      expect(mockLodgingModel.deleteOne).toHaveBeenCalledWith({ _id: '1' });
      expect(result).toEqual({ deleted: true });
    });

    it('debe lanzar error si no existe', async () => {
      mockLodgingModel.findOne.mockResolvedValue(null);

      await expect(service.remove('507f1f77bcf86cd799439011', ownerId, 'OWNER')).rejects.toThrow(
        DomainException,
      );
    });
  });
});
