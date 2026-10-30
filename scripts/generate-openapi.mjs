import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createOpenApiDocument } from '@modo-playa/contracts/openapi';

const root = new URL('..', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(
  new URL('dist/openapi.json', root),
  JSON.stringify(createOpenApiDocument(), null, 2) + '\n',
);
console.info(`OpenAPI generado en ${fileURLToPath(new URL('dist/openapi.json', root))}.`);
