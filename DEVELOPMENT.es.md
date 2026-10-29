# Desarrollo local

[English](DEVELOPMENT.md)

Usar Node.js de `.nvmrc`, Python 3 y `readelf` (binutils), en Linux.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Los workspaces privados comparten un lockfile raíz: `contracts` contiene metadata neutral, JSON Schema, tipos derivados y OpenAPI; `runtime`, handlers Middy/AJV, servicios y persistencia; `infrastructure`, CDK que importa solo contratos.

Los grupos runtime son `health`, `identity`, `catalog` y `management`. Health devuelve 200 `{"status":"ok"}` sin consultas externas. Identity implementa auth JSON y usuarios; catalog, alojamientos públicos y destinos; management, contactos, alojamientos, disponibilidad y dashboard. Métodos, schemas, Bearer y respuestas están en `dist/openapi.json`. Los POST devuelven 201; DELETE de disponibilidad conserva body JSON. La validación rechaza extras y conserva optional/null, transformaciones y mensajes del contrato. Los keywords `x-original-min-length`/`x-original-max-length` conservan el conteo Unicode de validator.

Contactos usa `includeInactive=false`; alojamientos admin usa `true` y aplica paginación/visibilidad, aunque acepta los filtros públicos declarados. El catálogo aplica sus filtros, incluye documentos legacy sin `isPubliclyVisible` y excluye los ocultos; su mapper omite owner, notas, keys y datos internos. OWNER mantiene scope; SUPERADMIN amplía lecturas y admite targetOwnerId/fallback en altas. En PATCH de lodging, la validación del contacto conserva el owner solicitante. Dashboard conserva agregaciones sobre `active` legacy y actividad derivada de timestamps.

Alta y borrado de alojamientos requieren integración real de `LodgingMedia`: asociación/procesamiento de drafts después de guardar, con compensación ante falla, y limpieza de objetos antes de borrar el documento. El runtime sin esa dependencia responde 503 antes de escribir. Sus contratos locales y factories con doubles no habilitan publicación de esas rutas. No hay multipart, procesamiento de imágenes ni storage real. Se conservan `uploadSessionId` y `pendingImageIds`.

Destinos conserva Open-Meteo y sunrise-sunset en paralelo, timezone y puntos de interés. Axios usa 10 segundos por proveedor bajo el deadline del request, límites de respuesta de 64 KiB para clima y 16 KiB para solar, sin redirects/retries. Clima tiene cache en memoria por destino durante 30 minutos; solar no tiene cache. Fallos se traducen a 503 sin serializar datos de Axios.

`npm run openapi` genera OpenAPI local; `/docs` y `/openapi.json` no se publican como rutas de este runtime. `npm run build` genera cuatro ZIP independientes, revisa inputs/allowlists y ejecuta smoke sobre artefactos extraídos con configuración y doubles explícitos. Catalog/management excluyen bcrypt y Resend; catalog excluye JWT. Identity contiene únicamente bcrypt Linux x86_64/glibc con su loader; la carga local no acredita Lambda administrada. Instalación sin lifecycle scripts.

`npm run synth:local` sintetiza exclusivamente health con referencias ficticias, sin lookups ni lectura de secretos. No declara infraestructura de negocio ni pipeline de despliegue.

Configuración diferida por grupo:

- `IDENTITY_SECRET_ARN`: JSON opcional con `MONGO_URI`, `SECRET_KEY`, `RESEND_API_KEY` y `RESEND_FROM_EMAIL`; también admite inyección directa. `BCRYPT_ROUNDS` usa 12; `SUPERADMIN_OWNER_ID` determina el rol de sesión. No hay clave JWT de ejemplo.
- `CATALOG_SECRET_ARN`: JSON opcional con `MONGO_URI`. `MANAGEMENT_SECRET_ARN`: JSON opcional con `MONGO_URI` y `SECRET_KEY`. También admiten inyección directa, sin credenciales de correo ni bcrypt.
- `MEDIA_PUBLIC_BASE_URL`, `R2_ENDPOINT` y `R2_BUCKET`: mapeo puro de imágenes existentes, sin clientes de storage.

Mongo reutiliza conexión por instancia, pool máximo 4 y plazos acotados, sin autoCreate/autoIndex. Conserva `users`, `contacts`, `lodgings`, ObjectId, timestamps, índices declarados y campos legacy. Dashboard reutiliza el modelo User de identidad.

Tests y smoke usan factories y dependencias simuladas; HTTP externo se prueba con doubles/servidor loopback. `LOCAL_MONGOD=/ruta/al/mongod` habilita persistencia real en un proceso/base temporal propios, con cleanup y bind loopback; no recibe URI externa. Sin esa variable se omite solo esa suite. `ORIGINAL_API_DIR=/ruta/modo-playa-api node scripts/compare-original.mjs` contrasta JWT y DTOs concretos contra una copia local con sus dependencias instaladas, sin leer `.env`.

También se admiten scripts desde cada workspace: `npm run openapi` en contracts, `npm run build` en runtime y `npm run synth` en infrastructure.
