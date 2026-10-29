# Desarrollo local

[English](DEVELOPMENT.md)

Usar la versión de Node.js de `.nvmrc` y Python 3 para empaquetar el ZIP.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Los npm workspaces privados comparten un único lockfile raíz:

- `packages/contracts`: metadata neutral de rutas, JSON Schema, tipos derivados y OpenAPI.
- `packages/runtime`: handlers Middy y validación AJV del sobre de eventos de HTTP API.
- `packages/infrastructure`: declaraciones CDK que solo importan contratos de la aplicación.

`GET /api/health` devuelve HTTP 200 con `{"status":"ok"}`. No exige body ni parámetros query y no comprueba dependencias externas.

`npm run openapi` escribe `dist/openapi.json`. `npm run build` genera el bundle health, crea `dist/health.zip` y ejecuta un smoke con configuración simulada explícita. `npm run synth:local` sintetiza `cdk.out` con referencias ficticias de cuenta, bucket y rol, sin lookups ni lectura de secretos. El template es para revisión local.

Los mismos scripts están disponibles mediante `npm run openapi --workspace=@modo-playa/contracts`, `npm run build --workspace=@modo-playa/runtime` y `npm run synth --workspace=@modo-playa/infrastructure`.
