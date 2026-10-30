# Desarrollo local

[English](DEVELOPMENT.md)

Usar Node.js de `.nvmrc`, Python 3 y `readelf` (binutils), en Linux.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Los workspaces privados comparten un lockfile raíz: `contracts` contiene metadata neutral, JSON Schema, tipos derivados y OpenAPI; `runtime`, handlers Middy/AJV, servicios y persistencia; `infrastructure`, CDK que importa solo contratos.

Los grupos runtime son `health`, `identity`, `catalog`, `management` y `media`. Health devuelve 200 `{"status":"ok"}` sin consultas externas. Identity implementa auth JSON y usuarios; catalog, alojamientos públicos y destinos; management, contactos y dashboard; media, HTTP nativo de perfil, drafts, imágenes y gestión completa de alojamientos/disponibilidad. Métodos, schemas, Bearer y respuestas están en `dist/openapi.json`. Los POST devuelven 201; DELETE de disponibilidad conserva body JSON. La validación rechaza extras y conserva optional/null, transformaciones y mensajes del contrato. Los keywords `x-original-min-length`/`x-original-max-length` conservan el conteo Unicode de validator.

Contactos usa `includeInactive=false`; alojamientos admin usa `true` y aplica paginación/visibilidad, aunque acepta los filtros públicos declarados. El catálogo aplica sus filtros, incluye documentos legacy sin `isPubliclyVisible` y excluye los ocultos; su mapper omite owner, notas, keys y datos internos. OWNER mantiene scope; SUPERADMIN amplía lecturas y admite targetOwnerId/fallback en altas. En PATCH de lodging, la validación del contacto conserva el owner solicitante. Dashboard conserva agregaciones sobre `active` legacy y actividad derivada de timestamps.

Media conserva multipart backend-only con campo `file`: hasta 10 MiB por imagen de alojamiento y 5 MiB por perfil, además de 128 KiB para el envelope multipart. El parser limita partes/campos y consume rechazos antes de responder. El procesamiento conserva rotación, resize inside sin enlargement y WebP: alojamiento 2560×2560/calidad 82; perfil 1024×1024/calidad 84, configurables. Perfil usa userId/ownerId propios y rechaza SUPERADMIN. Drafts conservan PENDING/CONFIRMED, owner/session, TTL, keys staging/finales y orden de pendingImageIds; hasta cinco imágenes y un default.

Alta guarda y asocia drafts; ante falla confirma el borrado del documento antes de compensar finales posiblemente referenciados. Si ese borrado falla, conserva objetos y propaga error, sin retry automático. Borrado de lodging limpia objetos finales, pending y legacy antes del documento. Limpiezas best effort conservan ese carácter; TTL Mongo no elimina objetos R2. Sin dependencia/configuración real se rechaza con 503 antes de escribir.

El grupo media escucha en `AWS_LAMBDA_HTTP_ENDPOINT` mediante `index.js`; recibe HTTP sin evento/base64. Está destinado al modelo Lambda Web Functions Node24 ARM64, con JWT propio; no pasa uploads por HTTP API/Event Lambda. El ingreso y sus controles se declaran por separado. R2 usa PutObject con ContentLength conocido, spool temporal privado y sin retries/checksums opcionales aws-chunked; HeadBucket es el único efecto de media health. `MEDIA_REQUEST_TIMEOUT_MS` limita cada request (90000 por defecto); desconexiones/deadlines cancelan streams y compensaciones usan plazo independiente.

Destinos conserva Open-Meteo y sunrise-sunset en paralelo, timezone y puntos de interés. Axios usa 10 segundos por proveedor bajo el deadline del request, límites de respuesta de 64 KiB para clima y 16 KiB para solar, sin redirects/retries. Clima tiene cache en memoria por destino durante 30 minutos; solar no tiene cache. Fallos se traducen a 503 sin serializar datos de Axios.

`npm run openapi` genera OpenAPI local; `/docs` y `/openapi.json` no se publican como rutas de este runtime. `npm run build` genera cinco ZIP independientes, revisa inputs/allowlists y ejecuta smoke sobre artefactos extraídos con configuración y doubles explícitos. Catalog/management/media excluyen bcrypt y Resend; catalog excluye JWT. Identity contiene únicamente bcrypt Linux x86_64/glibc con su loader; la carga local no acredita Lambda administrada. Instalación sin lifecycle scripts. Build prepara los dos prebuilds Sharp ARM64 fijados por el lockfile en cache local ignorado, verificando SHA-512 y extracción acotada/sin symlinks; requiere acceso al registry solo si faltan. `npm run prepare:media-native` permite prepararlos explícitamente. El ZIP media incluye únicamente Sharp/libvips Linux ARM64; una carga en Ubuntu x64 no acredita ese binario ni ingreso administrado.

`npm run synth:local` sintetiza exclusivamente health con referencias ficticias, sin lookups ni lectura de secretos. No declara infraestructura de negocio ni pipeline de despliegue.

Configuración diferida por grupo:

- `IDENTITY_SECRET_ARN`: JSON opcional con `MONGO_URI`, `SECRET_KEY`, `RESEND_API_KEY` y `RESEND_FROM_EMAIL`; también admite inyección directa. `BCRYPT_ROUNDS` usa 12; `SUPERADMIN_OWNER_ID` determina el rol de sesión. No hay clave JWT de ejemplo.
- `CATALOG_SECRET_ARN`: JSON opcional con `MONGO_URI`. `MANAGEMENT_SECRET_ARN`: JSON opcional con `MONGO_URI` y `SECRET_KEY`. También admiten inyección directa, sin credenciales de correo ni bcrypt.
- `MEDIA_SECRET_ARN`: JSON opcional con `MONGO_URI`, `SECRET_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`; también admite inyección directa. `R2_REGION` usa `auto`. `MEDIA_PUBLIC_BASE_URL` conserva URLs/variantes; `IMAGE_ALLOWED_MIME`, `PENDING_UPLOAD_TTL_SECONDS`, `LODGING_IMAGE_MAX_BYTES/WIDTH/HEIGHT` y `USER_PROFILE_IMAGE_MAX_BYTES/WIDTH/HEIGHT` conservan las opciones del original. Los demás grupos solo mapean URLs, sin storage.

Mongo reutiliza conexión por instancia, pool máximo 4 y plazos acotados, sin autoCreate/autoIndex. Conserva `users`, `contacts`, `lodgings`, ObjectId, timestamps, índices declarados y campos legacy. Dashboard reutiliza el modelo User de identidad.

Tests y smoke usan factories y dependencias simuladas; HTTP externo se prueba con doubles/servidor loopback. `LOCAL_MONGOD=/ruta/al/mongod` habilita persistencia real en un proceso/base temporal propios, con cleanup y bind loopback; no recibe URI externa. Sin esa variable se omiten las suites de persistencia; parser HTTP, errores de streams y HEAD siguen cubiertos sin Mongo. Las pruebas media con Mongo usan Sharp real, imágenes válidas cerca de los máximos y storage sustituido; no acreditan R2/Atlas ni ingreso administrados. `ORIGINAL_API_DIR=/ruta/modo-playa-api node scripts/compare-original.mjs` contrasta JWT y DTOs concretos contra una copia local con sus dependencias instaladas, sin leer `.env`.

También se admiten scripts desde cada workspace: `npm run openapi` en contracts, `npm run build` en runtime y `npm run synth` en infrastructure.
