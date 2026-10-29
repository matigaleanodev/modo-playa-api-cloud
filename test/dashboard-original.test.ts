import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { Types } from 'mongoose';

import { DashboardService } from '../packages/runtime/src/business/dashboard.service.ts';

type AggregatePipeline = Array<Record<string, unknown>>;

const createQueryMock = <T>(result: T) => ({
  sort: vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      lean: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(result),
      }),
    }),
  }),
});

type QueryMock = ReturnType<typeof createQueryMock<unknown[]>>;

type DashboardModelMock = {
  aggregate: Mock<(pipeline: AggregatePipeline) => Promise<unknown>>;
  find: Mock<(filter: unknown) => QueryMock>;
};

describe('DashboardService', () => {
  let service: DashboardService;

  const lodgingModelMock: DashboardModelMock = {
    aggregate: vi.fn() as Mock<(pipeline: AggregatePipeline) => Promise<unknown>>,
    find: vi.fn() as Mock<(filter: unknown) => QueryMock>,
  };

  const contactModelMock: DashboardModelMock = {
    aggregate: vi.fn() as Mock<(pipeline: AggregatePipeline) => Promise<unknown>>,
    find: vi.fn() as Mock<(filter: unknown) => QueryMock>,
  };

  const userModelMock: DashboardModelMock = {
    aggregate: vi.fn() as Mock<(pipeline: AggregatePipeline) => Promise<unknown>>,
    find: vi.fn() as Mock<(filter: unknown) => QueryMock>,
  };

  beforeEach(async () => {
    service = new DashboardService(
      lodgingModelMock as never,
      contactModelMock as never,
      userModelMock as never,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('debe aplicar filtro por ownerId para OWNER y construir métricas/alertas', async () => {
    const ownerId = new Types.ObjectId().toString();

    lodgingModelMock.aggregate.mockResolvedValueOnce([
      {
        totals: [
          {
            total: 2,
            active: 1,
            inactive: 1,
            withAvailability: 1,
            withoutContact: 1,
          },
        ],
        byCity: [{ city: 'Mar del Plata', total: 2, active: 1, inactive: 1 }],
        byType: [{ type: 'HOUSE', total: 2 }],
      },
    ]);
    contactModelMock.aggregate.mockResolvedValueOnce([
      {
        total: 1,
        active: 1,
        inactive: 0,
        defaults: 1,
        withEmail: 0,
        withWhatsapp: 0,
        incomplete: 1,
      },
    ]);
    userModelMock.aggregate.mockResolvedValueOnce([
      {
        total: 1,
        active: 1,
        inactive: 0,
        passwordSet: 0,
        pendingActivation: 1,
        neverLoggedIn: 1,
      },
    ]);

    const now = new Date('2026-02-23T12:00:00.000Z');
    lodgingModelMock.find.mockReturnValue(
      createQueryMock([
        {
          _id: new Types.ObjectId(),
          title: 'Casa test',
          createdAt: new Date('2026-02-20T12:00:00.000Z'),
          updatedAt: now,
        },
      ]),
    );
    contactModelMock.find.mockReturnValue(createQueryMock([]));
    userModelMock.find.mockReturnValue(createQueryMock([]));

    const result = await service.getSummary(ownerId, 'OWNER');

    const lodgingPipeline = lodgingModelMock.aggregate.mock.calls[0]?.[0];
    const contactPipeline = contactModelMock.aggregate.mock.calls[0]?.[0];
    const userPipeline = userModelMock.aggregate.mock.calls[0]?.[0];

    expect(lodgingPipeline).toBeDefined();
    expect(contactPipeline).toBeDefined();
    expect(userPipeline).toBeDefined();

    const lodgingMatch = lodgingPipeline?.[0]?.$match as {
      ownerId: Types.ObjectId;
    };
    const contactMatch = contactPipeline?.[0]?.$match as {
      ownerId: Types.ObjectId;
    };
    const userMatch = userPipeline?.[0]?.$match as { ownerId: Types.ObjectId };

    expect(lodgingMatch.ownerId.toString()).toBe(ownerId);
    expect(contactMatch.ownerId.toString()).toBe(ownerId);
    expect(userMatch.ownerId.toString()).toBe(ownerId);

    expect(result.metrics.lodgings.total).toBe(2);
    expect(result.metrics.contacts.incomplete).toBe(1);
    expect(result.metrics.users.pendingActivation).toBe(1);
    expect(result.distributions.lodgingsByCity).toHaveLength(1);
    expect(result.recentActivity.source).toBe('timestamps');
    expect(result.alerts.map((a) => a.code)).toEqual(
      expect.arrayContaining([
        'LODGING_WITHOUT_CONTACT',
        'CONTACT_INCOMPLETE',
        'USER_PENDING_ACTIVATION',
        'INACTIVE_LODGINGS_PRESENT',
      ]),
    );
  });

  it('debe omitir filtro ownerId para SUPERADMIN', async () => {
    const ownerId = new Types.ObjectId().toString();

    lodgingModelMock.aggregate.mockResolvedValueOnce([{ totals: [], byCity: [], byType: [] }]);
    contactModelMock.aggregate.mockResolvedValueOnce([]);
    userModelMock.aggregate.mockResolvedValueOnce([]);
    lodgingModelMock.find.mockReturnValue(createQueryMock([]));
    contactModelMock.find.mockReturnValue(createQueryMock([]));
    userModelMock.find.mockReturnValue(createQueryMock([]));

    const result = await service.getSummary(ownerId, 'SUPERADMIN');

    const lodgingPipeline = lodgingModelMock.aggregate.mock.calls[0]?.[0];
    const contactPipeline = contactModelMock.aggregate.mock.calls[0]?.[0];
    const userPipeline = userModelMock.aggregate.mock.calls[0]?.[0];

    expect(lodgingPipeline?.[0]?.$match).toEqual({});
    expect(contactPipeline?.[0]?.$match).toEqual({});
    expect(userPipeline?.[0]?.$match).toEqual({});
    expect(result.ownerScope.role).toBe('SUPERADMIN');
    expect(result.recentActivity.source).toBe('none');
  });

  it('debe priorizar la sugerencia de crear contacto cuando no hay contactos', async () => {
    const ownerId = new Types.ObjectId().toString();

    lodgingModelMock.aggregate.mockResolvedValueOnce([
      {
        totals: [
          {
            total: 1,
            active: 1,
            inactive: 0,
            withAvailability: 0,
            withoutContact: 1,
          },
        ],
        byCity: [],
        byType: [],
      },
    ]);
    contactModelMock.aggregate.mockResolvedValueOnce([
      {
        total: 0,
        active: 0,
        inactive: 0,
        defaults: 0,
        withEmail: 0,
        withWhatsapp: 0,
        incomplete: 0,
      },
    ]);
    userModelMock.aggregate.mockResolvedValueOnce([
      {
        total: 0,
        active: 0,
        inactive: 0,
        passwordSet: 0,
        pendingActivation: 0,
        neverLoggedIn: 0,
      },
    ]);

    lodgingModelMock.find.mockReturnValue(createQueryMock([]));
    contactModelMock.find.mockReturnValue(createQueryMock([]));
    userModelMock.find.mockReturnValue(createQueryMock([]));

    const result = await service.getSummary(ownerId, 'OWNER');

    expect(result.alerts[0]?.code).toBe('CONTACTS_NOT_CREATED');
    expect(result.alerts.map((a) => a.code)).toEqual(
      expect.arrayContaining(['LODGING_WITHOUT_CONTACT']),
    );
  });

  it('devuelve codigo explicito si ownerId es invalido', async () => {
    await expect(service.getSummary('invalid-owner-id', 'OWNER')).rejects.toMatchObject({
      message: 'Invalid owner id',
      code: 'INVALID_OWNER_ID',
    });
  });
});
