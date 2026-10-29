# Desarrollo local

[English](DEVELOPMENT.md)

Usar Node.js de `.nvmrc`, Python 3 y `readelf` (binutils), en Linux.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Los workspaces privados comparten un lockfile raíz:

- `packages/contracts`: metadata neutral de rutas, JSON Schema, tipos derivados y OpenAPI.
- `packages/runtime`: handlers Middy/AJV; identidad con Mongo, JWT, bcrypt y Resend.
- `packages/infrastructure`: CDK que importa únicamente contratos de la aplicación.

`GET /api/health` devuelve 200 `{"status":"ok"}`, sin body obligatorio ni consultas externas. Identidad implementa auth JSON y POST/GET/PATCH de usuarios; los métodos y contratos están en `dist/openapi.json`. Los POST devuelven 201. La validación rechaza campos extra; los keywords `x-original-min-length` y `x-original-max-length` conservan el conteo Unicode de validator. El listado de usuarios usa page=1/limit=10 y limita enteros superiores a 50.

`npm run openapi` genera OpenAPI. `npm run build` crea `health.zip` e `identity.zip`, revisa sus allowlists y prueba los ZIP extraídos con dependencias simuladas. Health permanece separado de identidad. Identity incluye únicamente el prebuild bcrypt Linux x86_64/glibc y su loader; la prueba local no acredita el runtime administrado de Lambda. Se mantienen deshabilitados los lifecycle scripts de instalación.

`npm run synth:local` sintetiza exclusivamente health con referencias ficticias, sin lookups ni lectura de secretos. El template es para revisión local; no declara infraestructura de identidad.

Configuración de identidad, cargada al invocar el runtime:

- `IDENTITY_SECRET_ARN`: referencia opcional a un JSON con `MONGO_URI`, `SECRET_KEY`, `RESEND_API_KEY` y `RESEND_FROM_EMAIL`. También se admite inyectar esos campos directamente. No hay clave JWT de ejemplo por defecto.
- `BCRYPT_ROUNDS`: 12 por defecto; `SUPERADMIN_OWNER_ID`: owner que determina el rol de sesión.
- `MEDIA_PUBLIC_BASE_URL`, `R2_ENDPOINT` y `R2_BUCKET`: solo mapeo de metadata de imágenes existentes, sin clientes de storage.

La conexión Mongo se reutiliza por instancia con pool máximo 4, deadlines y sin autoCreate/autoIndex. Se conserva la colección `users`. Tests y smoke usan factories con configuración explícita y correo simulado. La prueba opcional de persistencia requiere `LOCAL_MONGOD=/ruta/al/mongod`: inicia su propio proceso en loopback y elimina su base temporal; no recibe una URI externa. Sin esa variable se omite únicamente esa prueba.

Para contrastar JWT/DTOs contra una copia local del original con sus dependencias instaladas, usar `ORIGINAL_API_DIR=/ruta/modo-playa-api node scripts/compare-original.mjs`. Solo utiliza datos y claves simulados; no lee entornos privados.

También se admiten los scripts desde cada workspace: `npm run openapi` en contracts, `npm run build` en runtime y `npm run synth` en infrastructure.
