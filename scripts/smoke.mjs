import assert from 'node:assert/strict';
import { createHealthHandler } from '../dist/health.mjs';
import { event, context } from '../test/helpers.ts';

// Configuración simulada explícita; no depende del entorno del proceso ni de servicios externos.
const handler = createHealthHandler({ logRequests: false });
const response = await handler(event(), context);
assert.equal(response.statusCode, 200);
assert.equal(response.body, '{"status":"ok"}');
assert.equal((await handler(event('/api/not-declared'), context)).statusCode, 404);
console.info('Smoke del bundle aprobado con configuración simulada explícita.');
