import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Mongoose, Types } from 'mongoose';
import { userModel, type UserModel } from '../packages/runtime/src/identity/models.ts';
import { UsersRepository } from '../packages/runtime/src/identity/users.repository.ts';
import { ownerId, otherOwnerId, userId } from './identity-fixture.ts';

function query<T>(value: T) {
  const result = Object.assign(Promise.resolve(value), {
    setOptions: vi.fn(),
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    exec: vi.fn(async () => value),
  });
  for (const method of ['setOptions', 'sort', 'skip', 'limit'] as const)
    result[method].mockReturnValue(result);
  return result;
}
describe('reglas de UsersService trasladadas al repositorio', () => {
  let model: UserModel;
  let users: UsersRepository;
  beforeEach(() => {
    model = userModel(new Mongoose().connection);
    users = new UsersRepository(model, AbortSignal.timeout(5000));
  });
  it('OWNER conserva límite y no llega al alta cuando ya hay tres usuarios', async () => {
    const count = vi.spyOn(model, 'countDocuments').mockReturnValue(query(3) as never);
    const find = vi.spyOn(model, 'findOne');
    await expect(
      users.createUser(ownerId, 'OWNER', {
        email: 'a@example.test',
        username: 'abc',
        targetOwnerId: otherOwnerId,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'USER_ALREADY_EXISTS' });
    expect(count).toHaveBeenCalledWith({ ownerId: new Types.ObjectId(ownerId) });
    expect(find).not.toHaveBeenCalled();
  });
  it('SUPERADMIN usa target/fallback y traduce 11000 del guardado', async () => {
    const count = vi.spyOn(model, 'countDocuments');
    const find = vi.spyOn(model, 'findOne').mockReturnValue(query(null) as never);
    vi.spyOn(model.prototype, 'save').mockRejectedValue({ code: 11000 });
    const dto = { email: 'a@example.test', username: 'AbC' };
    await expect(
      users.createUser(ownerId, 'SUPERADMIN', { ...dto, targetOwnerId: otherOwnerId }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Ya existe un usuario con ese email o username',
    });
    expect(count).not.toHaveBeenCalled();
    expect(find).toHaveBeenLastCalledWith({
      ownerId: new Types.ObjectId(otherOwnerId),
      $or: [{ email: 'a@example.test' }, { username: 'abc' }],
    });
    await expect(users.createUser(ownerId, 'SUPERADMIN', dto)).rejects.toMatchObject({
      code: 'USER_ALREADY_EXISTS',
    });
    expect(find.mock.calls[1]![0]).toMatchObject({ ownerId: new Types.ObjectId(ownerId) });
  });
  it('lectura/actualización aíslan owner y solo SUPERADMIN amplía el scope', async () => {
    const find = vi.spyOn(model, 'findOne').mockReturnValue(query(null) as never);
    const update = vi.spyOn(model, 'findOneAndUpdate').mockReturnValue(query(null) as never);
    await expect(users.findById(ownerId, userId)).rejects.toMatchObject({
      status: 404,
      code: 'USER_NOT_FOUND',
    });
    expect(find).toHaveBeenLastCalledWith({
      _id: new Types.ObjectId(userId),
      ownerId: new Types.ObjectId(ownerId),
    });
    await expect(users.findById(ownerId, userId, 'SUPERADMIN')).rejects.toMatchObject({
      status: 404,
    });
    expect(find).toHaveBeenLastCalledWith({ _id: new Types.ObjectId(userId) });
    await expect(users.updateUser(ownerId, userId, { firstName: 'Ana' })).rejects.toMatchObject({
      status: 404,
    });
    expect(update.mock.calls[0]![0]).toEqual({
      _id: new Types.ObjectId(userId),
      ownerId: new Types.ObjectId(ownerId),
    });
    await expect(users.updateUser(ownerId, userId, {}, 'SUPERADMIN')).rejects.toMatchObject({
      status: 404,
    });
    expect(update.mock.calls[1]![0]).toEqual({ _id: new Types.ObjectId(userId) });
    await expect(users.findById(ownerId, 'bad')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_USER_ID',
    });
    await expect(users.findById('bad', userId)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_OWNER_ID',
    });
  });
  it('paginación conserva orden, offset, tamaño y scope', async () => {
    const result = query([]);
    const find = vi.spyOn(model, 'find').mockReturnValue(result as never);
    vi.spyOn(model, 'countDocuments').mockReturnValue(query(0) as never);
    expect(await users.findAllByScope(ownerId, 'OWNER', { page: 2, limit: 5 })).toEqual({
      data: [],
      total: 0,
      page: 2,
      limit: 5,
    });
    expect(find).toHaveBeenLastCalledWith({ ownerId: new Types.ObjectId(ownerId) });
    expect(result.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(result.skip).toHaveBeenCalledWith(5);
    expect(result.limit).toHaveBeenCalledWith(5);
    await users.findAllByScope(ownerId, 'SUPERADMIN', { page: 1, limit: 10 });
    expect(find).toHaveBeenLastCalledWith({});
  });
});
