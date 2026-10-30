import { createConnection, type Connection } from 'mongoose';
import { userModel } from './models.ts';
import { UsersRepository } from './users.repository.ts';

// Una conexión por instancia; una apertura fallida se cierra y permite el próximo intento.
export function database(uri: () => Promise<string>, open = createConnection) {
  let opening: Promise<Connection> | undefined;
  const connect = () => {
    opening ??= (async () => {
      const connection = open(await uri(), {
        autoIndex: false,
        autoCreate: false,
        bufferCommands: false,
        minPoolSize: 0,
        maxPoolSize: 4,
        maxIdleTimeMS: 60000,
        serverSelectionTimeoutMS: 2000,
        connectTimeoutMS: 2000,
        socketTimeoutMS: 3000,
        timeoutMS: 3000,
      });
      try {
        return await connection.asPromise();
      } catch {
        await connection.close().catch(() => undefined);
        throw new Error('Database unavailable.');
      }
    })().catch(() => {
      opening = undefined;
      throw new Error('Database unavailable.');
    });
    return opening;
  };
  return {
    connect,
    async users(signal: AbortSignal) {
      signal.throwIfAborted();
      const connection = await connect();
      signal.throwIfAborted();
      return new UsersRepository(userModel(connection), signal);
    },
    async close() {
      const connection = await opening;
      opening = undefined;
      await connection?.close();
    },
  };
}
