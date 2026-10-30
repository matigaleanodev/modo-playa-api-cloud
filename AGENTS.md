# modo-playa-api-cloud

## Contexto de trabajo

Si existe un workspace con AGENTS.md en los directorios padre, leerlo explícitamente antes de editar y seguir sus referencias. Una raíz Git anidada puede impedir la herencia automática. Fuera de ese entorno, este archivo y el README deben ser suficientes para trabajar.

## Estructura y contratos

- AWS CDK v2, handlers TypeScript, Middy/AJV y MongoDB; paquetes ESM.
- packages/contracts define metadata neutral, schemas, tipos y OpenAPI.
- packages/runtime contiene handlers, servicios y persistencia; infrastructure declara CDK.
- Mantener exports explícitos, un lockfile y límites entre workspaces privados npm.
- Grupos runtime: health, identity, catalog, management y media.
- Preservar JWT, ownerId/targetOwnerId, roles y separación público/admin.
- El catálogo público omite owner, notas, keys y datos internos.
- Conservar DELETE de disponibilidad con body JSON y transformaciones compatibles.

## Desarrollo y verificación

- Requisitos y comandos canónicos en DEVELOPMENT.md y .nvmrc.
- Instalar con npm ci --ignore-scripts --no-audit --no-fund.
- npm run check cubre límites, privacidad, lint, tipos, tests, OpenAPI, ZIP y synth local.
- npm test permite comprobaciones puntuales; usar solo fixtures y dobles explícitos.
- Las comparaciones con NestJS son de lectura; no alterar la implementación original.

## Restricciones

- Crear/borrar alojamientos exige integración real LodgingMedia; conservar 503 antes de escribir si falta.
- Preservar attach, compensación y limpieza de objetos; no sustituirlas por no-ops.
- Media recibe HTTP nativo sin envelope/base64; conservar límites multipart de 10/5 MiB y declarar su ingreso por separado.
- No importar handlers ni inicializar clientes runtime desde CDK.
- Las pruebas locales no habilitan rutas productivas ni acreditan R2/Resend/Atlas reales.
